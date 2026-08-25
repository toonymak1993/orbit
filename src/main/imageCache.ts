import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { app, nativeImage } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import { readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Store from 'electron-store'
import type { ImageOrientation, ImageUpdate, LibraryGame, ResolvedImage } from '@shared/ipc'
import { settingsStore } from './settingsStore'
import { fetchSteamGridDbImage } from './steamGridDb'
import { fetchWithElectronNet } from './networkFetch'
import {
  isTransientArtworkStatus,
  runArtworkNetworkAttempt,
  type ArtworkNetworkAttempt
} from './artworkNetworkPolicy'
import { resolveLocalIconDataUrl } from './localIcon'
import { getBuiltinSteamGridDbKey } from './builtinKeys'
import { getSteamInstallPath } from './steam/steamInstall'
import { syncCoordinator } from './sync/syncCoordinator'
import { customArtworkService } from './customArtwork'

const CACHE_DIR = join(app.getPath('userData'), 'artwork-v2')
const CDN_HOSTS = ['cdn.akamai.steamstatic.com', 'cdn.cloudflare.steamstatic.com']
const HIGH_QUALITY_TTL_MS = 60 * 24 * 60 * 60 * 1000
const LOW_QUALITY_TTL_MS = 24 * 60 * 60 * 1000
const NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024
const ASSET_TIMEOUT_MS = 8_000
const TRANSIENT_RETRY_BASE_MS = 2 * 60 * 1000
const TRANSIENT_RETRY_MAX_MS = 6 * 60 * 60 * 1000
const ORPHAN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const MAX_ORPHAN_DELETIONS_PER_RUN = 25
const GENERATED_CACHE_FILE = /-(?:vertical|horizontal|icon)-[a-f0-9]{16}\.(?:jpg|png|webp)$/i
// Keep background artwork decoding below the point where it competes with the
// controller UI on handheld CPUs. Delta sync is continuous, so latency matters
// less here than stable frame times.
const MAX_CONCURRENCY = 3
const PIPELINE_VERSION = 5

type ArtworkSource =
  | 'steam-local'
  | 'steam-cdn'
  | 'provider-metadata'
  | 'steamgriddb'
  | 'local-icon'
  | 'none'
type ArtworkQuality = 'high' | 'low' | 'none'

interface ManifestEntry {
  url: string
  contain: boolean
  width: number
  height: number
  resolvedAt: number
  revision: number
  source: ArtworkSource
  quality: ArtworkQuality
  pipelineVersion: number
  metadataRevision?: number
  artworkFingerprint?: string
  retryAt?: number
  failureCount?: number
}

interface QueueItem {
  game: LibraryGame
  orientation: ImageOrientation
  generation: number
}

interface ValidatedImage {
  buffer: Buffer
  width: number
  height: number
  quality: Exclude<ArtworkQuality, 'none'>
  extension: string
}

const manifestStore = new Store<{ schemaVersion: number; entries: Record<string, ManifestEntry> }>({
  name: 'orbit-artwork-v2',
  defaults: { schemaVersion: 2, entries: {} }
})
const manifestEntries: Record<string, ManifestEntry> = { ...manifestStore.get('entries') }
let manifestPersistTimer: ReturnType<typeof setTimeout> | undefined
let lastRevision = Date.now()

function nextRevision(): number {
  lastRevision = Math.max(Date.now(), lastRevision + 1)
  return lastRevision
}

function persistManifestEntries(): void {
  if (manifestPersistTimer) clearTimeout(manifestPersistTimer)
  manifestPersistTimer = undefined
  manifestStore.set('entries', manifestEntries)
}

function scheduleManifestPersist(): void {
  if (manifestPersistTimer) return
  manifestPersistTimer = setTimeout(persistManifestEntries, 2_000)
}

app.on('before-quit', persistManifestEntries)

function ensureCacheDir(): void {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true })
}

export function getCacheDir(): string {
  return CACHE_DIR
}

function artworkKey(gameId: string, orientation: ImageOrientation): string {
  return `${gameId}:${orientation}`
}

