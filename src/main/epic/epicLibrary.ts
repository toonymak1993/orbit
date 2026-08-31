import { EventEmitter } from 'node:events'
import type {
  LibraryDetectionMethod,
  LibraryProviderStatus,
  LibrarySnapshot
} from '@shared/ipc'
import {
  epicEntitlementFallbackName,
  shouldRemoveEpicEntitlement
} from '@shared/libraryProjection'
import type { LibraryProviderAdapter } from '../library/libraryProvider'
import { gameRepository } from '../library/gameRepository'
import { artworkService } from '../imageCache'
import { settingsStore } from '../settingsStore'
import { syncCoordinator } from '../sync/syncCoordinator'
import type { EpicAuthManager } from './epicAuth'
import { EpicApiClient, type EpicLibraryAsset } from './epicApi'
import { scanInstalledEpicApps } from './epicInstall'
import {
  epicMetadataService,
  type EpicMetadataResult,
  type EpicMetadataSyncTarget
} from './epicMetadata'

const EPIC_LOCALE: Record<string, string> = { en: 'en-US', de: 'de-DE' }

interface MetadataUpdate {
  metadata: EpicMetadataResult
}

function usableAsset(asset: EpicLibraryAsset): boolean {
  return Boolean(
    asset.appName?.trim() &&
      asset.namespace?.trim().toLowerCase() !== 'ue' &&
      asset.sandboxType?.trim().toUpperCase() !== 'PRIVATE'
  )
}

function deduplicateAssets(assets: EpicLibraryAsset[]): Map<string, EpicLibraryAsset> {
  const unique = new Map<string, EpicLibraryAsset>()
  for (const asset of assets) {
    if (!usableAsset(asset)) continue
    const id = asset.appName!.trim()
    const current = unique.get(id)
    if (!current || (!current.catalogItemId && asset.catalogItemId)) unique.set(id, asset)
  }
  return unique
}

function assetDisplayName(asset: EpicLibraryAsset): string {
  // Epic's labelName is commonly a deployment channel such as "Live", not a
  // product title. appName is technical but stable and uniquely identifies the
  // entitlement until catalog metadata supplies the display title.
  return epicEntitlementFallbackName(asset.appName)
}

