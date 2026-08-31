import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import type { Dirent } from 'node:fs'
import { open, readdir, realpath, stat } from 'node:fs/promises'
import { basename, dirname, extname, join, parse, resolve, win32 as windowsPath } from 'node:path'
import { dialog, type BrowserWindow } from 'electron'
import type {
  DetectedRetroEmulator,
  GameMetadata,
  LibraryProviderStatus,
  RetroAchievementMatch,
  RetroGameConfig,
  RetroLibraryStatus,
  RetroRomDirectoryStatus,
  RetroSystemId
} from '@shared/ipc'
import {
  RETRO_SYSTEMS,
  cleanRetroGameName,
  detectRetroSystemId,
  matchingRetroArchCore,
  retroSystemById,
  selectRetroEmulator
} from '@shared/retroSystems'
import { gameRepository } from '../library/gameRepository'
import { settingsStore } from '../settingsStore'
import { getSteamAppsDirectories } from '../steam/steamInstall'
import {
  hasRetroAchievementsCredentials,
  matchRetroAchievementHashes
} from './retroAchievements'
import { managedEmulatorDirectories, managedRetroCoreDirectories } from './retroManagedPaths'

const MAX_SCAN_DEPTH = 8
const MAX_SCANNED_ENTRIES = 25_000
const MAX_ROM_FILES = 5_000
const ROM_HASH_WORKERS = 2

interface StandaloneEmulatorDefinition {
  id: string
  name: string
  executableNames: readonly string[]
  systems: readonly RetroSystemId[]
  commonPaths: () => string[]
  achievementsSupported: boolean
  priority: number
  wingetPackageId?: string
}

interface InternalRetroEmulator extends DetectedRetroEmulator {
  executablePath: string
  priority: number
  corePaths: Partial<Record<RetroSystemId, string>>
}

interface ScannedRom {
  romPath: string
  sourceDirectory: string
  systemId: RetroSystemId
  fallbackName: string
}

interface DirectoryScanResult {
  directory: RetroRomDirectoryStatus
  roms: ScannedRom[]
}

export interface RetroGameRecordInput {
  providerGameId: string
  name: string
  installDir: string
  metadata: GameMetadata
  retro: RetroGameConfig
}

function environmentPath(name: string): string | undefined {
  const value = process.env[name]
  return value?.trim() || undefined
}

function commonPath(...parts: Array<string | undefined>): string | undefined {
  if (!parts[0]) return undefined
  return windowsPath.join(...(parts.filter(Boolean) as string[]))
}

