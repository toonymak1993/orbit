import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getVdfValue, parseVdf, vdfObject, vdfString } from './vdf'
import { parseSteamAppManifest } from './steamManifest'

export interface InstalledSteamApp {
  appId: number
  name: string
  installDir: string
  updateAvailable: boolean
  playtimeSeconds?: number
  lastPlayedTimestamp?: number
}

export interface SteamLocalAppActivity {
  playtimeSeconds?: number
  lastPlayedTimestamp?: number
}

export interface InstalledSteamSnapshot {
  games: Map<number, InstalledSteamApp>
  /** False means at least one configured library or manifest was unreadable. */
  complete: boolean
}

interface SteamLibraryFoldersSnapshot {
  paths: string[]
  complete: boolean
}

const FULLY_INSTALLED_FLAG = 4
const UPDATE_REQUIRED_FLAG = 2
const STEAM_REDISTRIBUTABLES_APP_ID = 228980
const STEAM_ID64_BASE = 76561197960265728n

export function getSteamInstallPath(): string | null {
  try {
    const output = execFileSync(
      'reg',
      ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'],
      { encoding: 'utf8' }
    )
    const match = output.match(/SteamPath\s+REG_SZ\s+(.+)/)
    if (match) return match[1].trim().replace(/\//g, '\\')
  } catch {
    // Registry lookup failed; fall through to common installation paths.
  }

  const defaults = ['C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam']
  return defaults.find((path) => existsSync(path)) ?? null
}

function getLibraryFolders(steamPath: string): SteamLibraryFoldersSnapshot {
  const vdfPath = join(steamPath, 'steamapps', 'libraryfolders.vdf')
  if (!existsSync(vdfPath)) return { paths: [steamPath], complete: true }

  try {
    const root = parseVdf(readFileSync(vdfPath, 'utf8'))
    const libraries = vdfObject(getVdfValue(root, 'libraryfolders')) ?? root
    const paths = new Set<string>([steamPath])
    for (const [key, value] of Object.entries(libraries)) {
      if (!/^\d+$/.test(key)) continue
      if (typeof value === 'string') paths.add(value)
      else {
        const path = vdfString(getVdfValue(value, 'path'))
        if (path) paths.add(path)
      }
    }
    const uniquePaths = new Map<string, string>()
    for (const libraryPath of paths) {
      uniquePaths.set(libraryPath.replace(/\//g, '\\').toLocaleLowerCase('en'), libraryPath)
    }
    return { paths: [...uniquePaths.values()], complete: true }
  } catch {
    return { paths: [steamPath], complete: false }
  }
}

export function getSteamAppsDirectories(): string[] {
  const steamPath = getSteamInstallPath()
  if (!steamPath) return []
  return getLibraryFolders(steamPath).paths
    .map((libraryPath) => join(libraryPath, 'steamapps'))
    .filter((steamappsDir) => existsSync(steamappsDir))
}

function getLocalAppActivity(
  steamPath: string,
  steamId?: string
): Map<number, SteamLocalAppActivity> {
  const result = new Map<number, SteamLocalAppActivity>()
  if (!steamId || !/^\d{17}$/.test(steamId)) return result

  let accountId: string
  try {
    accountId = (BigInt(steamId) - STEAM_ID64_BASE).toString()
  } catch {
    return result
  }

  const configPath = join(steamPath, 'userdata', accountId, 'config', 'localconfig.vdf')
  if (!existsSync(configPath)) return result

  try {
    const root = parseVdf(readFileSync(configPath, 'utf8'))
    const userLocalConfig = vdfObject(getVdfValue(root, 'UserLocalConfigStore')) ?? root
    const software = vdfObject(getVdfValue(userLocalConfig, 'Software'))
    const valve = vdfObject(getVdfValue(software, 'Valve'))
    const steam = vdfObject(getVdfValue(valve, 'Steam'))
    const apps = vdfObject(getVdfValue(steam, 'apps'))
    if (!apps) return result

    for (const [rawAppId, value] of Object.entries(apps)) {
      if (!/^\d+$/.test(rawAppId)) continue
      const app = vdfObject(value)
      const lastPlayed = Number(vdfString(getVdfValue(app, 'LastPlayed')))
      const playtimeMinutes = Number(vdfString(getVdfValue(app, 'Playtime')))
      const activity: SteamLocalAppActivity = {
        lastPlayedTimestamp:
          Number.isFinite(lastPlayed) && lastPlayed > 0 ? lastPlayed : undefined,
        playtimeSeconds:
          Number.isFinite(playtimeMinutes) && playtimeMinutes >= 0
            ? Math.round(playtimeMinutes * 60)
            : undefined
      }
      if (activity.lastPlayedTimestamp !== undefined || activity.playtimeSeconds !== undefined) {
        result.set(Number(rawAppId), activity)
      }
    }
  } catch {
    // A corrupt local config must not prevent installed-game discovery.
  }

  return result
}

/** Reads Steam's own per-account activity cache, including uninstalled library games. */
export function scanSteamLocalActivity(steamId?: string): Map<number, SteamLocalAppActivity> {
  const steamPath = getSteamInstallPath()
  return steamPath ? getLocalAppActivity(steamPath, steamId) : new Map()
}

/**
 * Reads Steam's own libraryfolders.vdf and appmanifest files. As in Playnite,
 * only records with the FullyInstalled state and an existing install directory
 * are admitted. Steamworks Common Redistributables and soundtracks are skipped.
 */
export function scanInstalledSteamAppsSnapshot(steamId?: string): InstalledSteamSnapshot {
  const result = new Map<number, InstalledSteamApp>()
  const steamPath = getSteamInstallPath()
  if (!steamPath) return { games: result, complete: false }

  const localActivity = getLocalAppActivity(steamPath, steamId)
  const libraries = getLibraryFolders(steamPath)
  let complete = libraries.complete
  for (const libraryPath of libraries.paths) {
    const steamappsDir = join(libraryPath, 'steamapps')
    if (!existsSync(steamappsDir)) {
      complete = false
      continue
    }

    let files: string[]
    try {
      files = readdirSync(steamappsDir)
    } catch {
      complete = false
      continue
    }

    for (const file of files) {
      if (!file.startsWith('appmanifest_') || !file.endsWith('.acf')) continue
      try {
        const manifest = parseSteamAppManifest(readFileSync(join(steamappsDir, file), 'utf8'))
        const { appId, stateFlags, bytesToDownload, bytesDownloaded, name, installDirName } =
          manifest

        if (
          !appId ||
          appId <= 0 ||
          appId === STEAM_REDISTRIBUTABLES_APP_ID ||
          stateFlags === undefined ||
          (stateFlags & FULLY_INSTALLED_FLAG) === 0 ||
          !name ||
          !installDirName
        ) {
          continue
        }

        const installDir = join(steamappsDir, 'common', installDirName)
        if (!existsSync(installDir)) {
          complete = false
          continue
        }
        const hasPendingDownload =
          bytesToDownload !== undefined &&
          bytesDownloaded !== undefined &&
          bytesToDownload > 0 &&
          bytesDownloaded < bytesToDownload

        const activity = localActivity.get(appId)
        result.set(appId, {
          appId,
          name: name.trim(),
          installDir,
          updateAvailable: (stateFlags & UPDATE_REQUIRED_FLAG) !== 0 || hasPendingDownload,
          playtimeSeconds: activity?.playtimeSeconds,
          lastPlayedTimestamp: activity?.lastPlayedTimestamp
        })
      } catch {
        // Keep scanning, but do not let a partial result clear cached installs.
        complete = false
      }
    }
  }

  return { games: result, complete }
}

export function scanInstalledSteamApps(steamId?: string): Map<number, InstalledSteamApp> {
  return scanInstalledSteamAppsSnapshot(steamId).games
}