function cachedFileName(entry: ManifestEntry): string | null {
  try {
    if (!entry.url.startsWith('orbit-image://')) return null
    const fileName = decodeURIComponent(entry.url.slice('orbit-image://'.length))
    return fileName.includes('/') || fileName.includes('\\') ? null : fileName
  } catch {
    return null
  }
}

async function cleanupOrphanedCacheFiles(): Promise<void> {
  try {
    ensureCacheDir()
    const referenced = new Set(
      Object.values(manifestEntries)
        .map(cachedFileName)
        .filter((fileName): fileName is string => Boolean(fileName))
    )
    const cutoff = Date.now() - ORPHAN_RETENTION_MS
    const files = await readdir(CACHE_DIR, { withFileTypes: true })
    let deleted = 0
    for (const file of files) {
      if (deleted >= MAX_ORPHAN_DELETIONS_PER_RUN) break
      if (
        !file.isFile() ||
        referenced.has(file.name) ||
        (!GENERATED_CACHE_FILE.test(file.name) && !file.name.endsWith('.tmp'))
      ) continue
      const filePath = join(CACHE_DIR, file.name)
      const fileStat = await stat(filePath).catch(() => null)
      const nowReferenced = Object.values(manifestEntries).some(
        (entry) => cachedFileName(entry) === file.name
      )
      if (fileStat && fileStat.mtimeMs < cutoff && !nowReferenced) {
        await unlink(filePath).catch(() => undefined)
        deleted++
      }
    }
  } catch {
    // Cache maintenance must never delay or prevent launcher startup.
  }
}

const cacheCleanupTimer = setTimeout(() => void cleanupOrphanedCacheFiles(), 60_000)
cacheCleanupTimer.unref()

function isEntryUsable(entry: ManifestEntry): boolean {
  if (entry.source === 'none') return false
  if (entry.url.startsWith('data:')) return true
  const fileName = cachedFileName(entry)
  return Boolean(fileName && existsSync(join(CACHE_DIR, fileName)))
}

function isEntryFresh(entry: ManifestEntry): boolean {
  if (entry.retryAt !== undefined) return Date.now() < entry.retryAt
  const ttl =
    entry.quality === 'high'
      ? HIGH_QUALITY_TTL_MS
      : entry.quality === 'low'
        ? LOW_QUALITY_TTL_MS
        : NEGATIVE_TTL_MS
  return Date.now() - entry.resolvedAt < ttl
}

function toResolved(entry: ManifestEntry): ResolvedImage {
  return { url: entry.url, contain: entry.contain, revision: entry.revision }
}

function extensionFromType(contentType: string | null, sourceUrl: string): string {
  if (contentType?.includes('png')) return 'png'
  if (contentType?.includes('webp')) return 'webp'
  if (contentType?.includes('jpeg') || contentType?.includes('jpg')) return 'jpg'
  const extension = extname(new URL(sourceUrl).pathname).slice(1).toLowerCase()
  return ['png', 'webp', 'jpg', 'jpeg'].includes(extension) ? extension.replace('jpeg', 'jpg') : 'jpg'
}

function validateImage(
  buffer: Buffer,
  orientation: ImageOrientation,
  extension: string
): ValidatedImage | null {
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_DOWNLOAD_BYTES) return null
  const image = nativeImage.createFromBuffer(buffer)
  if (image.isEmpty()) return null
  const { width, height } = image.getSize()
  if (width <= 0 || height <= 0) return null

  const ratio = width / height
  if (orientation === 'icon') {
    if (ratio < 0.65 || ratio > 1.45 || width < 32 || height < 32) return null
    return {
      buffer,
      width,
      height,
      extension,
      quality: width >= 128 && height >= 128 ? 'high' : 'low'
    }
  }

  if (orientation === 'vertical') {
    if (ratio < 0.55 || ratio > 0.8 || width < 300 || height < 450) return null
    return {
      buffer,
      width,
      height,
      extension,
      quality: width >= 600 && height >= 900 ? 'high' : 'low'
    }
  }

  if (ratio < 1.45 || ratio > 3.6 || width < 600 || height < 250) return null
  return {
    buffer,
    width,
    height,
    extension,
    quality: width >= 1200 && height >= 500 ? 'high' : 'low'
  }
}

