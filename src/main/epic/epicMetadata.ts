import { EventEmitter } from 'node:events'
import Store from 'electron-store'
import { app } from 'electron'
import type { GameMetadata, GamePlatform } from '@shared/ipc'
import { syncCoordinator } from '../sync/syncCoordinator'
import type { EpicApiClient, EpicCatalogItem } from './epicApi'

const POSITIVE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const NEGATIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const REQUEST_GAP_MS = 250
const METADATA_SCHEMA_VERSION = 1

export interface EpicMetadataSyncTarget {
  providerGameId: string
  namespace: string
  catalogItemId: string
  buildVersion?: string
}

export interface EpicMetadataResult {
  providerGameId: string
  kind: 'game' | 'skip' | 'missing'
  name?: string
  metadata: GameMetadata
  locale: string
  source: 'epic-catalog'
  fetchedAt: number
}

interface CachedEpicMetadata extends EpicMetadataResult {
  namespace: string
  catalogItemId: string
  buildVersion?: string
  metadataSchemaVersion: number
}

interface QueueItem {
  target: EpicMetadataSyncTarget
  locale: string
  country: string
  client: EpicApiClient
  attempts: number
}

interface MetadataUpdate {
  metadata: EpicMetadataResult
}

const cache = new Store<{ entries: Record<string, CachedEpicMetadata> }>({
  name: 'orbit-epic-metadata-v1',
  defaults: { entries: {} }
})
const cacheEntries: Record<string, CachedEpicMetadata> = { ...cache.get('entries') }
let cachePersistTimer: ReturnType<typeof setTimeout> | undefined

function flushCache(): void {
  if (cachePersistTimer) clearTimeout(cachePersistTimer)
  cachePersistTimer = undefined
  cache.set('entries', cacheEntries)
}

function scheduleCachePersist(): void {
  if (cachePersistTimer) return
  cachePersistTimer = setTimeout(flushCache, 500)
  cachePersistTimer.unref()
}

app.on('before-quit', flushCache)

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function cacheKey(providerGameId: string, locale: string): string {
  return `${providerGameId}:${locale}`
}

function removeTrademarks(value: string): string {
  return value.replace(/[\u00ae\u2122\u00a9]/g, '').replace(/\s+/g, ' ').trim()
}

function unique(values: Iterable<string | undefined>): string[] | undefined {
  const result = [...new Set([...values].map((value) => value?.trim()).filter((value): value is string => Boolean(value)))]
  return result.length > 0 ? result : undefined
}

function attribute(item: EpicCatalogItem, ...names: string[]): string | undefined {
  const requested = names.map((name) => name.toLowerCase())
  for (const [key, entry] of Object.entries(item.customAttributes ?? {})) {
    const normalized = key.toLowerCase()
    if (requested.some((name) => normalized === name || normalized.endsWith(`.${name}`))) {
      const value = entry?.value?.trim()
      if (value) return value
    }
  }
  return undefined
}

function normalizeImageUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  if (value.startsWith('//')) return `https:${value}`
  return value.startsWith('https://') ? value : undefined
}

function imageScore(type: string, orientation: 'vertical' | 'horizontal' | 'icon'): number {
  const normalized = type.toLowerCase()
  if (orientation === 'vertical') {
    if (normalized.includes('tall') || normalized.includes('portrait')) return 100
    if (normalized.includes('storefront')) return 70
    if (normalized.includes('thumbnail')) return 40
    return 0
  }
  if (orientation === 'horizontal') {
    if (normalized.includes('wide') || normalized.includes('landscape') || normalized.includes('hero')) return 100
    if (normalized.includes('background')) return 90
    if (normalized.includes('storefront')) return 70
    return 0
  }
  if (normalized.includes('logo') || normalized.includes('icon')) return 100
  if (normalized.includes('thumbnail')) return 50
  return 0
}

