import { EventEmitter } from 'node:events'
import Store from 'electron-store'
import { app } from 'electron'
import type { GameMetadata, GamePlatform } from '@shared/ipc'
import { syncCoordinator } from '../sync/syncCoordinator'
import { fetchWithElectronNet } from '../networkFetch'

const POSITIVE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const NEGATIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const REQUEST_GAP_MS = 900
const METADATA_SCHEMA_VERSION = 2

export interface SteamAppMetadata {
  appId: number
  type: string
  name?: string
  metadata: GameMetadata
  locale: string
  source: 'steam-store'
  fetchedAt: number
}

interface CachedMetadata extends SteamAppMetadata {
  metadataSchemaVersion: number
}

interface LegacyCachedMetadata {
  appId: number
  type: string
  name?: string
  shortDescription?: string
  genres?: string[]
  developers?: string[]
  screenshotUrl?: string
  fetchedAt: number
}

interface QueueItem {
  appId: number
  language: string
  allowCreate: boolean
  attempts: number
}

interface MetadataUpdate {
  metadata: SteamAppMetadata
  allowCreate: boolean
}

export interface MetadataSyncTarget {
  appId: number
  allowCreate: boolean
}

const cache = new Store<{ entries: Record<string, CachedMetadata> }>({
  name: 'orbit-steam-metadata-v2',
  defaults: { entries: {} }
})
const cacheEntries: Record<string, CachedMetadata> = { ...cache.get('entries') }
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

function cacheKey(appId: number, language: string): string {
  return `${appId}:${language}`
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    quot: '"',
    apos: "'",
    lt: '<',
    gt: '>',
    nbsp: ' '
  }
  return value.replace(/&(#x?[\da-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const hexadecimal = entity[1]?.toLowerCase() === 'x'
      const codePoint = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match
    }
    return named[entity.toLowerCase()] ?? match
  })
}

