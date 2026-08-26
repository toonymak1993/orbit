import { EventEmitter } from 'node:events'
import { watch, type FSWatcher } from 'node:fs'
import { app } from 'electron'
import type {
  GameCompletionTimes,
  LibraryDetectionMethod,
  LibraryProviderStatus,
  LibrarySnapshot
} from '@shared/ipc'
import type { SteamAuthManager } from './steamAuth'
import { settingsStore } from '../settingsStore'
import { gameRepository } from '../library/gameRepository'
import {
  getSteamAppsDirectories,
  scanInstalledSteamApps,
  scanSteamLocalActivity,
  type InstalledSteamApp
} from './steamInstall'
import {
  fetchDynamicStoreData,
  fetchSteamCommunityGames,
  fetchOwnedGamesWithToken,
  fetchSteamClientGames,
  getSteamUserToken,
  type SteamOwnedGame,
  type SteamUserToken
} from './steamWebService'
import {
  steamMetadataService,
  type MetadataSyncTarget,
  type SteamAppMetadata
} from './steamMetadata'
import { artworkService } from '../imageCache'
import { syncCoordinator } from '../sync/syncCoordinator'
import type { LibraryProviderAdapter } from '../library/libraryProvider'
import { completionTimesService } from '../completionTimes'

const STEAM_API_LANGUAGE: Record<string, string> = { en: 'english', de: 'german' }
const LOCAL_MANIFEST_SETTLE_MS = 900

interface MetadataUpdate {
  metadata: SteamAppMetadata
  allowCreate: boolean
}

function localInstallFingerprint(installed: Iterable<InstalledSteamApp>): string {
  return [...installed]
    .sort((left, right) => left.appId - right.appId)
    .map((game) => `${game.appId}:${game.updateAvailable ? 1 : 0}:${game.installDir}:${game.name}`)
    .join('\n')
}

/**
 * Aggregates Steam's sources in Playnite's order and publishes only snapshots
 * from the persistent keyed repository. Source failures never replace a good
 * cached library with an empty list.
 */
export class SteamLibraryService extends EventEmitter implements LibraryProviderAdapter<SteamAuthManager> {
  readonly provider = 'steam' as const
  private refreshInFlight: Promise<LibrarySnapshot> | null = null
  private discoverableFallbackIds = new Set<number>()
  private localManifestWatchers: FSWatcher[] = []
  private localManifestTimer: ReturnType<typeof setTimeout> | undefined
  private localInstallState = ''
  private watchedSteamId?: string
  private pendingMetadataCanCompleteLibrary = false
  private providerStatus: LibraryProviderStatus = {
    provider: 'steam',
    state: 'idle',
    connection: 'not-connected',
    methods: [],
    gameCount: 0,
    installedCount: 0,
    installableCount: 0
  }

  constructor() {
    super()
    steamMetadataService.on('busy', () => {
      gameRepository.setMetadataLoading('steam', true)
      this.emitSnapshot()
    })
    steamMetadataService.on('updated', ({ metadata, allowCreate }: MetadataUpdate) => {
      const wasPendingFallback =
        allowCreate && this.discoverableFallbackIds.has(metadata.appId)
      if (metadata.type !== 'game') {
        if (wasPendingFallback) this.resolveFallbackMetadata(metadata.appId)
        return
      }
      const changed = gameRepository.applyMetadataDelta(
        metadata,
        Boolean(wasPendingFallback)
      )
      const game = gameRepository
        .getGamesByProvider('steam')
        .find((candidate) => candidate.id === `steam:${metadata.appId}`)
      if (wasPendingFallback && game) this.resolveFallbackMetadata(metadata.appId)
      if (!changed) return
      if (game) artworkService.syncProvider([game], 'steam')
      this.emitSnapshot()
    })
    steamMetadataService.on('idle', () => {
      gameRepository.setMetadataLoading('steam', false)
      if (
        this.providerStatus.issue === 'metadata-pending' &&
        this.discoverableFallbackIds.size > 0
      ) {
        this.setProviderStatus({
          state: 'partial',
          connection: 'connected',
          methods: this.providerStatus.methods,
          pendingCount: this.discoverableFallbackIds.size,
          issue: 'source-unavailable',
          lastCheckedAt: this.providerStatus.lastCheckedAt ?? Date.now()
        })
        return
      }
      this.emitSnapshot()
    })
  }

