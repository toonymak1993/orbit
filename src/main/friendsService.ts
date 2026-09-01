import { EventEmitter } from 'node:events'
import { shell } from 'electron'
import Store from 'electron-store'
import { FRIENDS_PROVIDERS } from '@shared/ipc'
import type {
  DiscordChatEvent,
  DiscordChatHistory,
  DiscordChatInbox,
  DiscordChatSendResult,
  DiscordServerList,
  FriendPresence,
  EpicAccount,
  FriendsProvider,
  FriendsProviderIssue,
  FriendsProviderStatus,
  FriendsSnapshot,
  OrbitFriend,
  SteamAccount
} from '@shared/ipc'
import { steamAuthManager } from './steam/steamAuth'
import { parseSteamCommunityFriendsHtml } from './steam/steamWebParsers'
import { discordSocialService } from './discord/discordSocialService'
import type { DiscordSocialSnapshot } from './discord/discordSocialProtocol'
import { ORBIT_DISCORD_APPLICATION_ID } from './discord/discordApplication'
import { epicAuthManager } from './epic/epicAuth'
import {
  epicSocialPresence,
  type EpicPresenceSnapshot
} from './epic/epicSocialPresence'

const STEAM_ID_PATTERN = /^\d{17}$/
const EPIC_ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/i
const MAX_STEAM_FRIENDS = 2_000
const MAX_EPIC_FRIENDS = 2_000
const MAX_EPIC_BATCH_SIZE = 50
const MAX_STEAM_FRIENDS_RESPONSE_BYTES = 8 * 1024 * 1024
const MAX_EPIC_RESPONSE_BYTES = 8 * 1024 * 1024
const VISIBLE_REFRESH_BUDGET_MS = 4_000

const friendsCache = new Store<{ snapshot?: FriendsSnapshot }>({
  name: 'orbit-friends-cache-v1',
  defaults: {}
})

class FriendsProviderError extends Error {
  constructor(readonly issue: FriendsProviderIssue) {
    super(issue)
  }
}

interface ProviderRefreshResult {
  friends: OrbitFriend[]
  status: FriendsProviderStatus
}

function providerStatus(
  provider: FriendsProvider,
  state: FriendsProviderStatus['state'],
  issue?: FriendsProviderIssue
): FriendsProviderStatus {
  return { provider, state, friendCount: 0, onlineCount: 0, issue }
}

function initialSnapshot(): FriendsSnapshot {
  return {
    friends: [],
    providers: {
      steam: providerStatus('steam', 'not-connected'),
      discord: providerStatus('discord', 'not-connected'),
      epic: providerStatus('epic', 'not-connected')
    },
    updatedAt: 0,
    isRefreshing: false
  }
}

function discordProviderStatus(snapshot: DiscordSocialSnapshot): FriendsProviderStatus {
  const onlineCount = snapshot.friends.filter((friend) => onlinePresence(friend.presence)).length
  return {
    provider: 'discord',
    state: snapshot.state,
    friendCount: snapshot.friends.length,
    onlineCount,
    updatedAt: snapshot.updatedAt || undefined,
    accountName: snapshot.accountName,
    issue: snapshot.issue
  }
}

function trustedSteamUrl(value: unknown, kind: 'avatar' | 'profile'): string | undefined {
  if (typeof value !== 'string' || value.length > 2_048) return undefined
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    if (url.protocol !== 'https:') return undefined
    if (kind === 'profile') {
      return host === 'steamcommunity.com' || host.endsWith('.steamcommunity.com')
        ? url.toString()
        : undefined
    }
    return host === 'steamstatic.com' || host.endsWith('.steamstatic.com')
      ? url.toString()
      : undefined
  } catch {
    return undefined
  }
}

function normalizedDisplayName(value: unknown, steamId: string): string {
  if (typeof value !== 'string') return `Steam ${steamId.slice(-6)}`
  const name = value.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return name ? name.slice(0, 80) : `Steam ${steamId.slice(-6)}`
}

function normalizedActivity(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const activity = value.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return activity ? activity.slice(0, 100) : undefined
}

function cachedHttpsUrl(value: unknown, provider: FriendsProvider, kind: 'avatar' | 'profile'):
  | string
  | undefined {
  if (typeof value !== 'string' || value.length > 2_048) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return undefined
    const host = url.hostname.toLowerCase()
    if (kind === 'profile') {
      return provider === 'steam' &&
        (host === 'steamcommunity.com' || host.endsWith('.steamcommunity.com'))
        ? url.toString()
        : undefined
    }
    if (
      (provider === 'steam' && (host === 'steamstatic.com' || host.endsWith('.steamstatic.com'))) ||
      (provider === 'discord' &&
        (host === 'cdn.discordapp.com' || host === 'media.discordapp.net'))
    ) {
      return url.toString()
    }
    return undefined
  } catch {
    return undefined
  }
}

