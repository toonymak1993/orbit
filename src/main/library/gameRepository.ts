import Store from 'electron-store'
import { app } from 'electron'
import type {
  GameMetadata,
  GameProvider,
  LibraryGame,
  LibrarySessionRecord,
  LibrarySnapshot,
  LocalGameBackupResult,
  LocalGameConfig,
  RetroAchievementMatch,
  RetroGameConfig,
  RetroSystemId
} from '@shared/ipc'
import { RETRO_SYSTEMS } from '@shared/retroSystems'
import { latestLibraryActivity, normalizeLibraryTimestamp } from '@shared/libraryTime'
import { summarizeLibraryActivity } from '@shared/libraryActivity'
import {
  isUsableLibraryName,
  projectVisibleLibraryRecords,
  shouldPruneProviderRecord
} from '@shared/libraryProjection'
import { isAutomaticLibraryTitleAllowed } from '@shared/libraryContentPolicy'
import type { LocalGameRecordInput } from '../customLibrary'
import type { RetroGameRecordInput } from '../retro/retroLibrary'
import {
  playtimeSecondsFrom,
  reconcileProviderPlaytime,
  validPlaytimeSeconds
} from './playtimeTracking'

const DATABASE_VERSION = 8
const DEFAULT_PROFILE_ID = 'orbit-default'
const STEAM_PROVIDER = 'steam' as const
const SESSION_RETENTION_MS = 366 * 24 * 60 * 60 * 1_000
const MAX_STORED_SESSIONS = 1_000
const MAX_SESSION_SECONDS = 30 * 24 * 60 * 60
const MAX_LOCAL_LAUNCH_ARGUMENTS = 128
const MAX_LOCAL_LAUNCH_ARGUMENT_LENGTH = 2_048
const KNOWN_PROVIDERS = new Set<GameProvider>([
  'steam',
  'epic',
  'gog',
  'xbox',
  'playstation',
  'retro',
  'ea',
  'ubisoft',
  'local'
])

interface StoredGame extends LibraryGame {
  owned: boolean
  /** Provider-defined ownership partition used for safe, source-scoped pruning. */
  ownershipSource?: string
  lastSeenOnlineAt?: number
  lastSeenInstalledAt?: number
  /** Last authoritative total reported by Steam/Epic. Kept out of renderer snapshots. */
  providerPlaytimeSeconds?: number
  /** Locally observed time not yet reflected by the provider total. */
  pendingPlaytimeSeconds?: number
}

interface AccountLibrary {
  games: Record<string, StoredGame>
  recentGameIds: string[]
  steamRecentGameIds: string[]
  sessions: LibrarySessionRecord[]
  loadedAt: number
}

interface LibraryDatabase {
  schemaVersion: number
  accounts: Record<string, AccountLibrary>
}

interface LegacyLibraryCache {
  steamId: string | null
  snapshot: {
    games?: LegacyGameSnapshot[]
    recentlyPlayedAppIds?: number[]
    loadedAt?: number
  } | null
}

interface LegacyMetadataFields {
  screenshotUrl?: string
  shortDescription?: string
  genres?: string[]
  developers?: string[]
}

interface LegacyGameSnapshot extends LegacyMetadataFields {
  appId?: number
  name?: string
  playtimeMinutes?: number
  lastPlayedTimestamp?: number
  installed?: boolean
  installDir?: string
  addedAt?: number
  updatedAt?: number
}

type StoredGameCandidate = Partial<StoredGame> & LegacyMetadataFields

export interface ProviderInstalledDelta {
  providerGameId: string
  name: string
  appId?: number
  installDir: string
  updateAvailable?: boolean
  metadata?: GameMetadata
  playtimeSeconds?: number
  lastPlayedTimestamp?: number
}

export interface ProviderActivityDelta {
  providerGameId: string
  playtimeSeconds?: number
  lastPlayedTimestamp?: number
}

export interface ProviderOwnedDelta {
  providerGameId: string
  name?: string
  appId?: number
  metadata?: GameMetadata
  playtimeSeconds?: number
  playtimeMinutes?: number
  lastPlayedTimestamp?: number
}

export interface ProviderMetadataDelta {
  providerGameId: string
  appId?: number
  name?: string
  metadata: GameMetadata
  locale: string
  source: string
  fetchedAt: number
}

export interface SteamOwnedDelta {
  appId: number
  name?: string
  iconUrl?: string
  playtimeSeconds?: number
  playtimeMinutes?: number
  lastPlayedTimestamp?: number
}

export interface SteamMetadataDelta {
  appId: number
  name?: string
  metadata: GameMetadata
  locale: string
  source: string
  fetchedAt: number
}

export interface SteamInstalledDelta {
  appId: number
  name: string
  installDir: string
  updateAvailable?: boolean
  playtimeSeconds?: number
  lastPlayedTimestamp?: number
}

const database = new Store<LibraryDatabase>({
  name: 'orbit-library-v2',
  defaults: { schemaVersion: DATABASE_VERSION, accounts: {} }
})

// Read-only migration source. It remains on disk so an older ORBIT build can
// still be restored; schema v4 writes only to the unified default profile.
const legacyDatabase = new Store<LegacyLibraryCache>({
  name: 'orbit-library-cache',
  defaults: { steamId: null, snapshot: null }
})

const databaseState: LibraryDatabase = database.store
const legacyDatabaseState: LegacyLibraryCache = legacyDatabase.store
let databasePersistTimer: ReturnType<typeof setTimeout> | undefined

function flushDatabase(): void {
  if (databasePersistTimer) clearTimeout(databasePersistTimer)
  databasePersistTimer = undefined
  database.store = databaseState
}

function scheduleDatabasePersist(): void {
  if (databasePersistTimer) return
  databasePersistTimer = setTimeout(flushDatabase, 500)
  databasePersistTimer.unref()
}

app.on('before-quit', flushDatabase)

function providerGameId(provider: GameProvider, id: string): string {
  return `${provider}:${id}`
}

function steamGameId(appId: number): string {
  return providerGameId(STEAM_PROVIDER, String(appId))
}

function isSteamGameId(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = /^steam:(\d+)$/.exec(value)
  if (!match) return false
  const appId = Number(match[1])
  return Number.isInteger(appId) && appId > 0 && appId <= 0xffffffff
}

function validProviderGameId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 512
}

