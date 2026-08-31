import type { RetroGameConfig, RetroSystemId } from './ipc'

export type RetroHashMode =
  | 'full'
  | 'nes-header'
  | 'fds-header'
  | 'snes-header'
  | 'pce-header'
  | 'atari-7800-header'
  | 'lynx-header'
  | 'n64-big-endian'

export interface RetroSystemDefinition {
  id: RetroSystemId
  name: string
  extensions: readonly string[]
  folderAliases: readonly string[]
  retroAchievementsConsoleId?: number
  hashMode?: RetroHashMode
  retroArchCores: readonly string[]
}

interface RetroEmulatorCandidate {
  id: string
  readySystems: readonly RetroSystemId[]
}

/**
 * Resolves a system's emulator without overriding an explicit user choice.
 * An unavailable explicit selection intentionally returns undefined instead of
 * silently launching through another emulator.
 */
export function selectRetroEmulator<T extends RetroEmulatorCandidate>(
  systemId: RetroSystemId,
  emulators: readonly T[],
  preferredId?: string
): T | undefined {
  if (preferredId) {
    return emulators.find(
      (emulator) => emulator.id === preferredId && emulator.readySystems.includes(systemId)
    )
  }
  return emulators.find((emulator) => emulator.readySystems.includes(systemId))
}