function validProviderUserId(provider: FriendsProvider, value: string): boolean {
  if (provider === 'steam') return STEAM_ID_PATTERN.test(value)
  if (provider === 'discord') return /^\d{17,20}$/.test(value)
  return EPIC_ACCOUNT_ID_PATTERN.test(value)
}

function sanitizedCachedFriend(value: unknown): OrbitFriend | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const friend = value as Partial<OrbitFriend>
  if (!FRIENDS_PROVIDERS.includes(friend.provider as FriendsProvider)) return null
  const provider = friend.provider as FriendsProvider
  if (
    typeof friend.providerUserId !== 'string' ||
    !validProviderUserId(provider, friend.providerUserId) ||
    friend.id !== `${provider}:${friend.providerUserId}`
  ) {
    return null
  }
  const displayName =
    typeof friend.displayName === 'string'
      ? friend.displayName.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 100)
      : ''
  const presences: FriendPresence[] = ['online', 'away', 'busy', 'offline', 'unknown']
  if (!displayName || !presences.includes(friend.presence as FriendPresence)) return null
  const lastSeenAt =
    typeof friend.lastSeenAt === 'number' &&
    Number.isFinite(friend.lastSeenAt) &&
    friend.lastSeenAt > 0 &&
    friend.lastSeenAt <= Date.now()
      ? friend.lastSeenAt
      : undefined
  return {
    id: friend.id,
    provider,
    providerUserId: friend.providerUserId,
    displayName,
    avatarUrl: cachedHttpsUrl(friend.avatarUrl, provider, 'avatar'),
    profileUrl: cachedHttpsUrl(friend.profileUrl, provider, 'profile'),
    presence: friend.presence as FriendPresence,
    activity: normalizedActivity(friend.activity),
    lastSeenAt
  }
}

function sanitizedAccountName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const accountName = value.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return accountName ? accountName.slice(0, 100) : undefined
}

function cachedSnapshot(): FriendsSnapshot {
  const cached = friendsCache.get('snapshot')
  if (!cached || !Array.isArray(cached.friends)) return initialSnapshot()
  const friends = cached.friends
    .map(sanitizedCachedFriend)
    .filter((friend): friend is OrbitFriend => friend !== null)
    .filter((friend) => friend.provider !== 'discord')
  const providers = Object.fromEntries(
    FRIENDS_PROVIDERS.map((provider) => {
      const providerFriends = friends.filter((friend) => friend.provider === provider)
      const cachedStatus = cached.providers?.[provider]
      const ready =
        provider !== 'discord' &&
        (cachedStatus?.state === 'ready' || providerFriends.length > 0)
      const status: FriendsProviderStatus = {
        provider,
        state: ready ? 'ready' : 'not-connected',
        friendCount: providerFriends.length,
        onlineCount: providerFriends.filter((friend) => onlinePresence(friend.presence)).length,
        updatedAt:
          typeof cachedStatus?.updatedAt === 'number' && Number.isFinite(cachedStatus.updatedAt)
            ? cachedStatus.updatedAt
            : undefined,
        accountName:
          provider === 'discord' ? undefined : sanitizedAccountName(cachedStatus?.accountName)
      }
      return [provider, status]
    })
  ) as FriendsSnapshot['providers']
  return {
    friends,
    providers,
    updatedAt:
      typeof cached.updatedAt === 'number' && Number.isFinite(cached.updatedAt)
        ? cached.updatedAt
        : 0,
    isRefreshing: false
  }
}

function onlinePresence(presence: FriendPresence): boolean {
  return presence !== 'offline' && presence !== 'unknown'
}

function toOrbitFriend(
  player: ReturnType<typeof parseSteamCommunityFriendsHtml>[number]
): OrbitFriend | null {
  const steamId = player.steamId
  if (!STEAM_ID_PATTERN.test(steamId)) return null
  return {
    id: `steam:${steamId}`,
    provider: 'steam',
    providerUserId: steamId,
    displayName: normalizedDisplayName(player.displayName, steamId),
    avatarUrl: trustedSteamUrl(player.avatarUrl, 'avatar'),
    profileUrl:
      trustedSteamUrl(player.profileUrl, 'profile') ??
      `https://steamcommunity.com/profiles/${steamId}/`,
    presence: player.presence,
    activity: normalizedActivity(player.activity)
  }
}

