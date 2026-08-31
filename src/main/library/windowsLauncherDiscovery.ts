import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve, win32 as path } from 'node:path'
import type { GameMetadata, GameProvider } from '@shared/ipc'
import { parseCustomLaunchArguments } from '../customLaunchArguments'

export type WindowsLauncherProvider = Extract<GameProvider, 'gog' | 'ea' | 'ubisoft'>

export interface WindowsLauncherGame {
  provider: WindowsLauncherProvider
  providerGameId: string
  name: string
  installDir: string
  metadata: GameMetadata
}

export interface WindowsLauncherDiscovery {
  games: Record<WindowsLauncherProvider, Map<string, WindowsLauncherGame>>
  complete: boolean
}

interface RawWindowsLauncherGame {
  provider?: unknown
  providerGameId?: unknown
  name?: unknown
  installDir?: unknown
}

const SCAN_TIMEOUT_MS = 15_000
const MAX_SCAN_OUTPUT_BYTES = 4 * 1024 * 1024
const RESULT_MARKER = 'ORBIT_LAUNCHER_LIBRARY_RESULT:'

const WINDOWS_LAUNCHER_SCAN_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$records = [System.Collections.Generic.List[object]]::new()

function Get-OrbitValue($key, [string[]]$names) {
  foreach ($name in $names) {
    try {
      $value = [string]$key.GetValue($name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
      if (-not [string]::IsNullOrWhiteSpace($value)) { return $value.Trim() }
    } catch {}
  }
  return $null
}

function Add-OrbitGame([string]$provider, [string]$providerGameId, [string]$name, [string]$installDir) {
  if ([string]::IsNullOrWhiteSpace($providerGameId) -or
      [string]::IsNullOrWhiteSpace($name) -or
      [string]::IsNullOrWhiteSpace($installDir) -or
      -not [System.IO.Directory]::Exists($installDir)) { return }
  $records.Add([ordered]@{
    provider = $provider
    providerGameId = $providerGameId.Trim()
    name = $name.Trim()
    installDir = [System.IO.Path]::GetFullPath($installDir)
  })
}

function Visit-OrbitRegistryChildren(
  [Microsoft.Win32.RegistryHive]$hive,
  [Microsoft.Win32.RegistryView]$view,
  [string]$path,
  [scriptblock]$visitor
) {
  $base = $null
  $root = $null
  try {
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view)
    $root = $base.OpenSubKey($path)
    if ($null -eq $root) { return }
    foreach ($childName in @($root.GetSubKeyNames())) {
      $child = $null
      try {
        $child = $root.OpenSubKey($childName)
        if ($null -ne $child) { & $visitor $childName $child }
      } catch {} finally {
        if ($null -ne $child) { $child.Dispose() }
      }
    }
  } catch {} finally {
    if ($null -ne $root) { $root.Dispose() }
    if ($null -ne $base) { $base.Dispose() }
  }
}

$hives = @(
  [Microsoft.Win32.RegistryHive]::LocalMachine,
  [Microsoft.Win32.RegistryHive]::CurrentUser
)
$views = @(
  [Microsoft.Win32.RegistryView]::Registry32,
  [Microsoft.Win32.RegistryView]::Registry64
)