export const RETRO_SYSTEMS: readonly RetroSystemDefinition[] = [
  {
    id: 'nes',
    name: 'Nintendo Entertainment System',
    extensions: ['nes'],
    folderAliases: ['nes', 'famicom', 'nintendo entertainment system'],
    retroAchievementsConsoleId: 7,
    hashMode: 'nes-header',
    retroArchCores: ['mesen', 'nestopia', 'fceumm']
  },
  {
    id: 'fds',
    name: 'Famicom Disk System',
    extensions: ['fds'],
    folderAliases: ['fds', 'famicom disk'],
    retroAchievementsConsoleId: 7,
    hashMode: 'fds-header',
    retroArchCores: ['mesen', 'nestopia', 'fceumm']
  },
  {
    id: 'snes',
    name: 'Super Nintendo',
    extensions: ['sfc', 'smc'],
    folderAliases: ['snes', 'super nintendo', 'super famicom'],
    retroAchievementsConsoleId: 3,
    hashMode: 'snes-header',
    retroArchCores: ['snes9x', 'bsnes']
  },
  {
    id: 'gb',
    name: 'Game Boy',
    extensions: ['gb'],
    folderAliases: ['game boy', 'gameboy', 'gb'],
    retroAchievementsConsoleId: 4,
    hashMode: 'full',
    retroArchCores: ['gambatte', 'sameboy', 'mgba']
  },
  {
    id: 'gbc',
    name: 'Game Boy Color',
    extensions: ['gbc'],
    folderAliases: ['game boy color', 'gameboy color', 'gbc'],
    retroAchievementsConsoleId: 6,
    hashMode: 'full',
    retroArchCores: ['gambatte', 'sameboy', 'mgba']
  },
  {
    id: 'gba',
    name: 'Game Boy Advance',
    extensions: ['gba'],
    folderAliases: ['game boy advance', 'gameboy advance', 'gba'],
    retroAchievementsConsoleId: 5,
    hashMode: 'full',
    retroArchCores: ['mgba', 'vba_next']
  },
  {
    id: 'n64',
    name: 'Nintendo 64',
    extensions: ['z64', 'v64', 'n64'],
    folderAliases: ['nintendo 64', 'n64'],
    retroAchievementsConsoleId: 2,
    hashMode: 'n64-big-endian',
    retroArchCores: ['mupen64plus_next', 'parallel_n64']
  },
  {
    id: 'nds',
    name: 'Nintendo DS',
    extensions: ['nds'],
    folderAliases: ['nintendo ds', 'nds'],
    retroAchievementsConsoleId: 18,
    retroArchCores: ['melonds', 'desmume']
  },
  {
    id: 'gamecube',
    name: 'Nintendo GameCube',
    extensions: ['rvz', 'gcz', 'gcm'],
    folderAliases: ['gamecube', 'game cube', 'ngc'],
    retroAchievementsConsoleId: 16,
    retroArchCores: ['dolphin']
  },
  {
    id: 'wii',
    name: 'Nintendo Wii',
    extensions: ['wbfs', 'wad'],
    folderAliases: ['nintendo wii', 'wii'],
    retroAchievementsConsoleId: 19,
    retroArchCores: ['dolphin']
  },
  {
    id: 'wiiu',
    name: 'Nintendo Wii U',
    extensions: ['wua', 'wux', 'wud', 'rpx'],
    folderAliases: ['wii u', 'wiiu'],
    retroArchCores: []
  },
  {
    id: 'megadrive',
    name: 'Mega Drive / Genesis',
    extensions: ['md', 'gen'],
    folderAliases: ['mega drive', 'megadrive', 'genesis'],
    retroAchievementsConsoleId: 1,
    hashMode: 'full',
    retroArchCores: ['genesis_plus_gx', 'picodrive']
  },
  {
    id: 'mastersystem',
    name: 'Master System',
    extensions: ['sms'],
    folderAliases: ['master system', 'mastersystem', 'sms'],
    retroAchievementsConsoleId: 11,
    hashMode: 'full',
    retroArchCores: ['genesis_plus_gx', 'picodrive']
  },
  {
    id: 'gamegear',
    name: 'Game Gear',
    extensions: ['gg'],
    folderAliases: ['game gear', 'gamegear'],
    retroAchievementsConsoleId: 15,
    hashMode: 'full',
    retroArchCores: ['genesis_plus_gx', 'picodrive']
  },
  {
    id: 'sega32x',
    name: 'Sega 32X',
    extensions: ['32x'],
    folderAliases: ['sega 32x', 'sega32x', '32x'],
    retroAchievementsConsoleId: 10,
    hashMode: 'full',
    retroArchCores: ['picodrive']
  },
  {
    id: 'segacd',
    name: 'Sega CD',
    extensions: [],
    folderAliases: ['sega cd', 'segacd', 'megacd', 'mega cd'],
    retroAchievementsConsoleId: 9,
    retroArchCores: ['genesis_plus_gx', 'picodrive']
  },
  {
    id: 'saturn',
    name: 'Sega Saturn',
    extensions: [],
    folderAliases: ['sega saturn', 'saturn'],
    retroAchievementsConsoleId: 39,
    retroArchCores: ['mednafen_saturn', 'kronos', 'beetle_saturn', 'yabause']
  },
  {
    id: 'dreamcast',
    name: 'Sega Dreamcast',
    extensions: ['gdi', 'cdi'],
    folderAliases: ['dreamcast'],
    retroAchievementsConsoleId: 40,
    retroArchCores: ['flycast']
  },
  {
    id: 'ps1',
    name: 'PlayStation',
    extensions: [],
    folderAliases: ['playstation 1', 'playstation', 'ps1', 'psx'],
    retroAchievementsConsoleId: 12,
    retroArchCores: [
      'mednafen_psx_hw',
      'mednafen_psx',
      'beetle_psx_hw',
      'beetle_psx',
      'swanstation',
      'pcsx_rearmed'
    ]
  },
  {
    id: 'ps2',
    name: 'PlayStation 2',
    extensions: [],
    folderAliases: ['playstation 2', 'ps2'],
    retroAchievementsConsoleId: 21,
    retroArchCores: ['pcsx2', 'play']
  },
  {
    id: 'psp',
    name: 'PlayStation Portable',
    extensions: ['cso'],
    folderAliases: ['playstation portable', 'psp'],
    retroAchievementsConsoleId: 41,
    retroArchCores: ['ppsspp']
  },
  {
    id: 'atari2600',
    name: 'Atari 2600',
    extensions: ['a26'],
    folderAliases: ['atari 2600', 'atari2600', 'a2600'],
    retroAchievementsConsoleId: 25,
    hashMode: 'full',
    retroArchCores: ['stella']
  },
  {
    id: 'atari7800',
    name: 'Atari 7800',
    extensions: ['a78'],
    folderAliases: ['atari 7800', 'atari7800', 'a7800'],
    retroAchievementsConsoleId: 51,
    hashMode: 'atari-7800-header',
    retroArchCores: ['prosystem']
  },
  {
    id: 'atarilynx',
    name: 'Atari Lynx',
    extensions: ['lnx'],
    folderAliases: ['atari lynx', 'atarilynx', 'lynx'],
    retroAchievementsConsoleId: 13,
    hashMode: 'lynx-header',
    retroArchCores: ['handy', 'mednafen_lynx']
  },
  {
    id: 'pce',
    name: 'PC Engine / TurboGrafx-16',
    extensions: ['pce'],
    folderAliases: ['pc engine', 'turbografx', 'tg16', 'pce'],
    retroAchievementsConsoleId: 8,
    hashMode: 'pce-header',
    retroArchCores: ['mednafen_pce_fast', 'mednafen_supergrafx']
  },
  {
    id: 'wonderswan',
    name: 'WonderSwan',
    extensions: ['ws'],
    folderAliases: ['wonderswan'],
    retroAchievementsConsoleId: 53,
    hashMode: 'full',
    retroArchCores: ['mednafen_wswan']
  },
  {
    id: 'wonderswancolor',
    name: 'WonderSwan Color',
    extensions: ['wsc'],
    folderAliases: ['wonderswan color', 'wonderswancolor'],
    retroAchievementsConsoleId: 53,
    hashMode: 'full',
    retroArchCores: ['mednafen_wswan']
  },
  {
    id: 'ngp',
    name: 'Neo Geo Pocket',
    extensions: ['ngp'],
    folderAliases: ['neo geo pocket', 'ngp'],
    retroAchievementsConsoleId: 14,
    hashMode: 'full',
    retroArchCores: ['mednafen_ngp']
  },
  {
    id: 'ngpc',
    name: 'Neo Geo Pocket Color',
    extensions: ['ngc'],
    folderAliases: ['neo geo pocket color', 'ngpc'],
    retroAchievementsConsoleId: 14,
    hashMode: 'full',
    retroArchCores: ['mednafen_ngp']
  },
  {
    id: 'virtualboy',
    name: 'Virtual Boy',
    extensions: ['vb'],
    folderAliases: ['virtual boy', 'virtualboy'],
    retroAchievementsConsoleId: 28,
    hashMode: 'full',
    retroArchCores: ['mednafen_vb']
  },
  {
    id: 'colecovision',
    name: 'ColecoVision',
    extensions: ['col'],
    folderAliases: ['colecovision', 'coleco vision'],
    retroAchievementsConsoleId: 44,
    hashMode: 'full',
    retroArchCores: ['bluemsx', 'gearcoleco']
  },
  {
    id: 'arcade',
    name: 'Arcade',
    extensions: [],
    folderAliases: ['arcade', 'mame', 'fbneo', 'finalburn'],
    retroAchievementsConsoleId: 27,
    retroArchCores: ['fbneo', 'mame']
  }
] as const