async function fetchSteamFriends(steamId: string): Promise<OrbitFriend[]> {
  const url = new URL(`https://steamcommunity.com/profiles/${steamId}/friends/`)
  url.searchParams.set('ajax', '1')
  url.searchParams.set('l', 'english')
  const response = await steamAuthManager.fetchAuthenticated(url, {
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(15_000)
  })
  if (response.status === 401 || response.status === 403) {
    throw new FriendsProviderError('authentication-failed')
  }
  if (!response.ok || response.url.includes('/login')) {
    throw new FriendsProviderError('provider-unavailable')
  }
  const source = await response.text()
  if (Buffer.byteLength(source, 'utf8') > MAX_STEAM_FRIENDS_RESPONSE_BYTES) {
    throw new FriendsProviderError('provider-unavailable')
  }
  if (!/\bid=["']friends_list["']/i.test(source) || !/\bfriends_list_ctn\b/i.test(source)) {
    throw new FriendsProviderError(
      /profile_fatalerror|profile_private_info|private profile/i.test(source)
        ? 'private-profile'
        : 'provider-unavailable'
    )
  }

  const friends = parseSteamCommunityFriendsHtml(source)
    .slice(0, MAX_STEAM_FRIENDS)
    .map(toOrbitFriend)
    .filter((friend): friend is OrbitFriend => friend !== null)
  return friends.sort(
    (left, right) =>
      Number(onlinePresence(right.presence)) - Number(onlinePresence(left.presence)) ||
      Number(Boolean(right.activity)) - Number(Boolean(left.activity)) ||
      left.displayName.localeCompare(right.displayName)
  )
}

interface EpicFriendSummaryEntry {
  accountId?: unknown
  alias?: unknown
}

interface EpicFriendSummaryResponse {
  friends?: EpicFriendSummaryEntry[]
}

interface EpicPublicAccount {
  id?: unknown
  displayName?: unknown
}

type EpicLastOnlineResponse = Record<string, Array<{ last_online?: unknown }>>

async function readEpicJson<T>(response: Response): Promise<T> {
  const source = await response.text()
  if (Buffer.byteLength(source, 'utf8') > MAX_EPIC_RESPONSE_BYTES) {
    throw new FriendsProviderError('provider-unavailable')
  }
  try {
    return JSON.parse(source) as T
  } catch {
    throw new FriendsProviderError('provider-unavailable')
  }
}

async function fetchEpicJson<T>(url: string | URL): Promise<T> {
  const response = await epicAuthManager.fetchAuthenticated(url, {
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(15_000)
  })
  if (response.status === 401 || response.status === 403) {
    throw new FriendsProviderError('authentication-failed')
  }
  if (!response.ok) throw new FriendsProviderError('provider-unavailable')
  return readEpicJson<T>(response)
}

function cleanEpicDisplayName(value: unknown, accountId: string): string {
  if (typeof value !== 'string') return `Epic ${accountId.slice(-6)}`
  const name = value.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return name ? name.slice(0, 80) : `Epic ${accountId.slice(-6)}`
}

async function fetchEpicAccountNames(accountIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  for (let offset = 0; offset < accountIds.length; offset += MAX_EPIC_BATCH_SIZE) {
    const url = new URL(
      'https://account-public-service-prod03.ol.epicgames.com/account/api/public/account'
    )
    for (const accountId of accountIds.slice(offset, offset + MAX_EPIC_BATCH_SIZE)) {
      url.searchParams.append('accountId', accountId)
    }
    const accounts = await fetchEpicJson<EpicPublicAccount[]>(url)
    if (!Array.isArray(accounts)) continue
    for (const account of accounts) {
      if (!EPIC_ACCOUNT_ID_PATTERN.test(String(account.id ?? ''))) continue
      names.set(String(account.id), cleanEpicDisplayName(account.displayName, String(account.id)))
    }
  }
  return names
}

async function fetchEpicLastSeen(accountId: string): Promise<Map<string, number>> {
  const lastSeen = new Map<string, number>()
  const response = await fetchEpicJson<EpicLastOnlineResponse>(
    `https://presence-public-service-prod.ol.epicgames.com/presence/api/v1/_/${accountId}/last-online`
  )
  if (!response || typeof response !== 'object' || Array.isArray(response)) return lastSeen
  for (const [friendId, records] of Object.entries(response)) {
    if (!EPIC_ACCOUNT_ID_PATTERN.test(friendId) || !Array.isArray(records)) continue
    const value = records[0]?.last_online
    if (typeof value !== 'string') continue
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed) && parsed > 0 && parsed <= Date.now()) lastSeen.set(friendId, parsed)
  }
  return lastSeen
}