async function validateLocalFile(
  filePath: string,
  orientation: ImageOrientation
): Promise<ValidatedImage | null> {
  try {
    const buffer = await readFile(filePath)
    const extension = extname(filePath).slice(1).toLowerCase() || 'jpg'
    return validateImage(buffer, orientation, extension)
  } catch {
    return null
  }
}

async function readBoundedResponse(response: Response): Promise<Buffer | null> {
  if (!response.body) return null
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      byteLength += chunk.value.byteLength
      if (byteLength > MAX_DOWNLOAD_BYTES) {
        await reader.cancel().catch(() => undefined)
        return null
      }
      chunks.push(chunk.value)
    }
    return Buffer.concat(chunks, byteLength)
  } finally {
    reader.releaseLock()
  }
}

async function discardResponse(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined)
}

async function downloadValidated(
  remoteUrl: string,
  orientation: ImageOrientation
): Promise<ArtworkNetworkAttempt<ValidatedImage>> {
  try {
    const parsedUrl = new URL(remoteUrl)
    if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password) {
      return { state: 'missing' }
    }
    const scope = `artwork:${parsedUrl.hostname.toLowerCase()}`
    return runArtworkNetworkAttempt<ValidatedImage>(scope, async () => {
      const response = await fetchWithElectronNet(parsedUrl, {
        signal: AbortSignal.timeout(ASSET_TIMEOUT_MS)
      })
      if (!response.ok) {
        await discardResponse(response)
        return { state: isTransientArtworkStatus(response.status) ? 'unavailable' : 'missing' }
      }
      const contentType = response.headers.get('content-type')
      if (contentType && !contentType.toLowerCase().startsWith('image/')) {
        await discardResponse(response)
        return { state: 'missing' }
      }
      const announcedSize = Number(response.headers.get('content-length'))
      if (Number.isFinite(announcedSize) && announcedSize > MAX_DOWNLOAD_BYTES) {
        await discardResponse(response)
        return { state: 'missing' }
      }
      const buffer = await readBoundedResponse(response)
      if (!buffer) return { state: 'missing' }
      const validated = validateImage(
        buffer,
        orientation,
        extensionFromType(contentType, remoteUrl)
      )
      return validated ? { state: 'success', value: validated } : { state: 'missing' }
    })
  } catch {
    return { state: 'missing' }
  }
}

async function persistImage(
  game: LibraryGame,
  orientation: ImageOrientation,
  validated: ValidatedImage,
  source: ArtworkSource
): Promise<ManifestEntry> {
  ensureCacheDir()
  const hash = createHash('sha256').update(validated.buffer).digest('hex').slice(0, 16)
  const safeId = game.id.replace(/[^a-z0-9_-]/gi, '-').slice(0, 64) || 'game'
  const gameHash = createHash('sha256').update(game.id).digest('hex').slice(0, 8)
  const fileName = `${safeId}-${gameHash}-${orientation}-${hash}.${validated.extension}`
  const outputPath = join(CACHE_DIR, fileName)
  if (!existsSync(outputPath)) {
    const temporaryPath = `${outputPath}.${process.pid}-${Date.now()}.tmp`
    try {
      await writeFile(temporaryPath, validated.buffer, { flag: 'wx' })
      await rename(temporaryPath, outputPath)
    } catch (error) {
      if (!existsSync(outputPath)) throw error
    } finally {
      await unlink(temporaryPath).catch(() => undefined)
    }
  }
  return {
    url: `orbit-image://${fileName}`,
    contain: orientation === 'icon',
    width: validated.width,
    height: validated.height,
    resolvedAt: Date.now(),
    revision: nextRevision(),
    source,
    quality: validated.quality,
    pipelineVersion: PIPELINE_VERSION,
    metadataRevision: game.metadataRevision,
    artworkFingerprint: artworkFingerprint(game, orientation),
    retryAt: undefined,
    failureCount: undefined
  }
}

