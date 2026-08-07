import { EventEmitter } from 'node:events'
import Store from 'electron-store'
import { app } from 'electron'
import type { GameMetadata } from '@shared/ipc'
import { settingsStore } from '../settingsStore'
import { searchXboxProducts } from '../store/xboxStoreProvider'
import { STORE_REGIONS, type StoreRegionConfig } from '../store/storeRegions'
import { normalizeStoreTitle } from '../store/storeProviderUtils'
import { syncCoordinator } from '../sync/syncCoordinator'

const POSITIVE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const NEGATIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const REQUEST_GAP_MS = 400
const METADATA_SCHEMA_VERSION = 2

export interface XboxMetadataSyncTarget {
  providerGameId: string
  name: string
  packageVersion: string
}

export interface XboxMetadataResult {
  providerGameId: string
  kind: 'game' | 'missing'
  name?: string
  metadata: GameMetadata
  locale: string
  source: 'xbox-store'
  fetchedAt: number
}

interface CachedXboxMetadata extends XboxMetadataResult {
  packageVersion: string
  region: string
  metadataSchemaVersion: number
}

interface QueueItem {
  target: XboxMetadataSyncTarget
  region: StoreRegionConfig
  attempts: number
}

interface MetadataUpdate {
  metadata: XboxMetadataResult
}

const cache = new Store<{ entries: Record<string, CachedXboxMetadata> }>({
  name: 'orbit-xbox-metadata-v1',
  defaults: { entries: {} }
})
const cacheEntries: Record<string, CachedXboxMetadata> = { ...cache.get('entries') }
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

function cacheKey(providerGameId: string, region: string): string {
  return `${providerGameId}:${region}`
}

function unique(values: Iterable<string | undefined>): string[] | undefined {
  const result = [...new Set([...values].map((value) => value?.trim()).filter((value): value is string => Boolean(value)))]
  return result.length > 0 ? result : undefined
}

function isFresh(entry: CachedXboxMetadata, target: XboxMetadataSyncTarget): boolean {
  if (entry.metadataSchemaVersion !== METADATA_SCHEMA_VERSION) return false
  if (entry.packageVersion !== target.packageVersion) return false
  const ttl = entry.kind === 'game' ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS
  return Date.now() - entry.fetchedAt < ttl
}

async function fetchMetadata(item: QueueItem): Promise<CachedXboxMetadata> {
  const candidates = await searchXboxProducts(item.target.name, item.region)
  const normalizedName = normalizeStoreTitle(item.target.name)
  const exact = candidates
    .filter((candidate) => normalizeStoreTitle(candidate.name) === normalizedName)
    .sort((left, right) => {
      const leftPc = left.offer.platform === 'pc' ? 1 : 0
      const rightPc = right.offer.platform === 'pc' ? 1 : 0
      return rightPc - leftPc
    })[0]
  const fetchedAt = Date.now()

  if (!exact) {
    return {
      providerGameId: item.target.providerGameId,
      packageVersion: item.target.packageVersion,
      region: item.region.id,
      kind: 'missing',
      metadata: {},
      locale: item.region.locale,
      source: 'xbox-store',
      fetchedAt,
      metadataSchemaVersion: METADATA_SCHEMA_VERSION
    }
  }

  const vertical = unique([exact.portraitUrl])
  const horizontal = unique([exact.heroUrl, exact.headerUrl])
  return {
    providerGameId: item.target.providerGameId,
    packageVersion: item.target.packageVersion,
    region: item.region.id,
    kind: 'game',
    // The Windows package display name is authoritative locally and already
    // resolved by the OS. Store HTML can contain encoded trademark markers.
    name: item.target.name,
    metadata: {
      summary: exact.summary,
      genres: exact.genres,
      platforms: ['windows'],
      storeUrl: exact.offer.url,
      backgroundUrl: horizontal?.[0],
      storeHeaderUrl: horizontal?.[0],
      artwork: { vertical, horizontal }
    },
    locale: item.region.locale,
    source: 'xbox-store',
    fetchedAt,
    metadataSchemaVersion: METADATA_SCHEMA_VERSION
  }
}

/** Persistent, throttled metadata/artwork enrichment for local Xbox games. */
export class XboxMetadataService extends EventEmitter {
  private queue: QueueItem[] = []
  private queued = new Map<string, QueueItem>()
  private running = false
  private syncKeys = new Set<string>()
  private completedSyncKeys = new Set<string>()

  syncLibrary(targets: Iterable<XboxMetadataSyncTarget>): void {
    const region = STORE_REGIONS[settingsStore.get('storeRegion')]
    const uniqueTargets = new Map<string, XboxMetadataSyncTarget>()
    for (const target of targets) {
      if (!target.providerGameId?.trim() || !target.name?.trim()) continue
      uniqueTargets.set(target.providerGameId, target)
    }

    this.syncKeys = new Set([...uniqueTargets.keys()].map((id) => cacheKey(id, region.id)))
    this.completedSyncKeys.clear()
    syncCoordinator.begin('metadata', this.syncKeys.size, 0, 'xbox-store', 'xbox')

    for (const target of uniqueTargets.values()) {
      const key = cacheKey(target.providerGameId, region.id)
      const cached = cacheEntries[key]
      if (cached) {
        if (cached.metadataSchemaVersion === METADATA_SCHEMA_VERSION) this.emitUpdate(cached)
        if (isFresh(cached, target)) {
          this.markSyncComplete(key)
          continue
        }
      }

      const existing = this.queued.get(key)
      if (existing) {
        existing.target = target
        existing.region = region
        continue
      }
      const queueItem = { target, region, attempts: 0 }
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

  private emitUpdate(entry: CachedXboxMetadata): void {
    const {
      packageVersion: _packageVersion,
      region: _region,
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
        const key = cacheKey(item.target.providerGameId, item.region.id)
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
            await delay(Math.min(2_000 * 2 ** (item.attempts - 1), 10_000))
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
    syncCoordinator.progress('metadata', completed, this.syncKeys.size, 'xbox-store', 'xbox')
    if (completed >= this.syncKeys.size) syncCoordinator.complete('metadata', 'xbox-store', 'xbox')
  }
}

export const xboxMetadataService = new XboxMetadataService()
