import { createHash, randomUUID } from 'node:crypto'
import type { Dirent } from 'node:fs'
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, parse, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, dialog, nativeImage, shell, type BrowserWindow } from 'electron'
import type {
  CustomGameDraft,
  CustomGameImportSource,
  CustomGameSaveSource,
  GameMetadata,
  LibraryGame,
  LocalGameBackupResult
} from '@shared/ipc'
import {
  normalizeCustomLaunchArguments,
  parseCustomLaunchArguments
} from './customLaunchArguments'
import { settingsStore } from './settingsStore'

const DRAFT_TTL_MS = 30 * 60_000
const MAX_SCAN_DEPTH = 4
const MAX_SCANNED_ENTRIES = 3_000
const MAX_BACKUPS_PER_GAME = 10
const IGNORED_EXE_PATTERN =
  /(anti.?cheat|battleye|crash|dedicated|directx|dxsetup|helper|installer|launcher|prereq|redist|report|server|service|setup|unins|uninstall|updater|vc_redist|webhelper)/i
const IGNORED_DIRECTORY_PATTERN =
  /^(\.git|__installer|anticheat|commonredist|directx|dotnet|installer|prereq|redist|support|uninstall|vcredist)$/i
const GENERIC_EXECUTABLE_PATTERN = /^(app|client|game|launcher|play|start|win64)$/i

interface PendingDraft extends CustomGameDraft {
  artworkPath?: string
  touchedAt: number
}

export interface LocalGameRecordInput {
  providerGameId: string
  name: string
  executablePath: string
  installDir: string
  launchArguments?: string[]
  savePath?: string
  metadata: GameMetadata
}

interface ExecutableCandidate {
  path: string
  size: number
  depth: number
}

type ArtworkImage = ReturnType<typeof nativeImage.createFromPath>

function isGerman(): boolean {
  return settingsStore.store.language === 'de'
}

function message(de: string, en: string): string {
  return isGerman() ? de : en
}

function cleanGameName(executablePath: string, installDir: string): string {
  const executableName = parse(executablePath).name
    .replace(/[-_. ]+(shipping|win32|win64|x64|x86|dx11|dx12)$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const directoryName = basename(installDir).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
  const candidate = GENERIC_EXECUTABLE_PATTERN.test(executableName) ? directoryName : executableName
  return candidate || directoryName || message('Eigenes Spiel', 'Custom game')
}

function scoreExecutable(candidate: ExecutableCandidate, installDir: string): number {
  const executableName = parse(candidate.path).name.toLocaleLowerCase('en-US')
  const directoryName = basename(installDir)
    .replace(/[^a-z0-9]/gi, '')
    .toLocaleLowerCase('en-US')
  const comparableName = executableName.replace(/[^a-z0-9]/gi, '')
  const nameAffinity =
    directoryName.length >= 3 &&
    (comparableName.includes(directoryName) || directoryName.includes(comparableName))
      ? 260
      : 0
  const visibleGameName = GENERIC_EXECUTABLE_PATTERN.test(executableName) ? -80 : 0
  const sizeScore = Math.min(320, candidate.size / (1024 * 1024))
  return nameAffinity + visibleGameName + sizeScore - candidate.depth * 4
}

async function findMainExecutable(installDir: string): Promise<string | null> {
  const candidates: ExecutableCandidate[] = []
  let scannedEntries = 0

  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > MAX_SCAN_DEPTH || scannedEntries >= MAX_SCANNED_ENTRIES) return
    let entries: Dirent<string>[]
    try {
      entries = await readdir(directory, { withFileTypes: true, encoding: 'utf8' })
    } catch {
      return
    }

    for (const entry of entries) {
      if (++scannedEntries > MAX_SCANNED_ENTRIES) return
      const entryPath = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORY_PATTERN.test(entry.name)) await walk(entryPath, depth + 1)
        continue
      }
      if (!entry.isFile() || extname(entry.name).toLocaleLowerCase('en-US') !== '.exe') continue
      if (IGNORED_EXE_PATTERN.test(entry.name)) continue
      try {
        candidates.push({ path: entryPath, size: (await stat(entryPath)).size, depth })
      } catch {
        // Files can disappear while a launcher updates; keep scanning the folder.
      }
    }
  }

  await walk(installDir, 0)
  candidates.sort((left, right) => scoreExecutable(right, installDir) - scoreExecutable(left, installDir))
  return candidates[0]?.path ?? null
}