function hasUsableName(name: unknown): name is string {
  return isUsableLibraryName(name)
}

function hasAllowedProviderName(provider: GameProvider, name: unknown): name is string {
  return hasUsableName(name) && isAutomaticLibraryTitleAllowed(provider, name)
}

function validLocalLaunchArguments(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length > MAX_LOCAL_LAUNCH_ARGUMENTS) return false
  let totalLength = 0
  for (const argument of value) {
    if (
      typeof argument !== 'string' ||
      argument.length > MAX_LOCAL_LAUNCH_ARGUMENT_LENGTH ||
      /[\u0000-\u001f\u007f-\u009f]/.test(argument)
    ) {
      return false
    }
    totalLength += argument.length + 1
    if (totalLength > 4_096) return false
  }
  return true
}

function validatedLocalLaunchArguments(value: unknown): string[] | undefined {
  if (value === undefined || (Array.isArray(value) && value.length === 0)) return undefined
  if (!validLocalLaunchArguments(value)) {
    throw new Error('Invalid custom game launch arguments')
  }
  return [...value]
}

function sanitizeLocalConfig(value: unknown): LocalGameConfig | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const candidate = value as Partial<LocalGameConfig>
  if (typeof candidate.executablePath !== 'string' || !candidate.executablePath.trim()) {
    return undefined
  }
  const lastBackupState =
    candidate.lastBackupState === 'success' || candidate.lastBackupState === 'failed'
      ? candidate.lastBackupState
      : 'never'
  return {
    executablePath: candidate.executablePath,
    launchArguments:
      validLocalLaunchArguments(candidate.launchArguments) && candidate.launchArguments.length > 0
        ? [...candidate.launchArguments]
        : undefined,
    savePath:
      typeof candidate.savePath === 'string' && candidate.savePath.trim()
        ? candidate.savePath
        : undefined,
    backupEnabled: Boolean(candidate.backupEnabled && candidate.savePath),
    lastBackupAt:
      typeof candidate.lastBackupAt === 'number' && Number.isFinite(candidate.lastBackupAt)
        ? candidate.lastBackupAt
        : undefined,
    lastBackupState
  }
}

const RETRO_SYSTEM_IDS = new Set<RetroSystemId>(RETRO_SYSTEMS.map((system) => system.id))
const RETRO_ACHIEVEMENT_MATCHES = new Set<RetroAchievementMatch>([
  'matched',
  'unmatched',
  'unavailable',
  'not-configured',
  'unsupported'
])

function optionalText(value: unknown, maximumLength = 4096): string | undefined {
  return typeof value === 'string' && value.trim() && value.trim().length <= maximumLength
    ? value.trim()
    : undefined
}

function sanitizeRetroConfig(value: unknown): RetroGameConfig | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const candidate = value as Partial<RetroGameConfig>
  const romPath = optionalText(candidate.romPath, 32_768)
  const sourceDirectory = optionalText(candidate.sourceDirectory, 32_768)
  const systemName = optionalText(candidate.systemName, 120)
  if (
    !romPath ||
    !sourceDirectory ||
    !systemName ||
    !candidate.systemId ||
    !RETRO_SYSTEM_IDS.has(candidate.systemId) ||
    !candidate.retroAchievementsMatch ||
    !RETRO_ACHIEVEMENT_MATCHES.has(candidate.retroAchievementsMatch)
  ) {
    return undefined
  }
  const achievementGameId = Number(candidate.retroAchievementsGameId)
  return {
    romPath,
    sourceDirectory,
    systemId: candidate.systemId,
    systemName,
    emulatorId: optionalText(candidate.emulatorId, 80),
    emulatorName: optionalText(candidate.emulatorName, 120),
    emulatorPath: optionalText(candidate.emulatorPath, 32_768),
    corePath: optionalText(candidate.corePath, 32_768),
    launchArguments:
      validLocalLaunchArguments(candidate.launchArguments) && candidate.launchArguments.length > 0
        ? [...candidate.launchArguments]
        : undefined,
    retroAchievementsHash:
      typeof candidate.retroAchievementsHash === 'string' &&
      /^[a-f\d]{32}$/i.test(candidate.retroAchievementsHash)
        ? candidate.retroAchievementsHash.toLocaleLowerCase('en-US')
        : undefined,
    retroAchievementsGameId:
      Number.isInteger(achievementGameId) && achievementGameId > 0
        ? achievementGameId
        : undefined,
    retroAchievementsMatch: candidate.retroAchievementsMatch
  }
}

function migrateMetadata(candidate: StoredGameCandidate): GameMetadata {
  const legacy: GameMetadata = {
    summary: candidate.shortDescription,
    genres: candidate.genres,
    developers: candidate.developers,
    backgroundUrl: candidate.screenshotUrl
  }
  return { ...legacy, ...(candidate.metadata ?? {}) }
}

function mergeDefinedMetadata(current: GameMetadata, delta: GameMetadata): GameMetadata {
  const merged = { ...current }
  for (const [key, value] of Object.entries(delta)) {
    if (value !== undefined) (merged as Record<string, unknown>)[key] = value
  }
  return merged
}

function metadataEquals(left: GameMetadata, right: GameMetadata): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function emptyAccount(): AccountLibrary {
  return { games: {}, recentGameIds: [], steamRecentGameIds: [], sessions: [], loadedAt: 0 }
}

/**
 * Persistent, provider-neutral repository. Identity follows Playnite's rule:
 * library plugin/provider + provider game ID. Every import is an idempotent
 * upsert. Storage preserves every durable provider identity; public snapshots
 * suppress confirmed auxiliary content and provider-local exact-title aliases.
 * Cross-provider licenses and differently named editions remain independent.
 */
export class GameRepository {
  private profileOpen = false
  private account: AccountLibrary = emptyAccount()
  private metadataLoadingProviders = new Set<string>()

  openProfile(legacySteamId?: string): void {
    if (this.profileOpen) return
    this.profileOpen = true

    const accounts = databaseState.accounts
    const stored = accounts[DEFAULT_PROFILE_ID]
    if (stored) {
      this.account = this.sanitize(stored)
      this.persist()
      return
    }

    const previous = legacySteamId ? accounts[legacySteamId] : undefined
    const newest = Object.entries(accounts)
      .filter(([id]) => id !== DEFAULT_PROFILE_ID)
      .sort(([, left], [, right]) => (right.loadedAt ?? 0) - (left.loadedAt ?? 0))[0]?.[1]
    const migrationSource = previous ?? newest
    this.account = migrationSource
      ? this.sanitize(migrationSource)
      : this.migrateLegacy(legacySteamId ?? legacyDatabase.get('steamId') ?? '')
    this.persist()
  }

