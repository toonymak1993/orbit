import { app, BrowserWindow, dialog, shell } from 'electron'
import Store from 'electron-store'
import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import type {
  ApplicationLaunchResult,
  CustomApplicationCommitInput,
  CustomApplicationDraft,
  CustomApplicationUpdateInput,
  OrbitApplication,
  OrbitApplicationSnapshot
} from '@shared/ipc'
import {
  normalizeCustomLaunchArguments,
  parseCustomLaunchArguments
} from './customLaunchArguments'
import { revealOrbitWindow } from './orbitWindow'
import { playStationRemotePlayService } from './playstation/remotePlay'
import { settingsStore } from './settingsStore'
import { MediaControllerBridge } from './mediaControllerBridge'
import { netflixMediaService } from './netflixMediaService'

interface StoredCustomApplication {
  id: string
  name: string
  executablePath: string
  launchArguments?: string
}

interface ApplicationStoreSchema {
  applications: StoredCustomApplication[]
}

interface NativeApplicationTarget {
  executablePath: string
  arguments: string[]
  iconPath?: string
}

type GraphicsCompanionVendor = 'amd' | 'nvidia' | 'intel'

interface GraphicsEnvironment {
  detectionAvailable: boolean
  vendors: Set<GraphicsCompanionVendor>
  intelAppUserModelId?: string
}

const BUILTIN_NETFLIX_ID = 'builtin:netflix-web'
const BUILTIN_YOUTUBE_TV_ID = 'builtin:youtube-tv'
const BUILTIN_SPOTIFY_ID = 'builtin:spotify'
const BUILTIN_DISCORD_ID = 'builtin:discord'
const BUILTIN_AMD_SOFTWARE_ID = 'builtin:amd-software'
const BUILTIN_NVIDIA_APP_ID = 'builtin:nvidia-app'
const BUILTIN_INTEL_GRAPHICS_ID = 'builtin:intel-graphics'
const LAUNCHER_STEAM_ID = 'launcher:steam'
const LAUNCHER_EPIC_ID = 'launcher:epic'
const LAUNCHER_GOG_ID = 'launcher:gog'
const LAUNCHER_XBOX_ID = 'launcher:xbox'
const LAUNCHER_PLAYSTATION_ID = 'launcher:playstation'
const LAUNCHER_EA_ID = 'launcher:ea'
const LAUNCHER_UBISOFT_ID = 'launcher:ubisoft'
const SNAPSHOT_TTL_MS = 15_000
const YOUTUBE_TV_URL = 'https://www.youtube.com/tv#/'
const YOUTUBE_TV_LOAD_TIMEOUT_MS = 25_000
const YOUTUBE_TV_USER_AGENT =
  'Mozilla/5.0 (SMART-TV; LINUX; Tizen 7.0) AppleWebKit/537.36 (KHTML, like Gecko) 94.0.4606.31/7.0 TV Safari/537.36'
const GRAPHICS_ENVIRONMENT_MARKER = 'ORBIT_GRAPHICS_ENVIRONMENT:'
const GRAPHICS_ENVIRONMENT_SCRIPT = String.raw`
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$result = [ordered]@{
  detectionAvailable = $false
  adapters = @()
  intelStartApps = @()
}

try {
  $result.adapters = @(Get-CimInstance -ClassName Win32_VideoController | ForEach-Object {
    [ordered]@{
      name = [string]$_.Name
      manufacturer = [string]$_.AdapterCompatibility
      hardwareId = [string]$_.PNPDeviceID
    }
  })
  $result.detectionAvailable = $true
} catch {}

try {
  $result.intelStartApps = @(Get-StartApps | Where-Object {
    $appId = [string]$_.AppID
    $appId -match '^AppUp\.Intel(?:ArcSoftware|GraphicsExperience)_.+!.+$'
  } | ForEach-Object {
    [ordered]@{
      name = [string]$_.Name
      appId = [string]$_.AppID
    }
  })
} catch {}

$json = $result | ConvertTo-Json -Depth 5 -Compress
[Console]::Out.WriteLine('${GRAPHICS_ENVIRONMENT_MARKER}' + $json)
`
const execFileAsync = promisify(execFile)

const applicationStore = new Store<ApplicationStoreSchema>({
  name: 'orbit-applications',
  defaults: { applications: [] }
})

function normalizedApplicationName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid application name')
  const normalized = value.trim()
  if (!normalized || normalized.length > 120 || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new Error('Invalid application name')
  }
  return normalized
}

function validatedApplicationId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 160) {
    throw new Error('Invalid application ID')
  }
  return value.trim()
}

function isExecutablePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 32_768 &&
    isAbsolute(value) &&
    extname(value).toLowerCase() === '.exe'
  )
}

function firstExistingPath(paths: Array<string | undefined>): string | undefined {
  return paths.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)))
}

async function runRegistryQuery(args: string[]): Promise<string> {
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
  const match = new RegExp(`^\\s*${name}\\s+REG_(?:SZ|EXPAND_SZ)\\s+(.+)$`, 'im').exec(output)
  return match?.[1]?.trim().replace(/^"|"$/g, '')
}

async function registryLauncherExecutable(
  searchTerms: string[],
  relativeExecutables: string[]
): Promise<string | undefined> {
  const roots = [
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
  ]
  const searches = await Promise.all(
    roots.flatMap((root) =>
      searchTerms.map((term) => runRegistryQuery(['query', root, '/s', '/f', term, '/d']))
    )
  )
  const keys = [...new Set(searches.flatMap(registryKeys))].slice(0, 18)
  const entries = await Promise.all(keys.map((key) => runRegistryQuery(['query', key])))
  for (const entry of entries) {
    const displayIcon = registryValue(entry, 'DisplayIcon')
      ?.replace(/,\s*-?\d+$/, '')
      .replace(/^"|"$/g, '')
    const installLocation = registryValue(entry, 'InstallLocation')
    const expectedNames = new Set(
      relativeExecutables.map((relativePath) => basename(relativePath).toLowerCase())
    )
    const displayExecutable =
      displayIcon && expectedNames.has(basename(displayIcon).toLowerCase())
        ? displayIcon
        : undefined
    const executable = firstExistingPath([
      ...relativeExecutables.map((relativePath) =>
        installLocation ? join(installLocation, relativePath) : undefined
      ),
      displayExecutable
    ])
    if (executable) return executable
  }
  return undefined
}

async function registrySteamExecutable(): Promise<string | undefined> {
  const output = await runRegistryQuery([
    'query',
    'HKCU\\Software\\Valve\\Steam',
    '/v',
    'SteamPath'
  ])
  const root = /SteamPath\s+REG_SZ\s+(.+)/i.exec(output)?.[1]?.trim().replace(/\//g, '\\')
  return root ? firstExistingPath([join(root, 'steam.exe')]) : undefined
}

function findDiscordExecutable(localAppData: string | undefined): string | undefined {
  if (!localAppData) return undefined
  const discordRoot = join(localAppData, 'Discord')
  if (!existsSync(discordRoot)) return undefined
  let versions: string[] = []
  try {
    versions = readdirSync(discordRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^app-\d/i.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
  } catch {
    return undefined
  }
  return firstExistingPath(versions.map((version) => join(discordRoot, version, 'Discord.exe')))
}

interface DiscoveredNativeApplication {
  application: OrbitApplication
  target?: NativeApplicationTarget
}

function nativeApplication(
  id: string,
  name: string,
  category: OrbitApplication['category'],
  executablePath: string | undefined
): DiscoveredNativeApplication {
  return {
    application: {
      id,
      name,
      category,
      target: 'native',
      available: Boolean(executablePath),
      issue: executablePath ? undefined : 'executable-missing',
      controllerOptimized: false
    },
    target: executablePath
      ? { executablePath, arguments: [], iconPath: executablePath }
      : undefined
  }
}

function appUserModelApplication(
  id: string,
  name: string,
  appUserModelId: string | undefined
): DiscoveredNativeApplication | undefined {
  const windowsDirectory = process.env.WINDIR ?? 'C:\\Windows'
  const explorerPath = firstExistingPath([join(windowsDirectory, 'explorer.exe')])
  if (!appUserModelId || !explorerPath) return undefined
  return {
    application: {
      id,
      name,
      category: 'standard',
      target: 'native',
      available: true,
      controllerOptimized: false
    },
    target: {
      executablePath: explorerPath,
      arguments: [`shell:AppsFolder\\${appUserModelId}`]
    }
  }
}

function graphicsVendorFromText(value: string): GraphicsCompanionVendor | undefined {
  const normalized = value.toLowerCase()
  if (normalized.includes('nvidia') || normalized.includes('ven_10de')) return 'nvidia'
  if (
    normalized.includes('advanced micro devices') ||
    normalized.includes('radeon') ||
    normalized.includes('ven_1002') ||
    /(?:^|\s)amd(?:\s|$)/u.test(normalized)
  ) {
    return 'amd'
  }
  if (normalized.includes('intel') || normalized.includes('ven_8086')) return 'intel'
  return undefined
}

function validatedAppUserModelId(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 240) return undefined
  return /^[a-z0-9._-]+![a-z0-9._-]+$/iu.test(value) ? value : undefined
}

async function detectGraphicsEnvironment(): Promise<GraphicsEnvironment> {
  if (process.platform !== 'win32') {
    return { detectionAvailable: false, vendors: new Set() }
  }
  try {
    const encoded = Buffer.from(GRAPHICS_ENVIRONMENT_SCRIPT, 'utf16le').toString('base64')
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: 8_000, maxBuffer: 512 * 1024 }
    )
    const markerIndex = stdout.lastIndexOf(GRAPHICS_ENVIRONMENT_MARKER)
    if (markerIndex < 0) throw new Error('Graphics environment marker missing')
    const parsed = JSON.parse(stdout.slice(markerIndex + GRAPHICS_ENVIRONMENT_MARKER.length)) as {
      detectionAvailable?: unknown
      adapters?: unknown
      intelStartApps?: unknown
    }
    const vendors = new Set<GraphicsCompanionVendor>()
    if (Array.isArray(parsed.adapters)) {
      for (const adapter of parsed.adapters) {
        if (!adapter || typeof adapter !== 'object') continue
        const record = adapter as Record<string, unknown>
        const vendor = graphicsVendorFromText(
          [record.name, record.manufacturer, record.hardwareId]
            .filter((part): part is string => typeof part === 'string')
            .join(' ')
        )
        if (vendor) vendors.add(vendor)
      }
    }
    const intelStartApps = Array.isArray(parsed.intelStartApps)
      ? parsed.intelStartApps
          .map((entry) =>
            entry && typeof entry === 'object'
              ? validatedAppUserModelId((entry as Record<string, unknown>).appId)
              : undefined
          )
          .filter((value): value is string => Boolean(value))
      : []
    const intelAppUserModelId =
      intelStartApps.find((appId) => appId.includes('IntelArcSoftware_')) ?? intelStartApps[0]
    return {
      detectionAvailable: parsed.detectionAvailable === true,
      vendors,
      intelAppUserModelId
    }
  } catch {
    return { detectionAvailable: false, vendors: new Set() }
  }
}