function localSteamCandidates(appId: number, orientation: ImageOrientation): string[] {
  const steamPath = getSteamInstallPath()
  if (!steamPath) return []
  const cacheRoot = join(steamPath, 'appcache', 'librarycache')
  const appRoot = join(cacheRoot, String(appId))
  const names =
    orientation === 'vertical'
      ? ['library_600x900_2x.jpg', 'library_600x900.jpg', 'library_capsule.jpg']
      : orientation === 'horizontal'
        ? ['library_hero.jpg', 'page_bg_generated_v6b.jpg']
        : ['icon.jpg']
  let hashedRoots: string[] = []
  if (existsSync(appRoot)) {
    try {
      hashedRoots = readdirSync(appRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(appRoot, entry.name))
    } catch {
      hashedRoots = []
    }
  }
  return [
    ...names.map((name) => join(appRoot, name)),
    ...hashedRoots.flatMap((root) => names.map((name) => join(root, name))),
    ...names.map((name) => join(cacheRoot, `${appId}_${name}`)),
    ...(orientation === 'icon' ? [join(cacheRoot, `${appId}_icon.jpg`)] : [])
  ]
}

function steamCdnCandidates(appId: number, orientation: ImageOrientation): string[] {
  if (orientation === 'icon') return []
  const paths =
    orientation === 'vertical'
      ? ['library_600x900_2x.jpg', 'library_600x900.jpg']
      : ['library_hero.jpg', 'page_bg_generated_v6b.jpg', 'page_bg_generated.jpg']
  return paths.flatMap((path) => CDN_HOSTS.map((host) => `https://${host}/steam/apps/${appId}/${path}`))
}

function providerMetadataCandidates(game: LibraryGame, orientation: ImageOrientation): string[] {
  const explicit = game.metadata.artwork?.[orientation] ?? []
  const legacy =
    orientation === 'vertical'
      ? []
      : orientation === 'horizontal'
        ? [game.metadata.backgroundUrl, game.metadata.storeHeaderUrl]
        : [game.metadata.iconUrl]
  return [...new Set([...explicit, ...legacy].filter((url): url is string => Boolean(url)))]
}

function artworkFingerprint(game: LibraryGame, orientation: ImageOrientation): string {
  return createHash('sha1')
    .update(
      JSON.stringify({
        provider: game.provider,
        providerGameId: game.providerGameId,
        appId: game.appId,
        name: game.name,
        installed: game.installed,
        installDir: game.installDir,
        sources: providerMetadataCandidates(game, orientation)
      })
    )
    .digest('hex')
    .slice(0, 16)
}

function adoptArtworkFingerprint(
  entry: ManifestEntry | undefined,
  fingerprint: string
): void {
  if (!entry || entry.artworkFingerprint) return
  entry.artworkFingerprint = fingerprint
  scheduleManifestPersist()
}

function needsRefresh(
  entry: ManifestEntry | undefined,
  fingerprint: string
): boolean {
  if (!entry) return true
  return (
    !isEntryFresh(entry) ||
    (entry.source !== 'none' && !isEntryUsable(entry)) ||
    entry.pipelineVersion !== PIPELINE_VERSION ||
    entry.artworkFingerprint !== fingerprint
  )
}

function transientRetryState(previous: ManifestEntry | undefined): {
  failureCount: number
  retryAt: number
} {
  const failureCount = (previous?.failureCount ?? 0) + 1
  const delay = Math.min(
    TRANSIENT_RETRY_BASE_MS * 2 ** Math.max(0, failureCount - 1),
    TRANSIENT_RETRY_MAX_MS
  )
  return { failureCount, retryAt: Date.now() + delay }
}

function localProviderMetadataCandidates(
  game: LibraryGame,
  orientation: ImageOrientation
): string[] {
  return providerMetadataCandidates(game, orientation).filter((url) => url.startsWith('file:'))
}

function remoteProviderMetadataCandidates(
  game: LibraryGame,
  orientation: ImageOrientation
): string[] {
  return providerMetadataCandidates(game, orientation).filter((url) => url.startsWith('https://'))
}