  // Compatibility entry point for the existing Steam adapter.
  openSteamAccount(steamId: string): void {
    this.openProfile(steamId)
  }

  getSnapshot(): LibrarySnapshot {
    this.ensureOpen()
    const visibleRecords = projectVisibleLibraryRecords(Object.values(this.account.games))

    const toPublicGame = ({
      owned: _owned,
      ownershipSource: _ownershipSource,
      lastSeenOnlineAt: _online,
      lastSeenInstalledAt: _local,
      providerPlaytimeSeconds: _providerPlaytime,
      pendingPlaytimeSeconds: _pendingPlaytime,
      ...game
    }: StoredGame): LibraryGame => game
    const games = visibleRecords.map(toPublicGame)
    const providerGames = visibleRecords.map(toPublicGame)
    const visibleIds = new Set(games.map((game) => game.id))
    const recentGameIds = [...new Set(this.account.recentGameIds)].filter((id) =>
      visibleIds.has(id)
    )
    const sessions = this.account.sessions.map((session) => ({ ...session }))
    const installedIds = new Set(games.filter((game) => game.installed).map((game) => game.id))
    const activity = summarizeLibraryActivity(sessions)
    const sessionContinue = sessions
      .sort((left, right) => right.endedAt - left.endedAt)
      .find((session) => installedIds.has(session.gameId))
    const providerContinueId = recentGameIds.find((id) => installedIds.has(id))
    const providerContinueAt = latestLibraryActivity(
      games.find((game) => game.id === providerContinueId) ?? {}
    )
    const continueGameId =
      sessionContinue && sessionContinue.endedAt >= providerContinueAt
        ? sessionContinue.gameId
        : providerContinueId ?? sessionContinue?.gameId

    return {
      games,
      providerGames,
      excludedGames: [],
      recentGameIds,
      loadedAt: this.account.loadedAt,
      isLoadingMetadata: this.metadataLoadingProviders.size > 0,
      activity: {
        ...activity,
        continueGameId
      }
    }
  }

  setMetadataLoading(provider: string, loading?: boolean): void {
    const active = loading ?? Boolean(provider)
    const key = loading === undefined ? 'system' : provider
    if (active) this.metadataLoadingProviders.add(key)
    else this.metadataLoadingProviders.delete(key)
  }

  /** Local state is authoritative only for one provider's installation status. */
  applyInstalledProviderDelta(
    provider: GameProvider,
    installedGames: Iterable<ProviderInstalledDelta>
  ): void {
    this.applyInstalledProviderGames(provider, installedGames, true)
  }

  /** Adds or updates confirmed installs without invalidating the provider's
   * other games. Used by event-driven, package-scoped launcher refreshes. */
  applyInstalledProviderPatch(
    provider: GameProvider,
    installedGames: Iterable<ProviderInstalledDelta>
  ): void {
    this.applyInstalledProviderGames(provider, installedGames, false)
  }

  private applyInstalledProviderGames(
    provider: GameProvider,
    installedGames: Iterable<ProviderInstalledDelta>,
    resetMissing: boolean
  ): void {
    this.ensureOpen()
    const now = Date.now()
    if (resetMissing) {
      for (const game of Object.values(this.account.games)) {
        if (game.provider === provider) {
          game.installed = false
          game.installDir = undefined
          game.updateAvailable = false
        }
      }
    }

    for (const installed of installedGames) {
      if (!validProviderGameId(installed.providerGameId) || !hasUsableName(installed.name)) continue
      const rawProviderId = installed.providerGameId.trim()
      const id = providerGameId(provider, rawProviderId)
      if (!hasAllowedProviderName(provider, installed.name)) {
        delete this.account.games[id]
        continue
      }
      const existing = this.account.games[id]
      const currentMetadata = existing?.metadata ?? {}
      const nextMetadata = mergeDefinedMetadata(currentMetadata, installed.metadata ?? {})
      const metadataChanged = !metadataEquals(currentMetadata, nextMetadata)
      const playtime = reconcileProviderPlaytime(
        existing,
        validPlaytimeSeconds(installed.playtimeSeconds)
      )
      this.account.games[id] = {
        ...existing,
        id,
        provider,
        providerGameId: rawProviderId,
        appId: installed.appId ?? existing?.appId,
        name: installed.name.trim(),
        metadata: nextMetadata,
        metadataRevision: (existing?.metadataRevision ?? 0) + (metadataChanged ? 1 : 0),
        metadataUpdatedAt: metadataChanged ? now : existing?.metadataUpdatedAt,
        installed: true,
        installDir: installed.installDir,
        updateAvailable: Boolean(installed.updateAvailable),
        owned: existing?.owned ?? false,
        ...playtime,
        lastPlayedTimestamp:
          Math.max(
            normalizeLibraryTimestamp(installed.lastPlayedTimestamp),
            normalizeLibraryTimestamp(existing?.lastPlayedTimestamp)
          ) || undefined,
        addedAt: existing?.addedAt ?? now,
        updatedAt: now,
        lastSeenInstalledAt: now
      }
    }

    this.rebuildRecentIds()
    this.commit(now)
  }

  /** Applies non-destructive launcher activity to already known provider games. */
  applyProviderActivityDelta(
    provider: GameProvider,
    activities: Iterable<ProviderActivityDelta>
  ): number {
    this.ensureOpen()
    const now = Date.now()
    let changedCount = 0

    for (const activity of activities) {
      if (!validProviderGameId(activity.providerGameId)) continue
      const id = providerGameId(provider, activity.providerGameId.trim())
      const game = this.account.games[id]
      if (!game || game.provider !== provider) continue

      const previousSeconds = game.playtimeSeconds
      const previousProviderSeconds = game.providerPlaytimeSeconds
      const previousPendingSeconds = game.pendingPlaytimeSeconds
      const previousLastPlayedTimestamp = game.lastPlayedTimestamp
      Object.assign(
        game,
        reconcileProviderPlaytime(game, validPlaytimeSeconds(activity.playtimeSeconds))
      )
      game.lastPlayedTimestamp =
        Math.max(
          normalizeLibraryTimestamp(game.lastPlayedTimestamp),
          normalizeLibraryTimestamp(activity.lastPlayedTimestamp)
        ) || undefined
      const changed =
        previousSeconds !== game.playtimeSeconds ||
        previousProviderSeconds !== game.providerPlaytimeSeconds ||
        previousPendingSeconds !== game.pendingPlaytimeSeconds ||
        previousLastPlayedTimestamp !== game.lastPlayedTimestamp
      if (!changed) continue
      game.updatedAt = now
      changedCount++
    }

    if (changedCount > 0) {
      this.rebuildRecentIds()
      this.commit(now)
    }
    return changedCount
  }