function systemApplication(id: string, name: string, available: boolean): DiscoveredNativeApplication {
  return {
    application: {
      id,
      name,
      category: 'launcher',
      target: 'native',
      available,
      issue: available ? undefined : 'executable-missing',
      controllerOptimized: false
    }
  }
}

async function discoveredNativeApplications(): Promise<DiscoveredNativeApplication[]> {
  if (process.platform !== 'win32') return []
  const localAppData = process.env.LOCALAPPDATA
  const roamingAppData = process.env.APPDATA
  const programFiles = process.env.ProgramFiles
  const programFilesX86 = process.env['ProgramFiles(x86)']
  const graphicsEnvironmentPromise = detectGraphicsEnvironment()
  const spotify = firstExistingPath([
    roamingAppData ? join(roamingAppData, 'Spotify', 'Spotify.exe') : undefined,
    localAppData ? join(localAppData, 'Microsoft', 'WindowsApps', 'Spotify.exe') : undefined
  ])
  const discord = findDiscordExecutable(localAppData)
  const steamDirect = firstExistingPath([
    programFilesX86 ? join(programFilesX86, 'Steam', 'steam.exe') : undefined,
    programFiles ? join(programFiles, 'Steam', 'steam.exe') : undefined
  ])
  const epicRelativeExecutables = [
    join('Launcher', 'Portal', 'Binaries', 'Win64', 'EpicGamesLauncher.exe'),
    join('Launcher', 'Portal', 'Binaries', 'Win32', 'EpicGamesLauncher.exe')
  ]
  const epicDirect = firstExistingPath(
    [programFilesX86, programFiles].flatMap((root) =>
      epicRelativeExecutables.map((relativePath) =>
        root ? join(root, 'Epic Games', relativePath) : undefined
      )
    )
  )
  let gog = firstExistingPath([
    programFilesX86 ? join(programFilesX86, 'GOG Galaxy', 'GalaxyClient.exe') : undefined,
    programFiles ? join(programFiles, 'GOG Galaxy', 'GalaxyClient.exe') : undefined
  ])
  let ea = firstExistingPath([
    programFiles
      ? join(programFiles, 'Electronic Arts', 'EA Desktop', 'EA Desktop', 'EADesktop.exe')
      : undefined,
    programFilesX86
      ? join(programFilesX86, 'Electronic Arts', 'EA Desktop', 'EA Desktop', 'EADesktop.exe')
      : undefined
  ])
  let ubisoft = firstExistingPath([
    programFilesX86
      ? join(programFilesX86, 'Ubisoft', 'Ubisoft Game Launcher', 'UbisoftConnect.exe')
      : undefined,
    programFiles
      ? join(programFiles, 'Ubisoft', 'Ubisoft Game Launcher', 'UbisoftConnect.exe')
      : undefined,
    programFilesX86
      ? join(programFilesX86, 'Ubisoft', 'Ubisoft Game Launcher', 'upc.exe')
      : undefined,
    programFiles ? join(programFiles, 'Ubisoft', 'Ubisoft Game Launcher', 'upc.exe') : undefined
  ])
  const [steam, epic, registryGog, registryEa, registryUbisoft, graphicsEnvironment] =
    await Promise.all([
    steamDirect ? Promise.resolve(steamDirect) : registrySteamExecutable(),
    epicDirect
      ? Promise.resolve(epicDirect)
      : registryLauncherExecutable(['Epic Games Launcher'], epicRelativeExecutables),
    gog
      ? Promise.resolve(gog)
      : registryLauncherExecutable(['GOG Galaxy'], ['GalaxyClient.exe']),
    ea
      ? Promise.resolve(ea)
      : registryLauncherExecutable(
          ['EA app', 'EA Desktop'],
          ['EADesktop.exe', join('EA Desktop', 'EADesktop.exe')]
        ),
    ubisoft
      ? Promise.resolve(ubisoft)
      : registryLauncherExecutable(
          ['Ubisoft Connect', 'Ubisoft Game Launcher'],
          ['UbisoftConnect.exe', 'upc.exe']
        ),
    graphicsEnvironmentPromise
  ])
  gog = registryGog
  ea = registryEa
  ubisoft = registryUbisoft
  const xboxAvailable = Boolean(
    localAppData &&
      existsSync(join(localAppData, 'Packages', 'Microsoft.GamingApp_8wekyb3d8bbwe'))
  )
  const result: DiscoveredNativeApplication[] = [
    nativeApplication(LAUNCHER_STEAM_ID, 'Steam', 'launcher', steam),
    nativeApplication(LAUNCHER_EPIC_ID, 'Epic Games', 'launcher', epic),
    nativeApplication(LAUNCHER_GOG_ID, 'GOG Galaxy', 'launcher', gog),
    systemApplication(LAUNCHER_XBOX_ID, 'Xbox', xboxAvailable),
    systemApplication(LAUNCHER_PLAYSTATION_ID, 'PlayStation', false),
    nativeApplication(LAUNCHER_EA_ID, 'EA app', 'launcher', ea),
    nativeApplication(LAUNCHER_UBISOFT_ID, 'Ubisoft Connect', 'launcher', ubisoft)
  ]
  if (spotify) {
    result.push(nativeApplication(BUILTIN_SPOTIFY_ID, 'Spotify', 'media', spotify))
  }
  if (discord) {
    result.push(nativeApplication(BUILTIN_DISCORD_ID, 'Discord', 'standard', discord))
  }

  const shouldDiscoverVendor = (vendor: GraphicsCompanionVendor): boolean =>
    !graphicsEnvironment.detectionAvailable || graphicsEnvironment.vendors.has(vendor)
  const amdDirect = shouldDiscoverVendor('amd')
    ? firstExistingPath([
        programFiles ? join(programFiles, 'AMD', 'CNext', 'CNext', 'RadeonSoftware.exe') : undefined,
        programFiles ? join(programFiles, 'AMD', 'CNext', 'CNext', 'AMDSoftware.exe') : undefined
      ])
    : undefined
  const nvidiaDirect = shouldDiscoverVendor('nvidia')
    ? firstExistingPath([
        programFiles
          ? join(programFiles, 'NVIDIA Corporation', 'NVIDIA App', 'CEF', 'NVIDIA app.exe')
          : undefined,
        programFiles
          ? join(programFiles, 'NVIDIA Corporation', 'NVIDIA App', 'CEF', 'NVIDIAApp.exe')
          : undefined
      ])
    : undefined
  const intelDirect = shouldDiscoverVendor('intel')
    ? firstExistingPath([
        programFiles
          ? join(programFiles, 'Intel', 'Intel Graphics Software', 'IntelGraphicsSoftware.exe')
          : undefined,
        programFiles
          ? join(programFiles, 'Intel', 'Intel Graphics Software', 'Intel Graphics Software.exe')
          : undefined
      ])
    : undefined
  const intelStartApp = shouldDiscoverVendor('intel')
    ? appUserModelApplication(
        BUILTIN_INTEL_GRAPHICS_ID,
        graphicsEnvironment.intelAppUserModelId?.includes('IntelArcSoftware_')
          ? 'Intel Graphics Software'
          : 'Intel Graphics Command Center',
        graphicsEnvironment.intelAppUserModelId
      )
    : undefined
  const [amdSoftware, nvidiaApp, intelSoftware] = await Promise.all([
    shouldDiscoverVendor('amd')
      ? amdDirect
        ? Promise.resolve(amdDirect)
        : registryLauncherExecutable(
            ['AMD Software', 'AMD Radeon Software'],
            [
              'RadeonSoftware.exe',
              'AMDSoftware.exe',
              join('CNext', 'RadeonSoftware.exe'),
              join('CNext', 'CNext', 'RadeonSoftware.exe')
            ]
          )
      : Promise.resolve(undefined),
    shouldDiscoverVendor('nvidia')
      ? nvidiaDirect
        ? Promise.resolve(nvidiaDirect)
        : registryLauncherExecutable(
            ['NVIDIA App'],
            [
              'NVIDIA app.exe',
              'NVIDIAApp.exe',
              join('CEF', 'NVIDIA app.exe'),
              join('NVIDIA App', 'CEF', 'NVIDIA app.exe')
            ]
          )
      : Promise.resolve(undefined),
    shouldDiscoverVendor('intel') && !intelStartApp
      ? intelDirect
        ? Promise.resolve(intelDirect)
        : registryLauncherExecutable(
            ['Intel Graphics Software', 'Intel Graphics Command Center'],
            ['IntelGraphicsSoftware.exe', 'Intel Graphics Software.exe']
          )
      : Promise.resolve(undefined)
  ])
  if (amdSoftware) {
    result.push(
      nativeApplication(
        BUILTIN_AMD_SOFTWARE_ID,
        'AMD Software: Adrenalin Edition',
        'standard',
        amdSoftware
      )
    )
  }
  if (nvidiaApp) {
    result.push(
      nativeApplication(BUILTIN_NVIDIA_APP_ID, 'NVIDIA App', 'standard', nvidiaApp)
    )
  }
  if (intelStartApp) {
    result.push(intelStartApp)
  } else if (intelSoftware) {
    result.push(
      nativeApplication(
        BUILTIN_INTEL_GRAPHICS_ID,
        'Intel Graphics Software',
        'standard',
        intelSoftware
      )
    )
  }
  return result
}