const SYSTEM_BY_ID = new Map(RETRO_SYSTEMS.map((system) => [system.id, system]))
const UNIQUE_EXTENSION_SYSTEM = new Map<string, RetroSystemId>()

for (const system of RETRO_SYSTEMS) {
  for (const extension of system.extensions) UNIQUE_EXTENSION_SYSTEM.set(extension, system.id)
}

export function retroSystemById(id: RetroSystemId): RetroSystemDefinition {
  return SYSTEM_BY_ID.get(id) as RetroSystemDefinition
}

function normalizedPathWords(filePath: string): string {
  return filePath
    .normalize('NFKC')
    .replace(/\\/g, '/')
    .toLocaleLowerCase('en-US')
    .replace(/[._-]+/g, ' ')
}

function systemFromFolderHints(filePath: string): RetroSystemId | undefined {
  const words = normalizedPathWords(filePath)
  const candidates = RETRO_SYSTEMS
    .flatMap((system) =>
      system.folderAliases.map((alias) => ({ id: system.id, alias: alias.toLocaleLowerCase('en-US') }))
    )
    .sort((left, right) => right.alias.length - left.alias.length)
  return candidates.find(({ alias }) => words.includes(`/${alias}/`) || words.endsWith(`/${alias}`))?.id
}

export function detectRetroSystemId(filePath: string): RetroSystemId | undefined {
  const normalized = filePath.replace(/\\/g, '/')
  const filename = normalized.slice(normalized.lastIndexOf('/') + 1)
  const dot = filename.lastIndexOf('.')
  if (dot <= 0) return undefined
  const extension = filename.slice(dot + 1).toLocaleLowerCase('en-US')
  const unique = UNIQUE_EXTENSION_SYSTEM.get(extension)
  if (unique) return unique

  if (extension === 'wbfs' || extension === 'wad') return 'wii'
  if (extension === 'cso') return 'psp'
  if (extension === 'gdi' || extension === 'cdi') return 'dreamcast'

  const hinted = systemFromFolderHints(normalized)
  if (['7z', 'cue', 'chd', 'iso', 'm3u', 'pbp', 'zip'].includes(extension)) return hinted
  return undefined
}

