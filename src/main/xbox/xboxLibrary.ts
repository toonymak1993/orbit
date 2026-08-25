import { EventEmitter } from 'node:events'
import type {
  GameMetadata,
  LibraryDetectionMethod,
  LibraryProviderStatus,
  LibrarySnapshot
} from '@shared/ipc'
import { artworkService } from '../imageCache'
import { gameRepository } from '../library/gameRepository'
import type { LibraryProviderAdapter } from '../library/libraryProvider'
import { syncCoordinator } from '../sync/syncCoordinator'
import { scanXboxAppLibrary, type XboxAppGame } from './xboxAppLibrary'
import { scanInstalledXboxGames } from './xboxInstall'
import {
  xboxMetadataService,
  type XboxMetadataResult,
  type XboxMetadataSyncTarget
} from './xboxMetadata'

interface MetadataUpdate {
  metadata: XboxMetadataResult
}

function unique(values: Iterable<string | undefined>): string[] | undefined {
  const result = [...new Set([...values].filter((value): value is string => Boolean(value)))]
  return result.length > 0 ? result : undefined
}

function installedMetadata(local: GameMetadata, catalog?: XboxAppGame): GameMetadata {
  if (!catalog) return local
  return {
    ...local,
    ...catalog.metadata,
    // Launching stays tied to the installed AppX identity even though the
    // durable library identity is now the Microsoft Store product ID.
    launchUri: local.launchUri,
    artwork: {
      vertical: unique([
        ...(catalog.metadata.artwork?.vertical ?? []),
        ...(local.artwork?.vertical ?? [])
      ]),
      horizontal: unique([
        ...(catalog.metadata.artwork?.horizontal ?? []),
        ...(local.artwork?.horizontal ?? [])
      ]),
      icon: unique([
        ...(catalog.metadata.artwork?.icon ?? []),
        ...(local.artwork?.icon ?? [])
      ])
    }
  }
}

