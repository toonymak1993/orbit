import { EventEmitter } from 'node:events'
import type {
  LibraryDetectionMethod,
  LibraryProviderStatus,
  LibrarySnapshot
} from '@shared/ipc'
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

/** Epic adapter following Playnite's local-manifest + account-catalog model. */
export class EpicLibraryService
  extends EventEmitter
  implements LibraryProviderAdapter<EpicAuthManager>
{
  readonly provider = 'epic' as const
  private refreshInFlight: Promise<LibrarySnapshot> | null = null
  private pendingMetadataIds = new Set<string>()
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
      if (metadata.kind !== 'game') {
        if (gameRepository.removeProviderGame('epic', metadata.providerGameId)) this.emitSnapshot()
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
        const unresolved = this.pendingMetadataIds.size
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

  private async doRefresh(auth: EpicAuthManager): Promise<LibrarySnapshot> {
    const account = auth.getAccount() ?? (await auth.restoreSession())
    syncCoordinator.begin('library', account ? 3 : 1, 0, 'epic-local', 'epic')
    this.pendingMetadataIds.clear()
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
      const [assetList, playtimeItems] = await Promise.all([
        client.getAssets(),
        client.getPlaytime(account.accountId).catch(() => [])
      ])
      const assets = deduplicateAssets(assetList)
      const playtimeByApp = new Map(
        playtimeItems
          .filter((item) => item.artifactId)
          .map((item) => [item.artifactId as string, Number(item.totalTime ?? 0)])
      )
      syncCoordinator.progress('library', 2, 3, 'epic-catalog', 'epic')

      gameRepository.applyAuthoritativeProviderDelta(
        'epic',
        [...assets.values()].map((asset) => ({
          providerGameId: asset.appName!.trim(),
          playtimeMinutes: Math.max(0, Math.round((playtimeByApp.get(asset.appName!.trim()) ?? 0) / 60))
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
      this.pendingMetadataIds = new Set(assets.keys())
      const locale = EPIC_LOCALE[settingsStore.get('language')] ?? 'en-US'
      const country = locale === 'de-DE' ? 'DE' : 'US'
      epicMetadataService.syncLibrary(targets, locale, country, client)
      syncCoordinator.progress('library', 3, 3, 'epic', 'epic')
      syncCoordinator.complete('library', 'epic', 'epic')
      const pendingCount = this.pendingMetadataIds.size
      const targetIds = new Set(targets.map((target) => target.providerGameId))
      const pendingTargetCount = [...this.pendingMetadataIds].filter((id) =>
        targetIds.has(id)
      ).length
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
      state: 'ready',
      connection: 'connected',
      methods: ['local-manifests', 'epic-catalog'],
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
