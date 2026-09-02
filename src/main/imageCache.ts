import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { app, nativeImage } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import { readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Store from 'electron-store'
import type {
  ArtworkMaintenanceResult,
  ImageOrientation,
  ImageUpdate,
  LibraryGame,
  ResolvedImage
} from '@shared/ipc'
import { clearSteamGridDbCache, fetchSteamGridDbArtworkCandidates } from './steamGridDb'
import { fetchWithElectronNet } from './networkFetch'
import {
  isTransientArtworkStatus,
  runArtworkNetworkAttempt,
  type ArtworkNetworkAttempt
} from './artworkNetworkPolicy'
import { resolveLocalIconDataUrl } from './localIcon'
import { getBuiltinSteamGridDbKey } from './builtinKeys'
import { steamGridDbCredentials } from './steamGridDbCredentials'
import { getSteamInstallPath } from './steam/steamInstall'
import { syncCoordinator } from './sync/syncCoordinator'
import { customArtworkService } from './customArtwork'
import { trimTransparentImage } from './transparentImage'
import {
  clearArtworkDiscoveryCaches,
  discoverExactStoreArtwork,
  discoverLibretroArtwork
} from './artworkFallback'
import {
  artworkIdentitySignature,
  automaticArtworkQuality,
  automaticArtworkScore,
  canonicalArtworkTitle,
  libretroArtworkFolderPriority,
  libretroArtworkFolders,
  shareArtworkIdentity,
  type LibretroArtworkFolder
} from '@shared/artworkMatching'

const CACHE_DIR = join(app.getPath('userData'), 'artwork-v2')
const CDN_HOSTS = ['cdn.akamai.steamstatic.com', 'cdn.cloudflare.steamstatic.com']
const HIGH_QUALITY_TTL_MS = 60 * 24 * 60 * 60 * 1000
const LOW_QUALITY_TTL_MS = 24 * 60 * 60 * 1000
const NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024
const ASSET_TIMEOUT_MS = 8_000
const TRANSIENT_RETRY_BASE_MS = 2 * 60 * 1000
const TRANSIENT_RETRY_MAX_MS = 6 * 60 * 60 * 1000
const QUALITY_UPGRADE_RETRY_BASE_MS = 6 * 60 * 60 * 1000
const QUALITY_UPGRADE_RETRY_MAX_MS = 7 * 24 * 60 * 60 * 1000
const ORPHAN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const MAX_ORPHAN_DELETIONS_PER_RUN = 25
const GENERATED_CACHE_FILE = /-(?:vertical|horizontal|icon|logo)-[a-f0-9]{16}\.(?:ico|jpg|png|webp)$/i
const CUSTOM_CACHE_FILE = /^custom-(?:cover|background|icon|logo)-[a-f0-9]{12}-[a-f0-9]{16}\.png$/i
// Keep background artwork decoding below the point where it competes with the
// controller UI on handheld CPUs. Delta sync is continuous, so latency matters
// less here than stable frame times.
const MAX_CONCURRENCY = 3
const LIBRETRO_ARTWORK_ROLE_POLICY_VERSION = 15
const PIPELINE_VERSION = 17
const ARTWORK_ORIENTATIONS: ImageOrientation[] = ['vertical', 'horizontal', 'logo', 'icon']

type ArtworkSource =
  | 'steam-local'
  | 'steam-cdn'
  | 'provider-metadata'
  | 'library-match'
  | 'libretro'
  | 'store-fallback'
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
  libraryMatchSourceKey?: string
  libraryMatchSourceRevision?: number
  libretroFolder?: LibretroArtworkFolder
}

interface LibraryArtworkMatch {
  entry: ManifestEntry
  sourceKey: string
  sourceRevision: number
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
  contain: boolean
}

interface ImageValidationOptions {
  allowFallback?: boolean
  containFallback?: boolean
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
      [
        ...Object.values(manifestEntries)
          .map(cachedFileName)
          .filter((fileName): fileName is string => Boolean(fileName)),
        ...customArtworkService.referencedFileNames()
      ]
    )
    const cutoff = Date.now() - ORPHAN_RETENTION_MS
    const files = await readdir(CACHE_DIR, { withFileTypes: true })
    let deleted = 0
    for (const file of files) {
      if (deleted >= MAX_ORPHAN_DELETIONS_PER_RUN) break
      if (
        !file.isFile() ||
        referenced.has(file.name) ||
        (!GENERATED_CACHE_FILE.test(file.name) &&
          !CUSTOM_CACHE_FILE.test(file.name) &&
          !file.name.endsWith('.tmp'))
      ) continue
      const filePath = join(CACHE_DIR, file.name)
      const fileStat = await stat(filePath).catch(() => null)
      const nowReferenced =
        Object.values(manifestEntries).some(
          (entry) => cachedFileName(entry) === file.name
        ) || customArtworkService.referencedFileNames().includes(file.name)
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
  if (contentType?.includes('icon')) return 'ico'
  if (contentType?.includes('jpeg') || contentType?.includes('jpg')) return 'jpg'
  const extension = extname(new URL(sourceUrl).pathname).slice(1).toLowerCase()
  return ['ico', 'png', 'webp', 'jpg', 'jpeg'].includes(extension)
    ? extension.replace('jpeg', 'jpg')
    : 'jpg'
}