  hydrateFromDiskIfEmpty(steamId?: string): void {
    gameRepository.openProfile(steamId)
  }

  getSnapshot(): LibrarySnapshot {
    return gameRepository.getSnapshot()
  }

  getProviderStatus(): LibraryProviderStatus {
    return {
      ...this.providerStatus,
      ...gameRepository.getProviderCounts('steam'),
      methods: [...this.providerStatus.methods]
    }
  }

  getGame(gameId: string) {
    return gameRepository.getGame(gameId)
  }

  async resolveCompletionTimes(gameId: string): Promise<GameCompletionTimes | null> {
    const game = gameRepository.getGame(gameId)
    if (!game) return null
    const completionTimes = await completionTimesService.resolve(game)
    if (completionTimes) {
      const changed = gameRepository.applyEnrichmentDelta(
        gameId,
        { completionTimes },
        completionTimes.fetchedAt
      )
      if (changed) this.emitSnapshot()
    }
    return completionTimes
  }

  markGameStarted(gameId: string): void {
    if (gameRepository.markStarted(gameId)) this.emitSnapshot()
  }

  /** Reconciles one finished session without starting a full metadata/artwork sync. */
  async refreshPlaytime(auth: SteamAuthManager, appId: number): Promise<boolean> {
    const account = auth.getAccount() ?? (await auth.restoreSession())
    if (!account || !Number.isInteger(appId) || appId <= 0) return false
    const language = STEAM_API_LANGUAGE[settingsStore.get('language')] ?? 'english'
    const sessionFetch = (url: string | URL, init?: RequestInit): Promise<Response> =>
      auth.fetchAuthenticated(url, init)
    let synchronized = false
    const localActivity = scanSteamLocalActivity(account.steamId).get(appId)
    if (localActivity) {
      const changed = gameRepository.applyProviderActivityDelta('steam', [
        {
          providerGameId: String(appId),
          playtimeSeconds: localActivity.playtimeSeconds,
          lastPlayedTimestamp: localActivity.lastPlayedTimestamp
        }
      ])
      if (changed > 0) this.emitSnapshot()
      synchronized = localActivity.playtimeSeconds !== undefined
    }

    let game
    try {
      const token = await getSteamUserToken(account.steamId, sessionFetch)
      game = (await fetchOwnedGamesWithToken(token, language)).get(appId)
    } catch {
      try {
        game = (await fetchSteamCommunityGames(account.steamId, sessionFetch)).get(appId)
      } catch {
        return synchronized
      }
    }
    if (!game || game.playtimeSeconds === undefined) return synchronized
    const changed = gameRepository.applyProviderPlaytimeDelta(
      'steam',
      String(appId),
      game.playtimeSeconds,
      game.lastPlayedTimestamp
    )
    if (changed) this.emitSnapshot()
    return true
  }

  async refresh(auth: SteamAuthManager): Promise<LibrarySnapshot> {
    if (this.refreshInFlight) return this.refreshInFlight
    this.refreshInFlight = this.doRefresh(auth)
    try {
      return await this.refreshInFlight
    } finally {
      this.refreshInFlight = null
    }
  }