async function iconDataUrl(executablePath: string): Promise<string | undefined> {
  try {
    const icon = await app.getFileIcon(executablePath, { size: 'large' })
    return icon.isEmpty() ? undefined : icon.toDataURL()
  } catch {
    return undefined
  }
}

function launchDetached(executablePath: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, args, {
      cwd: dirname(executablePath),
      detached: true,
      shell: false,
      stdio: 'ignore',
      windowsHide: false
    })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

function isTrustedYouTubeTvUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return false
    const host = url.hostname.toLowerCase()
    return (
      host === 'youtube.com' ||
      host.endsWith('.youtube.com') ||
      host === 'google.com' ||
      host.endsWith('.google.com')
    )
  } catch {
    return false
  }
}

function isExpectedYouTubeTvNavigationReplacement(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const code = (error as Error & { code?: unknown }).code
  return code === 'ERR_FAILED' || code === 'ERR_ABORTED'
}

function youtubeTvLaunchConfig(): { url: string; acceptLanguages: string } {
  const language = settingsStore.get('language') === 'de' ? 'de' : 'en'
  const url = new URL(YOUTUBE_TV_URL)
  url.searchParams.set('hl', language)
  return {
    url: url.toString(),
    acceptLanguages: language === 'de' ? 'de-DE,de,en-US,en' : 'en-US,en'
  }
}