class ArtworkService extends EventEmitter {
  private queue: QueueItem[] = []
  private pending = new Map<string, QueueItem>()
  private active = 0
  private syncKeys = new Set<string>()
  private completedSyncKeys = new Set<string>()
  private syncProviderByKey = new Map<string, string>()
  private syncTotalsByProvider = new Map<string, number>()
  private syncCompletedByProvider = new Map<string, number>()

  beginSyncSession(): void {
    this.syncKeys.clear()
    this.completedSyncKeys.clear()
    this.syncProviderByKey.clear()
    this.syncTotalsByProvider.clear()
    this.syncCompletedByProvider.clear()
  }

  syncLibrary(games: Iterable<LibraryGame>): void {
    this.beginSyncSession()
    const grouped = new Map<string, LibraryGame[]>()
    for (const game of games) {
      const providerGames = grouped.get(game.provider) ?? []
      providerGames.push(game)
      grouped.set(game.provider, providerGames)
    }
    if (grouped.size === 0) syncCoordinator.begin('artwork', 0, 0, undefined, 'system')
    for (const [provider, providerGames] of grouped) this.syncProvider(providerGames, provider)
  }

  syncProvider(games: Iterable<LibraryGame>, provider: string): void {
    const targets = [...games]
      .filter((game) => game.provider === provider)
      .flatMap((game) => [
      { game, orientation: 'vertical' as const },
      { game, orientation: 'horizontal' as const },
      { game, orientation: 'icon' as const }
    ])
    for (const { game, orientation } of targets) {
      const key = artworkKey(game.id, orientation)
      this.syncKeys.add(key)
      this.syncProviderByKey.set(key, game.provider)
    }
    const providerKeys = [...this.syncProviderByKey.entries()]
      .filter(([, keyProvider]) => keyProvider === provider)
      .map(([key]) => key)
    const total = providerKeys.length
    const completed = providerKeys.filter((key) => this.completedSyncKeys.has(key)).length
    this.syncTotalsByProvider.set(provider, total)
    this.syncCompletedByProvider.set(provider, completed)
    syncCoordinator.begin('artwork', total, completed, provider, provider)

    for (const { game, orientation } of targets) {
      const key = artworkKey(game.id, orientation)
      const entry = manifestEntries[key]
      const currentArtworkFingerprint = artworkFingerprint(game, orientation)
      // Older manifests only tracked the broad metadata revision. Adopt their
      // currently cached result without forcing another full network sweep.
      adoptArtworkFingerprint(entry, currentArtworkFingerprint)
      if (needsRefresh(entry, currentArtworkFingerprint)) this.schedule(game, orientation)
      else this.markSyncComplete(key)
    }
  }

  resolve(game: LibraryGame, orientation: ImageOrientation): ResolvedImage | null {
    const key = artworkKey(game.id, orientation)
    const entry = manifestEntries[key]
    const currentArtworkFingerprint = artworkFingerprint(game, orientation)
    adoptArtworkFingerprint(entry, currentArtworkFingerprint)
    if (needsRefresh(entry, currentArtworkFingerprint)) {
      this.schedule(game, orientation)
    }
    return entry && isEntryUsable(entry) ? toResolved(entry) : null
  }

  reportFailure(game: LibraryGame, orientation: ImageOrientation, revision: number): void {
    const key = artworkKey(game.id, orientation)
    const entry = manifestEntries[key]
    if (!entry || entry.revision !== revision) return

    const fileName = cachedFileName(entry)
    delete manifestEntries[key]
    scheduleManifestPersist()
    this.emit('updated', { gameId: game.id, orientation, image: null } satisfies ImageUpdate)
    if (fileName) void unlink(join(CACHE_DIR, fileName)).catch(() => undefined)
    this.schedule(game, orientation, true)
  }

  private schedule(
    game: LibraryGame,
    orientation: ImageOrientation,
    force = false
  ): void {
    const key = artworkKey(game.id, orientation)
    const existing = this.pending.get(key)
    if (existing) {
      const changed =
        artworkFingerprint(existing.game, orientation) !== artworkFingerprint(game, orientation)
      existing.game = game
      if (changed || force) existing.generation++
      return
    }
    const item: QueueItem = { game, orientation, generation: 0 }
    this.pending.set(key, item)
    if (game.metadataSource === 'orbit-store') {
      const firstBackgroundItem = this.queue.findIndex(
        (queued) => queued.game.metadataSource !== 'orbit-store'
      )
      if (firstBackgroundItem === -1) this.queue.push(item)
      else this.queue.splice(firstBackgroundItem, 0, item)
    } else {
      this.queue.push(item)
    }
    this.pump()
  }