function artworkCandidates(
  item: EpicCatalogItem,
  orientation: 'vertical' | 'horizontal' | 'icon'
): string[] | undefined {
  const candidates = (item.keyImages ?? [])
    .map((image, index) => ({
      url: normalizeImageUrl(image.url),
      score: imageScore(image.type ?? '', orientation),
      index
    }))
    .filter((image): image is { url: string; score: number; index: number } => Boolean(image.url))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((image) => image.url)
  return unique(candidates)
}

function classifyCatalogItem(item: EpicCatalogItem): 'game' | 'skip' {
  const categories = (item.categories ?? [])
    .map((category) => category.path?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value))
  if (!categories.includes('applications')) return 'skip'
  if (item.mainGameItem && !categories.includes('addons/launchable')) return 'skip'
  if (categories.some((category) => ['digitalextras', 'plugins', 'plugins/engine'].includes(category))) {
    return 'skip'
  }

  // Keep third-party launcher entries out of the Epic library by default, as
  // Playnite does unless EA/Ubisoft imports are explicitly enabled.
  const thirdParty = attribute(item, 'ThirdPartyManagedApp')?.toLowerCase()
  if (thirdParty === 'the ea app') return 'skip'
  if (attribute(item, 'partnerLinkType')?.toLowerCase() === 'ubisoft') return 'skip'
  return 'game'
}

function catalogMetadata(item: EpicCatalogItem): GameMetadata {
  const vertical = artworkCandidates(item, 'vertical')
  const horizontal = artworkCandidates(item, 'horizontal')
  const icon = artworkCandidates(item, 'icon')
  const platforms = unique((item.releaseInfo ?? []).flatMap((release) => release.platform ?? []))
  const normalizedPlatforms: GamePlatform[] = []
  if (platforms?.some((platform) => /win/i.test(platform))) normalizedPlatforms.push('windows')
  if (platforms?.some((platform) => /mac/i.test(platform))) normalizedPlatforms.push('macos')
  if (platforms?.some((platform) => /linux/i.test(platform))) normalizedPlatforms.push('linux')

  const publisher = attribute(item, 'publisherName', 'publisher')
  const developer = item.developer?.trim() || attribute(item, 'developerName', 'developer')
  const productSlug = attribute(item, 'productSlug')?.replace(/^\/+|\/+$/g, '').replace(/\/home$/i, '')
  const storeUrl =
    productSlug && /^[a-z0-9][a-z0-9/_-]*$/i.test(productSlug)
      ? `https://store.epicgames.com/p/${productSlug}`
      : undefined
  const genreText = attribute(item, 'genres', 'genre')
  const genres = genreText ? unique(genreText.split(/[,;|]/)) : undefined
  const releaseDate = (item.releaseInfo ?? [])
    .map((release) => release.dateAdded)
    .find((date): date is string => Boolean(date))

  return {
    summary: item.description?.trim() || undefined,
    description: item.description?.trim() || undefined,
    genres,
    developers: unique([developer]),
    publishers: unique([publisher]),
    releaseDateText: releaseDate ? new Date(releaseDate).toLocaleDateString() : undefined,
    storeUrl,
    platforms: normalizedPlatforms.length > 0 ? normalizedPlatforms : ['windows'],
    backgroundUrl: horizontal?.[0],
    storeHeaderUrl: horizontal?.[0],
    iconUrl: icon?.[0],
    artwork: { vertical, horizontal, icon }
  }
}

function isFresh(entry: CachedEpicMetadata, target: EpicMetadataSyncTarget): boolean {
  if (entry.metadataSchemaVersion !== METADATA_SCHEMA_VERSION) return false
  if (entry.namespace !== target.namespace || entry.catalogItemId !== target.catalogItemId) return false
  if ((entry.buildVersion ?? '') !== (target.buildVersion ?? '')) return false
  const ttl = entry.kind === 'game' ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS
  return Date.now() - entry.fetchedAt < ttl
}

