import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getVdfValue, parseVdf, vdfObject, vdfString, type VdfObject } from './vdf'

export interface InstalledSteamApp {
  appId: number
  name: string
  installDir: string
  updateAvailable: boolean
  lastPlayedTimestamp?: number
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

function getLibraryFolders(steamPath: string): string[] {
  const vdfPath = join(steamPath, 'steamapps', 'libraryfolders.vdf')
  if (!existsSync(vdfPath)) return [steamPath]

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
    return [...uniquePaths.values()]
  } catch {
    return [steamPath]
  }
}

export function getSteamAppsDirectories(): string[] {
  const steamPath = getSteamInstallPath()
  if (!steamPath) return []
  return getLibraryFolders(steamPath)
    .map((libraryPath) => join(libraryPath, 'steamapps'))
    .filter((steamappsDir) => existsSync(steamappsDir))
}

function getLocalLastPlayed(steamPath: string, steamId?: string): Map<number, number> {
  const result = new Map<number, number>()
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
      const lastPlayed = Number(vdfString(getVdfValue(vdfObject(value), 'LastPlayed')))
      if (Number.isFinite(lastPlayed) && lastPlayed > 0) result.set(Number(rawAppId), lastPlayed)
    }
  } catch {
    // A corrupt local config must not prevent installed-game discovery.
  }

  return result
}

function manifestRoot(source: string): VdfObject {
  const parsed = parseVdf(source)
  return vdfObject(getVdfValue(parsed, 'AppState')) ?? parsed
}

/**
 * Reads Steam's own libraryfolders.vdf and appmanifest files. As in Playnite,
 * only records with the FullyInstalled state and an existing install directory
 * are admitted. Steamworks Common Redistributables and soundtracks are skipped.
 */
export function scanInstalledSteamApps(steamId?: string): Map<number, InstalledSteamApp> {
  const result = new Map<number, InstalledSteamApp>()
  const steamPath = getSteamInstallPath()
  if (!steamPath) return result

  const lastPlayed = getLocalLastPlayed(steamPath, steamId)
  for (const libraryPath of getLibraryFolders(steamPath)) {
    const steamappsDir = join(libraryPath, 'steamapps')
    if (!existsSync(steamappsDir)) continue

    let files: string[]
    try {
      files = readdirSync(steamappsDir)
    } catch {
      continue
    }

    for (const file of files) {
      if (!file.startsWith('appmanifest_') || !file.endsWith('.acf')) continue
      try {
        const manifest = manifestRoot(readFileSync(join(steamappsDir, file), 'utf8'))
        const appId = Number(vdfString(getVdfValue(manifest, 'appid')))
        const stateFlags = Number(vdfString(getVdfValue(manifest, 'StateFlags')))
        const bytesToDownload = Number(vdfString(getVdfValue(manifest, 'BytesToDownload')))
        const bytesDownloaded = Number(vdfString(getVdfValue(manifest, 'BytesDownloaded')))
        const userConfig = vdfObject(getVdfValue(manifest, 'UserConfig'))
        const name =
          vdfString(getVdfValue(manifest, 'name')) ?? vdfString(getVdfValue(userConfig, 'name'))
        const installDirName = vdfString(getVdfValue(manifest, 'installdir'))

        if (
          !Number.isInteger(appId) ||
          appId <= 0 ||
          appId === STEAM_REDISTRIBUTABLES_APP_ID ||
          !Number.isFinite(stateFlags) ||
          (stateFlags & FULLY_INSTALLED_FLAG) === 0 ||
          !name ||
          !installDirName
        ) {
          continue
        }

        const installDir = join(steamappsDir, 'common', installDirName)
        if (!existsSync(installDir)) continue
        const hasPendingDownload =
          Number.isFinite(bytesToDownload) &&
          Number.isFinite(bytesDownloaded) &&
          bytesToDownload > 0 &&
          bytesDownloaded < bytesToDownload

        result.set(appId, {
          appId,
          name: name.trim(),
          installDir,
          updateAvailable: (stateFlags & UPDATE_REQUIRED_FLAG) !== 0 || hasPendingDownload,
          lastPlayedTimestamp: lastPlayed.get(appId)
        })
      } catch {
        // One unreadable/corrupt manifest must not abort the remaining library.
      }
    }
  }

  return result
}