/** Xbox adapter: Xbox-app collection, local install scan and cached enrichment. */
export class XboxLibraryService
  extends EventEmitter
  implements LibraryProviderAdapter<void>
{
  readonly provider = 'xbox' as const
  private refreshInFlight: Promise<LibrarySnapshot> | null = null
  private providerStatus: LibraryProviderStatus = {
    provider: 'xbox',
    state: 'idle',
    connection: 'automatic',
    methods: [],
    gameCount: 0,
    installedCount: 0,
    installableCount: 0
  }

  constructor() {
    super()
    xboxMetadataService.on('busy', () => {
      gameRepository.setMetadataLoading('xbox', true)
      this.emitSnapshot()
    })
    xboxMetadataService.on('updated', ({ metadata }: MetadataUpdate) => {
      if (metadata.kind !== 'game') return
      const changed = gameRepository.applyProviderMetadataDelta(
        'xbox',
        {
          providerGameId: metadata.providerGameId,
          name: metadata.name,
          metadata: metadata.metadata,
          locale: metadata.locale,
          source: metadata.source,
          fetchedAt: metadata.fetchedAt
        },
        false
      )
      if (changed) {
        const game = gameRepository
          .getGamesByProvider('xbox')
          .find((candidate) => candidate.id === `xbox:${metadata.providerGameId}`)
        if (game) artworkService.syncProvider([game], 'xbox')
        this.emitSnapshot()
      }
    })
    xboxMetadataService.on('idle', () => {
      gameRepository.setMetadataLoading('xbox', false)
      this.emitSnapshot()
    })
  }

  getSnapshot(): LibrarySnapshot {
    return gameRepository.getSnapshot()
  }

  getProviderStatus(): LibraryProviderStatus {
    return {
      ...this.providerStatus,
      ...gameRepository.getProviderCounts('xbox'),
      methods: [...this.providerStatus.methods]
    }
  }

  async refresh(): Promise<LibrarySnapshot> {
    if (this.refreshInFlight) return this.refreshInFlight
    this.refreshInFlight = this.doRefresh()
    try {
      return await this.refreshInFlight
    } finally {
      this.refreshInFlight = null
    }
  }

  private async doRefresh(): Promise<LibrarySnapshot> {
    syncCoordinator.begin('library', 4, 0, 'xbox-app', 'xbox')
    this.setProviderStatus({
      state: 'scanning',
      connection: 'automatic',
      methods: []
    })
    const [appLibraryResult, installedResult] = await Promise.allSettled([
      scanXboxAppLibrary(),
      scanInstalledXboxGames()
    ])

    const appLibrary = appLibraryResult.status === 'fulfilled' ? appLibraryResult.value : undefined
    const installed = installedResult.status === 'fulfilled' ? installedResult.value : undefined
    syncCoordinator.progress('library', 1, 4, 'xbox-packages', 'xbox')

    if (appLibrary?.available && appLibrary.activeSubscription) {
      gameRepository.applyAuthoritativeProviderDelta(
        'xbox',
        [...appLibrary.games.values()].map((game) => ({
          providerGameId: game.providerGameId,
          name: game.name,
          metadata: game.metadata
        }))
      )
      syncCoordinator.begin(
        'metadata',
        appLibrary.games.size,
        appLibrary.games.size,
        'xbox-app-cache',
        'xbox-cache'
      )
    } else if (appLibraryResult.status === 'rejected') {
      // Keep the previous account snapshot if the Xbox app is updating its DB.
      syncCoordinator.fail('metadata', 'xbox-app-cache', 'xbox-cache')
    } else {
      syncCoordinator.begin('metadata', 0, 0, 'xbox-app-cache', 'xbox-cache')
    }
    syncCoordinator.progress('library', 2, 4, 'xbox-installed', 'xbox')

    const fallbackTargets: XboxMetadataSyncTarget[] = []
    if (installed) {
      const installedDeltas = [...installed.values()].map((game) => {
        const catalog = appLibrary?.byPackageFamilyName.get(game.packageFamilyName.toLowerCase())
        if (!catalog) {
          fallbackTargets.push({
            providerGameId: game.providerGameId,
            name: game.name,
            packageVersion: game.packageVersion
          })
        }
        return {
          providerGameId: catalog?.providerGameId ?? game.providerGameId,
          name: game.name,
          installDir: game.installDir,
          metadata: installedMetadata(game.metadata, catalog)
        }
      })
      gameRepository.applyInstalledProviderDelta('xbox', installedDeltas)
    }
    xboxMetadataService.syncLibrary(fallbackTargets)
    syncCoordinator.progress('library', 3, 4, 'xbox-artwork', 'xbox')
    this.emitSnapshot()

    artworkService.syncProvider(gameRepository.getGamesByProvider('xbox'), 'xbox')
    syncCoordinator.progress('library', 4, 4, 'xbox', 'xbox')
    if (appLibraryResult.status === 'rejected' && installedResult.status === 'rejected') {
      syncCoordinator.fail('library', 'xbox-cache', 'xbox')
    } else {
      syncCoordinator.complete('library', 'xbox', 'xbox')
    }

    const methods: LibraryDetectionMethod[] = []
    if (appLibraryResult.status === 'fulfilled') methods.push('xbox-app-cache')
    if (installedResult.status === 'fulfilled') methods.push('windows-packages')
    const counts = gameRepository.getProviderCounts('xbox')
    const allSourcesFailed =
      appLibraryResult.status === 'rejected' && installedResult.status === 'rejected'
    const appLibraryReady = Boolean(appLibrary?.available && appLibrary.activeSubscription)
    const oneSourceFailed =
      appLibraryResult.status === 'rejected' || installedResult.status === 'rejected'
    this.setProviderStatus({
      state: allSourcesFailed
        ? 'error'
        : oneSourceFailed
          ? 'partial'
          : appLibraryReady
            ? 'ready'
            : 'local-only',
      connection: 'automatic',
      methods,
      issue: allSourcesFailed || oneSourceFailed || !appLibraryReady
        ? 'source-unavailable'
        : counts.gameCount === 0
          ? 'no-games-found'
          : undefined,
      lastCheckedAt: Date.now()
    })

    this.emitSnapshot()
    return this.getSnapshot()
  }

  private emitSnapshot(): void {
    this.emit('updated', this.getSnapshot())
  }

  private setProviderStatus(
    next: Omit<
      LibraryProviderStatus,
      'provider' | 'gameCount' | 'installedCount' | 'installableCount'
    >
  ): void {
    this.providerStatus = {
      provider: 'xbox',
      ...gameRepository.getProviderCounts('xbox'),
      ...next,
      methods: [...next.methods]
    }
    this.emitSnapshot()
  }
}

export const xboxLibraryService = new XboxLibraryService()