  /** A successful online response is authoritative for one provider only. */
  applyAuthoritativeProviderDelta(
    provider: GameProvider,
    ownedGames: Iterable<ProviderOwnedDelta>
  ): void {
    this.applyProviderOwnedDelta(provider, ownedGames, true)
  }

  /** Prunes only records previously proven to belong to the same provider
   * source. This prevents a subscription catalog from deleting purchases or
   * records discovered through another account surface. */
  applyAuthoritativeProviderSourceDelta(
    provider: GameProvider,
    ownershipSource: string,
    ownedGames: Iterable<ProviderOwnedDelta>
  ): void {
    this.applyProviderOwnedDelta(provider, ownedGames, true, ownershipSource)
  }

  /** Updates one provider-owned partition without deleting records when that
   * source reported an incomplete snapshot. */
  applyNonAuthoritativeProviderSourceDelta(
    provider: GameProvider,
    ownershipSource: string,
    ownedGames: Iterable<ProviderOwnedDelta>
  ): void {
    this.applyProviderOwnedDelta(provider, ownedGames, false, ownershipSource)
  }

  /** A partial provider response may add/update records but never remove cached ones. */
  applyNonAuthoritativeProviderDelta(
    provider: GameProvider,
    ownedGames: Iterable<ProviderOwnedDelta>
  ): void {
    this.applyProviderOwnedDelta(provider, ownedGames, false)
  }

  private applyProviderOwnedDelta(
    provider: GameProvider,
    ownedGames: Iterable<ProviderOwnedDelta>,
    pruneMissing: boolean,
    ownershipSource?: string
  ): void {
    this.ensureOpen()
    const now = Date.now()
    const seen = new Set<string>()

    for (const owned of ownedGames) {
      if (!validProviderGameId(owned.providerGameId)) continue
      const rawProviderId = owned.providerGameId.trim()
      const id = providerGameId(provider, rawProviderId)
      const existing = this.account.games[id]
      const currentMetadata = existing?.metadata ?? {}
      const nextMetadata = mergeDefinedMetadata(currentMetadata, owned.metadata ?? {})
      const metadataChanged = !metadataEquals(currentMetadata, nextMetadata)
      const name = hasUsableName(owned.name) ? owned.name.trim() : (existing?.name ?? '')
      if (hasUsableName(name) && !hasAllowedProviderName(provider, name)) {
        delete this.account.games[id]
        continue
      }
      const playtime = reconcileProviderPlaytime(existing, playtimeSecondsFrom(owned))
      seen.add(id)
      this.account.games[id] = {
        ...existing,
        id,
        provider,
        providerGameId: rawProviderId,
        appId: owned.appId ?? existing?.appId,
        name,
        metadata: nextMetadata,
        metadataRevision: (existing?.metadataRevision ?? 0) + (metadataChanged ? 1 : 0),
        metadataUpdatedAt: metadataChanged ? now : existing?.metadataUpdatedAt,
        installed: existing?.installed ?? false,
        owned: true,
        ownershipSource: ownershipSource ?? existing?.ownershipSource,
        ...playtime,
        lastPlayedTimestamp:
          Math.max(
            normalizeLibraryTimestamp(owned.lastPlayedTimestamp),
            normalizeLibraryTimestamp(existing?.lastPlayedTimestamp)
          ) || undefined,
        addedAt: existing?.addedAt ?? now,
        updatedAt: now,
        lastSeenOnlineAt: now
      }
    }

    if (pruneMissing) {
      for (const [id, game] of Object.entries(this.account.games)) {
        if (!shouldPruneProviderRecord(game, provider, seen, ownershipSource)) continue
        game.owned = false
        if (!game.installed) delete this.account.games[id]
      }
    }

    this.rebuildRecentIds()
    this.commit(now)
  }

  applyProviderMetadataDelta(
    provider: GameProvider,
    delta: ProviderMetadataDelta,
    allowCreate: boolean
  ): boolean {
    this.ensureOpen()
    if (!validProviderGameId(delta.providerGameId)) return false
    const rawProviderId = delta.providerGameId.trim()
    const id = providerGameId(provider, rawProviderId)
    const existing = this.account.games[id]
    if (!existing && (!allowCreate || !hasUsableName(delta.name))) return false

    const now = Date.now()
    const name = hasUsableName(delta.name) ? delta.name.trim() : existing?.name
    if (!hasUsableName(name)) return false
    if (!hasAllowedProviderName(provider, name)) {
      if (!existing) return false
      delete this.account.games[id]
      this.rebuildRecentIds()
      this.commit(now)
      return true
    }

    const currentMetadata = existing?.metadata ?? {}
    const nextMetadata = mergeDefinedMetadata(currentMetadata, delta.metadata)
    const contentChanged = !metadataEquals(currentMetadata, nextMetadata)
    const identityChanged = !existing || existing.name !== name
    const localeChanged = existing?.metadataLocale !== delta.locale
    const sourceChanged = existing?.metadataSource !== delta.source
    if (existing && !contentChanged && !identityChanged && !localeChanged && !sourceChanged) return false

    this.account.games[id] = {
      ...existing,
      id,
      provider,
      providerGameId: rawProviderId,
      appId: delta.appId ?? existing?.appId,
      name,
      metadata: nextMetadata,
      metadataRevision:
        contentChanged || localeChanged
          ? (existing?.metadataRevision ?? 0) + 1
          : (existing?.metadataRevision ?? 0),
      metadataUpdatedAt:
        contentChanged || localeChanged ? delta.fetchedAt : existing?.metadataUpdatedAt,
      metadataLocale: delta.locale,
      metadataSource: delta.source,
      installed: existing?.installed ?? false,
      owned: existing?.owned ?? allowCreate,
      addedAt: existing?.addedAt ?? now,
      updatedAt: now,
      lastSeenOnlineAt: existing?.lastSeenOnlineAt ?? (allowCreate ? now : undefined)
    }

    this.commit(now)
    return true
  }

