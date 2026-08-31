import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { shell } from 'electron'
import type {
  PlayStationRemotePlayAppId,
  PlayStationRemotePlayPreference,
  PlayStationRemotePlayStatus
} from '@shared/ipc'
import { selectPlayStationRemotePlayApp } from '@shared/playstation'
import { settingsStore } from '../settingsStore'

const execFileAsync = promisify(execFile)
const CACHE_MAX_AGE_MS = 15_000
const CHIAKI_DOWNLOAD_URL = 'https://github.com/streetpea/chiaki-ng/releases/latest'
const OFFICIAL_DOWNLOAD_URL = 'https://remoteplay.dl.playstation.net/remoteplay/'

interface DetectedRemotePlayApp {
  id: PlayStationRemotePlayAppId
  name: string
  executablePath: string
  executableName: string
}

const APP_NAMES: Record<PlayStationRemotePlayAppId, string> = {
  chiaki: 'Chiaki-ng',
  'ps-remote-play': 'PS Remote Play'
}

function uniqueExisting(paths: Iterable<string | undefined>): string[] {
  return [...new Set([...paths].filter((value): value is string => Boolean(value?.trim())))]
    .map((value) => value.replace(/^"|"$/g, '').trim())
    .filter((value) => value.toLowerCase().endsWith('.exe') && existsSync(value))
}

function directCandidates(): Record<PlayStationRemotePlayAppId, string[]> {
  const programFiles = process.env.ProgramFiles
  const programFilesX86 = process.env['ProgramFiles(x86)']
  const localAppData = process.env.LOCALAPPDATA
  const userProfile = process.env.USERPROFILE
  const chocolateyInstall = process.env.ChocolateyInstall ?? 'C:\\ProgramData\\chocolatey'
  return {
    chiaki: uniqueExisting([
      programFiles && join(programFiles, 'chiaki-ng', 'chiaki.exe'),
      programFiles && join(programFiles, 'Chiaki', 'chiaki.exe'),
      programFilesX86 && join(programFilesX86, 'chiaki-ng', 'chiaki.exe'),
      localAppData && join(localAppData, 'Programs', 'chiaki-ng', 'chiaki.exe'),
      localAppData && join(localAppData, 'chiaki-ng', 'chiaki.exe'),
      userProfile && join(userProfile, 'scoop', 'apps', 'chiaki-ng', 'current', 'chiaki.exe'),
      join(chocolateyInstall, 'bin', 'chiaki.exe')
    ]),
    'ps-remote-play': uniqueExisting([
      programFilesX86 && join(programFilesX86, 'Sony', 'PS Remote Play', 'RemotePlay.exe'),
      programFiles && join(programFiles, 'Sony', 'PS Remote Play', 'RemotePlay.exe'),
      localAppData && join(localAppData, 'Programs', 'PS Remote Play', 'RemotePlay.exe')
    ])
  }
}

async function runRegistry(args: string[]): Promise<string> {
  if (process.platform !== 'win32') return ''
  try {
    const result = await execFileAsync('reg.exe', args, {
      windowsHide: true,
      timeout: 5_000,
      maxBuffer: 2 * 1024 * 1024
    })
    return result.stdout
  } catch {
    return ''
  }
}

function registryKeys(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^HKEY_(?:CURRENT_USER|LOCAL_MACHINE)\\/i.test(line))
}

function registryValue(output: string, name: string): string | undefined {
  const pattern = new RegExp(`^\\s*${name}\\s+REG_(?:SZ|EXPAND_SZ)\\s+(.+)$`, 'im')
  return pattern.exec(output)?.[1]?.trim().replace(/^"|"$/g, '')
}

function executableFromRegistry(output: string, id: PlayStationRemotePlayAppId): string[] {
  const displayIcon = registryValue(output, 'DisplayIcon')?.replace(/,\s*-?\d+$/, '')
  const installLocation = registryValue(output, 'InstallLocation')
  const executableNames = id === 'chiaki' ? ['chiaki.exe', 'chiaki-ng.exe'] : ['RemotePlay.exe']
  return uniqueExisting([
    displayIcon,
    ...executableNames.map((name) => (installLocation ? join(installLocation, name) : undefined))
  ])
}