export function cleanRetroGameName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const filename = normalized.slice(normalized.lastIndexOf('/') + 1)
  const dot = filename.lastIndexOf('.')
  const base = dot > 0 ? filename.slice(0, dot) : filename
  const cleaned = base
    .normalize('NFKC')
    .replace(/[_]+/g, ' ')
    .replace(/\s*[([](?:usa|europe|japan|world|en|de|fr|es|rev[^\])]*|proto|beta|demo|sample|unl|!)[^\])]*[\])]/giu, '')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || base || 'Retro game'
}

export function matchingRetroArchCore(
  systemId: RetroSystemId,
  coreFileNames: readonly string[]
): string | undefined {
  const preferences = retroSystemById(systemId).retroArchCores
  const normalized = coreFileNames.map((name) => name.toLocaleLowerCase('en-US'))
  for (const preferred of preferences) {
    const index = normalized.findIndex((name) => name.includes(`${preferred}_libretro`))
    if (index >= 0) return coreFileNames[index]
  }
  return undefined
}

export interface RetroEmulatorDownloadDefinition {
  id: string
  name: string
  systems: readonly RetroSystemId[]
  firmwareSystems: readonly RetroSystemId[]
  /** Stable project-owned page where the user chooses and installs a current build. */
  downloadUrl: string
}

const RETROARCH_MANAGED_SYSTEMS = RETRO_SYSTEMS.filter(
  (system) => system.retroArchCores.length > 0
).map((system) => system.id)

