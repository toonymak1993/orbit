import { createHash } from 'node:crypto'
import { app, dialog, nativeImage, type BrowserWindow, type NativeImage } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import Store from 'electron-store'
import { settingsStore } from './settingsStore'

const CACHE_DIR = join(app.getPath('userData'), 'artwork-v2')
const AVATAR_SIZE = 256
const MAX_SOURCE_BYTES = 10 * 1024 * 1024
const MAX_SOURCE_PIXELS = 30_000_000

interface ProfileAvatarDatabase {
  fileName?: string
}

const profileAvatarStore = new Store<ProfileAvatarDatabase>({
  name: 'orbit-profile-avatar'
})

function isSafeAvatarFileName(value: unknown): value is string {
  return typeof value === 'string' && /^profile-avatar-[a-f0-9]{16}\.png$/.test(value)
}

function toUrl(fileName: string): string {
  return `orbit-image://${fileName}`
}

function prepareAvatar(source: Buffer): NativeImage {
  if (source.byteLength === 0 || source.byteLength > MAX_SOURCE_BYTES) {
    throw new Error('Selected avatar is empty or too large')
  }
  const image = nativeImage.createFromBuffer(source)
  if (image.isEmpty()) throw new Error('Selected avatar is not a readable image')
  const { width, height } = image.getSize()
  if (width <= 0 || height <= 0 || width * height > MAX_SOURCE_PIXELS) {
    throw new Error('Selected avatar has unsupported dimensions')
  }
  const size = Math.min(width, height)
  const avatar = image
    .crop({
      x: Math.floor((width - size) / 2),
      y: Math.floor((height - size) / 2),
      width: size,
      height: size
    })
    .resize({ width: AVATAR_SIZE, height: AVATAR_SIZE, quality: 'best' })
  if (avatar.isEmpty()) throw new Error('Selected avatar could not be prepared')
  return avatar
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

class ProfileAvatarService {
  resolve(): string | null {
    const fileName = profileAvatarStore.get('fileName')
    if (!isSafeAvatarFileName(fileName)) return null
    if (existsSync(join(CACHE_DIR, fileName))) return toUrl(fileName)
    profileAvatarStore.delete('fileName')
    return null
  }

  async select(mainWindow: BrowserWindow): Promise<string | null> {
    const german = settingsStore.store.language === 'de'
    const result = await dialog.showOpenDialog(mainWindow, {
      title: german ? 'ORBIT · Avatar auswählen' : 'ORBIT · Select avatar',
      buttonLabel: german ? 'Avatar verwenden' : 'Use avatar',
      properties: ['openFile'],
      filters: [
        { name: german ? 'Bilder' : 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }
      ]
    })
    if (result.canceled || !result.filePaths[0]) return null

    const sourcePath = result.filePaths[0]
    const sourceStats = await stat(sourcePath)
    if (!sourceStats.isFile() || sourceStats.size === 0 || sourceStats.size > MAX_SOURCE_BYTES) {
      throw new Error('Selected avatar is empty or too large')
    }
    const source = await readFile(sourcePath)
    if (source.byteLength !== sourceStats.size) {
      throw new Error('Selected avatar changed while it was being read')
    }

    const buffer = prepareAvatar(source).toPNG()
    const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 16)
    const fileName = `profile-avatar-${hash}.png`
    await mkdir(CACHE_DIR, { recursive: true })
    await writeAtomically(join(CACHE_DIR, fileName), buffer)

    const previous = profileAvatarStore.get('fileName')
    profileAvatarStore.set('fileName', fileName)
    if (isSafeAvatarFileName(previous) && previous !== fileName) {
      await unlink(join(CACHE_DIR, previous)).catch(() => undefined)
    }
    return toUrl(fileName)
  }
}

export const profileAvatarService = new ProfileAvatarService()