async function registryCandidates(
  id: PlayStationRemotePlayAppId,
  searchTerm: string
): Promise<string[]> {
  const roots = [
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
  ]
  const searches = await Promise.all(
    roots.map((root) => runRegistry(['query', root, '/s', '/f', searchTerm, '/d']))
  )
  const keys = [...new Set(searches.flatMap(registryKeys))].slice(0, 12)
  const entries = await Promise.all(keys.map((key) => runRegistry(['query', key])))
  return uniqueExisting(entries.flatMap((entry) => executableFromRegistry(entry, id)))
}

async function detectApps(): Promise<Map<PlayStationRemotePlayAppId, DetectedRemotePlayApp>> {
  if (process.platform !== 'win32') return new Map()
  const direct = directCandidates()
  const [chiakiRegistry, officialRegistry] = await Promise.all([
    registryCandidates('chiaki', 'Chiaki'),
    registryCandidates('ps-remote-play', 'PS Remote Play')
  ])
  const candidates: Record<PlayStationRemotePlayAppId, string[]> = {
    chiaki: uniqueExisting([...direct.chiaki, ...chiakiRegistry]),
    'ps-remote-play': uniqueExisting([...direct['ps-remote-play'], ...officialRegistry])
  }
  const apps = new Map<PlayStationRemotePlayAppId, DetectedRemotePlayApp>()
  for (const id of ['chiaki', 'ps-remote-play'] as const) {
    const executablePath = candidates[id][0]
    if (!executablePath) continue
    apps.set(id, {
      id,
      name: APP_NAMES[id],
      executablePath,
      executableName: executablePath.split(/[\\/]/).pop() ?? ''
    })
  }
  return apps
}

function selectedApp(
  apps: ReadonlyMap<PlayStationRemotePlayAppId, DetectedRemotePlayApp>,
  preference: PlayStationRemotePlayPreference
): DetectedRemotePlayApp | undefined {
  const id = selectPlayStationRemotePlayApp(apps.keys(), preference)
  return id ? apps.get(id) : undefined
}

export class PlayStationRemotePlayService {
  private apps = new Map<PlayStationRemotePlayAppId, DetectedRemotePlayApp>()
  private checkedAt = 0
  private detectionInFlight: Promise<PlayStationRemotePlayStatus> | null = null

  getCachedStatus(): PlayStationRemotePlayStatus {
    const preference = settingsStore.get('playstationRemotePlayPreference')
    const selected = selectedApp(this.apps, preference)
    return {
      platform: process.platform === 'win32' ? 'windows' : 'unsupported',
      apps: (['chiaki', 'ps-remote-play'] as const).map((id) => ({
        id,
        name: APP_NAMES[id],
        installed: this.apps.has(id)
      })),
      preference,
      selectedApp: selected?.id,
      checkedAt: this.checkedAt
    }
  }

  async refresh(force = false): Promise<PlayStationRemotePlayStatus> {
    if (!force && this.checkedAt > 0 && Date.now() - this.checkedAt < CACHE_MAX_AGE_MS) {
      return this.getCachedStatus()
    }
    if (this.detectionInFlight) return this.detectionInFlight
    const detection = detectApps()
      .then((apps) => {
        this.apps = apps
        this.checkedAt = Date.now()
        return this.getCachedStatus()
      })
      .finally(() => {
        if (this.detectionInFlight === detection) this.detectionInFlight = null
      })
    this.detectionInFlight = detection
    return detection
  }

  async selectedExecutableName(): Promise<string | undefined> {
    await this.refresh()
    return selectedApp(this.apps, settingsStore.get('playstationRemotePlayPreference'))
      ?.executableName
  }

  async launch(openDownloadIfMissing = true): Promise<number | undefined> {
    await this.refresh(true)
    const preference = settingsStore.get('playstationRemotePlayPreference')
    const app = selectedApp(this.apps, preference)
    if (!app) {
      if (openDownloadIfMissing) {
        const downloadUrl =
          preference === 'ps-remote-play' ? OFFICIAL_DOWNLOAD_URL : CHIAKI_DOWNLOAD_URL
        await shell.openExternal(downloadUrl)
      }
      return undefined
    }
    return new Promise((resolve, reject) => {
      const child = spawn(app.executablePath, [], {
        cwd: dirname(app.executablePath),
        detached: true,
        shell: false,
        stdio: 'ignore',
        windowsHide: false
      })
      child.once('error', reject)
      child.once('spawn', () => resolve(child.pid))
      child.unref()
    })
  }
}

export const playStationRemotePlayService = new PlayStationRemotePlayService()