const STANDALONE_EMULATORS: readonly StandaloneEmulatorDefinition[] = [
  {
    id: 'duckstation',
    name: 'DuckStation',
    executableNames: [
      'duckstation-qt-x64-ReleaseLTCG.exe',
      'duckstation-qt-x64-ReleaseLTCG-SSE2.exe',
      'duckstation-qt.exe'
    ],
    systems: ['ps1'],
    commonPaths: () => [
      commonPath(environmentPath('LOCALAPPDATA'), 'Programs', 'DuckStation', 'duckstation-qt-x64-ReleaseLTCG.exe'),
      commonPath(environmentPath('ProgramFiles'), 'DuckStation', 'duckstation-qt-x64-ReleaseLTCG.exe')
    ].filter((path): path is string => Boolean(path)),
    achievementsSupported: true,
    priority: 4,
    wingetPackageId: 'Stenzek.DuckStation'
  },
  {
    id: 'pcsx2',
    name: 'PCSX2',
    executableNames: ['pcsx2-qt.exe', 'pcsx2.exe'],
    systems: ['ps2'],
    commonPaths: () => [
      commonPath(environmentPath('ProgramFiles'), 'PCSX2', 'pcsx2-qt.exe'),
      commonPath(environmentPath('LOCALAPPDATA'), 'Programs', 'PCSX2', 'pcsx2-qt.exe')
    ].filter((path): path is string => Boolean(path)),
    achievementsSupported: true,
    priority: 4,
    wingetPackageId: 'PCSX2Team.PCSX2'
  },
  {
    id: 'dolphin',
    name: 'Dolphin',
    executableNames: ['Dolphin.exe'],
    systems: ['gamecube', 'wii'],
    commonPaths: () => [
      commonPath(environmentPath('ProgramFiles'), 'Dolphin', 'Dolphin.exe'),
      commonPath(environmentPath('LOCALAPPDATA'), 'Programs', 'Dolphin', 'Dolphin.exe')
    ].filter((path): path is string => Boolean(path)),
    achievementsSupported: true,
    priority: 4,
    wingetPackageId: 'DolphinEmulator.Dolphin'
  },
  {
    id: 'ppsspp',
    name: 'PPSSPP',
    executableNames: ['PPSSPPWindows64.exe', 'PPSSPPWindows.exe'],
    systems: ['psp'],
    commonPaths: () => [
      commonPath(environmentPath('ProgramFiles'), 'PPSSPP', 'PPSSPPWindows64.exe'),
      commonPath(environmentPath('LOCALAPPDATA'), 'PPSSPP', 'PPSSPPWindows64.exe')
    ].filter((path): path is string => Boolean(path)),
    achievementsSupported: true,
    priority: 4,
    wingetPackageId: 'PPSSPPTeam.PPSSPP'
  },
  {
    id: 'cemu',
    name: 'Cemu',
    executableNames: ['Cemu.exe'],
    systems: ['wiiu'],
    commonPaths: () => [
      commonPath(environmentPath('ProgramFiles'), 'Cemu', 'Cemu.exe'),
      commonPath(environmentPath('LOCALAPPDATA'), 'Programs', 'Cemu', 'Cemu.exe')
    ].filter((path): path is string => Boolean(path)),
    achievementsSupported: false,
    priority: 4,
    wingetPackageId: 'Cemu.Cemu'
  },
  {
    id: 'mgba',
    name: 'mGBA',
    executableNames: ['mGBA.exe'],
    systems: ['gb', 'gbc', 'gba'],
    commonPaths: () => [
      commonPath(environmentPath('ProgramFiles'), 'mGBA', 'mGBA.exe'),
      commonPath(environmentPath('LOCALAPPDATA'), 'mGBA', 'mGBA.exe')
    ].filter((path): path is string => Boolean(path)),
    achievementsSupported: false,
    priority: 7,
    wingetPackageId: 'JeffreyPfau.mGBA'
  },
  {
    id: 'melonds',
    name: 'melonDS',
    executableNames: ['melonDS.exe'],
    systems: ['nds'],
    commonPaths: () => [
      commonPath(environmentPath('ProgramFiles'), 'melonDS', 'melonDS.exe'),
      commonPath(environmentPath('LOCALAPPDATA'), 'melonDS', 'melonDS.exe')
    ].filter((path): path is string => Boolean(path)),
    achievementsSupported: false,
    priority: 7,
    wingetPackageId: 'melonDS.melonDS'
  },
  {
    id: 'snes9x',
    name: 'Snes9x',
    executableNames: ['snes9x-x64.exe', 'snes9x.exe'],
    systems: ['snes'],
    commonPaths: () => [commonPath(environmentPath('ProgramFiles'), 'Snes9x', 'snes9x-x64.exe')]
      .filter((path): path is string => Boolean(path)),
    achievementsSupported: false,
    priority: 7
  },
  {
    id: 'project64',
    name: 'Project64',
    executableNames: ['Project64.exe'],
    systems: ['n64'],
    commonPaths: () => [
      commonPath(environmentPath('ProgramFiles'), 'Project64 3.0', 'Project64.exe'),
      commonPath(environmentPath('ProgramFiles(x86)'), 'Project64 3.0', 'Project64.exe')
    ].filter((path): path is string => Boolean(path)),
    achievementsSupported: false,
    priority: 7,
    wingetPackageId: 'Project64.Project64'
  },
  {
    id: 'flycast',
    name: 'Flycast',
    executableNames: ['flycast.exe'],
    systems: ['dreamcast'],
    commonPaths: () => [commonPath(environmentPath('ProgramFiles'), 'Flycast', 'flycast.exe')]
      .filter((path): path is string => Boolean(path)),
    achievementsSupported: true,
    priority: 7
  },
  {
    id: 'mame',
    name: 'MAME',
    executableNames: ['mame.exe'],
    systems: ['arcade'],
    commonPaths: () => [commonPath(environmentPath('ProgramFiles'), 'MAME', 'mame.exe')]
      .filter((path): path is string => Boolean(path)),
    achievementsSupported: false,
    priority: 7,
    wingetPackageId: 'MAMEdev.MAME'
  }
]