/** Official emulator pages ORBIT may open from its fixed, main-process-owned catalog. */
export const RETRO_EMULATOR_DOWNLOADS: readonly RetroEmulatorDownloadDefinition[] = [
  {
    id: 'retroarch',
    name: 'RetroArch',
    systems: RETROARCH_MANAGED_SYSTEMS,
    firmwareSystems: ['fds', 'segacd', 'saturn', 'dreamcast', 'ps1', 'ps2'],
    downloadUrl: 'https://www.retroarch.com/?page=platforms'
  },
  {
    id: 'duckstation',
    name: 'DuckStation',
    systems: ['ps1'],
    firmwareSystems: ['ps1'],
    downloadUrl: 'https://www.duckstation.org/windl'
  },
  {
    id: 'pcsx2',
    name: 'PCSX2',
    systems: ['ps2'],
    firmwareSystems: ['ps2'],
    downloadUrl: 'https://pcsx2.net/downloads/'
  },
  {
    id: 'dolphin',
    name: 'Dolphin',
    systems: ['gamecube', 'wii'],
    firmwareSystems: [],
    downloadUrl: 'https://dolphin-emu.org/download/'
  },
  {
    id: 'ppsspp',
    name: 'PPSSPP',
    systems: ['psp'],
    firmwareSystems: [],
    downloadUrl: 'https://www.ppsspp.org/download/'
  },
  {
    id: 'cemu',
    name: 'Cemu',
    systems: ['wiiu'],
    firmwareSystems: [],
    downloadUrl: 'https://cemu.info/'
  },
  {
    id: 'mgba',
    name: 'mGBA',
    systems: ['gb', 'gbc', 'gba'],
    firmwareSystems: [],
    downloadUrl: 'https://mgba.io/downloads.html'
  },
  {
    id: 'melonds',
    name: 'melonDS',
    systems: ['nds'],
    firmwareSystems: [],
    downloadUrl: 'https://melonds.kuribo64.net/downloads.php'
  },
  {
    id: 'snes9x',
    name: 'Snes9x',
    systems: ['snes'],
    firmwareSystems: [],
    downloadUrl: 'https://github.com/snes9xgit/snes9x/releases'
  },
  {
    id: 'project64',
    name: 'Project64',
    systems: ['n64'],
    firmwareSystems: [],
    downloadUrl: 'https://www.pj64-emu.com/windows-downloads'
  },
  {
    id: 'flycast',
    name: 'Flycast',
    systems: ['dreamcast'],
    firmwareSystems: ['dreamcast'],
    downloadUrl: 'https://github.com/flyinghead/flycast/releases'
  },
  {
    id: 'mame',
    name: 'MAME',
    systems: ['arcade'],
    firmwareSystems: [],
    downloadUrl: 'https://www.mamedev.org/release.html'
  }
] as const

const RECOMMENDED_MANAGED_EMULATOR: Partial<Record<RetroSystemId, string>> = {
  snes: 'snes9x',
  gb: 'mgba',
  gbc: 'mgba',
  gba: 'mgba',
  n64: 'project64',
  nds: 'melonds',
  gamecube: 'dolphin',
  wii: 'dolphin',
  wiiu: 'cemu',
  dreamcast: 'flycast',
  ps1: 'duckstation',
  ps2: 'pcsx2',
  psp: 'ppsspp',
  arcade: 'mame'
}

export function retroEmulatorDownloadsForSystem(
  systemId: RetroSystemId
): RetroEmulatorDownloadDefinition[] {
  const recommendedId = RECOMMENDED_MANAGED_EMULATOR[systemId] ?? 'retroarch'
  return RETRO_EMULATOR_DOWNLOADS.filter((emulator) => emulator.systems.includes(systemId)).sort(
    (left, right) => Number(right.id === recommendedId) - Number(left.id === recommendedId)
  )
}

export function recommendedRetroEmulatorDownload(
  systemId: RetroSystemId
): RetroEmulatorDownloadDefinition {
  const recommendedId = RECOMMENDED_MANAGED_EMULATOR[systemId] ?? 'retroarch'
  const emulator = RETRO_EMULATOR_DOWNLOADS.find(
    (candidate) => candidate.id === recommendedId && candidate.systems.includes(systemId)
  )
  if (!emulator) throw new Error(`No emulator download is available for ${systemId}`)
  return emulator
}

export const RETRO_LAUNCH_PROFILE_IDS = [
  'retroarch',
  'duckstation',
  'pcsx2',
  'dolphin',
  'ppsspp',
  'cemu',
  'mgba',
  'melonds',
  'snes9x',
  'project64',
  'flycast',
  'mame'
] as const

function mameRomParts(romPath: string): { directory: string; setName: string } {
  const separator = Math.max(romPath.lastIndexOf('/'), romPath.lastIndexOf('\\'))
  const directory = separator >= 0 ? romPath.slice(0, separator) : '.'
  const filename = separator >= 0 ? romPath.slice(separator + 1) : romPath
  const extension = filename.lastIndexOf('.')
  return {
    directory,
    setName: extension > 0 ? filename.slice(0, extension) : filename
  }
}