  removeProviderGame(provider: GameProvider, rawProviderId: string): boolean {
    this.ensureOpen()
    if (!validProviderGameId(rawProviderId)) return false
    const id = providerGameId(provider, rawProviderId.trim())
    const game = this.account.games[id]
    if (!game) return false
    if (game.installed) game.owned = false
    else delete this.account.games[id]
    this.rebuildRecentIds()
    this.commit(Date.now())
    return true
  }

  /** Removes content positively classified by its provider as a non-game. */
  removeProviderContent(provider: GameProvider, rawProviderId: string): boolean {
    this.ensureOpen()
    if (!validProviderGameId(rawProviderId)) return false
    const id = providerGameId(provider, rawProviderId.trim())
    if (!this.account.games[id]) return false
    delete this.account.games[id]
    this.rebuildRecentIds()
    this.commit(Date.now())
    return true
  }

  // Steam compatibility wrappers keep the existing adapter small while all
  // future stores use the provider-neutral methods above.
  applyInstalledDelta(installedGames: Iterable<SteamInstalledDelta>): void {
    this.applyInstalledProviderDelta(
      STEAM_PROVIDER,
      [...installedGames].map((game) => ({
        providerGameId: String(game.appId),
        appId: game.appId,
        name: game.name,
        installDir: game.installDir,
        updateAvailable: game.updateAvailable,
        playtimeSeconds: game.playtimeSeconds,
        lastPlayedTimestamp: game.lastPlayedTimestamp
      }))
    )
  }

  applyAuthoritativeOwnedDelta(ownedGames: Iterable<SteamOwnedDelta>): void {
    this.applyAuthoritativeProviderDelta(
      STEAM_PROVIDER,
      [...ownedGames].map((game) => ({
        providerGameId: String(game.appId),
        appId: game.appId,
        name: game.name,
        metadata: { iconUrl: game.iconUrl },
        playtimeSeconds: game.playtimeSeconds,
        playtimeMinutes: game.playtimeMinutes,
        lastPlayedTimestamp: game.lastPlayedTimestamp
      }))
    )
  }

  applyNonAuthoritativeOwnedDelta(ownedGames: Iterable<SteamOwnedDelta>): void {
    this.applyNonAuthoritativeProviderDelta(
      STEAM_PROVIDER,
      [...ownedGames].map((game) => ({
        providerGameId: String(game.appId),
        appId: game.appId,
        name: game.name,
        metadata: { iconUrl: game.iconUrl },
        playtimeSeconds: game.playtimeSeconds,
        playtimeMinutes: game.playtimeMinutes,
        lastPlayedTimestamp: game.lastPlayedTimestamp
      }))
    )
  }

  /** Dynamicstore IDs are non-authoritative because they include DLC/tools. */
  applyNonAuthoritativeOwnedIds(appIds: Iterable<number>): number[] {
    this.ensureOpen()
    const now = Date.now()
    const unresolved: number[] = []
    for (const appId of new Set(appIds)) {
      if (!Number.isInteger(appId) || appId <= 0) continue
      const id = steamGameId(appId)
      const existing = this.account.games[id]
      if (existing && hasUsableName(existing.name)) {
        existing.owned = true
        existing.lastSeenOnlineAt = now
        existing.updatedAt = now
      } else {
        unresolved.push(appId)
      }
    }
    this.commit(now)
    return unresolved
  }

  applyMetadataDelta(metadata: SteamMetadataDelta, allowCreate: boolean): boolean {
    return this.applyProviderMetadataDelta(
      STEAM_PROVIDER,
      {
        providerGameId: String(metadata.appId),
        appId: metadata.appId,
        name: metadata.name,
        metadata: metadata.metadata,
        locale: metadata.locale,
        source: metadata.source,
        fetchedAt: metadata.fetchedAt
      },
      allowCreate
    )
  }

  /** Applies provider-neutral enrichment (for example completion-time data). */
  applyEnrichmentDelta(gameId: string, metadata: GameMetadata, fetchedAt: number): boolean {
    this.ensureOpen()
    const existing = this.account.games[gameId]
    if (!existing) return false
    const nextMetadata = mergeDefinedMetadata(existing.metadata, metadata)
    if (metadataEquals(existing.metadata, nextMetadata)) return false
    this.account.games[gameId] = {
      ...existing,
      metadata: nextMetadata,
      metadataRevision: existing.metadataRevision + 1,
      metadataUpdatedAt: fetchedAt,
      updatedAt: Date.now()
    }
    this.commit(Date.now())
    return true
  }

  markStarted(gameId: string, startedAt = Date.now()): boolean {
    this.ensureOpen()
    const game = this.account.games[gameId]
    if (!game) return false
    const now = Date.now()
    game.lastStartedAt = normalizeLibraryTimestamp(startedAt) || now
    game.updatedAt = now
    this.rebuildRecentIds()
    this.commit(now)
    return true
  }

  setRecentSteamAppIds(appIds: Iterable<number>): void {
    this.ensureOpen()
    const ids = [...new Set(appIds)]
      .filter((appId) => Number.isInteger(appId) && appId > 0 && appId <= 0xffffffff)
      .map(steamGameId)
    const otherProviders = this.account.recentGameIds.filter(
      (id) => {
        const game = this.account.games[id]
        return Boolean(game && game.provider !== STEAM_PROVIDER)
      }
    )
    // Keep valid IDs even while their metadata is still being resolved. Public
    // snapshots hide unknown records and reveal them in this order once created.
    this.account.steamRecentGameIds = ids
    this.account.recentGameIds = [...ids, ...otherProviders]
    this.commit(Date.now())
  }

