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
  type InstalledSteamApp
} from './steamInstall'
import {
  fetchDynamicStoreData,
  fetchSteamCommunityGames,
  fetchOwnedGamesWithToken,
  fetchSteamClientGames,
  getSteamUserToken
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
        allowCreate && this.discoverableFallbackIds.delete(metadata.appId)
      if (metadata.type !== 'game') {
        if (wasPendingFallback) this.finishFallbackMetadataIfReady()
        return
      }
      const changed = gameRepository.applyMetadataDelta(
        metadata,
        Boolean(wasPendingFallback)
      )
      if (wasPendingFallback) this.finishFallbackMetadataIfReady()
      if (!changed) return
      const game = gameRepository
        .getGamesByProvider('steam')
        .find((candidate) => candidate.id === `steam:${metadata.appId}`)
      if (game) artworkService.syncProvider([game], 'steam')
      this.emitSnapshot()
    })
    steamMetadataService.on('idle', () => {
      gameRepository.setMetadataLoading('steam', false)
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
    this.setProviderStatus({
      state: 'scanning',
      connection: account ? 'connected' : 'not-connected',
      methods: ['local-manifests']
    })

    // Local state is fast, private and authoritative for installation status.
    const installed = scanInstalledSteamApps(account?.steamId)
    this.localInstallState = localInstallFingerprint(installed.values())
    this.startLocalInstallMonitor(account?.steamId)
    gameRepository.applyInstalledDelta(installed.values())
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

    let metadataTargets: MetadataSyncTarget[] = []
    let librarySucceeded = false
    try {
      // The token is read from Steam's authenticated store page and retained in
      // memory only. This is the same no-user-API-key path used by Playnite.
      const token = await getSteamUserToken(account.steamId, sessionFetch)
      const owned = await fetchOwnedGamesWithToken(token, language)
      if (owned.size === 0 && installed.size > 0) {
        throw new Error('Steam account library returned no games')
      }
      syncCoordinator.progress('library', 2, 3, 'steam-client', 'steam')

      // ClientComm is a supplemental source. Failure is harmless because the
      // owned-games response is already authoritative.
      try {
        const clientGames = await fetchSteamClientGames(token, language)
        for (const [appId, clientGame] of clientGames) {
          const game = owned.get(appId)
          if (game) game.name = clientGame.name
        }
      } catch {
        // Steam client is not running or the endpoint is unavailable.
      }

      gameRepository.applyAuthoritativeOwnedDelta(owned.values())
      const recent = [...owned.values()]
        .filter((game) => Boolean(game.lastPlayedTimestamp))
        .sort((a, b) => (b.lastPlayedTimestamp ?? 0) - (a.lastPlayedTimestamp ?? 0))
        .map((game) => game.appId)
      gameRepository.setRecentSteamAppIds(recent)
      metadataTargets = [...owned.keys()].map((appId) => ({ appId, allowCreate: false }))
      librarySucceeded = true
      this.setProviderStatus({
        state: 'ready',
        connection: 'connected',
        methods: ['local-manifests', 'account-api'],
        issue: owned.size === 0 ? 'no-games-found' : undefined,
        lastCheckedAt: Date.now()
      })
    } catch {
      syncCoordinator.progress('library', 2, 3, 'steam-community', 'steam')
      try {
        const owned = await fetchSteamCommunityGames(account.steamId, sessionFetch)
        if (owned.size === 0 && installed.size > 0) {
          throw new Error('Steam community library returned no games')
        }
        gameRepository.applyAuthoritativeOwnedDelta(owned.values())
        metadataTargets = [...owned.keys()].map((appId) => ({ appId, allowCreate: false }))
        librarySucceeded = true
        this.setProviderStatus({
          state: 'ready',
          connection: 'connected',
          methods: ['local-manifests', 'community-profile'],
          issue: owned.size === 0 ? 'no-games-found' : undefined,
          lastCheckedAt: Date.now()
        })
      } catch {
        syncCoordinator.progress('library', 2, 3, 'steam-fallback', 'steam')
        const fallback = await this.refreshFromConservativeFallback(sessionFetch)
        metadataTargets = fallback.targets
        librarySucceeded = fallback.succeeded
        const counts = gameRepository.getProviderCounts('steam')
        const methods: LibraryDetectionMethod[] = ['local-manifests']
        if (fallback.succeeded) methods.push('launcher-session')
        else if (counts.installableCount > 0) {
          methods.push('cached-data')
        }
        this.setProviderStatus({
          state: fallback.succeeded
            ? fallback.pendingCount > 0
              ? 'partial'
              : 'ready'
            : counts.gameCount > 0
              ? 'partial'
              : 'error',
          connection: 'connected',
          methods,
          pendingCount: fallback.pendingCount || undefined,
          issue: fallback.succeeded
            ? fallback.pendingCount > 0
              ? 'metadata-pending'
              : undefined
            : 'online-library-unavailable',
          lastCheckedAt: Date.now()
        })
      }
    }

    if (librarySucceeded) syncCoordinator.complete('library', 'steam', 'steam')
    else syncCoordinator.fail('library', 'cached-library', 'steam')

    const snapshot = this.getSnapshot()
    if (metadataTargets.length === 0) {
      metadataTargets = snapshot.games
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

  private async refreshFromConservativeFallback(
    sessionFetch: (url: string | URL, init?: RequestInit) => Promise<Response>
  ): Promise<{ succeeded: boolean; targets: MetadataSyncTarget[]; pendingCount: number }> {
    try {
      const fallback = await fetchDynamicStoreData(sessionFetch)
      if (fallback.ownedAppIds.length === 0) {
        return { succeeded: false, targets: [], pendingCount: 0 }
      }
      const unresolved = gameRepository.applyNonAuthoritativeOwnedIds(fallback.ownedAppIds)
      this.discoverableFallbackIds = new Set(unresolved)
      if (fallback.recentlyPlayedAppIds.length > 0) {
        gameRepository.setRecentSteamAppIds(fallback.recentlyPlayedAppIds)
      }

      const knownAppIds = this.getSnapshot().games
        .map((game) => game.appId)
        .filter((appId): appId is number => Number.isInteger(appId))
      const unresolvedSet = new Set(unresolved)
      const targets = [...new Set([...unresolved, ...knownAppIds])].map((appId) => ({
        appId,
        allowCreate: unresolvedSet.has(appId)
      }))
      return { succeeded: true, targets, pendingCount: unresolved.length }
    } catch {
      // Keep the keyed on-disk snapshot and the fresh local installation delta.
      return { succeeded: false, targets: [], pendingCount: 0 }
    }
  }

  private finishFallbackMetadataIfReady(): void {
    if (
      this.discoverableFallbackIds.size > 0 ||
      this.providerStatus.issue !== 'metadata-pending'
    ) {
      return
    }
    this.setProviderStatus({
      state: 'ready',
      connection: 'connected',
      methods: ['local-manifests', 'launcher-session'],
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