async function fetchEpicFriends(accountId: string): Promise<OrbitFriend[]> {
  const summary = await fetchEpicJson<EpicFriendSummaryResponse>(
    `https://friends-public-service-prod.ol.epicgames.com/friends/api/v1/${accountId}/summary`
  )
  if (!Array.isArray(summary?.friends)) {
    throw new FriendsProviderError('provider-unavailable')
  }
  const relations = summary.friends
    .slice(0, MAX_EPIC_FRIENDS)
    .filter((friend) => EPIC_ACCOUNT_ID_PATTERN.test(String(friend.accountId ?? '')))
  const friendIds = [...new Set(relations.map((friend) => String(friend.accountId)))]
  const [names, lastSeen, livePresence] = await Promise.all([
    fetchEpicAccountNames(friendIds).catch(() => new Map<string, string>()),
    fetchEpicLastSeen(accountId).catch(() => new Map<string, number>()),
    epicAuthManager
      .getAccessToken()
      .then((token) => epicSocialPresence.connect(accountId, token, friendIds))
      .catch(
        (): EpicPresenceSnapshot => ({ accountId, connected: false, presences: {} })
      )
  ])

  return relations
    .map((relation): OrbitFriend => {
      const friendId = String(relation.accountId)
      const live = livePresence.presences[friendId]
      const alias = cleanEpicDisplayName(relation.alias, friendId)
      return {
        id: `epic:${friendId}`,
        provider: 'epic',
        providerUserId: friendId,
        displayName: names.get(friendId) ?? alias,
        presence: livePresence.connected ? (live?.presence ?? 'offline') : 'unknown',
        activity: live?.activity,
        lastSeenAt: lastSeen.get(friendId)
      }
    })
    .sort(
      (left, right) =>
        Number(onlinePresence(right.presence)) - Number(onlinePresence(left.presence)) ||
        Number(Boolean(right.activity)) - Number(Boolean(left.activity)) ||
        left.displayName.localeCompare(right.displayName)
    )
}

export class FriendsService extends EventEmitter {
  private snapshot = cachedSnapshot()
  private refreshInFlight: Promise<FriendsSnapshot> | null = null
  private disposed = false

  constructor() {
    super()
    discordSocialService.on('updated', this.handleDiscordUpdated)
    discordSocialService.on('chat-message', this.handleDiscordChatMessage)
    epicSocialPresence.on('updated', this.handleEpicPresenceUpdated)
  }

  getSnapshot(): FriendsSnapshot {
    return structuredClone(this.snapshot)
  }

  private publish(snapshot: FriendsSnapshot): FriendsSnapshot {
    this.snapshot = snapshot
    if (!snapshot.isRefreshing) {
      try {
        const cachedFriends = snapshot.friends.filter((friend) => friend.provider !== 'discord')
        friendsCache.set('snapshot', {
          ...snapshot,
          friends: cachedFriends,
          providers: {
            ...snapshot.providers,
            discord: providerStatus('discord', 'not-connected')
          },
          isRefreshing: false
        })
      } catch {
        // A read-only or temporarily unavailable cache must not block live friends.
      }
    }
    this.emit('updated', this.getSnapshot())
    return this.getSnapshot()
  }

  private mergeDiscord(snapshot: DiscordSocialSnapshot): FriendsSnapshot {
    const previous = this.snapshot
    const cachedFriends = previous.friends.filter((friend) => friend.provider === 'discord')
    const friends =
      snapshot.state === 'connecting' || snapshot.state === 'error'
        ? snapshot.friends.length > 0
          ? snapshot.friends
          : cachedFriends
        : snapshot.friends
    const discordStatus = discordProviderStatus({ ...snapshot, friends })
    return this.publish({
      ...previous,
      friends: [
        ...previous.friends.filter((friend) => friend.provider !== 'discord'),
        ...friends
      ],
      providers: { ...previous.providers, discord: discordStatus },
      updatedAt: Math.max(previous.updatedAt, snapshot.updatedAt)
    })
  }

  private readonly handleDiscordUpdated = (snapshot: DiscordSocialSnapshot): void => {
    if (!this.disposed) this.mergeDiscord(snapshot)
  }