  recordGameSession(gameId: string, durationSeconds: number, endedAt: number): boolean {
    this.ensureOpen()
    const game = this.account.games[gameId]
    const duration = validPlaytimeSeconds(durationSeconds)
    if (!game || duration === undefined || duration <= 0 || duration > MAX_SESSION_SECONDS) return false

    const normalizedEndedAt = normalizeLibraryTimestamp(endedAt) || Date.now()
    const sessionId = `${gameId}:${normalizedEndedAt}:${duration}`
    if (this.account.sessions.some((session) => session.id === sessionId)) return false
    this.account.sessions.push({
      id: sessionId,
      gameId,
      startedAt: normalizedEndedAt - duration * 1_000,
      endedAt: normalizedEndedAt,
      durationSeconds: duration
    })
    this.pruneSessions(normalizedEndedAt)

    const currentSeconds = playtimeSecondsFrom(game) ?? 0
    const playtimeSeconds = currentSeconds + duration
    game.playtimeSeconds = playtimeSeconds
    game.playtimeMinutes = playtimeSeconds / 60
    if (
      game.provider === 'steam' ||
      game.provider === 'epic' ||
      game.providerPlaytimeSeconds !== undefined
    ) {
      game.pendingPlaytimeSeconds = (validPlaytimeSeconds(game.pendingPlaytimeSeconds) ?? 0) + duration
    }
    game.lastPlayedTimestamp =
      Math.max(
        normalizeLibraryTimestamp(game.lastPlayedTimestamp),
        normalizedEndedAt
      ) || Date.now()
    game.updatedAt = Date.now()
    this.rebuildRecentIds()
    this.commit(game.updatedAt)
    return true
  }

  applyProviderPlaytimeDelta(
    provider: GameProvider,
    rawProviderId: string,
    playtimeSeconds: number,
    lastPlayedTimestamp?: number
  ): boolean {
    this.ensureOpen()
    if (!validProviderGameId(rawProviderId)) return false
    const game = this.account.games[providerGameId(provider, rawProviderId.trim())]
    const reportedSeconds = validPlaytimeSeconds(playtimeSeconds)
    if (!game || game.provider !== provider || reportedSeconds === undefined) return false

    const previousSeconds = game.playtimeSeconds
    const previousProviderSeconds = game.providerPlaytimeSeconds
    const previousPendingSeconds = game.pendingPlaytimeSeconds
    const previousLastPlayedTimestamp = game.lastPlayedTimestamp
    Object.assign(game, reconcileProviderPlaytime(game, reportedSeconds))
    game.lastPlayedTimestamp =
      Math.max(
        normalizeLibraryTimestamp(game.lastPlayedTimestamp),
        normalizeLibraryTimestamp(lastPlayedTimestamp)
      ) || undefined
    const changed =
      previousSeconds !== game.playtimeSeconds ||
      previousProviderSeconds !== game.providerPlaytimeSeconds ||
      previousPendingSeconds !== game.pendingPlaytimeSeconds ||
      previousLastPlayedTimestamp !== game.lastPlayedTimestamp
    if (!changed) return false

    game.updatedAt = Date.now()
    this.rebuildRecentIds()
    this.commit(game.updatedAt)
    return true
  }

  upsertLocalGame(input: LocalGameRecordInput): LibraryGame {
    this.ensureOpen()
    const now = Date.now()
    const id = providerGameId('local', input.providerGameId)
    const existing = this.account.games[id]
    const currentMetadata = existing?.metadata ?? {}
    const metadata = mergeDefinedMetadata(currentMetadata, {
      ...input.metadata,
      artwork: input.metadata.artwork
        ? { ...currentMetadata.artwork, ...input.metadata.artwork }
        : undefined
    })
    const metadataChanged = !metadataEquals(currentMetadata, metadata)
    const sameSavePath = existing?.local?.savePath === input.savePath
    const local: LocalGameConfig = {
      executablePath: input.executablePath,
      launchArguments: validatedLocalLaunchArguments(input.launchArguments),
      savePath: input.savePath,
      backupEnabled: Boolean(input.savePath),
      lastBackupAt: sameSavePath ? existing?.local?.lastBackupAt : undefined,
      lastBackupState: sameSavePath ? (existing?.local?.lastBackupState ?? 'never') : 'never'
    }
    this.account.games[id] = {
      ...existing,
      id,
      provider: 'local',
      providerGameId: input.providerGameId,
      appId: undefined,
      name: input.name,
      metadata,
      metadataRevision: (existing?.metadataRevision ?? 0) + (metadataChanged ? 1 : 0),
      metadataUpdatedAt: metadataChanged ? now : existing?.metadataUpdatedAt,
      metadataSource: 'orbit-custom-library',
      installed: true,
      installDir: input.installDir,
      local,
      owned: true,
      addedAt: existing?.addedAt ?? now,
      updatedAt: now,
      lastSeenInstalledAt: now
    }
    this.commit(now)
    return this.getGame(id) as LibraryGame
  }

  updateLocalGameLaunchArguments(gameId: string, launchArguments: readonly string[]): boolean {
    this.ensureOpen()
    const game = this.account.games[gameId]
    if (!game || game.provider !== 'local' || !game.local) return false

    const now = Date.now()
    game.local = {
      ...game.local,
      launchArguments: validatedLocalLaunchArguments(launchArguments)
    }
    game.updatedAt = now
    this.commit(now)
    return true
  }

  updateRetroGameLaunchArguments(gameId: string, launchArguments: readonly string[]): boolean {
    this.ensureOpen()
    const game = this.account.games[gameId]
    if (!game || game.provider !== 'retro' || !game.retro) return false

    const now = Date.now()
    game.retro = {
      ...game.retro,
      launchArguments: validatedLocalLaunchArguments(launchArguments)
    }
    game.updatedAt = now
    this.commit(now)
    return true
  }