function isSupportedArtworkResponse(contentType: string | null, sourceUrl: string): boolean {
  if (!contentType) return true
  const normalizedType = contentType.split(';', 1)[0].trim().toLowerCase()
  if (normalizedType.startsWith('image/')) return true
  if (normalizedType !== 'application/octet-stream' && normalizedType !== 'binary/octet-stream') {
    return false
  }
  // Ubisoft's official asset CDN serves valid images as generic binary data.
  // Only accept that MIME fallback for an explicit image extension; the same
  // bounded nativeImage decode below remains the final content validation.
  const extension = extname(new URL(sourceUrl).pathname).slice(1).toLowerCase()
  return ['ico', 'jpeg', 'jpg', 'png', 'webp'].includes(extension)
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
      quality: automaticArtworkQuality(width, height, orientation),
      contain: true
    }
  }

  if (orientation === 'logo') {
    const logo = trimTransparentImage(image)
    const logoSize = logo.getSize()
    const logoRatio = logoSize.width / logoSize.height
    if (
      logoRatio < 0.65 ||
      logoRatio > 12 ||
      logoSize.width < 64 ||
      logoSize.height < 16
    ) {
      return null
    }
    return {
      buffer: logo === image ? buffer : logo.toPNG(),
      width: logoSize.width,
      height: logoSize.height,
      extension: logo === image ? extension : 'png',
      quality: automaticArtworkQuality(logoSize.width, logoSize.height, orientation),
      contain: true
    }
  }

  if (orientation === 'vertical') {
    if (ratio < 0.55 || ratio > 0.8 || width < 300 || height < 450) return null
    return {
      buffer,
      width,
      height,
      extension,
      quality: automaticArtworkQuality(width, height, orientation),
      contain: false
    }
  }

  if (ratio < 1.45 || ratio > 3.6 || width < 600 || height < 250) return null
  return {
    buffer,
    width,
    height,
    extension,
    quality: automaticArtworkQuality(width, height, orientation),
    contain: false
  }
}

function validateImageFallback(
  buffer: Buffer,
  orientation: ImageOrientation,
  extension: string,
  contain: boolean
): ValidatedImage | null {
  if (orientation === 'icon' || orientation === 'logo') return null
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_DOWNLOAD_BYTES) return null
  const image = nativeImage.createFromBuffer(buffer)
  if (image.isEmpty()) return null
  const { width, height } = image.getSize()
  if (width < 128 || height < 128) return null
  // Cross-orientation provider art normally fills its slot. Callers may keep a
  // semantically authoritative landscape box intact; the renderer then gives
  // it an intentional backdrop instead of destructively cropping it.
  return {
    buffer,
    width,
    height,
    extension,
    quality: automaticArtworkQuality(width, height, orientation),
    contain
  }
}

async function validateLocalFile(
  filePath: string,
  orientation: ImageOrientation,
  options: ImageValidationOptions = {}
): Promise<ValidatedImage | null> {
  try {
    const buffer = await readFile(filePath)
    const extension = extname(filePath).slice(1).toLowerCase() || 'jpg'
    return (
      validateImage(buffer, orientation, extension) ??
      (options.allowFallback
        ? validateImageFallback(buffer, orientation, extension, options.containFallback ?? false)
        : null)
    )
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
  orientation: ImageOrientation,
  options: ImageValidationOptions = {}
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
      if (!isSupportedArtworkResponse(contentType, remoteUrl)) {
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
      const extension = extensionFromType(contentType, remoteUrl)
      const validated =
        validateImage(buffer, orientation, extension) ??
        (options.allowFallback
          ? validateImageFallback(buffer, orientation, extension, options.containFallback ?? false)
          : null)
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
  source: ArtworkSource,
  libretroFolder?: LibretroArtworkFolder
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
    contain: validated.contain,
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
    failureCount: undefined,
    libretroFolder: source === 'libretro' ? libretroFolder : undefined
  }
}

type SteamArtworkTier = 'all' | 'primary' | 'fallback'

function localSteamCandidates(
  appId: number,
  orientation: ImageOrientation,
  tier: SteamArtworkTier = 'all'
): string[] {
  const steamPath = getSteamInstallPath()
  if (!steamPath) return []
  const cacheRoot = join(steamPath, 'appcache', 'librarycache')
  const appRoot = join(cacheRoot, String(appId))
  const names =
    orientation === 'vertical'
      ? ['library_600x900_2x.jpg', 'library_600x900.jpg', 'library_capsule.jpg']
      : orientation === 'horizontal'
        ? tier === 'primary'
          ? ['library_hero.jpg']
          : tier === 'fallback'
            ? ['page_bg_generated_v6b.jpg']
            : ['library_hero.jpg', 'page_bg_generated_v6b.jpg']
        : orientation === 'logo'
          ? ['logo.png', 'library_logo.png', 'logo_2x.png']
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
    ...(orientation === 'icon' ? [join(cacheRoot, `${appId}_icon.jpg`)] : []),
    ...(orientation === 'logo'
      ? [join(cacheRoot, `${appId}_logo.png`), join(cacheRoot, `${appId}_library_logo.png`)]
      : [])
  ]
}