  private async doRefresh(auth: SteamAuthManager): Promise<LibrarySnapshot> {
    const account = auth.getAccount() ?? (await auth.restoreSession())
    syncCoordinator.begin('library', account ? 3 : 1, 0, 'steam-local', 'steam')

    gameRepository.openProfile(account?.steamId)
    this.discoverableFallbackIds.clear()
    this.pendingMetadataCanCompleteLibrary = false
    this.setProviderStatus({
      state: 'scanning',
      connection: account ? 'connected' : 'not-connected',
      methods: ['local-manifests']
    })

    // Local state is fast, private and authoritative for installation status.
    const installed = scanInstalledSteamApps(account?.steamId)
    const localActivity = [...scanSteamLocalActivity(account?.steamId)].map(
      ([appId, activity]) => ({
        providerGameId: String(appId),
        playtimeSeconds: activity.playtimeSeconds,
        lastPlayedTimestamp: activity.lastPlayedTimestamp
      })
    )
    this.localInstallState = localInstallFingerprint(installed.values())
    this.startLocalInstallMonitor(account?.steamId)
    gameRepository.applyInstalledDelta(installed.values())
    gameRepository.applyProviderActivityDelta('steam', localActivity)
    syncCoordinator.progress('library', 1, account ? 3 : 1, 'steam-account', 'steam')
    artworkService.syncProvider(gameRepository.getGamesByProvider('steam'), 'steam')
    this.emitSnapshot()

    const language = STEAM_API_LANGUAGE[settingsStore.get('language')] ?? 'english'
    if (!account) {
      steamMetadataService.syncLibrary(
        [...installed.keys()].map((appId) => ({ appId, allowCreate: false })),
        language
      )
      syncCoordinator.complete('library', 'steam-local', 'steam')
      this.setProviderStatus({
        state: 'local-only',
        connection: 'not-connected',
        methods: ['local-manifests'],
        issue: 'not-connected',
        lastCheckedAt: Date.now()
      })
      return this.getSnapshot()
    }

    const sessionFetch = (url: string | URL, init?: RequestInit): Promise<Response> =>
      auth.fetchAuthenticated(url, init)

    const cachedByAppId = new Map(
      this.getSnapshot().providerGames.flatMap((game) =>
        game.provider === 'steam' && game.appId ? [[game.appId, game] as const] : []
      )
    )
    const methods: LibraryDetectionMethod[] = ['local-manifests']
    const addMethod = (method: LibraryDetectionMethod): void => {
      if (!methods.includes(method)) methods.push(method)
    }
    const metadataByAppId = new Map<number, boolean>()
    const addMetadataTarget = (appId: number, allowCreate: boolean): void => {
      metadataByAppId.set(appId, Boolean(metadataByAppId.get(appId) || allowCreate))
    }
    const mergeOwnedGame = (target: Map<number, SteamOwnedGame>, game: SteamOwnedGame): void => {
      const current = target.get(game.appId)
      target.set(game.appId, {
        ...current,
        ...game,
        name: game.name ?? current?.name
      })
    }
    const dynamicStoreAttempt = Promise.allSettled([fetchDynamicStoreData(sessionFetch)])

    let token: SteamUserToken | undefined
    try {
      // Steam exposes the short-lived token in #application_config on /explore/.
      // It remains in memory and is never persisted or sent anywhere but Steam.
      token = await getSteamUserToken(account.steamId, sessionFetch)
    } catch {
      // Community and authenticated Store userdata remain independent fallbacks.
    }

    let authoritativeOwned: Map<number, SteamOwnedGame> | undefined
    const supplementalOwned = new Map<number, SteamOwnedGame>()
    let clientGames = new Map<number, { appId: number; name: string }>()
    let clientSourceAvailable = false
    let ownedResponseWasEmpty = false

    if (token) {
      const [ownedAttempt, clientAttempt] = await Promise.allSettled([
        fetchOwnedGamesWithToken(token, language),
        fetchSteamClientGames(token, language)
      ])
      if (ownedAttempt.status === 'fulfilled') {
        ownedResponseWasEmpty = ownedAttempt.value.size === 0
        if (ownedAttempt.value.size > 0) {
          authoritativeOwned = ownedAttempt.value
          addMethod('account-api')
        }
      }
      if (clientAttempt.status === 'fulfilled') {
        clientSourceAvailable = true
        clientGames = clientAttempt.value
        if (clientGames.size > 0) addMethod('launcher-session')
      }
      syncCoordinator.progress('library', 2, 3, 'steam-client', 'steam')
    } else {
      syncCoordinator.progress('library', 2, 3, 'steam-community', 'steam')
    }

    for (const clientGame of clientGames.values()) {
      mergeOwnedGame(authoritativeOwned ?? supplementalOwned, {
        appId: clientGame.appId,
        name: clientGame.name
      })
    }

    if (!authoritativeOwned) {
      try {
        const communityGames = await fetchSteamCommunityGames(account.steamId, sessionFetch)
        if (communityGames.size > 0) {
          addMethod('community-profile')
          for (const game of communityGames.values()) mergeOwnedGame(supplementalOwned, game)
        }
      } catch {
        // A private or unavailable community feed must never prune cached games.
      }
    }

    let dynamicOwnedIds: number[] = []
    let dynamicRecentIds: number[] = []
    let dynamicSourceAvailable = false
    const [dynamicAttempt] = await dynamicStoreAttempt
    if (dynamicAttempt.status === 'fulfilled') {
      const dynamicStore = dynamicAttempt.value
      dynamicSourceAvailable = true
      dynamicOwnedIds = dynamicStore.ownedAppIds
      dynamicRecentIds = dynamicStore.recentlyPlayedAppIds
      if (dynamicOwnedIds.length > 0) addMethod('launcher-session')
    } else {
      // Keep the last good online snapshot when Steam's Store session is unavailable.
    }
    const supplementalSourcesComplete = clientSourceAvailable && dynamicSourceAvailable

    if (authoritativeOwned) {
      // Preserve previously verified Store-session games that are still present
      // in the current session while their metadata source catches up.
      for (const appId of dynamicOwnedIds) {
        if (authoritativeOwned.has(appId)) continue
        const cached = cachedByAppId.get(appId)
        if (!cached) continue
        authoritativeOwned.set(appId, {
          appId,
          name: cached.name,
          iconUrl: cached.metadata.iconUrl,
          playtimeSeconds: cached.playtimeSeconds,
          playtimeMinutes: cached.playtimeMinutes,
          lastPlayedTimestamp: cached.lastPlayedTimestamp
        })
      }
      // GetOwnedGames does not necessarily include Family Sharing titles. A
      // mark-and-sweep is safe only after both additive session sources were
      // also structurally available; otherwise keep cached provider records.
      if (supplementalSourcesComplete) {
        gameRepository.applyAuthoritativeOwnedDelta(authoritativeOwned.values())
      } else {
        gameRepository.applyNonAuthoritativeOwnedDelta(authoritativeOwned.values())
      }
      for (const appId of authoritativeOwned.keys()) addMetadataTarget(appId, false)
    } else if (supplementalOwned.size > 0) {
      gameRepository.applyNonAuthoritativeOwnedDelta(supplementalOwned.values())
      for (const appId of supplementalOwned.keys()) addMetadataTarget(appId, false)
    }

    const unresolved = gameRepository.applyNonAuthoritativeOwnedIds(dynamicOwnedIds)
    const unresolvedSet = new Set(unresolved)
    for (const appId of dynamicOwnedIds) addMetadataTarget(appId, unresolvedSet.has(appId))
    this.discoverableFallbackIds = unresolvedSet
    this.pendingMetadataCanCompleteLibrary = Boolean(
      authoritativeOwned && supplementalSourcesComplete
    )
    gameRepository.applyProviderActivityDelta('steam', localActivity)
    if (dynamicRecentIds.length > 0) gameRepository.setRecentSteamAppIds(dynamicRecentIds)

    let metadataTargets: MetadataSyncTarget[] = [...metadataByAppId].map(
      ([appId, allowCreate]) => ({ appId, allowCreate })
    )
    const librarySucceeded = Boolean(
      authoritativeOwned || supplementalOwned.size > 0 || dynamicOwnedIds.length > 0
    )
    const counts = gameRepository.getProviderCounts('steam')
    const fullySynchronized = Boolean(authoritativeOwned && supplementalSourcesComplete)
    if (!fullySynchronized && counts.installableCount > 0) addMethod('cached-data')
    const pendingCount = unresolved.length
    this.setProviderStatus({
      state: fullySynchronized
        ? pendingCount > 0
          ? 'partial'
          : 'ready'
        : librarySucceeded || counts.gameCount > 0
          ? 'partial'
          : 'error',
      connection: 'connected',
      methods,
      pendingCount: pendingCount || undefined,
      issue:
        pendingCount > 0
          ? 'metadata-pending'
          : fullySynchronized
            ? undefined
            : ownedResponseWasEmpty
              ? 'no-games-found'
              : librarySucceeded
                ? 'source-unavailable'
                : 'online-library-unavailable',
      lastCheckedAt: Date.now()
    })

    if (librarySucceeded) syncCoordinator.complete('library', 'steam', 'steam')
    else syncCoordinator.fail('library', 'cached-library', 'steam')

    const snapshot = this.getSnapshot()
    if (metadataTargets.length === 0) {
      metadataTargets = snapshot.providerGames
        .filter((game) => game.provider === 'steam')
        .map((game) => game.appId)
        .filter((appId): appId is number => Number.isInteger(appId))
        .map((appId) => ({ appId, allowCreate: false }))
    }
    // These two provider-neutral pipelines always run after the game delta,
    // including during onboarding. Fresh records count as completed instantly.
    steamMetadataService.syncLibrary(metadataTargets, language)
    artworkService.syncProvider(gameRepository.getGamesByProvider('steam'), 'steam')
    this.emitSnapshot()
    return this.getSnapshot()
  }