  private pump(): void {
    while (this.active < MAX_CONCURRENCY && this.queue.length > 0) {
      const item = this.queue.shift() as QueueItem
      const key = artworkKey(item.game.id, item.orientation)
      const generation = item.generation
      this.active++
      void this.refresh(item.game, item.orientation, () => item.generation === generation)
        .catch(() => undefined)
        .finally(() => {
          this.active--
          if (item.generation !== generation) {
            this.queue.push(item)
          } else {
            this.pending.delete(key)
            this.markSyncComplete(key)
          }
          this.pump()
        })
    }
  }

  private async refresh(
    game: LibraryGame,
    orientation: ImageOrientation,
    isCurrent: () => boolean
  ): Promise<void> {
    const key = artworkKey(game.id, orientation)
    const previous = manifestEntries[key]
    let transientFailure = false
    let bestFallback =
      previous &&
      isEntryUsable(previous) &&
      !(orientation !== 'icon' && previous.source === 'local-icon')
        ? previous
        : undefined

    const acceptValidated = async (
      validated: ValidatedImage,
      source: ArtworkSource
    ): Promise<boolean> => {
      if (!isCurrent()) return true
      const entry = await persistImage(game, orientation, validated, source)
      if (!isCurrent()) return true
      if (entry.quality === 'high') {
        this.rememberAndEmit(key, game.id, orientation, entry)
        return true
      }
      const previousArea = bestFallback ? bestFallback.width * bestFallback.height : 0
      const candidateArea = entry.width * entry.height
      if (!bestFallback || bestFallback.quality === 'none' || candidateArea > previousArea) {
        bestFallback = entry
        // A usable thumbnail appears immediately, while this same worker keeps
        // searching the remaining sources for a high-resolution replacement.
        this.rememberAndEmit(key, game.id, orientation, entry)
      }
      return false
    }

    if (game.provider === 'steam' && game.appId) {
      for (const localPath of localSteamCandidates(game.appId, orientation)) {
        if (!existsSync(localPath)) continue
        const validated = await validateLocalFile(localPath, orientation)
        if (!validated) continue
        if (await acceptValidated(validated, 'steam-local')) return
      }

      for (const remoteUrl of steamCdnCandidates(game.appId, orientation)) {
        const result = await downloadValidated(remoteUrl, orientation)
        if (result.state === 'unavailable') {
          transientFailure = true
          continue
        }
        if (result.state === 'missing') continue
        if (await acceptValidated(result.value, 'steam-cdn')) return
      }
    }

    for (const localUrl of localProviderMetadataCandidates(game, orientation)) {
      try {
        const localPath = fileURLToPath(localUrl)
        if (!existsSync(localPath)) continue
        const validated = await validateLocalFile(localPath, orientation)
        if (!validated) continue
        if (await acceptValidated(validated, 'provider-metadata')) return
      } catch {
        // Invalid or inaccessible package assets simply fall through to the
        // provider's online metadata and the shared artwork fallback.
      }
    }

    for (const remoteUrl of remoteProviderMetadataCandidates(game, orientation)) {
      const result = await downloadValidated(remoteUrl, orientation)
      if (result.state === 'unavailable') {
        transientFailure = true
        continue
      }
      if (result.state === 'missing') continue
      if (await acceptValidated(result.value, 'provider-metadata')) return
    }

    if (orientation !== 'icon') {
      const gridDbKey = settingsStore.get('steamGridDbApiKey') || getBuiltinSteamGridDbKey()
      if (gridDbKey) {
        const steamAppId = game.provider === 'steam' ? game.appId : undefined
        const gridResult = await fetchSteamGridDbImage(
          steamAppId,
          gridDbKey,
          orientation,
          game.name
        )
        if (gridResult.state === 'unavailable') {
          transientFailure = true
        } else if (gridResult.state === 'success') {
          const result = await downloadValidated(gridResult.value, orientation)
          if (result.state === 'unavailable') transientFailure = true
          else if (result.state === 'success') {
            if (await acceptValidated(result.value, 'steamgriddb')) return
          }
        }
      }
    }

    if (!bestFallback && orientation === 'icon' && game.installed && game.installDir) {
      const iconDataUrl = await resolveLocalIconDataUrl(game.installDir)
      if (iconDataUrl) {
        const icon = nativeImage.createFromDataURL(iconDataUrl)
        const { width, height } = icon.getSize()
        const entry: ManifestEntry = {
          url: iconDataUrl,
          contain: true,
          width,
          height,
          resolvedAt: Date.now(),
          revision: nextRevision(),
          source: 'local-icon',
          quality: 'low',
          pipelineVersion: PIPELINE_VERSION,
          metadataRevision: game.metadataRevision,
          artworkFingerprint: artworkFingerprint(game, orientation),
          retryAt: undefined,
          failureCount: undefined
        }
        if (!isCurrent()) return
        this.rememberAndEmit(key, game.id, orientation, entry)
        return
      }
    }

    if (!isCurrent()) return

    // Preserve a stale/low-quality image if all upgrades fail. A negative delta
    // is stored only when there was no usable image at all. Provider outages use
    // a shorter exponential retry while the last good file remains available.
    if (bestFallback && isEntryUsable(bestFallback)) {
      const retry = transientFailure ? transientRetryState(previous) : undefined
      this.rememberAndEmit(key, game.id, orientation, {
        ...bestFallback,
        resolvedAt: transientFailure ? bestFallback.resolvedAt : Date.now(),
        pipelineVersion: PIPELINE_VERSION,
        metadataRevision: game.metadataRevision,
        artworkFingerprint: artworkFingerprint(game, orientation),
        retryAt: retry?.retryAt,
        failureCount: retry?.failureCount
      })
      return
    }

    const retry = transientFailure ? transientRetryState(previous) : undefined
    const missing: ManifestEntry = {
      url: '',
      contain: false,
      width: 0,
      height: 0,
      resolvedAt: Date.now(),
      revision: nextRevision(),
      source: 'none',
      quality: 'none',
      pipelineVersion: PIPELINE_VERSION,
      metadataRevision: game.metadataRevision,
      artworkFingerprint: artworkFingerprint(game, orientation),
      retryAt: retry?.retryAt,
      failureCount: retry?.failureCount
    }
    this.rememberAndEmit(key, game.id, orientation, missing)
  }