  private readonly handleDiscordChatMessage = (event: DiscordChatEvent): void => {
    if (!this.disposed) this.emit('discord-chat-message', event)
  }

  private readonly handleEpicPresenceUpdated = (snapshot: EpicPresenceSnapshot): void => {
    if (this.disposed || epicAuthManager.getAccount()?.accountId !== snapshot.accountId) return
    const previous = this.snapshot
    let changed = false
    const friends = previous.friends.map((friend): OrbitFriend => {
      if (friend.provider !== 'epic') return friend
      const live = snapshot.presences[friend.providerUserId]
      const presence = snapshot.connected ? (live?.presence ?? 'offline') : 'unknown'
      const activity = live?.activity
      if (friend.presence === presence && friend.activity === activity) return friend
      changed = true
      return { ...friend, presence, activity }
    })
    if (!changed) return
    const epicFriends = friends.filter((friend) => friend.provider === 'epic')
    const updatedAt = Date.now()
    this.publish({
      ...previous,
      friends,
      providers: {
        ...previous.providers,
        epic: {
          ...previous.providers.epic,
          onlineCount: epicFriends.filter((friend) => onlinePresence(friend.presence)).length,
          updatedAt
        }
      },
      updatedAt
    })
  }

  refresh(): Promise<FriendsSnapshot> {
    if (this.refreshInFlight) return this.refreshInFlight
    this.refreshInFlight = this.performRefresh().finally(() => {
      this.refreshInFlight = null
    })
    return this.refreshInFlight
  }

  private async refreshSteamProvider(
    account: SteamAccount,
    previous: FriendsSnapshot
  ): Promise<ProviderRefreshResult> {
    try {
      const friends = await fetchSteamFriends(account.steamId)
      const updatedAt = Date.now()
      return {
        friends,
        status: {
          provider: 'steam',
          state: 'ready',
          friendCount: friends.length,
          onlineCount: friends.filter((friend) => onlinePresence(friend.presence)).length,
          updatedAt,
          accountName: account.accountName
        }
      }
    } catch (error) {
      const friends = previous.friends.filter((friend) => friend.provider === 'steam')
      return {
        friends,
        status: {
          provider: 'steam',
          state: 'error',
          friendCount: friends.length,
          onlineCount: friends.filter((friend) => onlinePresence(friend.presence)).length,
          updatedAt: previous.providers.steam.updatedAt,
          accountName: account.accountName,
          issue:
            error instanceof FriendsProviderError ? error.issue : 'provider-unavailable'
        }
      }
    }
  }

  private async refreshEpicProvider(
    account: EpicAccount,
    previous: FriendsSnapshot
  ): Promise<ProviderRefreshResult> {
    try {
      const friends = await fetchEpicFriends(account.accountId)
      const updatedAt = Date.now()
      return {
        friends,
        status: {
          provider: 'epic',
          state: 'ready',
          friendCount: friends.length,
          onlineCount: friends.filter((friend) => onlinePresence(friend.presence)).length,
          updatedAt,
          accountName: account.displayName
        }
      }
    } catch (error) {
      const friends = previous.friends.filter((friend) => friend.provider === 'epic')
      return {
        friends,
        status: {
          provider: 'epic',
          state: 'error',
          friendCount: friends.length,
          onlineCount: friends.filter((friend) => onlinePresence(friend.presence)).length,
          updatedAt: previous.providers.epic.updatedAt,
          accountName: account.displayName,
          issue:
            error instanceof FriendsProviderError ? error.issue : 'provider-unavailable'
        }
      }
    }
  }

  private mergeProviderResult(result: ProviderRefreshResult): FriendsSnapshot {
    const provider = result.status.provider
    const previous = this.snapshot
    return this.publish({
      ...previous,
      friends: [
        ...previous.friends.filter((friend) => friend.provider !== provider),
        ...result.friends
      ],
      providers: { ...previous.providers, [provider]: result.status },
      updatedAt: Math.max(previous.updatedAt, result.status.updatedAt ?? 0)
    })
  }