  dispose(): void {
    if (this.localManifestTimer) clearTimeout(this.localManifestTimer)
    this.localManifestTimer = undefined
    for (const watcher of this.localManifestWatchers) watcher.close()
    this.localManifestWatchers = []
  }

  private finishFallbackMetadataIfReady(): void {
    if (
      this.discoverableFallbackIds.size > 0 ||
      this.providerStatus.issue !== 'metadata-pending'
    ) {
      return
    }
    this.setProviderStatus({
      state: this.pendingMetadataCanCompleteLibrary ? 'ready' : 'partial',
      connection: 'connected',
      methods: this.providerStatus.methods,
      issue: this.pendingMetadataCanCompleteLibrary ? undefined : 'source-unavailable',
      lastCheckedAt: this.providerStatus.lastCheckedAt ?? Date.now()
    })
  }

  private resolveFallbackMetadata(appId: number): void {
    if (!this.discoverableFallbackIds.delete(appId)) return
    if (this.discoverableFallbackIds.size === 0) {
      this.finishFallbackMetadataIfReady()
      return
    }
    this.setProviderStatus({
      state: 'partial',
      connection: 'connected',
      methods: this.providerStatus.methods,
      pendingCount: this.discoverableFallbackIds.size,
      issue: 'metadata-pending',
      lastCheckedAt: this.providerStatus.lastCheckedAt ?? Date.now()
    })
  }

