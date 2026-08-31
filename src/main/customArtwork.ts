import { createHash } from 'node:crypto'
import { app, clipboard, dialog, nativeImage, type BrowserWindow, type NativeImage } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import Store from 'electron-store'
import type { ImageOrientation, ResolvedImage } from '@shared/ipc'
import { settingsStore } from './settingsStore'
import { fetchWithElectronNet } from './networkFetch'
import { isSteamGridDbAssetUrl } from './steamGridDb'
import { isPublicSteamArtworkUrl } from './publicArtworkSearchPolicy'

const CACHE_DIR = join(app.getPath('userData'), 'artwork-v2')
const MAX_SOURCE_BYTES = 25 * 1024 * 1024
const MAX_SOURCE_PIXELS = 50_000_000
const REMOTE_TIMEOUT_MS = 12_000

export type CustomArtworkOrientation = ImageOrientation

const ARTWORK_TARGETS: Record<
  CustomArtworkOrientation,
  { width: number; height: number; filePrefix: string }
> = {
  vertical: { width: 600, height: 900, filePrefix: 'custom-cover-' },
  horizontal: { width: 1600, height: 900, filePrefix: 'custom-background-' },
  icon: { width: 512, height: 512, filePrefix: 'custom-icon-' }
}

interface CustomArtworkEntry {
  fileName: string
  width: number
  height: number
  revision: number
}

interface CustomArtworkDatabase {
  schemaVersion: number
  entries: Record<string, CustomArtworkEntry>
}

const customArtworkStore = new Store<CustomArtworkDatabase>({
  name: 'orbit-custom-artwork',
  defaults: { schemaVersion: 1, entries: {} }
})
const customArtworkEntries: Record<string, CustomArtworkEntry> = {
  ...customArtworkStore.get('entries')
}
let lastCustomArtworkRevision = Math.max(
  Date.now(),
  ...Object.values(customArtworkEntries).map((entry) => entry.revision || 0)
)

function nextCustomArtworkRevision(): number {
  lastCustomArtworkRevision = Math.max(Date.now(), lastCustomArtworkRevision + 1)
  return lastCustomArtworkRevision
}

function entryKey(gameId: string, orientation: CustomArtworkOrientation): string {
  // Existing vertical and horizontal keys remain untouched. Icon overrides get
  // their own namespace, so the store stays backwards compatible.
  return orientation === 'vertical' ? gameId : `${orientation}:${gameId}`
}

function isSafeFileName(
  fileName: unknown,
  orientation: CustomArtworkOrientation = 'vertical'
): fileName is string {
  return (
    typeof fileName === 'string' &&
    fileName.startsWith(ARTWORK_TARGETS[orientation].filePrefix) &&
    !fileName.includes('/') &&
    !fileName.includes('\\')
  )
}

function persistEntries(): void {
  customArtworkStore.set('entries', customArtworkEntries)
}

function toResolved(
  entry: CustomArtworkEntry,
  orientation: CustomArtworkOrientation
): ResolvedImage {
  return {
    url: `orbit-image://${entry.fileName}`,
    contain: orientation === 'icon',
    revision: entry.revision
  }
}

function normalizeArtworkImage(
  image: NativeImage,
  orientation: CustomArtworkOrientation
): NativeImage {
  const target = ARTWORK_TARGETS[orientation]
  const { width, height } = image.getSize()
  if (orientation === 'icon') {
    return width >= height
      ? image.resize({ width: target.width, quality: 'best' })
      : image.resize({ height: target.height, quality: 'best' })
  }
  const targetRatio = target.width / target.height
  const sourceRatio = width / height
  const cropWidth = sourceRatio > targetRatio ? Math.round(height * targetRatio) : width
  const cropHeight = sourceRatio > targetRatio ? height : Math.round(width / targetRatio)
  const x = Math.max(0, Math.floor((width - cropWidth) / 2))
  const y = Math.max(0, Math.floor((height - cropHeight) / 2))

  return image
    .crop({ x, y, width: cropWidth, height: cropHeight })
    .resize({ width: target.width, height: target.height, quality: 'best' })
}

async function writeAtomically(filePath: string, buffer: Buffer): Promise<void> {
  if (existsSync(filePath)) return
  const temporaryPath = `${filePath}.${process.pid}-${Date.now()}.tmp`
  try {
    await writeFile(temporaryPath, buffer, { flag: 'wx' })
    await rename(temporaryPath, filePath)
  } catch (error) {
    if (!existsSync(filePath)) throw error
  } finally {
    await unlink(temporaryPath).catch(() => undefined)
  }
}