  applyRetroLibraryDelta(
    records: readonly RetroGameRecordInput[],
    authoritativeRoots: readonly string[],
    unavailableRoots: readonly string[]
  ): void {
    this.ensureOpen()
    const now = Date.now()
    const seen = new Set<string>()
    const authoritative = new Set(
      authoritativeRoots.map((root) => root.replace(/\\/g, '/').toLocaleLowerCase('en-US'))
    )
    const unavailable = new Set(
      unavailableRoots.map((root) => root.replace(/\\/g, '/').toLocaleLowerCase('en-US'))
    )

    for (const input of records) {
      if (!validProviderGameId(input.providerGameId) || !hasUsableName(input.name)) continue
      const retro = sanitizeRetroConfig(input.retro)
      if (!retro) continue
      const id = providerGameId('retro', input.providerGameId.trim())
      seen.add(id)
      const existing = this.account.games[id]
      const currentMetadata = existing?.metadata ?? {}
      const metadata = mergeDefinedMetadata(currentMetadata, input.metadata)
      const metadataChanged = !metadataEquals(currentMetadata, metadata)
      const keepLaunchArguments =
        existing?.provider === 'retro' &&
        existing.retro?.emulatorId === retro.emulatorId &&
        existing.retro?.emulatorPath === retro.emulatorPath
          ? existing.retro?.launchArguments
          : undefined
      this.account.games[id] = {
        ...existing,
        id,
        provider: 'retro',
        providerGameId: input.providerGameId.trim(),
        appId: undefined,
        name: input.name.trim(),
        metadata,
        metadataRevision: (existing?.metadataRevision ?? 0) + (metadataChanged ? 1 : 0),
        metadataUpdatedAt: metadataChanged ? now : existing?.metadataUpdatedAt,
        metadataSource: retro.retroAchievementsGameId
          ? 'retroachievements'
          : 'orbit-retro-library',
        installed: true,
        installDir: input.installDir,
        local: undefined,
        retro: { ...retro, launchArguments: keepLaunchArguments },
        owned: true,
        ownershipSource: retro.sourceDirectory,
        addedAt: existing?.addedAt ?? now,
        updatedAt: now,
        lastSeenInstalledAt: now
      }
    }

    for (const [id, game] of Object.entries(this.account.games)) {
      if (game.provider !== 'retro' || !game.retro) continue
      const root = game.retro.sourceDirectory.replace(/\\/g, '/').toLocaleLowerCase('en-US')
      if (authoritative.has(root) && !seen.has(id)) {
        delete this.account.games[id]
      } else if (unavailable.has(root) && game.installed) {
        game.installed = false
        game.updatedAt = now
      }
    }
    this.rebuildRecentIds()
    this.commit(now)
  }

  removeRetroSource(sourceDirectory: string): boolean {
    this.ensureOpen()
    const normalized = sourceDirectory.replace(/\\/g, '/').toLocaleLowerCase('en-US')
    let changed = false
    for (const [id, game] of Object.entries(this.account.games)) {
      const source = game.retro?.sourceDirectory
      if (
        game.provider === 'retro' &&
        source?.replace(/\\/g, '/').toLocaleLowerCase('en-US') === normalized
      ) {
        delete this.account.games[id]
        changed = true
      }
    }
    if (changed) {
      this.rebuildRecentIds()
      this.commit(Date.now())
    }
    return changed
  }

  removeLocalGame(gameId: string): boolean {
    this.ensureOpen()
    const game = this.account.games[gameId]
    if (!game || game.provider !== 'local') return false
    delete this.account.games[gameId]
    this.rebuildRecentIds()
    this.commit(Date.now())
    return true
  }

  recordLocalBackup(gameId: string, result: LocalGameBackupResult): boolean {
    this.ensureOpen()
    const game = this.account.games[gameId]
    if (!game?.local || result.state === 'skipped') return false
    const now = Date.now()
    game.local = {
      ...game.local,
      lastBackupAt: result.completedAt,
      lastBackupState: result.state
    }
    game.updatedAt = now
    this.commit(now)
    return true
  }

  getGame(id: string): LibraryGame | undefined {
    this.ensureOpen()
    const game = this.account.games[id]
    if (!game) return undefined
    const {
      owned: _owned,
      ownershipSource: _ownershipSource,
      lastSeenOnlineAt: _online,
      lastSeenInstalledAt: _local,
      providerPlaytimeSeconds: _providerPlaytime,
      pendingPlaytimeSeconds: _pendingPlaytime,
      ...output
    } = game
    return output
  }

  getGamesByProvider(provider: GameProvider): LibraryGame[] {
    return this.getSnapshot().providerGames.filter((game) => game.provider === provider)
  }

  getProviderCounts(provider: GameProvider): {
    gameCount: number
    installedCount: number
    installableCount: number
  } {
    this.ensureOpen()
    const games = projectVisibleLibraryRecords(
      Object.values(this.account.games).filter((game) => game.provider === provider)
    )
    return {
      gameCount: games.length,
      installedCount: games.filter((game) => game.installed).length,
      installableCount: games.filter((game) => game.owned && !game.installed).length
    }
  }

  private rebuildRecentIds(): void {
    const steamRecents = this.account.steamRecentGameIds.filter(isSteamGameId)
    const steamRecentSet = new Set(steamRecents)
    const activityRecents = Object.values(this.account.games)
      .filter((game) => (game.lastStartedAt || game.lastPlayedTimestamp) && (game.owned || game.installed))
      .sort(
        (a, b) => latestLibraryActivity(b) - latestLibraryActivity(a)
      )
      .map((game) => game.id)
      .filter((id) => !steamRecentSet.has(id))
    this.account.recentGameIds = [...steamRecents, ...activityRecents]
  }