  private startLocalInstallMonitor(steamId?: string): void {
    this.dispose()
    this.watchedSteamId = steamId
    for (const steamappsDir of getSteamAppsDirectories()) {
      try {
        const watcher = watch(steamappsDir, { persistent: false }, (_event, filename) => {
          const changedFile = filename?.toString().toLocaleLowerCase('en') ?? ''
          const librariesChanged = changedFile === 'libraryfolders.vdf'
          if (
            changedFile &&
            !librariesChanged &&
            !/^appmanifest_\d+\.acf$/.test(changedFile)
          ) {
            return
          }
          this.scheduleLocalInstallRefresh(librariesChanged)
        })
        watcher.on('error', () => watcher.close())
        this.localManifestWatchers.push(watcher)
      } catch {
        // A missing or temporarily locked Steam library simply remains on the last good snapshot.
      }
    }
  }

  private scheduleLocalInstallRefresh(restartWatchers: boolean): void {
    if (this.localManifestTimer) clearTimeout(this.localManifestTimer)
    this.localManifestTimer = setTimeout(() => {
      this.localManifestTimer = undefined
      const installed = scanInstalledSteamApps(this.watchedSteamId)
      const fingerprint = localInstallFingerprint(installed.values())
      if (fingerprint !== this.localInstallState) {
        this.localInstallState = fingerprint
        gameRepository.applyInstalledDelta(installed.values())
        artworkService.syncProvider(gameRepository.getGamesByProvider('steam'), 'steam')
        this.emitSnapshot()
      }
      if (restartWatchers) this.startLocalInstallMonitor(this.watchedSteamId)
    }, LOCAL_MANIFEST_SETTLE_MS)
    this.localManifestTimer.unref()
  }

  private setProviderStatus(
    next: Omit<
      LibraryProviderStatus,
      'provider' | 'gameCount' | 'installedCount' | 'installableCount'
    >
  ): void {
    this.providerStatus = {
      provider: 'steam',
      ...gameRepository.getProviderCounts('steam'),
      ...next,
      methods: [...next.methods]
    }
    this.emitSnapshot()
  }

  private emitSnapshot(): void {
    this.emit('updated', this.getSnapshot())
  }
}

export const steamLibraryService = new SteamLibraryService()
app.once('before-quit', () => steamLibraryService.dispose())