function steamCdnCandidates(
  appId: number,
  orientation: ImageOrientation,
  tier: SteamArtworkTier = 'all'
): string[] {
  if (orientation === 'icon') return []
  if (orientation === 'logo') {
    const fastlyRoot = `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}`
    return [
      `${fastlyRoot}/library_logo.png`,
      `${fastlyRoot}/logo.png`,
      ...['library_logo.png', 'logo.png'].flatMap((path) =>
        CDN_HOSTS.map((host) => `https://${host}/steam/apps/${appId}/${path}`)
      )
    ]
  }
  if (orientation === 'horizontal') {
    const fastlyRoot = `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}`
    const primary = [
      `${fastlyRoot}/library_hero.jpg`,
      ...CDN_HOSTS.map((host) => `https://${host}/steam/apps/${appId}/library_hero.jpg`)
    ]
    const fallback = [
      `https://store.akamai.steamstatic.com/images/storepagebackground/app/${appId}`,
      ...['page_bg_generated_v6b.jpg', 'page_bg_generated.jpg'].flatMap((path) =>
        CDN_HOSTS.map((host) => `https://${host}/steam/apps/${appId}/${path}`)
      )
    ]
    return tier === 'primary' ? primary : tier === 'fallback' ? fallback : [...primary, ...fallback]
  }
  const paths =
    orientation === 'vertical'
      ? ['library_600x900_2x.jpg', 'library_600x900.jpg']
      : []
  return paths.flatMap((path) => CDN_HOSTS.map((host) => `https://${host}/steam/apps/${appId}/${path}`))
}

function providerMetadataCandidates(game: LibraryGame, orientation: ImageOrientation): string[] {
  const explicit = game.metadata.artwork?.[orientation] ?? []
  const legacy =
    orientation === 'vertical'
      ? []
      : orientation === 'horizontal'
        ? [game.metadata.backgroundUrl, game.metadata.storeHeaderUrl]
        : orientation === 'icon'
          ? [game.metadata.iconUrl]
          : []
  return [...new Set([...explicit, ...legacy].filter((url): url is string => Boolean(url)))]
}

function providerMetadataFallbackCandidates(
  game: LibraryGame,
  orientation: ImageOrientation
): string[] {
  if (orientation === 'icon') return []
  const primary = new Set(providerMetadataCandidates(game, orientation))
  const artwork = game.metadata.artwork
  const alternatives =
    orientation === 'vertical'
      ? [
          ...(artwork?.icon ?? []),
          ...(artwork?.horizontal ?? []),
          game.metadata.iconUrl,
          game.metadata.storeHeaderUrl,
          game.metadata.backgroundUrl
        ]
      : orientation === 'logo'
        ? []
        : [
            // A large Landscape slot must not silently adopt a portrait cover
            // or square icon. The keyless store lookup is the safer fallback.
          ]
  return [
    ...new Set(
      alternatives.filter(
        (url): url is string => Boolean(url) && !primary.has(url as string)
      )
    )
  ]
}

