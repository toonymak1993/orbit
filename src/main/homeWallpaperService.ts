import { app, dialog, nativeImage, type BrowserWindow, type NativeImage } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { settingsStore } from './settingsStore'

const HOME_WALLPAPER_DIR = join(app.getPath('userData'), 'home-background')
const HOME_WALLPAPER_FILE = 'custom-wallpaper.jpg'
const HOME_WALLPAPER_URL = `orbit-media://${HOME_WALLPAPER_FILE}`
const MAX_SOURCE_BYTES = 32 * 1024 * 1024
const MAX_SOURCE_PIXELS = 80_000_000
const MAX_WIDTH = 3_840
const MAX_HEIGHT = 2_160

function wallpaperPath(): string {
  return join(HOME_WALLPAPER_DIR, HOME_WALLPAPER_FILE)
}

function prepareWallpaper(source: Buffer): NativeImage {
  if (source.byteLength === 0 || source.byteLength > MAX_SOURCE_BYTES) {
    throw new Error('Selected wallpaper is empty or too large')
  }

  const image = nativeImage.createFromBuffer(source)
  if (image.isEmpty()) throw new Error('Selected wallpaper is not a readable image')

  const { width, height } = image.getSize()
  if (width <= 0 || height <= 0 || width * height > MAX_SOURCE_PIXELS) {
    throw new Error('Selected wallpaper has unsupported dimensions')
  }

  const scale = Math.min(1, MAX_WIDTH / width, MAX_HEIGHT / height)
  if (scale === 1) return image

  const resized = image.resize({
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    quality: 'best'
  })
  if (resized.isEmpty()) throw new Error('Selected wallpaper could not be prepared')
  return resized
}

class HomeWallpaperService {
  resolvePath(): string | null {
    try {
      const filePath = wallpaperPath()
      const fileStats = statSync(filePath)
      return fileStats.isFile() && fileStats.size > 0 ? filePath : null
    } catch {
      return null
    }
  }

  resolveUrl(): string | null {
    try {
      const filePath = wallpaperPath()
      const fileStats = statSync(filePath)
      if (!fileStats.isFile() || fileStats.size === 0) return null
      return `${HOME_WALLPAPER_URL}?version=${Math.floor(fileStats.mtimeMs)}`
    } catch {
      return null
    }
  }

  resolveRequestPath(requestUrl: string): string | null {
    try {
      const parsed = new URL(requestUrl)
      if (
        parsed.protocol !== 'orbit-media:' ||
        parsed.hostname !== HOME_WALLPAPER_FILE ||
        (parsed.pathname !== '' && parsed.pathname !== '/')
      ) {
        return null
      }
      return this.resolvePath()
    } catch {
      return null
    }
  }

  async select(mainWindow: BrowserWindow): Promise<string | null> {
    const german = settingsStore.store.language === 'de'
    const result = await dialog.showOpenDialog(mainWindow, {
      title: german ? 'ORBIT · Home-Wallpaper auswählen' : 'ORBIT · Select Home wallpaper',
      buttonLabel: german ? 'Wallpaper verwenden' : 'Use wallpaper',
      properties: ['openFile'],
      filters: [
        { name: german ? 'Bilder' : 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }
      ]
    })
    if (result.canceled || !result.filePaths[0]) return null

    const sourcePath = result.filePaths[0]
    const sourceStats = await stat(sourcePath)
    if (!sourceStats.isFile() || sourceStats.size === 0 || sourceStats.size > MAX_SOURCE_BYTES) {
      throw new Error('Selected wallpaper is empty or too large')
    }

    const source = await readFile(sourcePath)
    if (source.byteLength !== sourceStats.size) {
      throw new Error('Selected wallpaper changed while it was being read')
    }

    const prepared = prepareWallpaper(source).toJPEG(92)
    if (prepared.byteLength === 0) throw new Error('Selected wallpaper could not be encoded')

    await mkdir(HOME_WALLPAPER_DIR, { recursive: true })
    const targetPath = wallpaperPath()
    const temporaryPath = `${targetPath}.${process.pid}-${Date.now()}.tmp`
    const backupPath = `${targetPath}.previous`
    try {
      await writeFile(temporaryPath, prepared, { flag: 'wx' })
      await unlink(backupPath).catch(() => undefined)
      if (existsSync(targetPath)) await rename(targetPath, backupPath)
      try {
        await rename(temporaryPath, targetPath)
        await unlink(backupPath).catch(() => undefined)
      } catch (error) {
        if (existsSync(backupPath) && !existsSync(targetPath)) {
          await rename(backupPath, targetPath).catch(() => undefined)
        }
        throw error
      }
    } finally {
      await unlink(temporaryPath).catch(() => undefined)
    }

    return this.resolveUrl()
  }

  async clear(): Promise<void> {
    await unlink(wallpaperPath()).catch(() => undefined)
    await unlink(`${wallpaperPath()}.previous`).catch(() => undefined)
  }
}

export const homeWallpaperService = new HomeWallpaperService()