function uniquePaths(values: readonly string[]): string[] {
  const seen = new Set<string>()
  return values.filter((value) => {
    const key = resolve(value).toLocaleLowerCase('en-US')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function existingExecutable(candidates: readonly string[]): Promise<string | undefined> {
  for (const candidate of uniquePaths(candidates)) {
    try {
      const resolved = await realpath(candidate)
      const info = await stat(resolved)
      if (info.isFile() && extname(resolved).toLocaleLowerCase('en-US') === '.exe') return resolved
    } catch {
      // Portable and package-managed installations are optional discovery sources.
    }
  }
  return undefined
}

async function nestedExecutable(
  roots: readonly string[],
  executableNames: readonly string[]
): Promise<string | undefined> {
  const wanted = new Set(executableNames.map((name) => name.toLocaleLowerCase('en-US')))
  const queue = roots.map((path) => ({ path, depth: 0 }))
  let visited = 0
  while (queue.length > 0 && visited < 10_000) {
    const current = queue.shift()
    if (!current) break
    let entries: Dirent<string>[]
    try {
      entries = await readdir(current.path, { withFileTypes: true, encoding: 'utf8' })
    } catch {
      continue
    }
    for (const entry of entries) {
      visited += 1
      const entryPath = join(current.path, entry.name)
      if (entry.isFile() && wanted.has(entry.name.toLocaleLowerCase('en-US'))) {
        return existingExecutable([entryPath])
      }
      if (entry.isDirectory() && current.depth < 6 && !entry.name.startsWith('.')) {
        queue.push({ path: entryPath, depth: current.depth + 1 })
      }
    }
  }
  return undefined
}

async function wingetPackageExecutable(
  packageId: string | undefined,
  executableNames: readonly string[]
): Promise<string | undefined> {
  if (!packageId) return undefined
  const localAppData = environmentPath('LOCALAPPDATA')
  if (!localAppData) return undefined
  const links = executableNames.map((name) =>
    windowsPath.join(localAppData, 'Microsoft', 'WinGet', 'Links', name)
  )
  const linked = await existingExecutable(links)
  if (linked) return linked
  const packagesRoot = windowsPath.join(localAppData, 'Microsoft', 'WinGet', 'Packages')
  let packageRoots: string[] = []
  try {
    const prefix = `${packageId}_`.toLocaleLowerCase('en-US')
    packageRoots = (await readdir(packagesRoot, { withFileTypes: true }))
      .filter(
        (entry) => entry.isDirectory() && entry.name.toLocaleLowerCase('en-US').startsWith(prefix)
      )
      .map((entry) => join(packagesRoot, entry.name))
  } catch {
    return undefined
  }
  return nestedExecutable(packageRoots, executableNames)
}

function queryRegistryDefaultValue(key: string): Promise<string | undefined> {
  return new Promise((resolveValue) => {
    execFile('reg.exe', ['query', key, '/ve'], { windowsHide: true, encoding: 'utf8' }, (error, stdout) => {
      if (error) return resolveValue(undefined)
      const match = stdout.match(/REG_SZ\s+([^\r\n]+)/i)
      resolveValue(match?.[1]?.trim())
    })
  })
}

async function registryExecutable(executableNames: readonly string[]): Promise<string | undefined> {
  if (process.platform !== 'win32') return undefined
  for (const executableName of executableNames) {
    for (const root of [
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths',
      'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths',
      'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths'
    ]) {
      const value = await queryRegistryDefaultValue(`${root}\\${executableName}`)
      if (!value) continue
      const executable = await existingExecutable([value.replace(/^"|"$/g, '')])
      if (executable) return executable
    }
  }
  return undefined
}

function pathCandidates(executableNames: readonly string[]): string[] {
  return (environmentPath('PATH') ?? '')
    .split(';')
    .map((directory) => directory.trim().replace(/^"|"$/g, ''))
    .filter(Boolean)
    .flatMap((directory) => executableNames.map((name) => windowsPath.join(directory, name)))
}

async function locateExecutable(definition: StandaloneEmulatorDefinition): Promise<string | undefined> {
  return (
    (await nestedExecutable(managedEmulatorDirectories(definition.id), definition.executableNames)) ??
    (await existingExecutable([...definition.commonPaths(), ...pathCandidates(definition.executableNames)])) ??
    (await registryExecutable(definition.executableNames)) ??
    (await wingetPackageExecutable(definition.wingetPackageId, definition.executableNames))
  )
}

async function detectRetroArch(): Promise<InternalRetroEmulator | undefined> {
  const executableNames = ['retroarch.exe']
  const managedDirectories = managedEmulatorDirectories('retroarch')
  const candidates = [
    ...managedDirectories.flatMap((directory) =>
      executableNames.map((name) => join(directory, name))
    ),
    commonPath(environmentPath('ProgramFiles'), 'RetroArch-Win64', 'retroarch.exe'),
    commonPath(environmentPath('ProgramFiles'), 'RetroArch', 'retroarch.exe'),
    commonPath(environmentPath('LOCALAPPDATA'), 'RetroArch', 'retroarch.exe'),
    commonPath(environmentPath('ProgramFiles(x86)'), 'Steam', 'steamapps', 'common', 'RetroArch', 'retroarch.exe'),
    ...getSteamAppsDirectories().map((steamapps) => join(steamapps, 'common', 'RetroArch', 'retroarch.exe')),
    ...pathCandidates(executableNames)
  ].filter((path): path is string => Boolean(path))
  const executablePath =
    (await nestedExecutable(managedDirectories, executableNames)) ??
    (await existingExecutable(candidates)) ??
    (await registryExecutable(executableNames)) ??
    (await wingetPackageExecutable('Libretro.RetroArch', executableNames))
  if (!executablePath) return undefined

  const coreDirectories = uniquePaths([
    join(dirname(executablePath), 'cores'),
    ...managedRetroCoreDirectories(),
    ...[
      commonPath(environmentPath('APPDATA'), 'RetroArch', 'cores'),
      commonPath(environmentPath('LOCALAPPDATA'), 'RetroArch', 'cores')
    ].filter((path): path is string => Boolean(path))
  ])
  const coreFiles: string[] = []
  for (const directory of coreDirectories) {
    try {
      const entries = await readdir(directory, { withFileTypes: true })
      coreFiles.push(
        ...entries
          .filter((entry) => entry.isFile() && entry.name.toLocaleLowerCase('en-US').endsWith('_libretro.dll'))
          .map((entry) => join(directory, entry.name))
      )
    } catch {
      // RetroArch remains visible even when no cores are installed yet.
    }
  }

  const corePaths: Partial<Record<RetroSystemId, string>> = {}
  for (const system of RETRO_SYSTEMS) {
    const match = matchingRetroArchCore(system.id, coreFiles.map((path) => basename(path)))
    if (!match) continue
    const corePath = coreFiles.find((path) => basename(path) === match)
    if (corePath) corePaths[system.id] = corePath
  }
  const readySystems = Object.keys(corePaths) as RetroSystemId[]
  return {
    id: 'retroarch',
    name: 'RetroArch',
    kind: 'retroarch',
    executablePath,
    supportedSystems: RETRO_SYSTEMS.filter((system) => system.retroArchCores.length > 0).map((system) => system.id),
    readySystems,
    achievementsSupported: true,
    coreCount: new Set(coreFiles.map((path) => path.toLocaleLowerCase('en-US'))).size,
    priority: 6,
    corePaths
  }
}

async function detectEmulators(): Promise<InternalRetroEmulator[]> {
  const [retroArch, ...standalonePaths] = await Promise.all([
    detectRetroArch(),
    ...STANDALONE_EMULATORS.map((definition) => locateExecutable(definition))
  ])
  const emulators: InternalRetroEmulator[] = retroArch ? [retroArch] : []
  STANDALONE_EMULATORS.forEach((definition, index) => {
    const executablePath = standalonePaths[index]
    if (!executablePath) return
    emulators.push({
      id: definition.id,
      name: definition.name,
      kind: 'standalone',
      executablePath,
      supportedSystems: [...definition.systems],
      readySystems: [...definition.systems],
      achievementsSupported: definition.achievementsSupported,
      priority: definition.priority,
      corePaths: {}
    })
  })
  return emulators.sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name))
}

function publicEmulator(emulator: InternalRetroEmulator): DetectedRetroEmulator {
  const { executablePath: _path, priority: _priority, corePaths: _cores, ...output } = emulator
  return output
}

/** Fresh, path-free emulator discovery for idempotent setup verification. */
export async function detectRetroEmulatorStatuses(): Promise<DetectedRetroEmulator[]> {
  return (await detectEmulators()).map(publicEmulator)
}

async function scanDirectory(sourceDirectory: string): Promise<DirectoryScanResult> {
  try {
    const root = await realpath(sourceDirectory)
    const rootInfo = await stat(root)
    if (!rootInfo.isDirectory()) throw new Error('ROM source is not a directory')
    const roms: ScannedRom[] = []
    const queue: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }]
    let scannedEntries = 0
    let limitReached = false
    let scanFailed = false

    while (queue.length > 0 && roms.length < MAX_ROM_FILES && scannedEntries < MAX_SCANNED_ENTRIES) {
      const current = queue.shift()
      if (!current) break
      let entries: Dirent<string>[]
      try {
        entries = await readdir(current.path, { withFileTypes: true, encoding: 'utf8' })
      } catch {
        scanFailed = true
        continue
      }
      for (const entry of entries) {
        scannedEntries += 1
        if (scannedEntries >= MAX_SCANNED_ENTRIES || roms.length >= MAX_ROM_FILES) {
          limitReached = true
          break
        }
        const entryPath = join(current.path, entry.name)
        if (entry.isDirectory()) {
          if (current.depth < MAX_SCAN_DEPTH && !entry.name.startsWith('.')) {
            queue.push({ path: entryPath, depth: current.depth + 1 })
          }
          continue
        }
        if (!entry.isFile()) continue
        const systemId = detectRetroSystemId(entryPath)
        if (!systemId) continue
        roms.push({
          romPath: entryPath,
          sourceDirectory: root,
          systemId,
          fallbackName: cleanRetroGameName(entryPath)
        })
      }
    }
    return {
      directory: {
        path: root,
        state: 'ready',
        gameCount: roms.length,
        issue: limitReached ? 'scan-limit-reached' : scanFailed ? 'scan-failed' : undefined
      },
      roms
    }
  } catch {
    return {
      directory: { path: sourceDirectory, state: 'missing', gameCount: 0 },
      roms: []
    }
  }
}

