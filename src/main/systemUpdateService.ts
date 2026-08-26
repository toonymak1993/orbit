import { spawn } from 'node:child_process'
import type {
  GraphicsAdapterVendor,
  GraphicsDriverUpdate,
  SystemUpdateSnapshot
} from '@shared/ipc'

const RESULT_MARKER = 'ORBIT_SYSTEM_UPDATE_RESULT:'
const SCAN_TIMEOUT_MS = 120_000
const MAX_OUTPUT_LENGTH = 2 * 1024 * 1024

const SYSTEM_UPDATE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Get-OrbitVendor([string]$Text) {
  $value = $Text.ToLowerInvariant()
  if ($value.Contains('nvidia') -or $value.Contains('ven_10de')) { return 'nvidia' }
  if ($value.Contains('advanced micro devices') -or $value.Contains(' amd') -or $value.StartsWith('amd') -or $value.Contains('radeon') -or $value.Contains('ven_1002')) { return 'amd' }
  if ($value.Contains('intel') -or $value.Contains('ven_8086')) { return 'intel' }
  return 'other'
}

function Get-OrbitStrings($Collection) {
  $values = @()
  if ($null -eq $Collection) { return $values }
  for ($index = 0; $index -lt $Collection.Count; $index++) {
    $value = [string]$Collection.Item($index)
    if (-not [string]::IsNullOrWhiteSpace($value)) { $values += $value }
  }
  return $values
}

function Get-OrbitIsoDate($Value) {
  if ($null -eq $Value) { return $null }
  try { return ([DateTime]$Value).ToUniversalTime().ToString('o') } catch { return $null }
}

$snapshot = [ordered]@{
  platform = 'windows'
  state = 'ready'
  checkedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  windowsUpdates = @()
  graphicsAdapters = @()
  graphicsDriverUpdates = @()
  errors = [ordered]@{
    updateScan = $null
    graphicsDetection = $null
  }
}

$graphicsAdaptersInternal = @()
try {
  $graphicsAdaptersInternal = @(Get-CimInstance -ClassName Win32_VideoController | ForEach-Object {
    $name = [string]$_.Name
    $manufacturer = [string]$_.AdapterCompatibility
    $hardwareId = [string]$_.PNPDeviceID
    if (-not [string]::IsNullOrWhiteSpace($name)) {
      [ordered]@{
        name = $name
        manufacturer = $manufacturer
        vendor = Get-OrbitVendor "$name $manufacturer $hardwareId"
        driverVersion = [string]$_.DriverVersion
        driverDate = Get-OrbitIsoDate $_.DriverDate
        hardwareId = $hardwareId
      }
    }
  })
  $snapshot.graphicsAdapters = @($graphicsAdaptersInternal | ForEach-Object {
    [ordered]@{
      name = $_.name
      manufacturer = $_.manufacturer
      vendor = $_.vendor
      driverVersion = $_.driverVersion
      driverDate = $_.driverDate
    }
  })
} catch {
  $snapshot.errors.graphicsDetection = 'graphics-detection-unavailable'
}

try {
  $session = New-Object -ComObject Microsoft.Update.Session
  $searcher = $session.CreateUpdateSearcher()
  $searchResult = $searcher.Search("IsInstalled = 0 and IsHidden = 0")

  for ($index = 0; $index -lt $searchResult.Updates.Count; $index++) {
    $update = $searchResult.Updates.Item($index)
    $identity = $update.Identity
    $updateId = [string]$identity.UpdateID

    if ([int]$update.Type -eq 2) {
      $driverClass = [string]$update.DriverClass
      if ($driverClass -notmatch '^(?i:display)$') { continue }

      $driverHardwareId = [string]$update.DriverHardwareID
      $driverManufacturer = [string]$update.DriverManufacturer
      $driverModel = [string]$update.DriverModel
      $driverProvider = [string]$update.DriverProvider
      $vendor = Get-OrbitVendor "$($update.Title) $driverManufacturer $driverModel $driverProvider $driverHardwareId"
      $matchedAdapterNames = @($graphicsAdaptersInternal | Where-Object {
        $hardwareMatches = -not [string]::IsNullOrWhiteSpace($driverHardwareId) -and
          -not [string]::IsNullOrWhiteSpace($_.hardwareId) -and
          ($_.hardwareId.StartsWith($driverHardwareId, [System.StringComparison]::OrdinalIgnoreCase) -or
            $driverHardwareId.StartsWith($_.hardwareId, [System.StringComparison]::OrdinalIgnoreCase))
        $hardwareMatches -or ($vendor -ne 'other' -and $_.vendor -eq $vendor)
      } | ForEach-Object { $_.name } | Select-Object -Unique)

      $snapshot.graphicsDriverUpdates += [ordered]@{
        id = $updateId
        title = [string]$update.Title
        vendor = $vendor
        driverClass = $driverClass
        manufacturer = $driverManufacturer
        model = $driverModel
        provider = $driverProvider
        driverDate = Get-OrbitIsoDate $update.DriverVerDate
        matchedAdapterNames = $matchedAdapterNames
        rebootRequired = [bool]$update.RebootRequired
        downloaded = [bool]$update.IsDownloaded
      }
      continue
    }

    $snapshot.windowsUpdates += [ordered]@{
      id = $updateId
      title = [string]$update.Title
      kbArticleIds = @(Get-OrbitStrings $update.KBArticleIDs)
      severity = [string]$update.MsrcSeverity
      rebootRequired = [bool]$update.RebootRequired
      downloaded = [bool]$update.IsDownloaded
    }
  }
} catch {
  $snapshot.errors.updateScan = 'windows-update-unavailable'
}

