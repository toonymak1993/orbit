import { EventEmitter } from 'node:events'
import type {
  GameMetadata,
  LibraryGame,
  LibraryDetectionMethod,
  LibraryProviderStatus,
  LibrarySnapshot
} from '@shared/ipc'
import { artworkService } from '../imageCache'
import { gameRepository } from '../library/gameRepository'
import type { LibraryProviderAdapter } from '../library/libraryProvider'
import { syncCoordinator } from '../sync/syncCoordinator'
import { settingsStore } from '../settingsStore'
import { STORE_REGIONS } from '../store/storeRegions'
import { scanXboxAppLibrary, type XboxAppGame } from './xboxAppLibrary'
import { fetchXboxCatalogProducts } from './xboxCatalog'
import { scanInstalledXboxGameByFamily, scanInstalledXboxGames } from './xboxInstall'
import { normalizeXboxPackageFamilyName } from './xboxPackageIdentity'
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

function xboxProductId(value: string | undefined): string | undefined {
  const normalized = value?.trim().toUpperCase()
  return normalized && /^[A-Z0-9]{12}$/.test(normalized) ? normalized : undefined
}

function installedMetadata(local: GameMetadata, catalog?: XboxAppGame): GameMetadata {
  if (!catalog) return local
  return {
    ...local,
    ...catalog.metadata,
    // Launching stays tied to the installed AppX identity even though the
    // durable library identity is now the Microsoft Store product ID.
    launchUri: local.launchUri,
    launchExecutable: local.launchExecutable,
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
      ]),
      logo: unique([
        ...(catalog.metadata.artwork?.logo ?? []),
        ...(local.artwork?.logo ?? [])
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
  private packageRefreshes = new Map<string, Promise<boolean>>()
  private gameIdByPackageFamilyName = new Map<string, string>()
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

  /** Resolves a package admitted by the Xbox cache or a Gaming Services Store ID. */
  resolvePackageFamilyName(
    packageFamilyName: string,
    suggestedProductId?: string
  ): LibraryGame | undefined {
    const normalized = normalizeXboxPackageFamilyName(packageFamilyName)
    if (!normalized) return undefined
    const key = normalized.toLowerCase()
    let gameId = this.gameIdByPackageFamilyName.get(key)
    const productId = xboxProductId(suggestedProductId)
    if (!gameId && productId) {
      const suggestedGame = gameRepository.getGame(`xbox:${productId}`)
      if (suggestedGame?.provider === 'xbox') {
        gameId = suggestedGame.id
        this.gameIdByPackageFamilyName.set(key, gameId)
      }
    }
    if (!gameId) return undefined
    const game = gameRepository.getGame(gameId)
    return game?.provider === 'xbox' ? game : undefined
  }

  /** Reconciles one completed Windows package in isolation. This keeps the
   * install-to-library path independent from the slower Xbox account cache. */
  async refreshInstalledPackage(
    packageFamilyName: string,
    suggestedProductId?: string
  ): Promise<boolean> {
    const normalized = normalizeXboxPackageFamilyName(packageFamilyName)
    if (!normalized) return false
    const key = normalized.toLowerCase()
    this.resolvePackageFamilyName(normalized, suggestedProductId)
    const active = this.packageRefreshes.get(key)
    if (active) return active

    const request = this.doRefreshInstalledPackage(normalized, suggestedProductId)
    this.packageRefreshes.set(key, request)
    try {
      return await request
    } finally {
      if (this.packageRefreshes.get(key) === request) this.packageRefreshes.delete(key)
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

    let appLibrary = appLibraryResult.status === 'fulfilled' ? appLibraryResult.value : undefined
    const installed = installedResult.status === 'fulfilled' ? installedResult.value : undefined
    let displayCatalogAvailable = false
    let displayCatalogCached = false
    if (
      appLibrary?.available &&
      appLibrary.activeSubscription &&
      appLibrary.unresolvedProductIds.length > 0
    ) {
      const requestedIds = new Set(appLibrary.unresolvedProductIds)
      const resolved = new Map<string, XboxAppGame>()
      for (const game of gameRepository.getGamesByProvider('xbox')) {
        if (!requestedIds.has(game.providerGameId)) continue
        resolved.set(game.providerGameId, {
          providerGameId: game.providerGameId,
          name: game.name,
          metadata: game.metadata
        })
      }
      displayCatalogCached = resolved.size > 0
      const unresolvedAfterCache = appLibrary.unresolvedProductIds.filter(
        (productId) => !resolved.has(productId)
      )
      try {
        if (unresolvedAfterCache.length > 0) {
          const remote = await fetchXboxCatalogProducts(
            unresolvedAfterCache,
            STORE_REGIONS[settingsStore.get('storeRegion')]
          )
          for (const [productId, game] of remote) resolved.set(productId, game)
          displayCatalogAvailable = true
        }
      } catch {
        // The Xbox app cache remains a non-destructive partial source while
        // Microsoft's public display catalog is offline or rate-limited.
      }
      const games = new Map(appLibrary.games)
      const byPackageFamilyName = new Map(appLibrary.byPackageFamilyName)
      for (const [productId, game] of resolved) {
        games.set(productId, game)
        const packageFamilyName = normalizeXboxPackageFamilyName(game.packageFamilyName)
        if (packageFamilyName) {
          byPackageFamilyName.set(packageFamilyName.toLowerCase(), game)
        }
      }
      const unresolvedProductIds = appLibrary.unresolvedProductIds.filter(
        (productId) => !resolved.has(productId)
      )
      appLibrary = {
        ...appLibrary,
        complete: unresolvedProductIds.length === 0,
        resolvedProductCount: games.size,
        unresolvedProductCount: unresolvedProductIds.length,
        unresolvedProductIds,
        games,
        byPackageFamilyName
      }
    }
    const nextPackageGameIds = new Map<string, string>()
    for (const game of appLibrary?.games.values() ?? []) {
      const packageFamilyName = normalizeXboxPackageFamilyName(game.packageFamilyName)
      if (packageFamilyName) {
        nextPackageGameIds.set(
          packageFamilyName.toLowerCase(),
          `xbox:${game.providerGameId}`
        )
      }
    }
    syncCoordinator.progress('library', 1, 4, 'xbox-packages', 'xbox')

    if (appLibrary?.available && appLibrary.activeSubscription) {
      const subscriptionGames = [...appLibrary.games.values()].map((game) => ({
          providerGameId: game.providerGameId,
          name: game.name,
          metadata: game.metadata
        }))
      if (appLibrary.complete) {
        gameRepository.applyAuthoritativeProviderSourceDelta(
          'xbox',
          'game-pass-cache',
          subscriptionGames
        )
      } else {
        gameRepository.applyNonAuthoritativeProviderSourceDelta(
          'xbox',
          'game-pass-cache',
          subscriptionGames
        )
      }
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
        const packageFamilyName = normalizeXboxPackageFamilyName(game.packageFamilyName)
        const catalog = packageFamilyName
          ? appLibrary?.byPackageFamilyName.get(packageFamilyName.toLowerCase())
          : undefined
        const previouslyMapped = packageFamilyName
          ? this.resolvePackageFamilyName(packageFamilyName)
          : undefined
        const resolvedProviderGameId =
          catalog?.providerGameId ?? previouslyMapped?.providerGameId ?? game.providerGameId
        if (packageFamilyName) {
          nextPackageGameIds.set(
            packageFamilyName.toLowerCase(),
            `xbox:${resolvedProviderGameId}`
          )
        }
        if (!catalog) {
          fallbackTargets.push({
            providerGameId: resolvedProviderGameId,
            name: game.name,
            packageVersion: game.packageVersion
          })
        }
        return {
          providerGameId: resolvedProviderGameId,
          name: game.name,
          installDir: game.installDir,
          metadata: installedMetadata(game.metadata, catalog)
        }
      })
      gameRepository.applyInstalledProviderDelta('xbox', installedDeltas)
    }
    if (appLibraryResult.status === 'fulfilled' && installedResult.status === 'fulfilled') {
      this.gameIdByPackageFamilyName = nextPackageGameIds
    } else if (
      appLibraryResult.status === 'fulfilled' ||
      installedResult.status === 'fulfilled'
    ) {
      this.gameIdByPackageFamilyName = new Map([
        ...this.gameIdByPackageFamilyName,
        ...nextPackageGameIds
      ])
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
    if (displayCatalogAvailable) methods.push('xbox-display-catalog')
    if (displayCatalogCached) methods.push('cached-data')
    if (installedResult.status === 'fulfilled') methods.push('windows-packages')
    const counts = gameRepository.getProviderCounts('xbox')
    const allSourcesFailed =
      appLibraryResult.status === 'rejected' && installedResult.status === 'rejected'
    const appLibraryReady = Boolean(
      appLibrary?.available && appLibrary.activeSubscription && appLibrary.complete
    )
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

  private async doRefreshInstalledPackage(
    packageFamilyName: string,
    suggestedProductId?: string
  ): Promise<boolean> {
    const refreshBeforeScan = this.refreshInFlight
    const installed = await scanInstalledXboxGameByFamily(packageFamilyName)
    if (!installed) return false
    const overlappingFullRefresh = this.refreshInFlight ?? refreshBeforeScan

    const knownGame = this.resolvePackageFamilyName(packageFamilyName, suggestedProductId)
    const productId = xboxProductId(suggestedProductId)
    const providerGameId =
      knownGame?.providerGameId ?? productId ?? installed.providerGameId
    const catalog = knownGame
      ? {
          providerGameId: knownGame.providerGameId,
          name: knownGame.name,
          metadata: knownGame.metadata
        }
      : undefined
    gameRepository.applyInstalledProviderPatch('xbox', [
      {
        providerGameId,
        name: installed.name,
        installDir: installed.installDir,
        metadata: installedMetadata(installed.metadata, catalog)
      }
    ])
    const key = packageFamilyName.toLowerCase()
    this.gameIdByPackageFamilyName.set(key, `xbox:${providerGameId}`)
    this.emitSnapshot()

    const game = gameRepository.getGame(`xbox:${providerGameId}`)
    if (game) artworkService.syncProvider([game], 'xbox')
    if (!knownGame && providerGameId === installed.providerGameId) {
      xboxMetadataService.syncLibrary([
        {
          providerGameId,
          name: installed.name,
          packageVersion: installed.packageVersion
        }
      ])
    }
    if (overlappingFullRefresh) {
      const verifyAfterRefresh = (): void => {
        setTimeout(() => {
          void this.refreshInstalledPackage(packageFamilyName, suggestedProductId).catch(() => {})
        }, 0)
      }
      void overlappingFullRefresh.then(verifyAfterRefresh, verifyAfterRefresh)
    }
    return true
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