function loadYouTubeTvPage(
  mediaWindow: BrowserWindow,
  url: string,
  acceptLanguages: string
): Promise<void> {
  const contents = mediaWindow.webContents
  return new Promise((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => {
      finish(
        new Error(
          `YouTube TV hat innerhalb von ${YOUTUBE_TV_LOAD_TIMEOUT_MS / 1_000} Sekunden keine Oberfläche geladen`
        )
      )
    }, YOUTUBE_TV_LOAD_TIMEOUT_MS)

    const cleanup = (): void => {
      clearTimeout(timeout)
      contents.removeListener('dom-ready', onDomReady)
      contents.removeListener('did-fail-load', onDidFailLoad)
      contents.removeListener('destroyed', onDestroyed)
    }

    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve()
    }

    const onDomReady = (): void => {
      if (isTrustedYouTubeTvUrl(contents.getURL())) finish()
    }

    const onDidFailLoad = (
      _event: Electron.Event,
      errorCode: number,
      errorDescription: string,
      validatedUrl: string,
      isMainFrame: boolean
    ): void => {
      if (!isMainFrame || errorCode === -2 || errorCode === -3) return
      finish(new Error(`${errorDescription} (${errorCode}) loading '${validatedUrl}'`))
    }

    const onDestroyed = (): void => finish(new Error('Das YouTube-TV-Fenster wurde geschlossen'))

    contents.on('dom-ready', onDomReady)
    contents.on('did-fail-load', onDidFailLoad)
    contents.once('destroyed', onDestroyed)
    void contents
      .loadURL(url, {
        userAgent: YOUTUBE_TV_USER_AGENT,
        extraHeaders: `pragma: no-cache\ncache-control: no-cache\naccept-language: ${acceptLanguages}\n`
      })
      .catch((error: unknown) => {
        // YouTube TV replaces its initial document while booting. Electron's
        // loadURL promise reports that valid hand-off as ERR_FAILED/ABORTED;
        // dom-ready on the replacement document is the authoritative signal.
        if (!isExpectedYouTubeTvNavigationReplacement(error)) {
          finish(error instanceof Error ? error : new Error('YouTube TV konnte nicht geladen werden'))
        }
      })
  })
}