async function fileHeader(filePath: string, length: number): Promise<Buffer> {
  const handle = await open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

async function md5File(filePath: string, start = 0): Promise<string> {
  const hash = createHash('md5')
  for await (const chunk of createReadStream(filePath, { start })) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

async function md5Nintendo64(filePath: string): Promise<string> {
  const header = await fileHeader(filePath, 4)
  const magic = header.readUInt32BE(0)
  const hash = createHash('md5')
  let carry = Buffer.alloc(0)
  for await (const raw of createReadStream(filePath)) {
    const joined = carry.length ? Buffer.concat([carry, raw as Buffer]) : (raw as Buffer)
    const usable = joined.length - (joined.length % 4)
    const transformed = Buffer.from(joined.subarray(0, usable))
    if (magic === 0x37804012) {
      for (let index = 0; index < transformed.length; index += 2) {
        const left = transformed[index]
        transformed[index] = transformed[index + 1]
        transformed[index + 1] = left
      }
    } else if (magic === 0x40123780) {
      for (let index = 0; index < transformed.length; index += 4) {
        const first = transformed[index]
        const second = transformed[index + 1]
        transformed[index] = transformed[index + 3]
        transformed[index + 1] = transformed[index + 2]
        transformed[index + 2] = second
        transformed[index + 3] = first
      }
    }
    hash.update(transformed)
    carry = Buffer.from(joined.subarray(usable))
  }
  if (carry.length) hash.update(carry)
  return hash.digest('hex')
}

async function retroAchievementsHash(rom: ScannedRom): Promise<string | undefined> {
  const system = retroSystemById(rom.systemId)
  if (rom.systemId === 'arcade') return createHash('md5').update(parse(rom.romPath).name).digest('hex')
  if (['.7z', '.zip'].includes(extname(rom.romPath).toLocaleLowerCase('en-US'))) return undefined
  if (!system.hashMode) return undefined
  const info = await stat(rom.romPath)
  const header = await fileHeader(rom.romPath, 128)
  if (system.hashMode === 'n64-big-endian') return md5Nintendo64(rom.romPath)
  if (system.hashMode === 'nes-header') {
    return md5File(rom.romPath, header.subarray(0, 4).equals(Buffer.from('NES\x1a')) ? 16 : 0)
  }
  if (system.hashMode === 'fds-header') {
    return md5File(rom.romPath, header.subarray(0, 4).equals(Buffer.from('FDS\x1a')) ? 16 : 0)
  }
  if (system.hashMode === 'snes-header') return md5File(rom.romPath, info.size % 8192 === 512 ? 512 : 0)
  if (system.hashMode === 'pce-header') return md5File(rom.romPath, info.size % (128 * 1024) === 512 ? 512 : 0)
  if (system.hashMode === 'atari-7800-header') {
    return md5File(rom.romPath, header.subarray(0, 10).equals(Buffer.from('\x01ATARI7800')) ? 128 : 0)
  }
  if (system.hashMode === 'lynx-header') {
    return md5File(rom.romPath, header.subarray(0, 5).equals(Buffer.from('LYNX\x00')) ? 64 : 0)
  }
  return md5File(rom.romPath)
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>
): Promise<R[]> {
  const output = new Array<R>(values.length)
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex++
      output[index] = await mapper(values[index])
    }
  })
  await Promise.all(workers)
  return output
}

