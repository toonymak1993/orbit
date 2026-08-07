import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { app, nativeImage } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Store from 'electron-store'
import type { ImageOrientation, ImageUpdate, LibraryGame, ResolvedImage } from '@shared/ipc'
import { settingsStore } from './settingsStore'
import { fetchSteamGridDbImage } from './steamGridDb'
import { resolveLocalIconDataUrl } from './localIcon'
import { getBuiltinSteamGridDbKey } from './builtinKeys'
import { getSteamInstallPath } from './steam/steamInstall'
import { syncCoordinator } from './sync/syncCoordinator'

const CACHE_DIR = join(app.getPath('userData'), 'artwork-v2')
const CDN_HOSTS = ['cdn.akamai.steamstatic.com', 'cdn.cloudflare.steamstatic.com']
const HIGH_QUALITY_TTL_MS = 60 * 24 * 60 * 60 * 1000
const LOW_QUALITY_TTL_MS = 24 * 60 * 60 * 1000
const NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024
// Keep background artwork decoding below the point where it competes with the
// controller UI on handheld CPUs. Delta sync is continuous, so latency matters
// less here than stable frame times.
const MAX_CONCURRENCY = 3
const PIPELINE_VERSION = 4

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
}

interface QueueItem {
  game: LibraryGame
  orientation: ImageOrientation
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

function isEntryUsable(entry: ManifestEntry): boolean {
  if (entry.source === 'none') return false
  if (entry.url.startsWith('data:')) return true
  if (!entry.url.startsWith('orbit-image://')) return false
  const fileName = decodeURIComponent(entry.url.slice('orbit-image://'.length))
  return !fileName.includes('/') && !fileName.includes('\\') && existsSync(join(CACHE_DIR, fileName))
}

function isEntryFresh(entry: ManifestEntry): boolean {
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

async function downloadValidated(
  remoteUrl: string,
  orientation: ImageOrientation
): Promise<ValidatedImage | null> {
  try {
    const response = await fetch(remoteUrl, { signal: AbortSignal.timeout(20_000) })
    if (!response.ok) return null
    const announcedSize = Number(response.headers.get('content-length'))
    if (Number.isFinite(announcedSize) && announcedSize > MAX_DOWNLOAD_BYTES) return null
    const buffer = Buffer.from(await response.arrayBuffer())
    return validateImage(
      buffer,
      orientation,
      extensionFromType(response.headers.get('content-type'), remoteUrl)
    )
  } catch {
    return null
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
  const safeId = game.id.replace(/[^a-z0-9_-]/gi, '-')
  const fileName = `${safeId}-${orientation}-${hash}.${validated.extension}`
  const outputPath = join(CACHE_DIR, fileName)
  if (!existsSync(outputPath)) await writeFile(outputPath, validated.buffer)
  return {
    url: `orbit-image://${fileName}`,
    contain: orientation === 'icon',
    width: validated.width,
    height: validated.height,
    resolvedAt: Date.now(),
    revision: Date.now(),
    source,
    quality: validated.quality,
    pipelineVersion: PIPELINE_VERSION,
    metadataRevision: game.metadataRevision,
    artworkFingerprint: artworkFingerprint(game, orientation)
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
      if (entry && !entry.artworkFingerprint) {
        entry.artworkFingerprint = currentArtworkFingerprint
        scheduleManifestPersist()
      }
      const cachedFileMissing = Boolean(entry && entry.source !== 'none' && !isEntryUsable(entry))
      const needsUpgrade = Boolean(
        !entry ||
          !isEntryFresh(entry) ||
          cachedFileMissing ||
          entry.pipelineVersion !== PIPELINE_VERSION ||
          entry.artworkFingerprint !== currentArtworkFingerprint
      )
      if (needsUpgrade) this.schedule(game, orientation)
      else this.markSyncComplete(key)
    }
  }

  resolve(game: LibraryGame, orientation: ImageOrientation): ResolvedImage | null {
    const key = artworkKey(game.id, orientation)
    const entry = manifestEntries[key]
    const cachedFileMissing = Boolean(entry && entry.source !== 'none' && !isEntryUsable(entry))
    if (!entry || !isEntryFresh(entry) || cachedFileMissing || entry.pipelineVersion !== PIPELINE_VERSION) {
      this.schedule(game, orientation)
    }
    return entry && isEntryUsable(entry) ? toResolved(entry) : null
  }

  private schedule(game: LibraryGame, orientation: ImageOrientation): void {
    const key = artworkKey(game.id, orientation)
    const existing = this.pending.get(key)
    if (existing) {
      existing.game = game
      return
    }
    const item = { game, orientation }
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
      this.active++
      void this.refresh(item)
        .catch(() => undefined)
        .finally(() => {
          this.active--
          this.pending.delete(key)
          this.markSyncComplete(key)
          this.pump()
        })
    }
  }

  private async refresh({ game, orientation }: QueueItem): Promise<void> {
    const key = artworkKey(game.id, orientation)
    const previous = manifestEntries[key]
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
      const entry = await persistImage(game, orientation, validated, source)
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
        const validated = await downloadValidated(remoteUrl, orientation)
        if (!validated) continue
        if (await acceptValidated(validated, 'steam-cdn')) return
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
      const validated = await downloadValidated(remoteUrl, orientation)
      if (!validated) continue
      if (await acceptValidated(validated, 'provider-metadata')) return
    }

    if (orientation !== 'icon') {
      const gridDbKey = settingsStore.get('steamGridDbApiKey') || getBuiltinSteamGridDbKey()
      if (gridDbKey) {
        const steamAppId = game.provider === 'steam' ? game.appId : undefined
        const gridUrl = await fetchSteamGridDbImage(steamAppId, gridDbKey, orientation, game.name)
        if (gridUrl) {
          const validated = await downloadValidated(gridUrl, orientation)
          if (validated) {
            if (await acceptValidated(validated, 'steamgriddb')) return
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
          revision: Date.now(),
          source: 'local-icon',
          quality: 'low',
          pipelineVersion: PIPELINE_VERSION,
          metadataRevision: game.metadataRevision,
          artworkFingerprint: artworkFingerprint(game, orientation)
        }
        this.rememberAndEmit(key, game.id, orientation, entry)
        return
      }
    }

    // Preserve a stale/low-quality image if all upgrades fail. A negative delta
    // is stored only when there was no usable image at all.
    if (bestFallback && isEntryUsable(bestFallback)) {
      this.rememberAndEmit(key, game.id, orientation, {
        ...bestFallback,
        resolvedAt: Date.now(),
        pipelineVersion: PIPELINE_VERSION,
        metadataRevision: game.metadataRevision,
        artworkFingerprint: artworkFingerprint(game, orientation)
      })
      return
    }

    const missing: ManifestEntry = {
      url: '',
      contain: false,
      width: 0,
      height: 0,
      resolvedAt: Date.now(),
      revision: Date.now(),
      source: 'none',
      quality: 'none',
      pipelineVersion: PIPELINE_VERSION,
      metadataRevision: game.metadataRevision,
      artworkFingerprint: artworkFingerprint(game, orientation)
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
  return artworkService.resolve(game, orientation)
}
