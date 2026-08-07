import { EventEmitter } from 'node:events'
import type { LibrarySnapshot } from '@shared/ipc'
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

  constructor() {
    super()
    epicMetadataService.on('busy', () => {
      gameRepository.setMetadataLoading('epic', true)
      this.emitSnapshot()
    })
    epicMetadataService.on('updated', ({ metadata }: MetadataUpdate) => {
      if (metadata.kind !== 'game') {
        if (gameRepository.removeProviderGame('epic', metadata.providerGameId)) this.emitSnapshot()
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
    })
    epicMetadataService.on('idle', () => {
      gameRepository.setMetadataLoading('epic', false)
      this.emitSnapshot()
    })
  }

  getSnapshot(): LibrarySnapshot {
    return gameRepository.getSnapshot()
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

    const installed = scanInstalledEpicApps()
    gameRepository.applyInstalledProviderDelta('epic', installed.values())
    syncCoordinator.progress('library', 1, account ? 3 : 1, 'epic-account', 'epic')
    artworkService.syncProvider(gameRepository.getGamesByProvider('epic'), 'epic')
    this.emitSnapshot()

    if (!account) {
      const client = new EpicApiClient(auth)
      epicMetadataService.syncLibrary([], EPIC_LOCALE[settingsStore.get('language')] ?? 'en-US', 'US', client)
      syncCoordinator.complete('library', 'epic-local', 'epic')
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
      const locale = EPIC_LOCALE[settingsStore.get('language')] ?? 'en-US'
      const country = locale === 'de-DE' ? 'DE' : 'US'
      epicMetadataService.syncLibrary(targets, locale, country, client)
      syncCoordinator.progress('library', 3, 3, 'epic', 'epic')
      syncCoordinator.complete('library', 'epic', 'epic')
    } catch {
      // Keep both the installed delta and the last good online snapshot. An API
      // outage must never turn a populated library into an empty one.
      epicMetadataService.syncLibrary([], EPIC_LOCALE[settingsStore.get('language')] ?? 'en-US', 'US', client)
      syncCoordinator.fail('library', 'epic-cache', 'epic')
    }

    artworkService.syncProvider(gameRepository.getGamesByProvider('epic'), 'epic')
    this.emitSnapshot()
    return this.getSnapshot()
  }

  private emitSnapshot(): void {
    this.emit('updated', this.getSnapshot())
  }
}

export const epicLibraryService = new EpicLibraryService()