function durableRomId(romPath: string): string {
  return createHash('sha256')
    .update(resolve(romPath).replace(/\\/g, '/').toLocaleLowerCase('en-US'))
    .digest('hex')
    .slice(0, 40)
}

function metadataForMatch(
  iconUrl: string | undefined,
  achievementCount: number | undefined,
  matched: boolean
): GameMetadata {
  return {
    iconUrl,
    artwork: iconUrl ? { icon: [iconUrl] } : undefined,
    achievementCount,
    features: matched ? ['RetroAchievements'] : undefined
  }
}

function cloneStatus(status: RetroLibraryStatus): RetroLibraryStatus {
  return {
    ...status,
    emulators: status.emulators.map((emulator) => ({
      ...emulator,
      supportedSystems: [...emulator.supportedSystems],
      readySystems: [...emulator.readySystems]
    })),
    directories: status.directories.map((directory) => ({ ...directory }))
  }
}

export class RetroLibraryService {
  private refreshInFlight: Promise<RetroLibraryStatus> | null = null
  private status: RetroLibraryStatus = {
    state: 'idle',
    emulators: [],
    directories: [],
    gameCount: 0,
    matchedAchievementsCount: 0
  }

  getStatus(): RetroLibraryStatus {
    return cloneStatus(this.status)
  }

