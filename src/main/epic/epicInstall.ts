import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, normalize } from 'node:path'
import type { GameMetadata } from '@shared/ipc'

interface LauncherInstalledFile {
  InstallationList?: EpicInstalledApp[]
}

interface EpicInstalledApp {
  InstallLocation?: string
  AppName?: string
  ArtifactId?: string
  AppID?: number
  AppVersion?: string
}

export interface EpicInstalledManifest {
  LaunchCommand?: string
  LaunchExecutable?: string
  bIsApplication?: boolean
  bIsExecutable?: boolean
  AppName?: string
  CatalogNamespace?: string
  AppCategories?: string[]
  CompatibleApps?: string[]
  DisplayName?: string
  FullAppName?: string
  InstallLocation?: string
  TechnicalType?: string
  VaultThumbnailUrl?: string
  MainGameAppName?: string
}

export interface InstalledEpicGame {
  providerGameId: string
  name: string
  installDir: string
  metadata: GameMetadata
}

function parseJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T
  } catch {
    return null
  }
}

function isHttps(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('https://')
}

function normalizedValues(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean)
}

function isLaunchableGame(manifest: EpicInstalledManifest): boolean {
  const appName = manifest.AppName?.trim()
  if (!appName || appName.toUpperCase().startsWith('UE_')) return false

  const categories = normalizedValues(manifest.AppCategories)
  const compatibleApps = normalizedValues(manifest.CompatibleApps)
  const technicalType = manifest.TechnicalType?.toLowerCase() ?? ''

  // Playnite's filters: ordinary DLC, Unreal Engine plugins and engine content
  // are not standalone games. Launchable add-ons remain valid.
  if (categories.includes('addons') && !categories.includes('addons/launchable')) return false
  if (categories.some((value) => value === 'plugins' || value === 'plugins/engine')) return false
  if (compatibleApps.some((value) => value.startsWith('ue_'))) return false
  if (technicalType.includes('plugins/engine')) return false
  return true
}

function epicProgramDataRoot(programDataRoot?: string): string {
  return join(programDataRoot ?? process.env.ProgramData ?? 'C:\\ProgramData', 'Epic')
}

export function getEpicLauncherInstallPath(): string | null {
  const executable = (root: string): string =>
    join(root, 'Launcher', 'Portal', 'Binaries', 'Win32', 'EpicGamesLauncher.exe')
  const executable64 = (root: string): string =>
    join(root, 'Launcher', 'Portal', 'Binaries', 'Win64', 'EpicGamesLauncher.exe')

  try {
    const output = execFileSync(
      'reg',
      [
        'query',
        'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
        '/s',
        '/f',
        'Epic Games Launcher'
      ],
      { encoding: 'utf8', windowsHide: true }
    )
    const locations = [...output.matchAll(/InstallLocation\s+REG_SZ\s+(.+)/gi)].map((match) =>
      match[1].trim()
    )
    for (const location of locations) {
      if (existsSync(executable(location)) || existsSync(executable64(location))) return location
    }
  } catch {
    // Missing registry entries are common after launcher updates.
  }

  for (const root of ['C:\\Program Files (x86)\\Epic Games', 'C:\\Program Files\\Epic Games']) {
    if (existsSync(executable(root)) || existsSync(executable64(root))) return root
  }
  return null
}

export function getEpicPortalConfigPath(): string | null {
  const root = getEpicLauncherInstallPath()
  if (!root) return null
  const config = join(root, 'Launcher', 'Portal', 'Config', 'DefaultPortalRegions.ini')
  return existsSync(config) ? config : null
}

/**
 * Mirrors Playnite's local Epic import. Both Epic files are required and joined
 * by AppName; malformed manifests, stale paths, DLC and Unreal content are
 * ignored independently so one bad entry cannot poison the library.
 */
export function scanInstalledEpicApps(programDataRoot?: string): Map<string, InstalledEpicGame> {
  const result = new Map<string, InstalledEpicGame>()
  const epicRoot = epicProgramDataRoot(programDataRoot)
  const installedPath = join(epicRoot, 'UnrealEngineLauncher', 'LauncherInstalled.dat')
  const manifestsPath = join(epicRoot, 'EpicGamesLauncher', 'Data', 'Manifests')
  if (!existsSync(installedPath) || !existsSync(manifestsPath)) return result

  const launcherData = parseJsonFile<LauncherInstalledFile>(installedPath)
  if (!launcherData?.InstallationList?.length) return result

  const manifests = new Map<string, EpicInstalledManifest>()
  let manifestFiles: string[] = []
  try {
    manifestFiles = readdirSync(manifestsPath).filter((file) => file.toLowerCase().endsWith('.item'))
  } catch {
    return result
  }
  for (const file of manifestFiles) {
    const manifest = parseJsonFile<EpicInstalledManifest>(join(manifestsPath, file))
    const appName = manifest?.AppName?.trim()
    if (manifest && appName) manifests.set(appName.toLowerCase(), manifest)
  }

  for (const app of launcherData.InstallationList) {
    const appName = app.AppName?.trim()
    if (!appName || appName.toUpperCase().startsWith('UE_')) continue
    const manifest = manifests.get(appName.toLowerCase())
    if (!manifest || !isLaunchableGame(manifest)) continue

    const preferredLocation = app.InstallLocation?.trim()
    const manifestLocation = manifest.InstallLocation?.trim()
    const installDir =
      preferredLocation && existsSync(preferredLocation)
        ? preferredLocation
        : manifestLocation && existsSync(manifestLocation)
          ? manifestLocation
          : null
    if (!installDir) continue

    const name = manifest.DisplayName?.trim() || manifest.FullAppName?.trim()
    if (!name) continue
    const thumbnail = isHttps(manifest.VaultThumbnailUrl) ? manifest.VaultThumbnailUrl : undefined
    result.set(appName, {
      providerGameId: appName,
      name,
      installDir: normalize(installDir),
      metadata: {
        platforms: ['windows'],
        launchExecutable: manifest.LaunchExecutable?.trim() || undefined,
        artwork: thumbnail
          ? { vertical: [thumbnail], horizontal: [thumbnail] }
          : undefined
      }
    })
  }

  return result
}