class ApplicationService {
  private drafts = new Map<string, { executablePath: string; iconDataUrl?: string }>()
  private nativeTargets = new Map<string, NativeApplicationTarget>()
  private snapshot: OrbitApplicationSnapshot | null = null
  private mediaWindow: BrowserWindow | null = null
  private mediaController = new MediaControllerBridge()
  private disposing = false

  async getSnapshot(force = false): Promise<OrbitApplicationSnapshot> {
    if (!force && this.snapshot && Date.now() - this.snapshot.scannedAt < SNAPSHOT_TTL_MS) {
      return this.snapshot
    }

    this.nativeTargets.clear()
    const [playStationStatus, discovered] = await Promise.all([
      playStationRemotePlayService
        .refresh(force)
        .catch(() => playStationRemotePlayService.getCachedStatus()),
      discoveredNativeApplications()
    ])
    const native = discovered.map((entry): DiscoveredNativeApplication =>
      entry.application.id === LAUNCHER_PLAYSTATION_ID
        ? systemApplication(
            LAUNCHER_PLAYSTATION_ID,
            'PlayStation',
            Boolean(playStationStatus.selectedApp)
          )
        : entry
    )
    const detected = await Promise.all(
      native.map(async ({ application, target }) => {
        if (target) this.nativeTargets.set(application.id, target)
        return target?.iconPath
          ? { ...application, iconDataUrl: await iconDataUrl(target.iconPath) }
          : application
      })
    )
    const custom = await Promise.all(
      this.readStoredApplications().map(async (record): Promise<OrbitApplication> => {
        const available = existsSync(record.executablePath)
        return {
          id: record.id,
          name: record.name,
          category: 'custom',
          target: 'native',
          available,
          issue: available ? undefined : 'executable-missing',
          executablePath: record.executablePath,
          launchArguments: record.launchArguments,
          iconDataUrl: available ? await iconDataUrl(record.executablePath) : undefined,
          controllerOptimized: false
        }
      })
    )
    this.snapshot = {
      applications: [
        {
          id: BUILTIN_NETFLIX_ID,
          name: 'Netflix',
          category: 'media',
          target: 'orbit-media',
          available: netflixMediaService.isAvailable(),
          issue: netflixMediaService.isAvailable() ? undefined : 'executable-missing',
          controllerOptimized: true
        },
        {
          id: BUILTIN_YOUTUBE_TV_ID,
          name: 'YouTube TV',
          category: 'media',
          target: 'orbit-media',
          available: process.platform === 'win32',
          issue: process.platform === 'win32' ? undefined : 'unsupported-platform',
          controllerOptimized: true
        },
        ...detected,
        ...custom
      ],
      scannedAt: Date.now(),
      platform: process.platform === 'win32' ? 'windows' : 'unsupported'
    }
    return this.snapshot
  }