/** Epic adapter following Playnite's local-manifest + account-catalog model. */
export class EpicLibraryService
  extends EventEmitter
  implements LibraryProviderAdapter<EpicAuthManager>
{
  readonly provider = 'epic' as const
  private refreshInFlight: Promise<LibrarySnapshot> | null = null
  private pendingMetadataIds = new Set<string>()
  private unresolvedMetadataIds = new Set<string>()
  private providerStatus: LibraryProviderStatus = {
    provider: 'epic',
    state: 'idle',
    connection: 'not-connected',
    methods: [],
    gameCount: 0,
    installedCount: 0,
    installableCount: 0
  }

  constructor() {
    super()
    epicMetadataService.on('busy', () => {
      gameRepository.setMetadataLoading('epic', true)
      this.emitSnapshot()
    })
    epicMetadataService.on('updated', ({ metadata }: MetadataUpdate) => {
      this.pendingMetadataIds.delete(metadata.providerGameId)
      if (shouldRemoveEpicEntitlement(metadata.kind)) {
        this.unresolvedMetadataIds.delete(metadata.providerGameId)
        if (gameRepository.removeProviderContent('epic', metadata.providerGameId)) this.emitSnapshot()
        this.finishMetadataStatus()
        return
      }
      if (metadata.kind === 'missing') {
        // A missing catalog response is not evidence that the entitlement is
        // invalid. Keep the asset with its library-service fallback identity.
        this.unresolvedMetadataIds.add(metadata.providerGameId)
        this.finishMetadataStatus()
        return
      }
      const changed = gameRepository.applyProviderMetadataDelta(
        'epic',
        {
          providerGameId: metadata.providerGameId,
          name: metadata.name,
          metadata: metadata.metadata,
          locale: metadata.locale,
          source: metadata.source,
          fetchedAt: metadata.fetchedAt
        },
        true
      )
      this.unresolvedMetadataIds.delete(metadata.providerGameId)
      if (changed) {
        const game = gameRepository
          .getGamesByProvider('epic')
          .find((candidate) => candidate.id === `epic:${metadata.providerGameId}`)
        if (game) artworkService.syncProvider([game], 'epic')
        this.emitSnapshot()
      }
      this.finishMetadataStatus()
    })
    epicMetadataService.on('idle', () => {
      gameRepository.setMetadataLoading('epic', false)
      if (this.providerStatus.issue === 'metadata-pending') {
        for (const id of this.pendingMetadataIds) this.unresolvedMetadataIds.add(id)
        this.pendingMetadataIds.clear()
        const unresolved = this.unresolvedMetadataIds.size
        this.setProviderStatus({
          state: unresolved > 0 ? 'partial' : 'ready',
          connection: 'connected',
          methods: ['local-manifests', 'epic-catalog'],
          pendingCount: unresolved || undefined,
          issue: unresolved > 0 ? 'source-unavailable' : undefined,
          lastCheckedAt: this.providerStatus.lastCheckedAt ?? Date.now()
        })
      }
      this.emitSnapshot()
    })
  }

  getSnapshot(): LibrarySnapshot {
    return gameRepository.getSnapshot()
  }

  getProviderStatus(): LibraryProviderStatus {
    return {
      ...this.providerStatus,
      ...gameRepository.getProviderCounts('epic'),
      methods: [...this.providerStatus.methods]
    }
  }

  async refresh(auth: EpicAuthManager): Promise<LibrarySnapshot> {
    if (this.refreshInFlight) return this.refreshInFlight
    this.refreshInFlight = this.doRefresh(auth)
    try {
      return await this.refreshInFlight
    } finally {
      this.refreshInFlight = null
    }
  }

  /** Reconciles one finished session without repeating the catalog/artwork pipelines. */
  async refreshPlaytime(auth: EpicAuthManager, providerGameId: string): Promise<boolean> {
    const account = auth.getAccount() ?? (await auth.restoreSession())
    if (!account || !providerGameId.trim()) return false
    try {
      const item = (await new EpicApiClient(auth).getPlaytime(account.accountId)).find(
        (candidate) => candidate.artifactId === providerGameId
      )
      const seconds = Number(item?.totalTime ?? 0)
      if (!Number.isFinite(seconds) || seconds < 0) return false
      const changed = gameRepository.applyProviderPlaytimeDelta(
        'epic',
        providerGameId,
        seconds
      )
      if (changed) this.emitSnapshot()
      return true
    } catch {
      return false
    }
  }

  private async doRefresh(auth: EpicAuthManager): Promise<LibrarySnapshot> {
    const account = auth.getAccount() ?? (await auth.restoreSession())
    syncCoordinator.begin('library', account ? 3 : 1, 0, 'epic-local', 'epic')
    this.pendingMetadataIds.clear()
    this.unresolvedMetadataIds.clear()
    this.setProviderStatus({
      state: 'scanning',
      connection: account ? 'connected' : 'not-connected',
      methods: ['local-manifests']
    })

    const installed = scanInstalledEpicApps()
    gameRepository.applyInstalledProviderDelta('epic', installed.values())
    syncCoordinator.progress('library', 1, account ? 3 : 1, 'epic-account', 'epic')
    artworkService.syncProvider(gameRepository.getGamesByProvider('epic'), 'epic')
    this.emitSnapshot()

    if (!account) {
      const client = new EpicApiClient(auth)
      epicMetadataService.syncLibrary([], EPIC_LOCALE[settingsStore.get('language')] ?? 'en-US', 'US', client)
      syncCoordinator.complete('library', 'epic-local', 'epic')
      this.setProviderStatus({
        state: 'local-only',
        connection: 'not-connected',
        methods: ['local-manifests'],
        issue: 'not-connected',
        lastCheckedAt: Date.now()
      })
      return this.getSnapshot()
    }

    const client = new EpicApiClient(auth)
    try {
      const [assetList, playtimeResult] = await Promise.all([
        client.getAssets(),
        client
          .getPlaytime(account.accountId)
          .then((items) => ({ available: true as const, items }))
          .catch(() => ({ available: false as const, items: [] }))
      ])
      const assets = deduplicateAssets(assetList)
      const existingNames = new Map(
        gameRepository
          .getGamesByProvider('epic')
          .map((game) => [game.providerGameId, game.name] as const)
      )
      const playtimeByApp = new Map(
        playtimeResult.items
          .filter((item) => item.artifactId)
          .map((item) => [item.artifactId as string, Number(item.totalTime ?? 0)])
      )
      syncCoordinator.progress('library', 2, 3, 'epic-catalog', 'epic')

      gameRepository.applyAuthoritativeProviderDelta(
        'epic',
        [...assets.values()].map((asset) => ({
          providerGameId: asset.appName!.trim(),
          name: existingNames.get(asset.appName!.trim()) || assetDisplayName(asset),
          playtimeSeconds: playtimeResult.available
            ? Math.max(0, Math.round(playtimeByApp.get(asset.appName!.trim()) ?? 0))
            : undefined
        }))
      )

      const targets: EpicMetadataSyncTarget[] = [...assets.values()]
        .filter((asset) => asset.namespace?.trim() && asset.catalogItemId?.trim())
        .map((asset) => ({
          providerGameId: asset.appName!.trim(),
          namespace: asset.namespace!.trim(),
          catalogItemId: asset.catalogItemId!.trim(),
          buildVersion: asset.buildVersion?.trim() || undefined
        }))
      const targetIds = new Set(targets.map((target) => target.providerGameId))
      this.pendingMetadataIds = new Set(targetIds)
      this.unresolvedMetadataIds = new Set(
        [...assets.keys()].filter((id) => !targetIds.has(id))
      )
      const locale = EPIC_LOCALE[settingsStore.get('language')] ?? 'en-US'
      const country = locale === 'de-DE' ? 'DE' : 'US'
      epicMetadataService.syncLibrary(targets, locale, country, client)
      syncCoordinator.progress('library', 3, 3, 'epic', 'epic')
      syncCoordinator.complete('library', 'epic', 'epic')
      const pendingTargetCount = this.pendingMetadataIds.size
      const pendingCount = pendingTargetCount + this.unresolvedMetadataIds.size
      this.setProviderStatus({
        state: pendingTargetCount > 0 ? 'scanning' : pendingCount > 0 ? 'partial' : 'ready',
        connection: 'connected',
        methods: ['local-manifests', 'epic-catalog'],
        pendingCount: pendingCount || undefined,
        issue:
          pendingTargetCount > 0
            ? 'metadata-pending'
            : pendingCount > 0
              ? 'source-unavailable'
              : assets.size === 0
                ? 'no-games-found'
                : undefined,
        lastCheckedAt: Date.now()
      })
    } catch {
      // Keep both the installed delta and the last good online snapshot. An API
      // outage must never turn a populated library into an empty one.
      epicMetadataService.syncLibrary([], EPIC_LOCALE[settingsStore.get('language')] ?? 'en-US', 'US', client)
      syncCoordinator.fail('library', 'epic-cache', 'epic')
      this.pendingMetadataIds.clear()
      this.unresolvedMetadataIds.clear()
      const counts = gameRepository.getProviderCounts('epic')
      const methods: LibraryDetectionMethod[] = ['local-manifests']
      if (counts.installableCount > 0) methods.push('cached-data')
      this.setProviderStatus({
        state: counts.gameCount > 0 ? 'partial' : 'error',
        connection: 'connected',
        methods,
        issue: 'source-unavailable',
        lastCheckedAt: Date.now()
      })
    }

    artworkService.syncProvider(gameRepository.getGamesByProvider('epic'), 'epic')
    this.emitSnapshot()
    return this.getSnapshot()
  }

  private emitSnapshot(): void {
    this.emit('updated', this.getSnapshot())
  }

  private finishMetadataStatus(): void {
    if (
      this.pendingMetadataIds.size > 0 ||
      this.providerStatus.issue !== 'metadata-pending'
    ) {
      return
    }
    this.setProviderStatus({
      state: this.unresolvedMetadataIds.size > 0 ? 'partial' : 'ready',
      connection: 'connected',
      methods: ['local-manifests', 'epic-catalog'],
      pendingCount: this.unresolvedMetadataIds.size || undefined,
      issue: this.unresolvedMetadataIds.size > 0 ? 'source-unavailable' : undefined,
      lastCheckedAt: this.providerStatus.lastCheckedAt ?? Date.now()
    })
  }

  private setProviderStatus(
    next: Omit<
      LibraryProviderStatus,
      'provider' | 'gameCount' | 'installedCount' | 'installableCount'
    >
  ): void {
    this.providerStatus = {
      provider: 'epic',
      ...gameRepository.getProviderCounts('epic'),
      ...next,
      methods: [...next.methods]
    }
    this.emitSnapshot()
  }
}

export const epicLibraryService = new EpicLibraryService()