  private rememberAndEmit(
    key: string,
    gameId: string,
    orientation: ImageOrientation,
    entry: ManifestEntry
  ): void {
    manifestEntries[key] = entry
    scheduleManifestPersist()
    const update: ImageUpdate = {
      gameId,
      orientation,
      image: entry.source === 'none' ? null : toResolved(entry)
    }
    this.emit('updated', update)
  }

  private markSyncComplete(key: string): void {
    if (!this.syncKeys.has(key) || this.completedSyncKeys.has(key)) return
    this.completedSyncKeys.add(key)
    const provider = this.syncProviderByKey.get(key) ?? 'system'
    const completed = (this.syncCompletedByProvider.get(provider) ?? 0) + 1
    const total = this.syncTotalsByProvider.get(provider) ?? 0
    this.syncCompletedByProvider.set(provider, completed)
    syncCoordinator.progress('artwork', completed, total, provider, provider)
    if (completed >= total) syncCoordinator.complete('artwork', provider, provider)
  }
}

export const artworkService = new ArtworkService()

// Kept as a function for the IPC boundary; resolution is instant and any stale
// or missing asset is upgraded by ArtworkService's bounded background queue.
export function resolveImage(game: LibraryGame, orientation: ImageOrientation): ResolvedImage | null {
  if (orientation === 'vertical') {
    const customArtwork = customArtworkService.resolve(game.id)
    if (customArtwork) return customArtwork
  }
  return artworkService.resolve(game, orientation)
}
