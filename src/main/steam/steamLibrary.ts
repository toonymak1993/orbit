import { EventEmitter } from 'node:events'
import type { GameCompletionTimes, LibrarySnapshot } from '@shared/ipc'
import type { SteamAuthManager } from './steamAuth'
import { settingsStore } from '../settingsStore'
import { gameRepository } from '../library/gameRepository'
import { scanInstalledSteamApps } from './steamInstall'
import {
  fetchDynamicStoreData,
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

interface MetadataUpdate {
  metadata: SteamAppMetadata
  allowCreate: boolean
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

  constructor() {
    super()
    steamMetadataService.on('busy', () => {
      gameRepository.setMetadataLoading('steam', true)
      this.emitSnapshot()
    })
    steamMetadataService.on('updated', ({ metadata, allowCreate }: MetadataUpdate) => {
      if (metadata.type !== 'game') return
      const changed = gameRepository.applyMetadataDelta(
        metadata,
        allowCreate && this.discoverableFallbackIds.has(metadata.appId)
      )
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

    // Local state is fast, private and authoritative for installation status.
    const installed = scanInstalledSteamApps(account?.steamId)
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
    } catch {
      syncCoordinator.progress('library', 2, 3, 'steam-fallback', 'steam')
      const fallback = await this.refreshFromConservativeFallback(sessionFetch)
      metadataTargets = fallback.targets
      librarySucceeded = fallback.succeeded
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

  private async refreshFromConservativeFallback(
    sessionFetch: (url: string | URL, init?: RequestInit) => Promise<Response>
  ): Promise<{ succeeded: boolean; targets: MetadataSyncTarget[] }> {
    try {
      const fallback = await fetchDynamicStoreData(sessionFetch)
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
      return { succeeded: true, targets }
    } catch {
      // Keep the keyed on-disk snapshot and the fresh local installation delta.
      return { succeeded: false, targets: [] }
    }
  }

  private emitSnapshot(): void {
    this.emit('updated', this.getSnapshot())
  }
}

export const steamLibraryService = new SteamLibraryService()