async function validatedExecutable(value: string): Promise<string> {
  const resolved = await realpath(value)
  const info = await stat(resolved)
  if (!info.isFile() || extname(resolved).toLocaleLowerCase('en-US') !== '.exe') {
    throw new Error(message('Die ausgewählte Datei ist keine ausführbare EXE.', 'The selected file is not an executable.'))
  }
  return resolved
}

async function iconPreview(executablePath: string): Promise<string | undefined> {
  try {
    const icon = await app.getFileIcon(executablePath, { size: 'large' })
    return icon.isEmpty() ? undefined : icon.toDataURL()
  } catch {
    return undefined
  }
}

function centerCrop(image: ArtworkImage, width: number, height: number): ArtworkImage {
  const size = image.getSize()
  const targetRatio = width / height
  const sourceRatio = size.width / size.height
  let cropWidth = size.width
  let cropHeight = size.height
  let x = 0
  let y = 0

  if (sourceRatio > targetRatio) {
    cropWidth = Math.max(1, Math.round(size.height * targetRatio))
    x = Math.max(0, Math.floor((size.width - cropWidth) / 2))
  } else if (sourceRatio < targetRatio) {
    cropHeight = Math.max(1, Math.round(size.width / targetRatio))
    y = Math.max(0, Math.floor((size.height - cropHeight) / 2))
  }

  return image.crop({ x, y, width: cropWidth, height: cropHeight }).resize({
    width,
    height,
    quality: 'best'
  })
}

async function writeImage(destination: string, image: ArtworkImage): Promise<void> {
  const temporary = `${destination}.partial-${randomUUID()}`
  await writeFile(temporary, image.toPNG())
  await rm(destination, { force: true })
  await rename(temporary, destination)
}

async function persistArtwork(
  gameId: string,
  executablePath: string,
  selectedArtworkPath?: string
): Promise<GameMetadata> {
  const artworkDirectory = join(app.getPath('userData'), 'custom-library', gameId)
  await mkdir(artworkDirectory, { recursive: true })
  const artwork: NonNullable<GameMetadata['artwork']> = {}

  if (selectedArtworkPath) {
    const selected = nativeImage.createFromPath(selectedArtworkPath)
    if (selected.isEmpty()) {
      throw new Error(message('Das ausgewählte Bild konnte nicht gelesen werden.', 'The selected image could not be read.'))
    }
    const verticalPath = join(artworkDirectory, 'cover.png')
    const horizontalPath = join(artworkDirectory, 'hero.png')
    const iconPath = join(artworkDirectory, 'icon.png')
    await Promise.all([
      writeImage(verticalPath, centerCrop(selected, 600, 900)),
      writeImage(horizontalPath, centerCrop(selected, 1600, 900)),
      writeImage(iconPath, centerCrop(selected, 256, 256))
    ])
    artwork.vertical = [pathToFileURL(verticalPath).href]
    artwork.horizontal = [pathToFileURL(horizontalPath).href]
    artwork.icon = [pathToFileURL(iconPath).href]
  } else {
    try {
      const icon = await app.getFileIcon(executablePath, { size: 'large' })
      if (!icon.isEmpty()) {
        const iconPath = join(artworkDirectory, 'icon.png')
        await writeImage(iconPath, icon.resize({ width: 256, height: 256, quality: 'best' }))
        artwork.icon = [pathToFileURL(iconPath).href]
      }
    } catch {
      // The shared artwork pipeline still provides a name-based fallback.
    }
  }

  return Object.keys(artwork).length > 0
    ? {
        artwork,
        iconUrl: artwork.icon?.[0]
      }
    : {}
}

function requireDraft(drafts: Map<string, PendingDraft>, draftId: string): PendingDraft {
  const draft = drafts.get(draftId)
  if (!draft || Date.now() - draft.touchedAt > DRAFT_TTL_MS) {
    drafts.delete(draftId)
    throw new Error(message('Diese Auswahl ist abgelaufen. Bitte wähle das Spiel erneut.', 'This selection expired. Please choose the game again.'))
  }
  draft.touchedAt = Date.now()
  return draft
}