  async selectCustomApplication(mainWindow: BrowserWindow): Promise<CustomApplicationDraft | null> {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Applikation auswählen',
      properties: ['openFile'],
      filters: [
        { name: 'Windows-Applikationen', extensions: ['exe'] },
        { name: 'Alle Dateien', extensions: ['*'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const executablePath = result.filePaths[0]
    if (!isExecutablePath(executablePath) || !existsSync(executablePath)) {
      throw new Error('Die gewählte Applikation ist keine verfügbare Windows-EXE')
    }
    const draftId = randomUUID()
    const icon = await iconDataUrl(executablePath)
    this.drafts.set(draftId, { executablePath, iconDataUrl: icon })
    return {
      draftId,
      suggestedName: basename(executablePath, extname(executablePath)),
      executablePath,
      iconDataUrl: icon
    }
  }

  cancelCustomApplication(draftIdValue: unknown): void {
    this.drafts.delete(validatedApplicationId(draftIdValue))
  }

  async commitCustomApplication(input: CustomApplicationCommitInput): Promise<OrbitApplicationSnapshot> {
    const draftId = validatedApplicationId(input.draftId)
    const draft = this.drafts.get(draftId)
    if (!draft) throw new Error('Der Applikationsentwurf ist nicht mehr verfügbar')
    const record: StoredCustomApplication = {
      id: `custom:${randomUUID()}`,
      name: normalizedApplicationName(input.name),
      executablePath: draft.executablePath,
      launchArguments: normalizeCustomLaunchArguments(input.launchArguments)
    }
    const records = this.readStoredApplications()
    applicationStore.set('applications', [...records, record])
    this.drafts.delete(draftId)
    this.snapshot = null
    return this.getSnapshot(true)
  }

  async updateCustomApplication(input: CustomApplicationUpdateInput): Promise<OrbitApplicationSnapshot> {
    const applicationId = validatedApplicationId(input.applicationId)
    let found = false
    const records = this.readStoredApplications().map((record) => {
      if (record.id !== applicationId) return record
      found = true
      return {
        ...record,
        name: normalizedApplicationName(input.name),
        launchArguments: normalizeCustomLaunchArguments(input.launchArguments)
      }
    })
    if (!found) throw new Error('Die Custom-App wurde nicht gefunden')
    applicationStore.set('applications', records)
    this.snapshot = null
    return this.getSnapshot(true)
  }

  async removeCustomApplication(applicationIdValue: unknown): Promise<OrbitApplicationSnapshot> {
    const applicationId = validatedApplicationId(applicationIdValue)
    const records = this.readStoredApplications()
    if (!records.some((record) => record.id === applicationId)) {
      throw new Error('Die Custom-App wurde nicht gefunden')
    }
    applicationStore.set(
      'applications',
      records.filter((record) => record.id !== applicationId)
    )
    this.snapshot = null
    return this.getSnapshot(true)
  }

  async launch(applicationIdValue: unknown, mainWindow: BrowserWindow): Promise<ApplicationLaunchResult> {
    const applicationId = validatedApplicationId(applicationIdValue)
    const snapshot = await this.getSnapshot()
    const application = snapshot.applications.find((candidate) => candidate.id === applicationId)
    if (!application) throw new Error('Die Applikation wurde nicht gefunden')
    if (!application.available) throw new Error('Die Applikation ist derzeit nicht verfügbar')

    if (applicationId === BUILTIN_YOUTUBE_TV_ID) {
      const controllerBridge = await this.openYouTubeTv(mainWindow)
      return { applicationId, applicationName: application.name, controllerBridge }
    }
    if (applicationId === BUILTIN_NETFLIX_ID) {
      const controllerBridge = await netflixMediaService.launch(mainWindow)
      return { applicationId, applicationName: application.name, controllerBridge }
    }
    if (applicationId === LAUNCHER_XBOX_ID) {
      await shell.openExternal('msxbox://')
      if (!mainWindow.isDestroyed()) mainWindow.minimize()
      return {
        applicationId,
        applicationName: application.name,
        controllerBridge: 'not-needed'
      }
    }
    if (applicationId === LAUNCHER_PLAYSTATION_ID) {
      const pid = await playStationRemotePlayService.launch(false)
      if (!pid) {
        this.snapshot = null
        throw new Error('PlayStation Remote Play ist nicht mehr verfügbar')
      }
      if (!mainWindow.isDestroyed()) mainWindow.minimize()
      return {
        applicationId,
        applicationName: application.name,
        controllerBridge: 'not-needed'
      }
    }

    const custom = this.readStoredApplications().find((record) => record.id === applicationId)
    const target = custom
      ? {
          executablePath: custom.executablePath,
          arguments: parseCustomLaunchArguments(custom.launchArguments)
        }
      : this.nativeTargets.get(applicationId)
    if (!target || !isExecutablePath(target.executablePath) || !existsSync(target.executablePath)) {
      this.snapshot = null
      throw new Error('Die Applikation ist nicht mehr installiert oder wurde verschoben')
    }
    await launchDetached(target.executablePath, target.arguments)
    if (!mainWindow.isDestroyed()) mainWindow.minimize()
    return {
      applicationId,
      applicationName: application.name,
      controllerBridge: 'not-needed'
    }
  }

  dispose(): void {
    this.disposing = true
    this.mediaController.dispose()
    netflixMediaService.dispose()
    if (this.mediaWindow && !this.mediaWindow.isDestroyed()) this.mediaWindow.destroy()
    this.mediaWindow = null
    this.drafts.clear()
  }

  private readStoredApplications(): StoredCustomApplication[] {
    const stored = applicationStore.get('applications')
    if (!Array.isArray(stored)) return []
    return stored.filter(
      (record): record is StoredCustomApplication =>
        Boolean(
          record &&
            typeof record === 'object' &&
            typeof record.id === 'string' &&
            record.id.startsWith('custom:') &&
            typeof record.name === 'string' &&
            isExecutablePath(record.executablePath) &&
            (record.launchArguments === undefined || typeof record.launchArguments === 'string')
        )
    )
  }

  private async openYouTubeTv(
    mainWindow: BrowserWindow
  ): Promise<ApplicationLaunchResult['controllerBridge']> {
    if (this.mediaWindow && !this.mediaWindow.isDestroyed()) {
      this.mediaWindow.show()
      this.mediaWindow.focus()
      return 'active'
    }

    this.disposing = false

    const mediaWindow = new BrowserWindow({
      show: false,
      fullscreen: true,
      autoHideMenuBar: true,
      backgroundColor: '#05070c',
      title: 'ORBIT · YouTube TV',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: 'persist:orbit-media'
      }
    })
    this.mediaWindow = mediaWindow
    const youtubeTv = youtubeTvLaunchConfig()
    mediaWindow.webContents.session.setUserAgent(
      YOUTUBE_TV_USER_AGENT,
      youtubeTv.acceptLanguages
    )
    mediaWindow.webContents.setUserAgent(YOUTUBE_TV_USER_AGENT)
    mediaWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => {
      callback(false)
    })
    mediaWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (isTrustedYouTubeTvUrl(url)) {
        void mediaWindow.webContents
          .loadURL(url, {
            userAgent: YOUTUBE_TV_USER_AGENT,
            extraHeaders: `accept-language: ${youtubeTv.acceptLanguages}\n`
          })
          .catch(() => undefined)
      }
      return { action: 'deny' }
    })
    mediaWindow.webContents.on('will-navigate', (event, url) => {
      if (isTrustedYouTubeTvUrl(url)) return
      event.preventDefault()
    })