function htmlToText(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const text = decodeEntities(
    value
      .replace(/<br\s*\/?\s*>/gi, '\n')
      .replace(/<\/p\s*>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text || undefined
}

function uniqueStrings(values: unknown): string[] | undefined {
  if (!Array.isArray(values)) return undefined
  const result = [
    ...new Set(
      values
        .filter((value): value is string => typeof value === 'string')
        .map((value) => decodeEntities(value).trim())
        .filter(Boolean)
    )
  ]
  return result.length > 0 ? result : undefined
}

function parseLanguages(value: unknown): string[] | undefined {
  const text = htmlToText(value)?.replace(/\*/g, '')
  if (!text) return undefined
  const languages = [...new Set(text.split(/,|\n/).map((language) => language.trim()).filter(Boolean))]
  return languages.length > 0 ? languages : undefined
}

function parseRequiredAge(value: unknown): number | undefined {
  const age = typeof value === 'number' ? value : Number.parseInt(String(value), 10)
  return Number.isFinite(age) && age > 0 ? age : undefined
}

function normalizeCacheEntry(raw: CachedMetadata | LegacyCachedMetadata, language: string): CachedMetadata {
  if ('metadata' in raw && raw.metadata) return raw
  const legacy = raw as LegacyCachedMetadata
  return {
    appId: legacy.appId,
    type: legacy.type,
    name: legacy.name,
    metadata: {
      summary: legacy.shortDescription,
      genres: legacy.genres,
      developers: legacy.developers,
      backgroundUrl: legacy.screenshotUrl
    },
    locale: language,
    source: 'steam-store',
    fetchedAt: legacy.fetchedAt,
    metadataSchemaVersion: 0
  }
}

function isFresh(entry: CachedMetadata): boolean {
  if (entry.metadataSchemaVersion !== METADATA_SCHEMA_VERSION) return false
  const ttl = entry.type === 'game' ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS
  return Date.now() - entry.fetchedAt < ttl
}

async function fetchMetadata(appId: number, language: string): Promise<CachedMetadata | null> {
  const url = new URL('https://store.steampowered.com/api/appdetails')
  url.searchParams.set('appids', String(appId))
  url.searchParams.set('l', language)

  try {
    const response = await fetchWithElectronNet(url, {
      signal: AbortSignal.timeout(20_000)
    })
    if (response.status === 429) throw new Error('rate-limit')
    if (!response.ok) return null
    const json = (await response.json()) as Record<
      string,
      {
        success?: boolean
        data?: {
          type?: string
          name?: string
          short_description?: string
          about_the_game?: string
          genres?: Array<{ description: string }>
          categories?: Array<{ description: string }>
          developers?: string[]
          publishers?: string[]
          release_date?: { coming_soon?: boolean; date?: string }
          metacritic?: { score?: number }
          recommendations?: { total?: number }
          required_age?: number | string
          website?: string
          supported_languages?: string
          controller_support?: string
          platforms?: { windows?: boolean; mac?: boolean; linux?: boolean }
          achievements?: { total?: number }
          content_descriptors?: { notes?: string }
          pc_requirements?: { minimum?: string; recommended?: string } | unknown[]
          header_image?: string
          screenshots?: Array<{ path_full: string }>
        }
      }
    >
    const result = json[String(appId)]
    if (!result?.success || !result.data) {
      return {
        appId,
        type: 'missing',
        metadata: {},
        locale: language,
        source: 'steam-store',
        fetchedAt: Date.now(),
        metadataSchemaVersion: METADATA_SCHEMA_VERSION
      }
    }

    const data = result.data
    const platforms: GamePlatform[] = []
    if (data.platforms?.windows) platforms.push('windows')
    if (data.platforms?.mac) platforms.push('macos')
    if (data.platforms?.linux) platforms.push('linux')
    const requirements = Array.isArray(data.pc_requirements) ? undefined : data.pc_requirements
    const website = typeof data.website === 'string' && data.website.startsWith('http') ? data.website : undefined

    return {
      appId,
      type: data.type?.toLowerCase() ?? 'unknown',
      name: data.name?.trim(),
      metadata: {
        summary: htmlToText(data.short_description),
        description: htmlToText(data.about_the_game),
        genres: uniqueStrings(data.genres?.map((genre) => genre.description)),
        features: uniqueStrings(data.categories?.map((category) => category.description)),
        developers: uniqueStrings(data.developers),
        publishers: uniqueStrings(data.publishers),
        releaseDateText: data.release_date?.date?.trim() || undefined,
        comingSoon: data.release_date?.coming_soon,
        criticScore: data.metacritic?.score,
        recommendationCount: data.recommendations?.total,
        requiredAge: parseRequiredAge(data.required_age),
        website,
        storeUrl: `https://store.steampowered.com/app/${appId}/`,
        languages: parseLanguages(data.supported_languages),
        controllerSupport: data.controller_support,
        platforms: platforms.length > 0 ? platforms : undefined,
        achievementCount: data.achievements?.total,
        contentDescriptorNotes: htmlToText(data.content_descriptors?.notes),
        systemRequirements: requirements
          ? {
              minimum: htmlToText(requirements.minimum),
              recommended: htmlToText(requirements.recommended)
            }
          : undefined,
        backgroundUrl: data.screenshots?.[0]?.path_full,
        storeHeaderUrl: data.header_image
      },
      locale: language,
      source: 'steam-store',
      fetchedAt: Date.now(),
      metadataSchemaVersion: METADATA_SCHEMA_VERSION
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'rate-limit') throw error
    return null
  }
}

/** One throttled, persistent metadata queue shared by every screen. */
export class SteamMetadataService extends EventEmitter {
  private queue: QueueItem[] = []
  private queued = new Map<string, QueueItem>()
  private running = false
  private syncKeys = new Set<string>()
  private completedSyncKeys = new Set<string>()

  syncLibrary(targets: Iterable<MetadataSyncTarget>, language: string): void {
    const uniqueTargets = new Map<number, MetadataSyncTarget>()
    for (const target of targets) {
      if (!Number.isInteger(target.appId) || target.appId <= 0) continue
      const existing = uniqueTargets.get(target.appId)
      uniqueTargets.set(target.appId, {
        appId: target.appId,
        allowCreate: Boolean(existing?.allowCreate || target.allowCreate)
      })
    }

    this.syncKeys = new Set([...uniqueTargets.keys()].map((appId) => cacheKey(appId, language)))
    this.completedSyncKeys.clear()
    syncCoordinator.begin('metadata', this.syncKeys.size, 0, 'steam', 'steam')
    this.enqueueTargets(uniqueTargets.values(), language)
  }

  enqueue(appIds: Iterable<number>, language: string, allowCreate: boolean): void {
    this.enqueueTargets(
      [...new Set(appIds)].map((appId) => ({ appId, allowCreate })),
      language
    )
  }

  private enqueueTargets(targets: Iterable<MetadataSyncTarget>, language: string): void {
    for (const { appId, allowCreate } of targets) {
      if (!Number.isInteger(appId) || appId <= 0) continue
      const key = cacheKey(appId, language)
      const rawCached = cacheEntries[key] as CachedMetadata | LegacyCachedMetadata | undefined
      const cached = rawCached ? normalizeCacheEntry(rawCached, language) : undefined
      if (cached) {
        this.emitUpdate(cached, allowCreate)
        if (isFresh(cached)) {
          this.markSyncComplete(key)
          continue
        }
      }

      const existing = this.queued.get(key)
      if (existing) {
        existing.allowCreate ||= allowCreate
        continue
      }
      const item = { appId, language, allowCreate, attempts: 0 }
      this.queued.set(key, item)
      this.queue.push(item)
    }

    if (this.queue.length > 0) {
      this.emit('busy')
      void this.run()
    }
  }

  private emitUpdate(entry: CachedMetadata, allowCreate: boolean): void {
    const { metadataSchemaVersion: _schemaVersion, ...metadata } = entry
    this.emit('updated', { metadata, allowCreate } satisfies MetadataUpdate)
  }

  private async run(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift() as QueueItem
        const key = cacheKey(item.appId, item.language)
        this.queued.delete(key)

        try {
          const metadata = await fetchMetadata(item.appId, item.language)
          if (metadata) {
            cacheEntries[key] = metadata
            scheduleCachePersist()
            this.emitUpdate(metadata, item.allowCreate)
          }
          this.markSyncComplete(key)
        } catch {
          item.attempts++
          if (item.attempts < 3 && !this.queued.has(key)) {
            this.queued.set(key, item)
            this.queue.unshift(item)
            await delay(Math.min(30_000 * 2 ** (item.attempts - 1), 120_000))
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
    syncCoordinator.progress('metadata', completed, this.syncKeys.size, 'steam', 'steam')
    if (completed >= this.syncKeys.size) syncCoordinator.complete('metadata', 'steam', 'steam')
  }
}

export const steamMetadataService = new SteamMetadataService()