  private sanitize(input: AccountLibrary): AccountLibrary {
    const clean = emptyAccount()
    const now = Date.now()

    for (const stored of Object.values(input.games ?? {})) {
      const candidate = stored as StoredGameCandidate
      const provider = KNOWN_PROVIDERS.has(candidate.provider as GameProvider)
        ? (candidate.provider as GameProvider)
        : STEAM_PROVIDER
      const rawProviderId = String(candidate.providerGameId ?? candidate.appId ?? '').trim()
      if (!validProviderGameId(rawProviderId)) continue
      const appIdValue = Number(candidate.appId ?? (provider === STEAM_PROVIDER ? rawProviderId : NaN))
      const appId = Number.isInteger(appIdValue) && appIdValue > 0 ? appIdValue : undefined
      if (provider === STEAM_PROVIDER && !appId) continue
      const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
      if (hasUsableName(name) && !hasAllowedProviderName(provider, name)) continue
      const id = providerGameId(provider, rawProviderId)
      const existing = clean.games[id]
      if (existing && existing.updatedAt > (candidate.updatedAt ?? 0)) continue
      const {
        screenshotUrl: _legacyScreenshot,
        shortDescription: _legacySummary,
        genres: _legacyGenres,
        developers: _legacyDevelopers,
        ...currentFields
      } = candidate
      const migratedMetadata = migrateMetadata(candidate)
      const playtimeSeconds = playtimeSecondsFrom(candidate)
      const inferredProviderPlaytimeSeconds =
        validPlaytimeSeconds(candidate.providerPlaytimeSeconds) ??
        (provider === 'steam' || provider === 'epic' || provider === 'playstation'
          ? playtimeSeconds
          : undefined)
      clean.games[id] = {
        ...currentFields,
        id,
        provider,
        providerGameId: rawProviderId,
        appId,
        name,
        metadata: migratedMetadata,
        metadataRevision:
          candidate.metadataRevision ?? (Object.keys(migratedMetadata).length > 0 ? 1 : 0),
        playtimeSeconds,
        playtimeMinutes:
          playtimeSeconds === undefined ? candidate.playtimeMinutes : playtimeSeconds / 60,
        providerPlaytimeSeconds: inferredProviderPlaytimeSeconds,
        pendingPlaytimeSeconds: validPlaytimeSeconds(candidate.pendingPlaytimeSeconds) || undefined,
        lastPlayedTimestamp: normalizeLibraryTimestamp(candidate.lastPlayedTimestamp) || undefined,
        lastStartedAt: normalizeLibraryTimestamp(candidate.lastStartedAt) || undefined,
        installed: Boolean(candidate.installed),
        updateAvailable: Boolean(candidate.installed && candidate.updateAvailable),
        local: provider === 'local' ? sanitizeLocalConfig(candidate.local) : undefined,
        retro: provider === 'retro' ? sanitizeRetroConfig(candidate.retro) : undefined,
        owned: Boolean(candidate.owned),
        ownershipSource:
          typeof candidate.ownershipSource === 'string' && candidate.ownershipSource.trim()
            ? candidate.ownershipSource.trim()
            : undefined,
        addedAt: candidate.addedAt || now,
        updatedAt: candidate.updatedAt || now
      }
    }

    clean.steamRecentGameIds = [
      ...new Set(
        (input.steamRecentGameIds ?? input.recentGameIds ?? []).filter(isSteamGameId)
      )
    ]
    const steamRecentSet = new Set(clean.steamRecentGameIds)
    const knownRecents = [...new Set(input.recentGameIds ?? [])].filter(
      (id) => Boolean(clean.games[id]) && !steamRecentSet.has(id)
    )
    clean.recentGameIds = [...clean.steamRecentGameIds, ...knownRecents]
    const sessionCandidates = Array.isArray(input.sessions) ? input.sessions : []
    clean.sessions = sessionCandidates
      .flatMap((candidate) => {
        if (!candidate || typeof candidate !== 'object') return []
        const gameId = typeof candidate.gameId === 'string' ? candidate.gameId.trim() : ''
        const endedAt = normalizeLibraryTimestamp(candidate.endedAt)
        const durationSeconds = validPlaytimeSeconds(candidate.durationSeconds)
        if (
          !gameId ||
          !endedAt ||
          endedAt > now + 5 * 60_000 ||
          durationSeconds === undefined ||
          durationSeconds <= 0 ||
          durationSeconds > MAX_SESSION_SECONDS
        ) {
          return []
        }
        const startedAt = Math.min(
          endedAt,
          normalizeLibraryTimestamp(candidate.startedAt) || endedAt - durationSeconds * 1_000
        )
        return [{
          id:
            typeof candidate.id === 'string' && candidate.id.trim()
              ? candidate.id
              : `${gameId}:${endedAt}:${durationSeconds}`,
          gameId,
          startedAt,
          endedAt,
          durationSeconds
        }]
      })
      .filter((session) => session.endedAt >= now - SESSION_RETENTION_MS)
      .sort((left, right) => right.endedAt - left.endedAt)
      .filter((session, index, all) => all.findIndex((item) => item.id === session.id) === index)
      .slice(0, MAX_STORED_SESSIONS)
    clean.loadedAt = input.loadedAt ?? 0
    return clean
  }

  private migrateLegacy(steamId: string): AccountLibrary {
    const legacy = legacyDatabaseState
    if (legacy.steamId !== steamId || !legacy.snapshot) return emptyAccount()
    const account = emptyAccount()
    const now = Date.now()
    for (const old of legacy.snapshot.games ?? []) {
      const appId = Number(old.appId)
      if (!Number.isInteger(appId) || appId <= 0 || !hasUsableName(old.name)) continue
      const id = steamGameId(appId)
      const existing = account.games[id]
      const candidate: StoredGame = {
        id,
        provider: STEAM_PROVIDER,
        providerGameId: String(appId),
        appId,
        name: old.name.trim(),
        metadata: migrateMetadata(old),
        metadataRevision: Object.keys(migrateMetadata(old)).length > 0 ? 1 : 0,
        playtimeSeconds:
          typeof old.playtimeMinutes === 'number' ? Math.max(0, Math.round(old.playtimeMinutes * 60)) : undefined,
        playtimeMinutes: old.playtimeMinutes,
        providerPlaytimeSeconds:
          typeof old.playtimeMinutes === 'number' ? Math.max(0, Math.round(old.playtimeMinutes * 60)) : undefined,
        lastPlayedTimestamp: normalizeLibraryTimestamp(old.lastPlayedTimestamp) || undefined,
        installed: Boolean(old.installed),
        installDir: old.installDir,
        owned: Boolean(old.installed),
        addedAt: old.addedAt ?? now,
        updatedAt: old.updatedAt ?? now
      }
      if (!existing || candidate.updatedAt >= existing.updatedAt) account.games[id] = candidate
    }
    account.recentGameIds = [...new Set(legacy.snapshot.recentlyPlayedAppIds ?? [])]
      .map(steamGameId)
      .filter((id) => Boolean(account.games[id]))
    account.steamRecentGameIds = [...account.recentGameIds]
    account.loadedAt = legacy.snapshot.loadedAt ?? now
    return account
  }

  private pruneSessions(now: number): void {
    const cutoff = now - SESSION_RETENTION_MS
    this.account.sessions = this.account.sessions
      .filter((session) => session.endedAt >= cutoff)
      .sort((left, right) => right.endedAt - left.endedAt)
      .slice(0, MAX_STORED_SESSIONS)
  }

  private ensureOpen(): void {
    if (!this.profileOpen) this.openProfile()
  }

  private commit(timestamp: number): void {
    this.account.loadedAt = timestamp
    this.persist()
  }

  private persist(): void {
    if (!this.profileOpen) return
    databaseState.schemaVersion = DATABASE_VERSION
    databaseState.accounts[DEFAULT_PROFILE_ID] = this.account
    scheduleDatabasePersist()
  }
}

export const gameRepository = new GameRepository()
