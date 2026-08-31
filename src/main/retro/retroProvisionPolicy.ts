import type { DetectedRetroEmulator, RetroSystemId } from '@shared/ipc'

export type RetroProvisionDecision = 'use-existing' | 'install-core' | 'install-emulator'

export interface GithubReleaseProvisioner {
  kind: 'github-release'
  repository: string
  assetPattern: RegExp
}

export interface RetroArchProvisioner {
  kind: 'retroarch-stable'
  repository: 'libretro/RetroArch'
  version: string
  sha256: string
}

export interface DolphinProvisioner {
  kind: 'dolphin-stable'
  repository: 'dolphin-emu/dolphin'
  version: string
  sha256: string
}

export interface Project64Provisioner {
  kind: 'project64-stable'
  repository: 'project64/project64'
  version: string
  sha256: string
}

export type RetroEmulatorProvisioner =
  | GithubReleaseProvisioner
  | RetroArchProvisioner
  | DolphinProvisioner
  | Project64Provisioner

/**
 * Main-process-only supply catalog. The project/repository identities and
 * Windows asset selectors are fixed in code; renderer input can never choose
 * a package URL or executable.
 */
export const RETRO_EMULATOR_PROVISIONERS: Readonly<Record<string, RetroEmulatorProvisioner>> = {
  retroarch: {
    kind: 'retroarch-stable',
    repository: 'libretro/RetroArch',
    version: '1.22.2',
    sha256: 'b2139b1d0f9d4526dc6b5ce23cbb3efdc766096fa6f2c3df016818b486ac6372'
  },
  duckstation: {
    kind: 'github-release',
    repository: 'stenzek/duckstation',
    assetPattern: /^duckstation-windows-x64-release\.zip$/iu
  },
  pcsx2: {
    kind: 'github-release',
    repository: 'PCSX2/pcsx2',
    assetPattern: /^pcsx2-v[\w.-]+-windows-x64-Qt\.7z$/iu
  },
  dolphin: {
    kind: 'dolphin-stable',
    repository: 'dolphin-emu/dolphin',
    version: '2606a',
    sha256: '4c58045f9821cb63913f4df08ea86ece3cdda9f9e646154516000fa1547e0c37'
  },
  ppsspp: {
    kind: 'github-release',
    repository: 'hrydgard/ppsspp',
    assetPattern: /^PPSSPP-v[\w.-]+-Windows-x64\.zip$/iu
  },
  cemu: {
    kind: 'github-release',
    repository: 'cemu-project/Cemu',
    assetPattern: /^cemu-[\w.-]+-windows-x64\.zip$/iu
  },
  mgba: {
    kind: 'github-release',
    repository: 'mgba-emu/mgba',
    assetPattern: /^mGBA-[\w.-]+-win64\.7z$/iu
  },
  melonds: {
    kind: 'github-release',
    repository: 'melonDS-emu/melonDS',
    assetPattern: /^melonDS-[\w.-]+-windows-x86_64\.zip$/iu
  },
  snes9x: {
    kind: 'github-release',
    repository: 'snes9xgit/snes9x',
    assetPattern: /^snes9x-[\w.-]+-win32-x64\.zip$/iu
  },
  project64: {
    kind: 'project64-stable',
    repository: 'project64/project64',
    version: '3.0.1-5664-2df3434',
    sha256: 'f8be471f105e844e32589d21f3c1ee466d5ff4d93b8b7aff69e1badf511faf7f'
  },
  flycast: {
    kind: 'github-release',
    repository: 'flyinghead/flycast',
    assetPattern: /^flycast-win64-[\w.-]+\.zip$/iu
  },
  mame: {
    kind: 'github-release',
    repository: 'mamedev/mame',
    assetPattern: /^mame\d+b_x64\.exe$/iu
  }
}

export const RETRO_EMULATOR_EXECUTABLES: Readonly<Record<string, readonly string[]>> = {
  retroarch: ['retroarch.exe'],
  duckstation: [
    'duckstation-qt-x64-ReleaseLTCG.exe',
    'duckstation-qt-x64-ReleaseLTCG-SSE2.exe',
    'duckstation-qt.exe'
  ],
  pcsx2: ['pcsx2-qt.exe', 'pcsx2.exe'],
  dolphin: ['Dolphin.exe'],
  ppsspp: ['PPSSPPWindows64.exe', 'PPSSPPWindows.exe'],
  cemu: ['Cemu.exe'],
  mgba: ['mGBA.exe'],
  melonds: ['melonDS.exe'],
  snes9x: ['snes9x-x64.exe', 'snes9x.exe'],
  project64: ['Project64.exe'],
  flycast: ['flycast.exe'],
  mame: ['mame.exe']
}

export function decideRetroProvisioning(
  systemId: RetroSystemId,
  emulatorId: string,
  detected: readonly DetectedRetroEmulator[]
): RetroProvisionDecision {
  const existing = detected.find((emulator) => emulator.id === emulatorId)
  if (existing?.readySystems.includes(systemId)) return 'use-existing'
  if (emulatorId === 'retroarch' && existing?.supportedSystems.includes(systemId)) {
    return 'install-core'
  }
  return 'install-emulator'
}

export interface ReleaseAssetLike {
  name: string
  browser_download_url?: string
  size?: number
  digest?: string | null
}

export function selectGithubReleaseAsset(
  provisioner: GithubReleaseProvisioner,
  assets: readonly ReleaseAssetLike[]
): ReleaseAssetLike {
  const matches = assets.filter((asset) => provisioner.assetPattern.test(asset.name))
  if (matches.length !== 1) {
    throw new Error(
      `Official Windows package could not be resolved for ${provisioner.repository}`
    )
  }
  return matches[0]
}

const TRUSTED_DOWNLOAD_HOSTS = new Set([
  'api.github.com',
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'github-releases.githubusercontent.com',
  'buildbot.libretro.com',
  'dl.dolphin-emu.org',
  'www.pj64-emu.com'
])

export function validatedRetroDownloadUrl(value: string): string {
  const url = new URL(value)
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    !TRUSTED_DOWNLOAD_HOSTS.has(url.hostname.toLocaleLowerCase('en-US'))
  ) {
    throw new Error('Untrusted emulator download URL')
  }
  return url.toString()
}

export function validateArchiveEntryPath(entryPath: string): string {
  const normalized = entryPath.replace(/\\/gu, '/').normalize('NFKC')
  if (
    !normalized ||
    normalized.includes('\0') ||
    normalized.startsWith('/') ||
    /^[a-z]:\//iu.test(normalized) ||
    normalized.split('/').some((part) => part === '..')
  ) {
    throw new Error('Unsafe emulator archive entry')
  }
  return normalized
}