foreach ($hive in $hives) {
  foreach ($view in $views) {
    Visit-OrbitRegistryChildren $hive $view 'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall' {
      param($childName, $child)
      if ($childName -notmatch '^(\d+)_is1$') { return }
      $publisher = Get-OrbitValue $child @('Publisher')
      if ($publisher -notlike 'GOG.com*') { return }
      Add-OrbitGame 'gog' $Matches[1] (Get-OrbitValue $child @('DisplayName')) (Get-OrbitValue $child @('InstallLocation'))
    }

    Visit-OrbitRegistryChildren $hive $view 'SOFTWARE\GOG.com\Games' {
      param($childName, $child)
      $gameId = Get-OrbitValue $child @('gameID', 'gameId')
      if (-not $gameId) { $gameId = $childName }
      Add-OrbitGame 'gog' $gameId (Get-OrbitValue $child @('gameName', 'DisplayName')) (Get-OrbitValue $child @('path', 'InstallLocation'))
    }

    Visit-OrbitRegistryChildren $hive $view 'SOFTWARE\Origin Games' {
      param($childName, $child)
      Add-OrbitGame 'ea' $childName (Get-OrbitValue $child @('DisplayName', 'GameName', 'ProductName')) (Get-OrbitValue $child @('Install Dir', 'InstallDir', 'InstallLocation'))
    }

    Visit-OrbitRegistryChildren $hive $view 'SOFTWARE\Ubisoft\Launcher\Installs' {
      param($childName, $child)
      $installDir = Get-OrbitValue $child @('InstallDir', 'InstallLocation')
      $fallbackName = if ($installDir) { [System.IO.Path]::GetFileName($installDir.TrimEnd('\', '/')) } else { $null }
      $displayName = Get-OrbitValue $child @('DisplayName', 'GameName')
      if (-not $displayName) { $displayName = $fallbackName }
      Add-OrbitGame 'ubisoft' $childName $displayName $installDir
    }
  }
}

$json = @($records) | ConvertTo-Json -Depth 4 -Compress
[Console]::Out.WriteLine('${RESULT_MARKER}' + $json)
`

function emptyGames(): Record<WindowsLauncherProvider, Map<string, WindowsLauncherGame>> {
  return {
    gog: new Map(),
    ea: new Map(),
    ubisoft: new Map()
  }
}

function safeText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (!text || text.length > 2_048 || /[\u0000-\u001f\u007f-\u009f]/.test(text)) return undefined
  return text
}

function safeProvider(value: unknown): WindowsLauncherProvider | undefined {
  return value === 'gog' || value === 'ea' || value === 'ubisoft' ? value : undefined
}

function safeProviderGameId(
  provider: WindowsLauncherProvider,
  value: unknown
): string | undefined {
  const id = safeText(value)
  if (!id || id.length > 512) return undefined
  if (provider === 'gog' || provider === 'ubisoft') return /^\d+$/.test(id) ? id : undefined
  return /^[a-z0-9_.:-]+$/i.test(id) ? id : undefined
}

function pathInside(rootPath: string, candidatePath: string): boolean {
  const child = relative(resolve(rootPath), resolve(candidatePath))
  return child === '' || (child !== '..' && !child.startsWith(`..${path.sep}`) && !isAbsolute(child))
}

interface GogManifestTask {
  isPrimary?: unknown
  type?: unknown
  path?: unknown
  workingDir?: unknown
  arguments?: unknown
}

interface GogManifest {
  rootGameId?: unknown
  name?: unknown
  playTasks?: unknown
}

function manifestGameId(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value)
  return safeText(value)
}

function gogLaunchMetadata(
  providerGameId: string,
  installDir: string
): { name?: string; metadata: GameMetadata } | undefined {
  const manifestPath = path.join(installDir, `goggame-${providerGameId}.info`)
  if (!existsSync(manifestPath)) return undefined

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as GogManifest
    const rootGameId = manifestGameId(manifest.rootGameId)
    if (rootGameId && rootGameId !== providerGameId) return undefined
    if (!Array.isArray(manifest.playTasks)) return undefined
    const task = manifest.playTasks.find(
      (candidate): candidate is GogManifestTask =>
        Boolean(candidate && typeof candidate === 'object' && (candidate as GogManifestTask).isPrimary)
    )
    if (!task || (task.type !== undefined && task.type !== 'FileTask' && task.type !== 0)) {
      return undefined
    }

    const taskPath = safeText(task.path)
    if (!taskPath) return undefined
    const workingDir = safeText(task.workingDir)
    const candidates = [
      workingDir ? resolve(installDir, workingDir, taskPath) : undefined,
      resolve(installDir, taskPath)
    ].filter((candidate): candidate is string => Boolean(candidate))
    const executablePath = candidates.find(
      (candidate) =>
        pathInside(installDir, candidate) &&
        candidate.toLowerCase().endsWith('.exe') &&
        existsSync(candidate)
    )
    if (!executablePath) return undefined

    let launchArguments: string[] | undefined
    const rawArguments = safeText(task.arguments)
    if (rawArguments) {
      try {
        launchArguments = parseCustomLaunchArguments(rawArguments)
      } catch {
        return undefined
      }
    }

    return {
      name: safeText(manifest.name),
      metadata: {
        platforms: ['windows'],
        launchExecutable: executablePath,
        launchArguments
      }
    }
  } catch {
    return undefined
  }
}

export function normalizeWindowsLauncherGames(value: unknown): WindowsLauncherDiscovery {
  const games = emptyGames()
  const records = Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : []

  for (const rawValue of records) {
    if (!rawValue || typeof rawValue !== 'object') continue
    const raw = rawValue as RawWindowsLauncherGame
    const provider = safeProvider(raw.provider)
    if (!provider) continue
    const providerGameId = safeProviderGameId(provider, raw.providerGameId)
    const name = safeText(raw.name)
    const installDir = safeText(raw.installDir)
    if (!providerGameId || !name || !installDir || !isAbsolute(installDir) || !existsSync(installDir)) {
      continue
    }

    let resolvedName = name.replace(/[™®©]/g, '').trim()
    let metadata: GameMetadata = { platforms: ['windows'] }
    if (provider === 'gog') {
      const gog = gogLaunchMetadata(providerGameId, installDir)
      if (!gog) continue
      resolvedName = gog.name?.replace(/[™®©]/g, '').trim() || resolvedName
      metadata = gog.metadata
    } else if (provider === 'ea') {
      metadata = {
        platforms: ['windows'],
        launchUri: `origin2://game/launch?offerIds=${encodeURIComponent(providerGameId)}`
      }
    } else {
      metadata = {
        platforms: ['windows'],
        launchUri: `uplay://launch/${encodeURIComponent(providerGameId)}/0`
      }
    }

    games[provider].set(providerGameId, {
      provider,
      providerGameId,
      name: resolvedName,
      installDir: resolve(installDir),
      metadata
    })
  }

  return { games, complete: true }
}

function runWindowsLauncherScan(): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    execFile(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_LAUNCHER_SCAN_SCRIPT],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: SCAN_TIMEOUT_MS,
        maxBuffer: MAX_SCAN_OUTPUT_BYTES
      },
      (error, stdout) => {
        if (error) reject(error)
        else resolveOutput(stdout)
      }
    )
  })
}

let scanInFlight: Promise<WindowsLauncherDiscovery> | null = null

/** Runs one shared registry pass even when all three provider adapters refresh concurrently. */
export function scanWindowsLauncherLibraries(): Promise<WindowsLauncherDiscovery> {
  if (process.platform !== 'win32') {
    return Promise.resolve({ games: emptyGames(), complete: false })
  }
  if (scanInFlight) return scanInFlight

  const scan = runWindowsLauncherScan()
    .then((output) => {
      const markerIndex = output.lastIndexOf(RESULT_MARKER)
      if (markerIndex < 0) throw new Error('Windows launcher scan returned no result')
      const json = output.slice(markerIndex + RESULT_MARKER.length).trim()
      return normalizeWindowsLauncherGames(json ? JSON.parse(json) : [])
    })
    .finally(() => {
      if (scanInFlight === scan) scanInFlight = null
    })
  scanInFlight = scan
  return scan
}
