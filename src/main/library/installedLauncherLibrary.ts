import { EventEmitter } from 'node:events'
import type {
  LibraryDetectionMethod,
  LibraryProviderStatus,
  LibrarySnapshot
} from '@shared/ipc'
import { artworkService } from '../imageCache'
import { syncCoordinator } from '../sync/syncCoordinator'
import { gameRepository } from './gameRepository'
import type { LibraryProviderAdapter } from './libraryProvider'
import {
  scanWindowsLauncherLibraries,
  type WindowsLauncherProvider
} from './windowsLauncherDiscovery'

/** Installed-only adapter for launchers whose durable game IDs are registered by Windows. */
export class InstalledLauncherLibraryService
  extends EventEmitter
  implements LibraryProviderAdapter<void>
{
  private refreshInFlight: Promise<LibrarySnapshot> | null = null
  private providerStatus: LibraryProviderStatus

  constructor(
    readonly provider: Extract<WindowsLauncherProvider, 'gog' | 'ea'>,
    private readonly method: LibraryDetectionMethod = 'windows-registry'
  ) {
    super()
    this.providerStatus = {
      provider,
      state: 'idle',
      connection: 'automatic',
      methods: [],
      gameCount: 0,
      installedCount: 0,
      installableCount: 0
    }
  }

  getProviderStatus(): LibraryProviderStatus {
    return {
      ...this.providerStatus,
      ...gameRepository.getProviderCounts(this.provider),
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
    syncCoordinator.begin('library', 1, 0, this.provider, this.provider)
    this.setProviderStatus({
      state: 'scanning',
      connection: 'automatic',
      methods: []
    })

    try {
      const discovery = await scanWindowsLauncherLibraries()
      if (!discovery.complete) throw new Error('Windows launcher discovery is unavailable')
      gameRepository.applyInstalledProviderDelta(
        this.provider,
        [...discovery.games[this.provider].values()].map((game) => ({
          providerGameId: game.providerGameId,
          name: game.name,
          installDir: game.installDir,
          metadata: game.metadata
        }))
      )
      artworkService.syncProvider(gameRepository.getGamesByProvider(this.provider), this.provider)
      const counts = gameRepository.getProviderCounts(this.provider)
      this.setProviderStatus({
        state: 'ready',
        connection: 'automatic',
        methods: [this.method],
        issue: counts.gameCount === 0 ? 'no-games-found' : undefined,
        lastCheckedAt: Date.now()
      })
      syncCoordinator.complete('library', this.provider, this.provider)
    } catch {
      this.setProviderStatus({
        state: 'error',
        connection: 'automatic',
        methods: [],
        issue: 'source-unavailable',
        lastCheckedAt: Date.now()
      })
      syncCoordinator.fail('library', this.provider, this.provider)
    }

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
      provider: this.provider,
      ...gameRepository.getProviderCounts(this.provider),
      ...next,
      methods: [...next.methods]
    }
    this.emitSnapshot()
  }

  private emitSnapshot(): void {
    this.emit('updated', gameRepository.getSnapshot())
  }
}