function publicDraft(draft: PendingDraft): CustomGameDraft {
  const { artworkPath: _artworkPath, touchedAt: _touchedAt, ...output } = draft
  return output
}

function safeBackupDirectoryName(game: LibraryGame): string {
  return createHash('sha256').update(game.id).digest('hex').slice(0, 24)
}

function sameOrInside(parent: string, child: string): boolean {
  const pathFromParent = relative(resolve(parent), resolve(child))
  return pathFromParent === '' || (!pathFromParent.startsWith('..') && !isAbsolute(pathFromParent))
}

export class CustomLibraryService {
  private readonly drafts = new Map<string, PendingDraft>()

  async beginImport(
    mainWindow: BrowserWindow,
    source: CustomGameImportSource
  ): Promise<CustomGameDraft | null> {
    const folder = source === 'folder'
    const result = await dialog.showOpenDialog(mainWindow, {
      title: folder
        ? message('ORBIT · Spieleordner auswählen', 'ORBIT · Select game folder')
        : message('ORBIT · Spiel-EXE auswählen', 'ORBIT · Select game executable'),
      buttonLabel: message('Spiel erkennen', 'Detect game'),
      properties: folder ? ['openDirectory'] : ['openFile'],
      filters: folder ? undefined : [{ name: 'Windows games', extensions: ['exe'] }]
    })
    if (result.canceled || !result.filePaths[0]) return null

    const selectedPath = await realpath(result.filePaths[0])
    const executablePath = folder
      ? await findMainExecutable(selectedPath)
      : await validatedExecutable(selectedPath)
    if (!executablePath) {
      throw new Error(message('In diesem Ordner wurde keine passende Spiel-EXE gefunden.', 'No suitable game executable was found in this folder.'))
    }

    const validatedPath = await validatedExecutable(executablePath)
    const installDir = folder ? selectedPath : dirname(validatedPath)
    const draft: PendingDraft = {
      id: randomUUID(),
      name: cleanGameName(validatedPath, installDir),
      executablePath: validatedPath,
      installDir,
      iconPreviewUrl: await iconPreview(validatedPath),
      touchedAt: Date.now()
    }
    this.drafts.set(draft.id, draft)
    return publicDraft(draft)
  }