async function fetchMetadata(item: QueueItem): Promise<CachedEpicMetadata> {
  const catalog = await item.client.getCatalogItem(
    item.target.namespace,
    item.target.catalogItemId,
    item.locale,
    item.country
  )
  const fetchedAt = Date.now()
  if (!catalog) {
    return {
      ...item.target,
      kind: 'missing',
      metadata: {},
      locale: item.locale,
      source: 'epic-catalog',
      fetchedAt,
      metadataSchemaVersion: METADATA_SCHEMA_VERSION
    }
  }
  const kind = classifyCatalogItem(catalog)
  return {
    ...item.target,
    kind,
    name: kind === 'game' && catalog.title ? removeTrademarks(catalog.title) : undefined,
    metadata: kind === 'game' ? catalogMetadata(catalog) : {},
    locale: item.locale,
    source: 'epic-catalog',
    fetchedAt,
    metadataSchemaVersion: METADATA_SCHEMA_VERSION
  }
}

/** Persistent, throttled Epic catalog queue. Cached records are emitted first. */
export class EpicMetadataService extends EventEmitter {
  private queue: QueueItem[] = []
  private queued = new Map<string, QueueItem>()
  private running = false
  private syncKeys = new Set<string>()
  private completedSyncKeys = new Set<string>()

  syncLibrary(
    targets: Iterable<EpicMetadataSyncTarget>,
    locale: string,
    country: string,
    client: EpicApiClient
  ): void {
    const uniqueTargets = new Map<string, EpicMetadataSyncTarget>()
    for (const target of targets) {
      if (!target.providerGameId?.trim() || !target.namespace?.trim() || !target.catalogItemId?.trim()) {
        continue
      }
      uniqueTargets.set(target.providerGameId, target)
    }
    this.syncKeys = new Set([...uniqueTargets.keys()].map((id) => cacheKey(id, locale)))
    this.completedSyncKeys.clear()
    syncCoordinator.begin('metadata', this.syncKeys.size, 0, 'epic', 'epic')

    for (const target of uniqueTargets.values()) {
      const key = cacheKey(target.providerGameId, locale)
      const cached = cacheEntries[key]
      if (cached) {
        this.emitUpdate(cached)
        if (isFresh(cached, target)) {
          this.markSyncComplete(key)
          continue
        }
      }
      const existing = this.queued.get(key)
      if (existing) {
        existing.target = target
        existing.client = client
        continue
      }
      const queueItem = { target, locale, country, client, attempts: 0 }
      this.queued.set(key, queueItem)
      this.queue.push(queueItem)
    }

    if (this.queue.length > 0) {
      this.emit('busy')
      void this.run()
    } else {
      this.emit('idle')
    }
  }

  private emitUpdate(entry: CachedEpicMetadata): void {
    const {
      namespace: _namespace,
      catalogItemId: _catalogItemId,
      buildVersion: _buildVersion,
      metadataSchemaVersion: _schemaVersion,
      ...metadata
    } = entry
    this.emit('updated', { metadata } satisfies MetadataUpdate)
  }

  private async run(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift() as QueueItem
        const key = cacheKey(item.target.providerGameId, item.locale)
        this.queued.delete(key)
        try {
          const metadata = await fetchMetadata(item)
          cacheEntries[key] = metadata
          scheduleCachePersist()
          this.emitUpdate(metadata)
          this.markSyncComplete(key)
        } catch {
          item.attempts++
          if (item.attempts < 3 && !this.queued.has(key)) {
            this.queued.set(key, item)
            this.queue.unshift(item)
            await delay(Math.min(2_000 * 2 ** (item.attempts - 1), 15_000))
          } else {
            this.markSyncComplete(key)
          }
        }
        if (this.queue.length > 0) await delay(REQUEST_GAP_MS)
      }
    } finally {
      this.running = false
      this.emit('idle')
    }
  }

  private markSyncComplete(key: string): void {
    if (!this.syncKeys.has(key) || this.completedSyncKeys.has(key)) return
    this.completedSyncKeys.add(key)
    const completed = this.completedSyncKeys.size
    syncCoordinator.progress('metadata', completed, this.syncKeys.size, 'epic', 'epic')
    if (completed >= this.syncKeys.size) syncCoordinator.complete('metadata', 'epic', 'epic')
  }
}

export const epicMetadataService = new EpicMetadataService()