function allProviderMetadataCandidates(
  game: LibraryGame,
  orientation: ImageOrientation
): string[] {
  return [
    ...providerMetadataCandidates(game, orientation),
    ...providerMetadataFallbackCandidates(game, orientation)
  ]
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
        identity: artworkIdentitySignature(game),
        sources: allProviderMetadataCandidates(game, orientation)
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
  const libraryMatchSource = entry.libraryMatchSourceKey
    ? manifestEntries[entry.libraryMatchSourceKey]
    : undefined
  return (
    !isEntryFresh(entry) ||
    (entry.source !== 'none' && !isEntryUsable(entry)) ||
    entry.pipelineVersion !== PIPELINE_VERSION ||
    entry.artworkFingerprint !== fingerprint ||
    (entry.source === 'library-match' &&
      (!libraryMatchSource ||
        libraryMatchSource.source === 'library-match' ||
        !isEntryUsable(libraryMatchSource) ||
        libraryMatchSource.pipelineVersion !== PIPELINE_VERSION ||
        libraryMatchSource.revision !== entry.libraryMatchSourceRevision))
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

function qualityUpgradeRetryState(
  previous: ManifestEntry | undefined,
  currentArtworkFingerprint: string
): {
  failureCount: number
  retryAt: number
} {
  const previousFailures =
    previous?.quality === 'low' && previous.artworkFingerprint === currentArtworkFingerprint
      ? previous.failureCount ?? 0
      : 0
  const failureCount = previousFailures + 1
  const delay = Math.min(
    QUALITY_UPGRADE_RETRY_BASE_MS * 2 ** Math.max(0, failureCount - 1),
    QUALITY_UPGRADE_RETRY_MAX_MS
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

function localProviderMetadataFallbackCandidates(
  game: LibraryGame,
  orientation: ImageOrientation
): string[] {
  return providerMetadataFallbackCandidates(game, orientation).filter((url) => url.startsWith('file:'))
}

function remoteProviderMetadataFallbackCandidates(
  game: LibraryGame,
  orientation: ImageOrientation
): string[] {
  return providerMetadataFallbackCandidates(game, orientation).filter((url) => url.startsWith('https://'))
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
  private knownGamesById = new Map<string, LibraryGame>()
  private knownGameIdsByProvider = new Map<string, Set<string>>()
  private knownGamesByTitle = new Map<string, LibraryGame[]>()
  private artworkRetryTimer: ReturnType<typeof setTimeout> | undefined
  private artworkRetryWakeAt: number | undefined
  private maintenanceGeneration = 0

  constructor() {
    super()
    app.on('before-quit', () => this.clearArtworkRetryTimer())
  }

  async clearAutomaticCache(): Promise<ArtworkMaintenanceResult> {
    this.maintenanceGeneration++
    this.queue = []
    this.pending.clear()
    this.clearArtworkRetryTimer()
    for (const provider of new Set(this.syncProviderByKey.values())) {
      syncCoordinator.complete('artwork', provider, provider)
    }
    this.syncKeys.clear()
    this.completedSyncKeys.clear()
    this.syncProviderByKey.clear()
    this.syncTotalsByProvider.clear()
    this.syncCompletedByProvider.clear()
    clearSteamGridDbCache()
    clearArtworkDiscoveryCaches()

    const clearedEntries = Object.keys(manifestEntries).length
    for (const key of Object.keys(manifestEntries)) delete manifestEntries[key]
    persistManifestEntries()

    let clearedFiles = 0
    let freedBytes = 0
    let cacheReadError: unknown
    try {
      ensureCacheDir()
      const files = await readdir(CACHE_DIR, { withFileTypes: true })
      for (const file of files) {
        if (!file.isFile() || !GENERATED_CACHE_FILE.test(file.name)) continue
        const filePath = join(CACHE_DIR, file.name)
        const fileStats = await stat(filePath).catch(() => null)
        try {
          await unlink(filePath)
          clearedFiles++
          freedBytes += fileStats?.size ?? 0
        } catch {
          // Concurrent artwork workers and antivirus scanners may briefly own a
          // file. Unreferenced leftovers are removed by the orphan cleanup.
        }
      }
    } catch (error) {
      cacheReadError = error
    }

    this.emit('invalidated')
    if (cacheReadError) throw cacheReadError
    return { clearedEntries, clearedFiles, freedBytes, queuedAssets: 0 }
  }

  async reloadAll(games: Iterable<LibraryGame>): Promise<ArtworkMaintenanceResult> {
    const uniqueGames = [...new Map([...games].map((game) => [game.id, game])).values()]
    const result = await this.clearAutomaticCache()
    this.syncLibrary(uniqueGames)
    return {
      ...result,
      queuedAssets: uniqueGames.length * ARTWORK_ORIENTATIONS.length
    }
  }

  beginSyncSession(): void {
    this.clearArtworkRetryTimer()
    this.syncKeys.clear()
    this.completedSyncKeys.clear()
    this.syncProviderByKey.clear()
    this.syncTotalsByProvider.clear()
    this.syncCompletedByProvider.clear()
    this.knownGamesById.clear()
    this.knownGameIdsByProvider.clear()
    this.knownGamesByTitle.clear()
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
    const providerGames = [...games].filter((game) => game.provider === provider)
    this.rememberProviderGames(providerGames, provider)
    // Fill the library's visible covers first. Backgrounds, logos and icons
    // follow in later queue slices so large libraries improve progressively.
    const targets = [
      ...providerGames.map((game) => ({ game, orientation: 'vertical' as const })),
      ...providerGames.map((game) => ({ game, orientation: 'horizontal' as const })),
      ...providerGames.map((game) => ({ game, orientation: 'logo' as const })),
      ...providerGames.map((game) => ({ game, orientation: 'icon' as const }))
    ]
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
      // Artwork currently visible in Home/details jumps ahead of the bulk
      // background queue so a pipeline migration is perceptible immediately.
      this.schedule(game, orientation, false, true)
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
    this.scheduleLibraryMatchDependents(key, undefined)
    if (fileName) void unlink(join(CACHE_DIR, fileName)).catch(() => undefined)
    this.schedule(game, orientation, true, true)
  }

  private schedule(
    game: LibraryGame,
    orientation: ImageOrientation,
    force = false,
    priority = false
  ): void {
    const key = artworkKey(game.id, orientation)
    const existing = this.pending.get(key)
    if (existing) {
      const changed =
        artworkFingerprint(existing.game, orientation) !== artworkFingerprint(game, orientation)
      existing.game = game
      if (changed || force) existing.generation++
      if (priority) {
        const queueIndex = this.queue.indexOf(existing)
        if (queueIndex > 0) {
          this.queue.splice(queueIndex, 1)
          this.queue.unshift(existing)
        }
      }
      return
    }
    const item: QueueItem = { game, orientation, generation: 0 }
    this.pending.set(key, item)
    if (priority) {
      this.queue.unshift(item)
    } else if (game.metadataSource === 'orbit-store') {
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
      const maintenanceGeneration = this.maintenanceGeneration
      this.active++
      void this.refresh(
        item.game,
        item.orientation,
        () =>
          item.generation === generation &&
          maintenanceGeneration === this.maintenanceGeneration
      )
        .catch(() => undefined)
        .finally(() => {
          this.active--
          if (
            maintenanceGeneration !== this.maintenanceGeneration ||
            this.pending.get(key) !== item
          ) {
            this.pump()
            return
          }
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
    const currentArtworkFingerprint = artworkFingerprint(game, orientation)
    const previous = manifestEntries[key]
    let transientFailure = false
    let bestFallback: ManifestEntry | undefined =
      previous &&
      isEntryUsable(previous) &&
      previous.source !== 'library-match' &&
      !(orientation !== 'icon' && previous.source === 'local-icon') &&
      !(
        previous.source === 'libretro' &&
        previous.pipelineVersion < LIBRETRO_ARTWORK_ROLE_POLICY_VERSION
      )
        ? {
            ...previous,
            // Version 6 stored every cross-orientation image as "contain".
            // Correct that presentation immediately while the worker checks
            // whether a better exact-title asset is available.
            contain:
              previous.pipelineVersion >= LIBRETRO_ARTWORK_ROLE_POLICY_VERSION
                ? previous.contain
                : orientation === 'icon' || orientation === 'logo',
            // Quality thresholds evolve with the pipeline. Never carry an old
            // classification across versions just because the cached pixels
            // remain usable as a visual fallback.
            quality: automaticArtworkQuality(previous.width, previous.height, orientation)
          }
        : undefined

    const fallbackScore = (entry: Pick<ManifestEntry, 'width' | 'height'>): number =>
      automaticArtworkScore(entry.width, entry.height, orientation)
    const libretroRank = (entry: ManifestEntry): number =>
      entry.source === 'libretro' && entry.libretroFolder
        ? libretroArtworkFolderPriority(orientation, entry.libretroFolder)
        : -1
    const isBetterFallback = (candidate: ManifestEntry, current: ManifestEntry): boolean => {
      if (candidate.source === 'libretro' && current.source === 'libretro') {
        const candidateRank = libretroRank(candidate)
        const currentRank = libretroRank(current)
        if (candidateRank >= 0 && currentRank >= 0 && candidateRank !== currentRank) {
          return candidateRank < currentRank
        }
        if (candidateRank >= 0 && currentRank < 0) return true
        if (candidateRank < 0 && currentRank >= 0) return false
      }
      return (
        (candidate.quality === 'high' && current.quality !== 'high') ||
        (candidate.quality === current.quality && fallbackScore(candidate) > fallbackScore(current))
      )
    }

    const acceptLibraryMatch = (match: LibraryArtworkMatch): boolean => {
      if (!isCurrent()) return true
      const { entry } = match
      const adopted: ManifestEntry = {
        ...entry,
        contain: entry.contain,
        quality: automaticArtworkQuality(entry.width, entry.height, orientation),
        resolvedAt: Date.now(),
        revision: nextRevision(),
        source: 'library-match',
        pipelineVersion: PIPELINE_VERSION,
        metadataRevision: game.metadataRevision,
        artworkFingerprint: currentArtworkFingerprint,
        retryAt: undefined,
        failureCount: undefined,
        libraryMatchSourceKey: match.sourceKey,
        libraryMatchSourceRevision: match.sourceRevision,
        libretroFolder: undefined
      }
      if (adopted.quality === 'high') {
        this.rememberAndEmit(key, game.id, orientation, adopted)
        return true
      }
      if (!bestFallback || isBetterFallback(adopted, bestFallback)) {
        const retry = qualityUpgradeRetryState(previous, currentArtworkFingerprint)
        const fallback: ManifestEntry = {
          ...adopted,
          retryAt: retry.retryAt,
          failureCount: retry.failureCount
        }
        bestFallback = fallback
        this.rememberAndEmit(key, game.id, orientation, fallback)
      }
      return false
    }

    const acceptValidated = async (
      validated: ValidatedImage,
      source: ArtworkSource,
      libretroFolder?: LibretroArtworkFolder,
      forceFallback = false
    ): Promise<boolean> => {
      if (!isCurrent()) return true
      const entry = await persistImage(game, orientation, validated, source, libretroFolder)
      if (!isCurrent()) return true
      if (entry.quality === 'high' && !forceFallback) {
        this.rememberAndEmit(key, game.id, orientation, entry)
        return true
      }
      if (!bestFallback || isBetterFallback(entry, bestFallback)) {
        const retry = forceFallback
          ? transientRetryState(previous)
          : qualityUpgradeRetryState(previous, currentArtworkFingerprint)
        const fallback: ManifestEntry = {
          ...entry,
          retryAt: retry.retryAt,
          failureCount: retry.failureCount
        }
        bestFallback = fallback
        // A usable thumbnail appears immediately, while this same worker keeps
        // searching the remaining sources for a high-resolution replacement.
        this.rememberAndEmit(key, game.id, orientation, fallback)
      }
      return false
    }

    if (game.provider === 'steam' && game.appId) {
      const steamAppId = game.appId
      const tryLocalSteam = async (tier: SteamArtworkTier = 'all'): Promise<boolean> => {
        for (const localPath of localSteamCandidates(steamAppId, orientation, tier)) {
          if (!existsSync(localPath)) continue
          const validated = await validateLocalFile(localPath, orientation)
          if (!validated) continue
          if (await acceptValidated(validated, 'steam-local')) return true
        }
        return false
      }
      const tryRemoteSteam = async (tier: SteamArtworkTier = 'all'): Promise<boolean> => {
        for (const remoteUrl of steamCdnCandidates(steamAppId, orientation, tier)) {
          const result = await downloadValidated(remoteUrl, orientation)
          if (result.state === 'unavailable') {
            transientFailure = true
            continue
          }
          if (result.state === 'missing') continue
          if (await acceptValidated(result.value, 'steam-cdn')) return true
        }
        return false
      }

      // Steam's library hero is the purpose-built, visually rich background
      // asset. Prefer Steam's local offline copy before the current CDN copy;
      // subdued store-page backgrounds remain a separate fallback tier.
      if (orientation === 'horizontal') {
        if (
          (await tryLocalSteam('primary')) ||
          (await tryRemoteSteam('primary')) ||
          (await tryLocalSteam('fallback')) ||
          (await tryRemoteSteam('fallback'))
        ) {
          return
        }
      } else if ((await tryLocalSteam()) || (await tryRemoteSteam())) {
        return
      }
    }

    for (const localUrl of localProviderMetadataCandidates(game, orientation)) {
      try {
        const localPath = fileURLToPath(localUrl)
        if (!existsSync(localPath)) continue
        const validated = await validateLocalFile(localPath, orientation, {
          allowFallback: true
        })
        if (!validated) continue
        if (await acceptValidated(validated, 'provider-metadata')) return
      } catch {
        // Invalid or inaccessible package assets simply fall through to the
        // provider's online metadata and the shared artwork fallback.
      }
    }

    for (const remoteUrl of remoteProviderMetadataCandidates(game, orientation)) {
      const result = await downloadValidated(remoteUrl, orientation, {
        allowFallback: true
      })
      if (result.state === 'unavailable') {
        transientFailure = true
        continue
      }
      if (result.state === 'missing') continue
      if (await acceptValidated(result.value, 'provider-metadata')) return
    }

    // Reuse an already cached asset only when the equal title is backed by
    // matching release year and developer evidence. This stays local without
    // confusing homonymous originals and reboots.
    const sharedEntry = this.bestLibraryMatch(game, orientation)
    if (sharedEntry && acceptLibraryMatch(sharedEntry)) return

    for (const localUrl of localProviderMetadataFallbackCandidates(game, orientation)) {
      try {
        const localPath = fileURLToPath(localUrl)
        if (!existsSync(localPath)) continue
        const validated = await validateLocalFile(localPath, orientation, {
          allowFallback: true
        })
        if (!validated) continue
        if (await acceptValidated(validated, 'provider-metadata')) return
      } catch {
        // Cross-orientation provider candidates are opportunistic only.
      }
    }

    for (const remoteUrl of remoteProviderMetadataFallbackCandidates(game, orientation)) {
      const result = await downloadValidated(remoteUrl, orientation, {
        allowFallback: true
      })
      if (result.state === 'unavailable') {
        transientFailure = true
        continue
      }
      if (result.state === 'missing') continue
      if (await acceptValidated(result.value, 'provider-metadata')) return
    }

    let libretroHigherRoleUnavailable = false
    for (const folder of libretroArtworkFolders(orientation)) {
      const discovered = await discoverLibretroArtwork(game, folder)
      if (discovered.state === 'unavailable') {
        transientFailure = true
        break
      }
      if (discovered.state === 'missing') continue
      const result = await downloadValidated(discovered.value, orientation, {
        allowFallback: true,
        containFallback: orientation === 'vertical' && folder === 'Named_Boxarts'
      })
      if (result.state === 'unavailable') {
        transientFailure = true
        libretroHigherRoleUnavailable = true
        continue
      }
      if (result.state === 'missing') continue
      if (
        await acceptValidated(
          result.value,
          'libretro',
          folder,
          libretroHigherRoleUnavailable
        )
      ) {
        return
      }
      // Folder order is a semantic preference, not a pool of interchangeable
      // pixels. Once a valid asset exists for the best available role, lower
      // roles must not replace it merely because their aspect score is higher.
      break
    }

    if (orientation !== 'icon') {
      const discovered = await discoverExactStoreArtwork(game)
      if (discovered.state === 'unavailable') {
        transientFailure = true
      } else if (discovered.state === 'success') {
        for (const remoteUrl of discovered.value[orientation]) {
          const result = await downloadValidated(remoteUrl, orientation)
          if (result.state === 'unavailable') {
            transientFailure = true
            continue
          }
          if (result.state === 'missing') continue
          if (await acceptValidated(result.value, 'store-fallback')) return
        }
      }
    }

    if (orientation !== 'icon') {
      const gridDbKey = steamGridDbCredentials.getToken() || getBuiltinSteamGridDbKey()
      if (gridDbKey) {
        const steamAppId = game.provider === 'steam' ? game.appId : undefined
        const gridResult = await fetchSteamGridDbArtworkCandidates(
          steamAppId,
          gridDbKey,
          game.name,
          orientation
        )
        if (gridResult.state === 'unavailable') {
          transientFailure = true
        } else if (gridResult.state === 'success') {
          // A community result can disappear independently of the search API.
          // Try a small ranked set instead of letting one stale first asset
          // suppress every valid alternative.
          for (const candidate of gridResult.value.slice(0, 4)) {
            const result = await downloadValidated(candidate.downloadUrl, orientation)
            if (result.state === 'unavailable') {
              transientFailure = true
              continue
            }
            if (
              result.state === 'success' &&
              (await acceptValidated(result.value, 'steamgriddb'))
            ) {
              return
            }
          }
        }
      }
    }

    if (!bestFallback && orientation === 'icon' && game.installed && game.installDir) {
      const iconDataUrl = await resolveLocalIconDataUrl(game.installDir)
      if (iconDataUrl) {
        const icon = nativeImage.createFromDataURL(iconDataUrl)
        const { width, height } = icon.getSize()
        const quality = automaticArtworkQuality(width, height, orientation)
        const retry =
          quality === 'low'
            ? qualityUpgradeRetryState(previous, currentArtworkFingerprint)
            : undefined
        const entry: ManifestEntry = {
          url: iconDataUrl,
          contain: true,
          width,
          height,
          resolvedAt: Date.now(),
          revision: nextRevision(),
          source: 'local-icon',
          quality,
          pipelineVersion: PIPELINE_VERSION,
          metadataRevision: game.metadataRevision,
          artworkFingerprint: currentArtworkFingerprint,
          retryAt: retry?.retryAt,
          failureCount: retry?.failureCount
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
      const retry = transientFailure
        ? transientRetryState(previous)
        : bestFallback.quality === 'low'
          ? qualityUpgradeRetryState(previous, currentArtworkFingerprint)
          : undefined
      this.rememberAndEmit(key, game.id, orientation, {
        ...bestFallback,
        resolvedAt: Date.now(),
        // A preserved pixel can still represent a new metadata/identity
        // decision. Advance the revision so library-match dependents recheck
        // their evidence even when no replacement download succeeded.
        revision: nextRevision(),
        pipelineVersion: PIPELINE_VERSION,
        metadataRevision: game.metadataRevision,
        artworkFingerprint: currentArtworkFingerprint,
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
      artworkFingerprint: currentArtworkFingerprint,
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
    this.scheduleLibraryMatchDependents(key, entry.revision)
    this.planArtworkRetryWake()
  }

  private scheduleLibraryMatchDependents(
    sourceKey: string,
    sourceRevision: number | undefined
  ): void {
    for (const game of this.knownGamesById.values()) {
      for (const orientation of ARTWORK_ORIENTATIONS) {
        const dependentKey = artworkKey(game.id, orientation)
        if (dependentKey === sourceKey) continue
        const dependent = manifestEntries[dependentKey]
        if (
          dependent?.source !== 'library-match' ||
          dependent.libraryMatchSourceKey !== sourceKey ||
          (sourceRevision !== undefined &&
            dependent.libraryMatchSourceRevision === sourceRevision)
        ) {
          continue
        }
        this.schedule(game, orientation, true)
      }
    }
  }

  private rememberProviderGames(games: LibraryGame[], provider: string): void {
    for (const id of this.knownGameIdsByProvider.get(provider) ?? []) {
      this.knownGamesById.delete(id)
    }
    const nextIds = new Set<string>()
    for (const game of games) {
      this.knownGamesById.set(game.id, game)
      nextIds.add(game.id)
    }
    this.knownGameIdsByProvider.set(provider, nextIds)

    const byTitle = new Map<string, LibraryGame[]>()
    for (const game of this.knownGamesById.values()) {
      const title = canonicalArtworkTitle(game.name)
      if (!title) continue
      const matches = byTitle.get(title) ?? []
      matches.push(game)
      byTitle.set(title, matches)
    }
    this.knownGamesByTitle = byTitle
    this.planArtworkRetryWake()
  }

  private bestLibraryMatch(
    game: LibraryGame,
    orientation: ImageOrientation
  ): LibraryArtworkMatch | undefined {
    const matches = this.knownGamesByTitle.get(canonicalArtworkTitle(game.name)) ?? []
    let best: LibraryArtworkMatch | undefined
    for (const match of matches) {
      if (match.id === game.id || !shareArtworkIdentity(game, match)) continue
      const sourceKey = artworkKey(match.id, orientation)
      const entry = manifestEntries[sourceKey]
      if (
        !entry ||
        !isEntryUsable(entry) ||
        entry.source === 'library-match' ||
        entry.pipelineVersion !== PIPELINE_VERSION ||
        entry.artworkFingerprint !== artworkFingerprint(match, orientation)
      ) {
        continue
      }
      const candidate: ManifestEntry = {
        ...entry,
        quality: automaticArtworkQuality(entry.width, entry.height, orientation)
      }
      if (
        !best ||
        (candidate.quality === 'high' && best.entry.quality !== 'high') ||
        (candidate.quality === best.entry.quality &&
          automaticArtworkScore(candidate.width, candidate.height, orientation) >
            automaticArtworkScore(best.entry.width, best.entry.height, orientation))
      ) {
        best = {
          entry: candidate,
          sourceKey,
          sourceRevision: entry.revision
        }
      }
    }
    return best
  }

  private clearArtworkRetryTimer(): void {
    if (this.artworkRetryTimer) clearTimeout(this.artworkRetryTimer)
    this.artworkRetryTimer = undefined
    this.artworkRetryWakeAt = undefined
  }

  private planArtworkRetryWake(): void {
    let nextRetryAt: number | undefined
    for (const game of this.knownGamesById.values()) {
      for (const orientation of ARTWORK_ORIENTATIONS) {
        const entry = manifestEntries[artworkKey(game.id, orientation)]
        // `retryAt` covers quality upgrades, transient provider failures and
        // negative entries. All of them need a wake even when no view asks for
        // the artwork again in the meantime.
        if (entry?.retryAt === undefined) continue
        nextRetryAt = Math.min(nextRetryAt ?? entry.retryAt, entry.retryAt)
      }
    }
    if (nextRetryAt === undefined) {
      this.clearArtworkRetryTimer()
      return
    }
    if (
      this.artworkRetryTimer &&
      this.artworkRetryWakeAt !== undefined &&
      this.artworkRetryWakeAt <= nextRetryAt
    ) {
      return
    }
    this.clearArtworkRetryTimer()
    this.artworkRetryWakeAt = nextRetryAt
    this.artworkRetryTimer = setTimeout(
      () => this.wakeArtworkRetries(),
      Math.max(1_000, nextRetryAt - Date.now())
    )
    this.artworkRetryTimer.unref()
  }

  private wakeArtworkRetries(): void {
    this.artworkRetryTimer = undefined
    this.artworkRetryWakeAt = undefined
    const now = Date.now()
    let scheduled = false
    for (const game of this.knownGamesById.values()) {
      for (const orientation of ARTWORK_ORIENTATIONS) {
        const entry = manifestEntries[artworkKey(game.id, orientation)]
        if (entry?.retryAt === undefined || entry.retryAt > now) {
          continue
        }
        this.schedule(game, orientation)
        scheduled = true
      }
    }
    if (!scheduled) {
      this.planArtworkRetryWake()
      return
    }
    // A refresh normally installs a new retry time. This bounded safety wake
    // also recovers if a worker exits unexpectedly before persisting a result.
    this.artworkRetryWakeAt = now + TRANSIENT_RETRY_BASE_MS
    this.artworkRetryTimer = setTimeout(
      () => this.wakeArtworkRetries(),
      TRANSIENT_RETRY_BASE_MS
    )
    this.artworkRetryTimer.unref()
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
  const customArtwork = customArtworkService.resolve(game.id, orientation)
  if (customArtwork) return customArtwork
  return artworkService.resolve(game, orientation)
}
