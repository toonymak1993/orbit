import { EventEmitter } from 'node:events'
import type {
  LibraryDetectionMethod,
  LibraryProviderStatus,
  LibrarySnapshot
} from '@shared/ipc'
import { artworkService } from '../imageCache'
import { gameRepository } from '../library/gameRepository'
import type { LibraryProviderAdapter } from '../library/libraryProvider'
import { scanWindowsLauncherLibraries } from '../library/windowsLauncherDiscovery'
import { syncCoordinator } from '../sync/syncCoordinator'
import { scanUbisoftCatalog } from './ubisoftCatalog'

/** Ubisoft adapter: local owned-game cache plus authoritative Windows install state. */
export class UbisoftLibraryService
  extends EventEmitter
  implements LibraryProviderAdapter<void>
{
  readonly provider = 'ubisoft' as const
  private refreshInFlight: Promise<LibrarySnapshot> | null = null
  private providerStatus: LibraryProviderStatus = {
    provider: 'ubisoft',
    state: 'idle',
    connection: 'automatic',
    methods: [],
    gameCount: 0,
    installedCount: 0,
    installableCount: 0
  }

  getProviderStatus(): LibraryProviderStatus {
    return {
      ...this.providerStatus,
      ...gameRepository.getProviderCounts('ubisoft'),
      methods: [...this.providerStatus.methods]
    }
  }

  refresh(): Promise<LibrarySnapshot> {
    if (this.refreshInFlight) return this.refreshInFlight
    const refresh = this.doRefresh().finally(() => {
      if (this.refreshInFlight === refresh) this.refreshInFlight = null
    })
    this.refreshInFlight = refresh
    return refresh
  }

  private async doRefresh(): Promise<LibrarySnapshot> {
    syncCoordinator.begin('library', 2, 0, 'ubisoft', 'ubisoft')
    this.setProviderStatus({
      state: 'scanning',
      connection: 'automatic',
      methods: []
    })

    const [installResult, catalogResult] = await Promise.allSettled([
      scanWindowsLauncherLibraries(),
      scanUbisoftCatalog()
    ])
    const methods: LibraryDetectionMethod[] = []
    const discovery = installResult.status === 'fulfilled' ? installResult.value : undefined
    const installReady = Boolean(discovery?.complete)
    if (installReady) methods.push('windows-registry')
    syncCoordinator.progress('library', 1, 2, 'ubisoft-catalog', 'ubisoft')

    const catalog = catalogResult.status === 'fulfilled' ? catalogResult.value : undefined
    const catalogAvailable = Boolean(catalog?.available)
    const catalogComplete = Boolean(catalog?.available && catalog.complete)
    if (catalogAvailable) methods.push('launcher-cache')

    if (catalog?.available) {
      const owned = [...catalog.games.values()].map((game) => ({
        providerGameId: game.providerGameId,
        name: game.name,
        metadata: game.metadata
      }))
      if (catalog.complete) {
        gameRepository.applyAuthoritativeProviderSourceDelta(
          'ubisoft',
          'ubisoft-launcher-cache',
          owned
        )
      } else {
        gameRepository.applyNonAuthoritativeProviderSourceDelta(
          'ubisoft',
          'ubisoft-launcher-cache',
          owned
        )
      }
    }

    if (installReady && discovery) {
      gameRepository.applyInstalledProviderDelta(
        'ubisoft',
        [...discovery.games.ubisoft.values()].map((installed) => {
          const catalogGame = catalog?.games.get(installed.providerGameId)
          return {
            providerGameId: installed.providerGameId,
            name: catalogGame?.name ?? installed.name,
            installDir: installed.installDir,
            metadata: { ...installed.metadata, ...catalogGame?.metadata }
          }
        })
      )
    }

    const counts = gameRepository.getProviderCounts('ubisoft')
    if (counts.gameCount > 0 && methods.length === 0) methods.push('cached-data')
    const allSourcesFailed = !installReady && !catalogAvailable
    this.setProviderStatus({
      state: allSourcesFailed
        ? 'error'
        : installReady && catalogComplete
          ? 'ready'
          : installReady && !catalogAvailable
            ? 'local-only'
            : 'partial',
      connection: 'automatic',
      methods,
      issue: allSourcesFailed
        ? 'source-unavailable'
        : counts.gameCount === 0
          ? 'no-games-found'
          : catalogAvailable && !catalogComplete
            ? 'source-unavailable'
            : undefined,
      lastCheckedAt: Date.now()
    })

    artworkService.syncProvider(gameRepository.getGamesByProvider('ubisoft'), 'ubisoft')
    if (allSourcesFailed) syncCoordinator.fail('library', 'ubisoft', 'ubisoft')
    else syncCoordinator.complete('library', 'ubisoft', 'ubisoft')
    this.emitSnapshot()
    return gameRepository.getSnapshot()
  }

  private setProviderStatus(
    next: Omit<
      LibraryProviderStatus,
      'provider' | 'gameCount' | 'installedCount' | 'installableCount'
    >
  ): void {
    this.providerStatus = {
      provider: 'ubisoft',
      ...gameRepository.getProviderCounts('ubisoft'),
      ...next,
      methods: [...next.methods]
    }
    this.emitSnapshot()
  }

  private emitSnapshot(): void {
    this.emit('updated', gameRepository.getSnapshot())
  }
}

export const ubisoftLibraryService = new UbisoftLibraryService()