function prepareArtwork(
  source: Buffer,
  context: string,
  orientation: CustomArtworkOrientation
): NativeImage {
  if (source.byteLength === 0 || source.byteLength > MAX_SOURCE_BYTES) {
    throw new Error(`${context} is empty or too large`)
  }
  const image = nativeImage.createFromBuffer(source)
  if (image.isEmpty()) throw new Error(`${context} is not a readable image`)
  const sourceSize = image.getSize()
  if (
    sourceSize.width <= 0 ||
    sourceSize.height <= 0 ||
    sourceSize.width * sourceSize.height > MAX_SOURCE_PIXELS
  ) {
    throw new Error(`${context} has unsupported dimensions`)
  }
  const artwork = normalizeArtworkImage(image, orientation)
  if (artwork.isEmpty()) throw new Error(`${context} could not be prepared`)
  return artwork
}

async function readResponseLimited(response: Response): Promise<Buffer> {
  const declaredSize = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredSize) && declaredSize > MAX_SOURCE_BYTES) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error('Remote artwork is too large')
  }
  if (!response.body) throw new Error('Remote artwork returned no data')

  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > MAX_SOURCE_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new Error('Remote artwork is too large')
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, totalBytes)
}

class CustomArtworkService {
  referencedFileNames(): string[] {
    return Object.values(customArtworkEntries)
      .map((entry) => entry.fileName)
      .filter(
        (fileName) =>
          isSafeFileName(fileName, 'vertical') ||
          isSafeFileName(fileName, 'horizontal') ||
          isSafeFileName(fileName, 'icon')
      )
  }

  resolve(
    gameId: string,
    orientation: CustomArtworkOrientation = 'vertical'
  ): ResolvedImage | null {
    const key = entryKey(gameId, orientation)
    const entry = customArtworkEntries[key]
    if (!entry || !isSafeFileName(entry.fileName, orientation)) return null
    if (existsSync(join(CACHE_DIR, entry.fileName))) return toResolved(entry, orientation)

    delete customArtworkEntries[key]
    persistEntries()
    return null
  }

  has(gameId: string, orientation: CustomArtworkOrientation = 'vertical'): boolean {
    return this.resolve(gameId, orientation) !== null
  }