  getProviderStatus(): LibraryProviderStatus {
    const counts = gameRepository.getProviderCounts('retro')
    const hasConfiguredDirectories = settingsStore.store.retroRomDirectories.length > 0
    const hasMissingDirectory = this.status.directories.some((directory) => directory.state !== 'ready')
    const hasScanIssue = this.status.directories.some((directory) => Boolean(directory.issue))
    const hasLaunchableGame = gameRepository
      .getGamesByProvider('retro')
      .some((game) => Boolean(game.retro?.emulatorPath && game.retro.romPath))
    return {
      provider: 'retro',
      state:
        this.status.state === 'scanning'
          ? 'scanning'
          : !hasConfiguredDirectories
            ? 'idle'
            : hasMissingDirectory || hasScanIssue || (counts.gameCount > 0 && !hasLaunchableGame)
              ? 'partial'
              : 'ready',
      connection: 'automatic',
      methods: [
        'rom-folders',
        'emulator-installations',
        ...(hasRetroAchievementsCredentials() ? ['retroachievements-hash' as const] : [])
      ],
      ...counts,
      installableCount: 0,
      lastCheckedAt: this.status.scannedAt,
      issue: hasMissingDirectory
        ? 'rom-source-unavailable'
        : hasScanIssue
          ? 'source-unavailable'
          : counts.gameCount > 0 && !hasLaunchableGame
            ? 'emulator-missing'
            : undefined
    }
  }