if ($null -ne $snapshot.errors.updateScan -or $null -ne $snapshot.errors.graphicsDetection) {
  $hasUsableResult = $snapshot.windowsUpdates.Count -gt 0 -or
    $snapshot.graphicsAdapters.Count -gt 0 -or
    $snapshot.graphicsDriverUpdates.Count -gt 0
  $snapshot.state = if ($hasUsableResult) { 'partial' } else { 'error' }
}

$json = $snapshot | ConvertTo-Json -Depth 8 -Compress
[Console]::Out.WriteLine('${RESULT_MARKER}' + $json)
`

interface RawSystemUpdateSnapshot extends SystemUpdateSnapshot {
  graphicsDriverUpdates: GraphicsDriverUpdate[]
}

function normalizedVendor(value: unknown): GraphicsAdapterVendor {
  return value === 'nvidia' || value === 'amd' || value === 'intel' ? value : 'other'
}

function normalizeSnapshot(value: unknown): SystemUpdateSnapshot {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid Windows update result')
  }

  const snapshot = value as RawSystemUpdateSnapshot
  if (snapshot.platform !== 'windows' || !Number.isFinite(snapshot.checkedAt)) {
    throw new Error('Incomplete Windows update result')
  }

  return {
    ...snapshot,
    windowsUpdates: Array.isArray(snapshot.windowsUpdates) ? snapshot.windowsUpdates : [],
    graphicsAdapters: Array.isArray(snapshot.graphicsAdapters)
      ? snapshot.graphicsAdapters.map((adapter) => ({
          ...adapter,
          vendor: normalizedVendor(adapter.vendor)
        }))
      : [],
    graphicsDriverUpdates: Array.isArray(snapshot.graphicsDriverUpdates)
      ? snapshot.graphicsDriverUpdates.map((update) => ({
          ...update,
          vendor: normalizedVendor(update.vendor),
          matchedAdapterNames: Array.isArray(update.matchedAdapterNames)
            ? update.matchedAdapterNames
            : []
        }))
      : [],
    errors: {
      updateScan:
        snapshot.errors?.updateScan === 'windows-update-unavailable'
          ? 'windows-update-unavailable'
          : undefined,
      graphicsDetection:
        snapshot.errors?.graphicsDetection === 'graphics-detection-unavailable'
          ? 'graphics-detection-unavailable'
          : undefined
    }
  }
}

function unsupportedSnapshot(): SystemUpdateSnapshot {
  return {
    platform: 'unsupported',
    state: 'unsupported',
    checkedAt: Date.now(),
    windowsUpdates: [],
    graphicsAdapters: [],
    graphicsDriverUpdates: [],
    errors: {}
  }
}

class SystemUpdateService {
  private activeScan: Promise<SystemUpdateSnapshot> | null = null

  check(): Promise<SystemUpdateSnapshot> {
    if (process.platform !== 'win32') return Promise.resolve(unsupportedSnapshot())
    if (this.activeScan) return this.activeScan

    this.activeScan = this.runWindowsScan().finally(() => {
      this.activeScan = null
    })
    return this.activeScan
  }

  private runWindowsScan(): Promise<SystemUpdateSnapshot> {
    const encodedCommand = Buffer.from(SYSTEM_UPDATE_SCRIPT, 'utf16le').toString('base64')

    return new Promise((resolve, reject) => {
      const child = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-EncodedCommand',
          encodedCommand
        ],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
      )
      let stdout = ''
      let stderr = ''
      let settled = false

      const finish = (error?: Error, snapshot?: SystemUpdateSnapshot): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (error) reject(error)
        else resolve(snapshot!)
      }

      const appendOutput = (current: string, chunk: Buffer): string => {
        if (current.length >= MAX_OUTPUT_LENGTH) return current
        return (current + chunk.toString('utf8')).slice(0, MAX_OUTPUT_LENGTH)
      }

      child.stdout.on('data', (chunk: Buffer) => {
        stdout = appendOutput(stdout, chunk)
      })
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = appendOutput(stderr, chunk)
      })
      child.once('error', (error) => finish(error))
      child.once('close', (code) => {
        const markerIndex = stdout.lastIndexOf(RESULT_MARKER)
        if (code !== 0 || markerIndex < 0) {
          finish(new Error(`Windows update scan failed (${code ?? 'unknown'}): ${stderr.trim()}`))
          return
        }

        const json = stdout.slice(markerIndex + RESULT_MARKER.length).trim()
        try {
          finish(undefined, normalizeSnapshot(JSON.parse(json)))
        } catch (error) {
          finish(error instanceof Error ? error : new Error('Invalid Windows update result'))
        }
      })

      const timeout = setTimeout(() => {
        child.kill()
        finish(new Error('Windows update scan timed out'))
      }, SCAN_TIMEOUT_MS)
    })
  }
}

export const systemUpdateService = new SystemUpdateService()