  async select(
    mainWindow: BrowserWindow,
    gameId: string,
    orientation: CustomArtworkOrientation = 'vertical'
  ): Promise<ResolvedImage | null> {
    const german = settingsStore.store.language === 'de'
    const labels = german
      ? {
          vertical: ['ORBIT · Cover auswählen', 'Cover verwenden'],
          horizontal: ['ORBIT · Hintergrund auswählen', 'Hintergrund verwenden'],
          icon: ['ORBIT · Icon auswählen', 'Icon verwenden']
        }
      : {
          vertical: ['ORBIT · Select cover', 'Use cover'],
          horizontal: ['ORBIT · Select background', 'Use background'],
          icon: ['ORBIT · Select icon', 'Use icon']
        }
    const result = await dialog.showOpenDialog(mainWindow, {
      title: labels[orientation][0],
      buttonLabel: labels[orientation][1],
      properties: ['openFile'],
      filters: [
        { name: german ? 'Bilder' : 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
        { name: german ? 'Alle Dateien' : 'All files', extensions: ['*'] }
      ]
    })
    if (result.canceled || !result.filePaths[0]) return null

    const sourceStats = await stat(result.filePaths[0])
    if (!sourceStats.isFile() || sourceStats.size === 0 || sourceStats.size > MAX_SOURCE_BYTES) {
      throw new Error('Selected artwork is empty or too large')
    }
    const source = await readFile(result.filePaths[0])
    if (source.byteLength !== sourceStats.size) {
      throw new Error('Selected artwork changed while it was being read')
    }
    return this.persistArtwork(
      gameId,
      orientation,
      prepareArtwork(source, 'Selected artwork', orientation)
    )
  }

  async paste(
    gameId: string,
    orientation: CustomArtworkOrientation = 'vertical'
  ): Promise<ResolvedImage | null> {
    const sourceImage = clipboard.readImage()
    if (sourceImage.isEmpty()) return null
    const { width, height } = sourceImage.getSize()
    if (width <= 0 || height <= 0 || width * height > MAX_SOURCE_PIXELS) {
      throw new Error('Clipboard artwork has unsupported dimensions')
    }
    const source = sourceImage.toPNG()
    return this.persistArtwork(
      gameId,
      orientation,
      prepareArtwork(source, 'Clipboard artwork', orientation)
    )
  }

  async applySteamGridDb(
    gameId: string,
    sourceUrl: string,
    orientation: Exclude<CustomArtworkOrientation, 'icon'> = 'vertical'
  ): Promise<ResolvedImage> {
    return this.applyRemote(
      gameId,
      sourceUrl,
      orientation,
      isSteamGridDbAssetUrl,
      'SteamGridDB artwork'
    )
  }

  async applyPublicSteam(
    gameId: string,
    sourceUrl: string,
    orientation: Exclude<CustomArtworkOrientation, 'icon'> = 'vertical'
  ): Promise<ResolvedImage> {
    return this.applyRemote(
      gameId,
      sourceUrl,
      orientation,
      isPublicSteamArtworkUrl,
      'Steam Store artwork'
    )
  }

  private async applyRemote(
    gameId: string,
    sourceUrl: string,
    orientation: Exclude<CustomArtworkOrientation, 'icon'>,
    isAllowedUrl: (value: string) => boolean,
    context: string
  ): Promise<ResolvedImage> {
    if (!isAllowedUrl(sourceUrl)) throw new Error(`${context} has an unsupported URL`)
    const response = await fetchWithElectronNet(sourceUrl, {
      signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS)
    })
    if (response.url && !isAllowedUrl(response.url)) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error(`${context} redirected to an unsupported URL`)
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error(`${context} download failed (${response.status})`)
    }
    const contentType = response.headers.get('content-type')?.toLowerCase()
    if (contentType && !contentType.startsWith('image/')) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error(`${context} returned a non-image response`)
    }
    const source = await readResponseLimited(response)
    return this.persistArtwork(
      gameId,
      orientation,
      prepareArtwork(source, context, orientation)
    )
  }

  private async persistArtwork(
    gameId: string,
    orientation: CustomArtworkOrientation,
    artwork: NativeImage
  ): Promise<ResolvedImage> {
    const target = ARTWORK_TARGETS[orientation]
    const key = entryKey(gameId, orientation)
    const buffer = artwork.toPNG()
    const gameHash = createHash('sha256').update(gameId).digest('hex').slice(0, 12)
    const imageHash = createHash('sha256').update(buffer).digest('hex').slice(0, 16)
    const fileName = `${target.filePrefix}${gameHash}-${imageHash}.png`
    await mkdir(CACHE_DIR, { recursive: true })
    await writeAtomically(join(CACHE_DIR, fileName), buffer)

    const previous = customArtworkEntries[key]
    const artworkSize = artwork.getSize()
    const entry: CustomArtworkEntry = {
      fileName,
      width: artworkSize.width,
      height: artworkSize.height,
      revision: nextCustomArtworkRevision()
    }
    customArtworkEntries[key] = entry
    persistEntries()

    if (
      previous &&
      previous.fileName !== fileName &&
      isSafeFileName(previous.fileName, orientation)
    ) {
      await unlink(join(CACHE_DIR, previous.fileName)).catch(() => undefined)
    }
    return toResolved(entry, orientation)
  }

  async reset(gameId: string, expectedRevision?: number): Promise<boolean>
  async reset(
    gameId: string,
    orientation: CustomArtworkOrientation,
    expectedRevision?: number
  ): Promise<boolean>
  async reset(
    gameId: string,
    orientationOrRevision: CustomArtworkOrientation | number = 'vertical',
    expectedRevision?: number
  ): Promise<boolean> {
    const orientation =
      typeof orientationOrRevision === 'number' ? 'vertical' : orientationOrRevision
    const revision =
      typeof orientationOrRevision === 'number' ? orientationOrRevision : expectedRevision
    const key = entryKey(gameId, orientation)
    const entry = customArtworkEntries[key]
    if (!entry || (revision !== undefined && entry.revision !== revision)) {
      return false
    }

    delete customArtworkEntries[key]
    persistEntries()
    if (isSafeFileName(entry.fileName, orientation)) {
      await unlink(join(CACHE_DIR, entry.fileName)).catch(() => undefined)
    }
    return true
  }
}

export const customArtworkService = new CustomArtworkService()