    const closeMedia = (): void => {
      if (!mediaWindow.isDestroyed()) mediaWindow.close()
    }
    mediaWindow.once('closed', () => {
      this.mediaController.dispose()
      if (this.mediaWindow === mediaWindow) this.mediaWindow = null
      if (!this.disposing && !mainWindow.isDestroyed()) void revealOrbitWindow(mainWindow)
    })
    mediaWindow.webContents.once('render-process-gone', closeMedia)

    try {
      await loadYouTubeTvPage(mediaWindow, youtubeTv.url, youtubeTv.acceptLanguages)
    } catch (error) {
      closeMedia()
      throw new Error(
        error instanceof Error
          ? `YouTube TV konnte nicht geöffnet werden: ${error.message}`
          : 'YouTube TV konnte nicht geöffnet werden'
      )
    }
    const sendKey = (keyCode: string, modifiers?: Array<'alt'>): void => {
      if (mediaWindow.webContents.isDestroyed()) return
      mediaWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
      mediaWindow.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
    }
    const directionKey = {
      up: 'Up',
      down: 'Down',
      left: 'Left',
      right: 'Right'
    } as const
    const controllerPromise = this.mediaController.start({
      direction: (direction) => sendKey(directionKey[direction]),
      confirm: () => sendKey('Enter'),
      back: () => sendKey('Escape'),
      backHold: closeMedia,
      playPause: () => sendKey('Space'),
      search: () => sendKey('/'),
      history: (direction) => sendKey(direction < 0 ? 'Left' : 'Right', ['alt'])
    })
    if (!mainWindow.isDestroyed()) mainWindow.hide()
    mediaWindow.show()
    mediaWindow.focus()
    const controllerActive = await controllerPromise
    return controllerActive ? 'active' : 'unavailable'
  }
}

export const applicationService = new ApplicationService()