  async addDirectory(mainWindow: BrowserWindow): Promise<RetroLibraryStatus | null> {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: settingsStore.store.language === 'de' ? 'ORBIT · ROM-Ordner auswählen' : 'ORBIT · Select ROM folder',
      buttonLabel: settingsStore.store.language === 'de' ? 'ROMs erkennen' : 'Detect ROMs',
      properties: ['openDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null
    const selected = await realpath(result.filePaths[0])
    const info = await stat(selected)
    if (!info.isDirectory()) throw new Error('Invalid ROM directory')
    const existing = settingsStore.store.retroRomDirectories
    const normalized = selected.toLocaleLowerCase('en-US')
    const directories = existing.some((path) => path.toLocaleLowerCase('en-US') === normalized)
      ? existing
      : [...existing, selected].slice(0, 20)
    settingsStore.set('retroRomDirectories', directories)
    return this.refresh()
  }

  async removeDirectory(directoryValue: string): Promise<RetroLibraryStatus> {
    const directory = directoryValue.trim()
    const existing = settingsStore.store.retroRomDirectories
    const normalized = directory.toLocaleLowerCase('en-US')
    const selected = existing.find((path) => path.toLocaleLowerCase('en-US') === normalized)
    if (!selected) throw new Error('ROM directory is not configured')
    settingsStore.set(
      'retroRomDirectories',
      existing.filter((path) => path !== selected)
    )
    gameRepository.removeRetroSource(selected)
    return this.refresh()
  }

  refresh(): Promise<RetroLibraryStatus> {
    if (this.refreshInFlight) return this.refreshInFlight
    this.status = { ...this.status, state: 'scanning' }
    const request = this.doRefresh().finally(() => {
      if (this.refreshInFlight === request) this.refreshInFlight = null
    })
    this.refreshInFlight = request
    return request
  }

  private async doRefresh(): Promise<RetroLibraryStatus> {
    const configuredDirectories = [...new Set(settingsStore.store.retroRomDirectories.map((path) => path.trim()).filter(Boolean))]
    const emulatorSelections = settingsStore.store.retroSystemEmulators ?? {}
    const [emulators, scans] = await Promise.all([
      detectEmulators(),
      Promise.all(configuredDirectories.map((directory) => scanDirectory(directory)))
    ])
    const roms = scans.flatMap((scan) => scan.roms)
    const credentialsConfigured = hasRetroAchievementsCredentials()
    const hashes = credentialsConfigured
      ? await mapWithConcurrency(roms, ROM_HASH_WORKERS, async (rom) => {
          try {
            return await retroAchievementsHash(rom)
          } catch {
            return undefined
          }
        })
      : roms.map(() => undefined)
    const hashTargets = roms.flatMap((rom, index) =>
      hashes[index] ? [{ systemId: rom.systemId, hash: hashes[index] as string }] : []
    )
    const matches = credentialsConfigured ? await matchRetroAchievementHashes(hashTargets) : []
    const matchesByHash = new Map(matches.map((match) => [`${match.systemId}:${match.hash}`, match]))
    let matchedAchievementsCount = 0
    const records: RetroGameRecordInput[] = roms.map((rom, index) => {
      const system = retroSystemById(rom.systemId)
      const hash = hashes[index]
      const match = hash ? matchesByHash.get(`${rom.systemId}:${hash}`) : undefined
      const achievementMatch: RetroAchievementMatch = !credentialsConfigured
        ? 'not-configured'
        : !hash
          ? 'unsupported'
          : match?.state === 'matched'
            ? 'matched'
            : match?.state === 'unavailable' || !match
              ? 'unavailable'
              : 'unmatched'
      if (achievementMatch === 'matched') matchedAchievementsCount += 1
      const emulator = selectRetroEmulator(
        rom.systemId,
        emulators,
        emulatorSelections[rom.systemId]
      )
      const corePath = emulator?.corePaths[rom.systemId]
      return {
        providerGameId: durableRomId(rom.romPath),
        name: match?.game?.title ?? rom.fallbackName,
        installDir: dirname(rom.romPath),
        metadata: metadataForMatch(
          match?.game?.iconUrl,
          match?.game?.achievementCount,
          achievementMatch === 'matched'
        ),
        retro: {
          romPath: rom.romPath,
          sourceDirectory: rom.sourceDirectory,
          systemId: rom.systemId,
          systemName: system.name,
          emulatorId: emulator?.id,
          emulatorName: emulator?.name,
          emulatorPath: emulator?.executablePath,
          corePath,
          retroAchievementsHash: hash,
          retroAchievementsGameId: match?.game?.id,
          retroAchievementsMatch: achievementMatch
        }
      }
    })
    const authoritativeRoots = scans
      .filter((scan) => scan.directory.state === 'ready' && !scan.directory.issue)
      .map((scan) => scan.directory.path)
    const unavailableRoots = scans
      .filter((scan) => scan.directory.state !== 'ready')
      .map((scan) => scan.directory.path)
    gameRepository.applyRetroLibraryDelta(records, authoritativeRoots, unavailableRoots)

    const hasPartialScan = scans.some(
      (scan) => scan.directory.state !== 'ready' || Boolean(scan.directory.issue)
    )
    this.status = {
      state:
        configuredDirectories.length === 0
          ? 'idle'
          : scans.every((scan) => scan.directory.state !== 'ready')
            ? 'error'
            : hasPartialScan
              ? 'partial'
              : 'ready',
      emulators: emulators.map(publicEmulator),
      directories: scans.map((scan) => scan.directory),
      gameCount: records.length,
      matchedAchievementsCount,
      scannedAt: Date.now()
    }
    return this.getStatus()
  }
}

export const retroLibraryService = new RetroLibraryService()