  async selectArtwork(mainWindow: BrowserWindow, draftId: string): Promise<CustomGameDraft | null> {
    const draft = requireDraft(this.drafts, draftId)
    const result = await dialog.showOpenDialog(mainWindow, {
      title: message('ORBIT · Cover auswählen', 'ORBIT · Select cover'),
      buttonLabel: message('Bild verwenden', 'Use image'),
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }]
    })
    if (result.canceled || !result.filePaths[0]) return null
    const artworkPath = await realpath(result.filePaths[0])
    const artwork = nativeImage.createFromPath(artworkPath)
    if (artwork.isEmpty()) {
      throw new Error(message('Das ausgewählte Bild konnte nicht gelesen werden.', 'The selected image could not be read.'))
    }
    draft.artworkPath = artworkPath
    draft.artworkPreviewUrl = artwork.toDataURL()
    return publicDraft(draft)
  }

  async selectSave(
    mainWindow: BrowserWindow,
    draftId: string,
    source: CustomGameSaveSource
  ): Promise<CustomGameDraft | null> {
    const draft = requireDraft(this.drafts, draftId)
    const folder = source === 'folder'
    const result = await dialog.showOpenDialog(mainWindow, {
      title: folder
        ? message('ORBIT · Savegame-Ordner auswählen', 'ORBIT · Select save folder')
        : message('ORBIT · Savegame-Datei auswählen', 'ORBIT · Select save file'),
      buttonLabel: message('Für Backups verwenden', 'Use for backups'),
      properties: folder ? ['openDirectory'] : ['openFile']
    })
    if (result.canceled || !result.filePaths[0]) return null
    draft.savePath = await realpath(result.filePaths[0])
    return publicDraft(draft)
  }

  clearSave(draftId: string): CustomGameDraft {
    const draft = requireDraft(this.drafts, draftId)
    draft.savePath = undefined
    return publicDraft(draft)
  }

  cancel(draftId: string): void {
    this.drafts.delete(draftId)
  }

  async commit(
    draftId: string,
    requestedName: string,
    requestedLaunchArguments?: string
  ): Promise<LocalGameRecordInput> {
    const draft = requireDraft(this.drafts, draftId)
    const name = requestedName.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').trim()
    if (!name || name.length > 120) {
      throw new Error(message('Der Spielname muss zwischen 1 und 120 Zeichen lang sein.', 'The game name must be between 1 and 120 characters.'))
    }

    const executablePath = await validatedExecutable(draft.executablePath)
    const launchArguments = parseCustomLaunchArguments(
      normalizeCustomLaunchArguments(requestedLaunchArguments)
    )
    if (draft.savePath) await lstat(draft.savePath)
    // Local entries use a durable identity independent of mutable launch
    // options. This also lets one launcher EXE represent several mod profiles.
    const id = draft.id
    const metadata = await persistArtwork(id, executablePath, draft.artworkPath)
    this.drafts.delete(draftId)
    return {
      providerGameId: id,
      name,
      executablePath,
      installDir: draft.installDir,
      launchArguments: launchArguments.length > 0 ? launchArguments : undefined,
      savePath: draft.savePath,
      metadata
    }
  }

  async backup(game: LibraryGame): Promise<LocalGameBackupResult> {
    const completedAt = Date.now()
    const local = game.local
    if (game.provider !== 'local' || !local?.backupEnabled || !local.savePath) {
      return { state: 'skipped', completedAt }
    }

    const backupRoot = join(app.getPath('userData'), 'save-backups', safeBackupDirectoryName(game))
    const timestamp = new Date(completedAt).toISOString().replace(/[:.]/g, '-')
    const finalDirectory = join(backupRoot, timestamp)
    const temporaryDirectory = `${finalDirectory}.partial-${randomUUID()}`

    try {
      const sourcePath = await realpath(local.savePath)
      const sourceInfo = await lstat(sourcePath)
      if (
        sourceInfo.isDirectory() &&
        (sameOrInside(sourcePath, backupRoot) || sameOrInside(backupRoot, sourcePath))
      ) {
        throw new Error('Savegame and backup directories must not contain each other')
      }
      await mkdir(temporaryDirectory, { recursive: true })
      if (sourceInfo.isDirectory()) {
        await cp(sourcePath, join(temporaryDirectory, basename(sourcePath)), {
          recursive: true,
          force: false,
          errorOnExist: true,
          verbatimSymlinks: true
        })
      } else if (sourceInfo.isFile()) {
        await copyFile(sourcePath, join(temporaryDirectory, basename(sourcePath)))
      } else {
        throw new Error('Unsupported savegame path')
      }
      await writeFile(
        join(temporaryDirectory, 'orbit-backup.json'),
        JSON.stringify({ gameId: game.id, gameName: game.name, sourcePath, createdAt: completedAt }, null, 2),
        'utf8'
      )
      await mkdir(backupRoot, { recursive: true })
      await rename(temporaryDirectory, finalDirectory)
      await this.rotateBackups(backupRoot)
      return { state: 'success', completedAt, backupPath: finalDirectory }
    } catch {
      await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined)
      return { state: 'failed', completedAt }
    }
  }

  async openBackupDirectory(game: LibraryGame): Promise<void> {
    if (game.provider !== 'local') throw new Error('Custom game is not available')
    const backupRoot = join(app.getPath('userData'), 'save-backups', safeBackupDirectoryName(game))
    await mkdir(backupRoot, { recursive: true })
    const error = await shell.openPath(backupRoot)
    if (error) throw new Error(error)
  }

  private async rotateBackups(backupRoot: string): Promise<void> {
    const entries = await readdir(backupRoot, { withFileTypes: true })
    const backupDirectories = entries
      .filter((entry) => entry.isDirectory() && !entry.name.includes('.partial-'))
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left))
    await Promise.all(
      backupDirectories
        .slice(MAX_BACKUPS_PER_GAME)
        .map((directory) => rm(join(backupRoot, directory), { recursive: true, force: true }))
    )
  }
}

export const customLibraryService = new CustomLibraryService()