  private async performRefresh(): Promise<FriendsSnapshot> {
    const previous = this.snapshot
    this.publish({ ...previous, isRefreshing: true })
    const visibleRefreshTimer = setTimeout(() => {
      if (this.snapshot.isRefreshing) this.publish({ ...this.snapshot, isRefreshing: false })
    }, VISIBLE_REFRESH_BUDGET_MS)
    let accountsChanged = false

    const steamRefresh = async (): Promise<void> => {
      const account = steamAuthManager.getAccount() ?? (await steamAuthManager.restoreSession())
      const result = account
        ? await this.refreshSteamProvider(account, previous)
        : {
            friends: [],
            status: providerStatus('steam', 'not-connected')
          }
      if ((steamAuthManager.getAccount()?.steamId ?? null) !== (account?.steamId ?? null)) {
        accountsChanged = true
        return
      }
      this.mergeProviderResult(result)
    }

    const epicRefresh = async (): Promise<void> => {
      const account = epicAuthManager.getAccount() ?? (await epicAuthManager.restoreSession())
      if (!account) epicSocialPresence.disconnect()
      const result = account
        ? await this.refreshEpicProvider(account, previous)
        : {
            friends: [],
            status: providerStatus('epic', 'not-connected')
          }
      if ((epicAuthManager.getAccount()?.accountId ?? null) !== (account?.accountId ?? null)) {
        accountsChanged = true
        return
      }
      this.mergeProviderResult(result)
    }

    const discordRefresh = async (): Promise<void> => {
      const snapshot = await discordSocialService.refresh(ORBIT_DISCORD_APPLICATION_ID)
      this.mergeDiscord(snapshot)
    }

    await Promise.allSettled([steamRefresh(), discordRefresh(), epicRefresh()])
    clearTimeout(visibleRefreshTimer)
    if (accountsChanged) return this.performRefresh()
    return this.publish({ ...this.snapshot, updatedAt: Date.now(), isRefreshing: false })
  }

  async connectProvider(provider: FriendsProvider): Promise<FriendsSnapshot> {
    if (provider !== 'discord') return this.getSnapshot()
    const snapshot = await discordSocialService.connect(ORBIT_DISCORD_APPLICATION_ID)
    return this.mergeDiscord(snapshot)
  }

  async disconnectProvider(provider: FriendsProvider): Promise<FriendsSnapshot> {
    if (provider !== 'discord') return this.getSnapshot()
    const snapshot = await discordSocialService.disconnect(ORBIT_DISCORD_APPLICATION_ID)
    return this.mergeDiscord(snapshot)
  }

  getDiscordChatHistory(userId: unknown, limit: unknown): Promise<DiscordChatHistory> {
    return discordSocialService.getChatHistory(ORBIT_DISCORD_APPLICATION_ID, userId, limit)
  }

  getDiscordChatInbox(): Promise<DiscordChatInbox> {
    return discordSocialService.getChatInbox(ORBIT_DISCORD_APPLICATION_ID)
  }

  getDiscordServers(): Promise<DiscordServerList> {
    return discordSocialService.getServers(ORBIT_DISCORD_APPLICATION_ID)
  }

  async openDiscordServer(serverId: unknown): Promise<void> {
    if (typeof serverId !== 'string' || !/^\d{17,20}$/u.test(serverId)) {
      throw new Error('Invalid Discord server')
    }
    try {
      await shell.openExternal(`discord://-/channels/${serverId}`)
    } catch {
      await shell.openExternal(`https://discord.com/channels/${serverId}`)
    }
  }

  sendDiscordChatMessage(userId: unknown, content: unknown): Promise<DiscordChatSendResult> {
    return discordSocialService.sendChatMessage(ORBIT_DISCORD_APPLICATION_ID, userId, content)
  }

  setDiscordChatVisible(showing: unknown): Promise<void> {
    return discordSocialService.setShowingChat(ORBIT_DISCORD_APPLICATION_ID, showing)
  }

  async openProvider(provider: FriendsProvider): Promise<void> {
    const account = steamAuthManager.getAccount()
    const url =
      provider === 'steam' && account
        ? `https://steamcommunity.com/profiles/${account.steamId}/friends/`
        : provider === 'steam'
          ? 'https://steamcommunity.com/'
          : provider === 'discord'
            ? 'https://discord.com/channels/@me'
            : 'com.epicgames.launcher://friends'
    try {
      await shell.openExternal(url)
    } catch (error) {
      if (provider !== 'epic') throw error
      await shell.openExternal('https://store.epicgames.com/')
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    discordSocialService.off('updated', this.handleDiscordUpdated)
    discordSocialService.off('chat-message', this.handleDiscordChatMessage)
    epicSocialPresence.off('updated', this.handleEpicPresenceUpdated)
    epicSocialPresence.disconnect()
    discordSocialService.dispose()
  }
}

export const friendsService = new FriendsService()