/** ORBIT's complete, visible default argv for every emulator it can detect. */
export function retroDefaultLaunchArguments(game: RetroGameConfig): string[] {
  if (!game.emulatorId) return [game.romPath]
  if (game.emulatorId === 'retroarch') {
    if (!game.corePath) throw new Error('No compatible RetroArch core is installed')
    return ['-f', '-L', game.corePath, game.romPath]
  }
  if (game.emulatorId === 'dolphin') {
    return ['-b', '-C', 'Dolphin.Display.Fullscreen=True', '-e', game.romPath]
  }
  if (game.emulatorId === 'cemu') return ['-f', '-g', game.romPath]
  if (game.emulatorId === 'pcsx2' || game.emulatorId === 'duckstation') {
    return ['-batch', '-fullscreen', '--', game.romPath]
  }
  if (game.emulatorId === 'ppsspp') return ['--fullscreen', game.romPath]
  if (game.emulatorId === 'mgba' || game.emulatorId === 'melonds') {
    return ['-f', game.romPath]
  }
  if (game.emulatorId === 'snes9x' || game.emulatorId === 'project64') {
    return [game.romPath]
  }
  if (game.emulatorId === 'flycast') {
    return ['-config', 'window:fullscreen=yes', game.romPath]
  }
  if (game.emulatorId === 'mame') {
    const { directory, setName } = mameRomParts(game.romPath)
    return ['-nowindow', '-rompath', directory, setName]
  }
  throw new Error(`Unsupported retro emulator launch profile: ${game.emulatorId}`)
}

function withoutExactArguments(args: readonly string[], blocked: ReadonlySet<string>): string[] {
  return args.filter((argument) => !blocked.has(argument.toLocaleLowerCase('en-US')))
}

function withoutOptionValue(
  args: readonly string[],
  option: string,
  rejectsValue: (value: string) => boolean
): string[] {
  const result: string[] = []
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    if (argument.toLocaleLowerCase('en-US') === option && rejectsValue(args[index + 1] ?? '')) {
      index++
      continue
    }
    result.push(argument)
  }
  return result
}

/**
 * Applies ORBIT's non-optional fullscreen contract to a user override. Config-
 * driven emulators (Project64 and Snes9x) are prepared by the main process.
 */
export function enforceRetroFullscreenArguments(
  emulatorId: string | undefined,
  args: readonly string[]
): string[] {
  const blocked = new Set(['--windowed', '-windowed', '-window', '-nofullscreen'])
  let safe = withoutExactArguments(args, blocked)
  switch (emulatorId) {
    case 'retroarch':
    case 'cemu':
    case 'mgba':
    case 'melonds':
      return ['-f', ...withoutExactArguments(safe, new Set(['-f', '--fullscreen']))]
    case 'duckstation':
    case 'pcsx2':
      return ['-fullscreen', ...withoutExactArguments(safe, new Set(['-fullscreen']))]
    case 'ppsspp':
      return ['--fullscreen', ...withoutExactArguments(safe, new Set(['--fullscreen']))]
    case 'dolphin':
      for (const option of ['-c', '--config']) {
        safe = withoutOptionValue(
          safe,
          option,
          (value) => value.toLocaleLowerCase('en-US').startsWith('dolphin.display.fullscreen=')
        )
      }
      safe = safe.filter(
        (argument) =>
          !/^(?:-c|--config)=dolphin\.display\.fullscreen=/iu.test(argument)
      )
      return ['-C', 'Dolphin.Display.Fullscreen=True', ...safe]
    case 'flycast':
      safe = withoutOptionValue(
        safe,
        '-config',
        (value) => value.toLocaleLowerCase('en-US').startsWith('window:fullscreen=')
      )
      return ['-config', 'window:fullscreen=yes', ...safe]
    case 'mame':
      return ['-nowindow', ...withoutExactArguments(safe, new Set(['-nowindow']))]
    default:
      return safe
  }
}

/** The exact argv that ORBIT will pass to spawn for this game. */
export function retroLaunchArguments(game: RetroGameConfig): string[] {
  const selected = game.launchArguments?.length
    ? [...game.launchArguments]
    : retroDefaultLaunchArguments(game)
  return enforceRetroFullscreenArguments(game.emulatorId, selected)
}
