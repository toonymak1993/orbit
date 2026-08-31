import { app, dialog, type BrowserWindow } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { copyFile, mkdir, open, rename, stat, unlink } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { CUSTOM_STARTUP_VIDEO_URL } from '@shared/ipc'
import { settingsStore } from './settingsStore'

const STARTUP_MEDIA_DIR = join(app.getPath('userData'), 'startup-media')
const STARTUP_VIDEO_FILE = 'startup.mp4'
const MAX_SOURCE_BYTES = 256 * 1024 * 1024
const MP4_HEADER_BYTES = 4_096
const MP4_SIGNATURE = 'ftyp'

function startupVideoPath(): string {
  return join(STARTUP_MEDIA_DIR, STARTUP_VIDEO_FILE)
}

async function validateMp4(sourcePath: string): Promise<number> {
  if (extname(sourcePath).toLowerCase() !== '.mp4') {
    throw new Error('Selected startup video is not an MP4 file')
  }

  const sourceStats = await stat(sourcePath)
  if (!sourceStats.isFile() || sourceStats.size < 12 || sourceStats.size > MAX_SOURCE_BYTES) {
    throw new Error('Selected startup video is empty or too large')
  }

  const handle = await open(sourcePath, 'r')
  try {
    const header = Buffer.alloc(Math.min(MP4_HEADER_BYTES, sourceStats.size))
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    if (bytesRead < 12 || header.subarray(0, bytesRead).indexOf(MP4_SIGNATURE, 0, 'ascii') < 4) {
      throw new Error('Selected startup video is not a readable MP4 file')
    }
  } finally {
    await handle.close()
  }
  return sourceStats.size
}

class StartupVideoService {
  resolvePath(): string | null {
    const filePath = startupVideoPath()
    try {
      const fileStats = statSync(filePath)
      return fileStats.isFile() && fileStats.size > 0 && fileStats.size <= MAX_SOURCE_BYTES
        ? filePath
        : null
    } catch {
      return null
    }
  }

  resolveUrl(): string | null {
    try {
      const filePath = startupVideoPath()
      const fileStats = statSync(filePath)
      if (!fileStats.isFile() || fileStats.size === 0 || fileStats.size > MAX_SOURCE_BYTES) return null
      return `${CUSTOM_STARTUP_VIDEO_URL}?version=${Math.floor(fileStats.mtimeMs)}`
    } catch {
      return null
    }
  }

  resolveRequestPath(requestUrl: string): string | null {
    try {
      const parsed = new URL(requestUrl)
      if (
        parsed.protocol !== 'orbit-media:' ||
        parsed.hostname !== STARTUP_VIDEO_FILE ||
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
      title: german ? 'ORBIT · Startup-Video auswählen' : 'ORBIT · Select startup video',
      buttonLabel: german ? 'Video verwenden' : 'Use video',
      properties: ['openFile'],
      filters: [{ name: 'MP4 Video', extensions: ['mp4'] }]
    })
    if (result.canceled || !result.filePaths[0]) return null

    const sourcePath = result.filePaths[0]
    const sourceBytes = await validateMp4(sourcePath)
    await mkdir(STARTUP_MEDIA_DIR, { recursive: true })

    const targetPath = startupVideoPath()
    const temporaryPath = `${targetPath}.${process.pid}-${Date.now()}.tmp`
    try {
      await copyFile(sourcePath, temporaryPath)
      const copiedStats = await stat(temporaryPath)
      if (!copiedStats.isFile() || copiedStats.size !== sourceBytes) {
        throw new Error('Startup video could not be copied safely')
      }
      if (existsSync(targetPath)) await unlink(targetPath)
      await rename(temporaryPath, targetPath)
    } finally {
      await unlink(temporaryPath).catch(() => undefined)
    }

    return this.resolveUrl()
  }
}

export const startupVideoService = new StartupVideoService()
