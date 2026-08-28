import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { SystemStatusSnapshot } from '@shared/ipc'

const RESULT_MARKER = 'ORBIT_SYSTEM_STATUS_RESULT:'
const REFRESH_INTERVAL_MS = 60_000
const SCAN_TIMEOUT_MS = 10_000
const MAX_OUTPUT_LENGTH = 512 * 1024

const SYSTEM_STATUS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$errorCount = 0
$battery = [ordered]@{
  present = $false
  level = $null
  charging = $false
  powerSource = 'unknown'
}
$network = [ordered]@{
  connected = $false
  type = 'offline'
  name = $null
  linkSpeed = $null
}
$bluetooth = [ordered]@{
  available = $false
  enabled = $false
}

try {
  $batteries = @(Get-CimInstance -ClassName Win32_Battery)
  if ($batteries.Count -gt 0) {
    $levels = @($batteries | ForEach-Object { [int]$_.EstimatedChargeRemaining })
    $statuses = @($batteries | ForEach-Object { [int]$_.BatteryStatus })
    $powerOnline = @($batteries | Where-Object { $_.PowerOnline -eq $true }).Count -gt 0
    $battery.present = $true
    $battery.level = [Math]::Max(0, [Math]::Min(100, [Math]::Round(($levels | Measure-Object -Average).Average)))
    $battery.charging = @($statuses | Where-Object { $_ -ge 6 -and $_ -le 9 }).Count -gt 0
    $battery.powerSource = if ($powerOnline -or $battery.charging -or @($statuses | Where-Object { $_ -eq 2 -or $_ -eq 3 -or $_ -eq 11 }).Count -gt 0) { 'ac' } elseif (@($statuses | Where-Object { $_ -eq 1 -or $_ -eq 4 -or $_ -eq 5 }).Count -gt 0) { 'battery' } else { 'unknown' }
  }
} catch {
  $errorCount++
}

try {
  $adapters = @(Get-CimInstance -ClassName Win32_NetworkAdapter -Filter "NetEnabled=True" |
    Where-Object { $_.PhysicalAdapter -and -not [string]::IsNullOrWhiteSpace([string]$_.MACAddress) })
  $defaultRoute = Get-CimInstance Win32_IP4RouteTable -Filter "Destination='0.0.0.0'" -ErrorAction SilentlyContinue |
    Sort-Object Metric1 |
    Select-Object -First 1
  $adapter = if ($null -ne $defaultRoute) {
    $adapters | Where-Object { [int]$_.InterfaceIndex -eq [int]$defaultRoute.InterfaceIndex } | Select-Object -First 1
  } else {
    $adapters | Select-Object -First 1
  }

  if ($null -ne $adapter) {
    $medium = "$($adapter.NetConnectionID) $($adapter.Name)"
    $network.connected = $true
    $network.type = if ($medium -match '(?i:wi-?fi|wireless|wlan|802\.11)') { 'wifi' } else { 'ethernet' }
    $network.name = if (-not [string]::IsNullOrWhiteSpace([string]$adapter.NetConnectionID)) { [string]$adapter.NetConnectionID } else { [string]$adapter.Name }
    $speed = [double]$adapter.Speed
    if ($speed -ge 1000000000) { $network.linkSpeed = ([Math]::Round($speed / 1000000000, 1)).ToString('0.#', [Globalization.CultureInfo]::InvariantCulture) + ' Gbps' }
    elseif ($speed -ge 1000000) { $network.linkSpeed = ([Math]::Round($speed / 1000000)).ToString([Globalization.CultureInfo]::InvariantCulture) + ' Mbps' }
  }
} catch {
  $errorCount++
  $network.type = 'unknown'
}

try {
  $devices = @(Get-CimInstance Win32_PnPEntity -Filter "PNPClass='Bluetooth'")
  $adapters = @($devices | Where-Object {
    $_.PNPDeviceID -like 'USB*' -or
    $_.Name -match '(?i:bluetooth.*(adapter|radio)|intel.*bluetooth|mediatek.*bluetooth|realtek.*bluetooth)'
  })
  $bluetooth.available = $adapters.Count -gt 0 -or $devices.Count -gt 0
  $bluetooth.enabled = @($adapters | Where-Object { $_.Status -eq 'OK' -and [int]$_.ConfigManagerErrorCode -eq 0 }).Count -gt 0
  if ($adapters.Count -eq 0 -and $devices.Count -gt 0) {
    $bluetooth.enabled = @($devices | Where-Object { $_.Status -eq 'OK' -and [int]$_.ConfigManagerErrorCode -eq 0 }).Count -gt 0
  }
} catch {
  $errorCount++
}

$state = if ($errorCount -eq 0) { 'ready' } elseif ($errorCount -lt 3) { 'partial' } else { 'error' }
$snapshot = [ordered]@{
  platform = 'windows'
  state = $state
  checkedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  battery = $battery
  network = $network
  bluetooth = $bluetooth
}

$json = $snapshot | ConvertTo-Json -Depth 5 -Compress
[Console]::Out.WriteLine('${RESULT_MARKER}' + $json)
`

function emptySnapshot(state: SystemStatusSnapshot['state']): SystemStatusSnapshot {
  return {
    platform: process.platform === 'win32' ? 'windows' : 'unsupported',
    state,
    checkedAt: Date.now(),
    battery: {
      present: false,
      charging: false,
      powerSource: 'unknown'
    },
    network: {
      connected: false,
      type: process.platform === 'win32' ? 'offline' : 'unknown'
    },
    bluetooth: {
      available: false,
      enabled: false
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function optionalShortString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, 120) : undefined
}

function normalizeSnapshot(value: unknown): SystemStatusSnapshot {
  const raw = asRecord(value)
  const battery = asRecord(raw.battery)
  const network = asRecord(raw.network)
  const bluetooth = asRecord(raw.bluetooth)
  const checkedAt = typeof raw.checkedAt === 'number' && Number.isFinite(raw.checkedAt)
    ? raw.checkedAt
    : Date.now()
  const rawLevel = typeof battery.level === 'number' && Number.isFinite(battery.level)
    ? battery.level
    : undefined
  const networkType =
    network.type === 'wifi' ||
    network.type === 'ethernet' ||
    network.type === 'offline' ||
    network.type === 'unknown'
      ? network.type
      : 'unknown'
  const state =
    raw.state === 'ready' || raw.state === 'partial' || raw.state === 'error'
      ? raw.state
      : 'error'

  return {
    platform: 'windows',
    state,
    checkedAt,
    battery: {
      present: battery.present === true,
      level: rawLevel === undefined ? undefined : Math.round(Math.max(0, Math.min(100, rawLevel))),
      charging: battery.charging === true,
      powerSource:
        battery.powerSource === 'battery' || battery.powerSource === 'ac'
          ? battery.powerSource
          : 'unknown'
    },
    network: {
      connected: network.connected === true,
      type: networkType,
      name: optionalShortString(network.name),
      linkSpeed: optionalShortString(network.linkSpeed)
    },
    bluetooth: {
      available: bluetooth.available === true,
      enabled: bluetooth.enabled === true
    }
  }
}

export class SystemStatusService extends EventEmitter {
  private snapshot = emptySnapshot(process.platform === 'win32' ? 'loading' : 'unsupported')
  private refreshTimer: ReturnType<typeof setInterval> | null = null
  private activeRefresh: Promise<SystemStatusSnapshot> | null = null
  private activeChild: ReturnType<typeof spawn> | null = null
  private disposed = false

  start(): void {
    if (this.disposed || process.platform !== 'win32' || this.refreshTimer) return
    void this.refresh()
    this.refreshTimer = setInterval(() => void this.refresh(), REFRESH_INTERVAL_MS)
    this.refreshTimer.unref()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.refreshTimer) clearInterval(this.refreshTimer)
    this.refreshTimer = null
    this.activeChild?.kill()
    this.activeChild = null
    this.removeAllListeners()
  }

  getSnapshot(): SystemStatusSnapshot {
    return structuredClone(this.snapshot)
  }

  refresh(): Promise<SystemStatusSnapshot> {
    if (this.disposed || process.platform !== 'win32') return Promise.resolve(this.getSnapshot())
    if (this.activeRefresh) return this.activeRefresh

    this.activeRefresh = this.runWindowsScan()
      .then((snapshot) => {
        if (this.disposed) return this.getSnapshot()
        if (snapshot.state === 'partial' && this.snapshot.state !== 'loading') {
          snapshot = {
            ...snapshot,
            battery:
              !snapshot.battery.present && this.snapshot.battery.present
                ? this.snapshot.battery
                : snapshot.battery,
            network:
              snapshot.network.type === 'unknown' ? this.snapshot.network : snapshot.network,
            bluetooth:
              !snapshot.bluetooth.available && this.snapshot.bluetooth.available
                ? this.snapshot.bluetooth
                : snapshot.bluetooth
          }
        }
        this.snapshot = snapshot
        this.emit('updated', this.getSnapshot())
        return this.getSnapshot()
      })
      .catch(() => {
        if (this.disposed) return this.getSnapshot()
        this.snapshot = { ...this.snapshot, state: 'error' }
        this.emit('updated', this.getSnapshot())
        return this.getSnapshot()
      })
      .finally(() => {
        this.activeRefresh = null
      })
    return this.activeRefresh
  }

  private runWindowsScan(): Promise<SystemStatusSnapshot> {
    const encodedCommand = Buffer.from(SYSTEM_STATUS_SCRIPT, 'utf16le').toString('base64')

    return new Promise((resolve, reject) => {
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedCommand],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
      )
      this.activeChild = child
      let stdout = ''
      let settled = false

      const finish = (error?: Error, snapshot?: SystemStatusSnapshot): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (this.activeChild === child) this.activeChild = null
        if (error) reject(error)
        else resolve(snapshot!)
      }

      child.stdout.on('data', (chunk: Buffer) => {
        if (stdout.length < MAX_OUTPUT_LENGTH) {
          stdout = (stdout + chunk.toString('utf8')).slice(0, MAX_OUTPUT_LENGTH)
        }
      })
      child.once('error', (error) => finish(error))
      child.once('close', (code) => {
        const markerIndex = stdout.lastIndexOf(RESULT_MARKER)
        if (code !== 0 || markerIndex < 0) {
          finish(new Error(`System status scan failed (${code ?? 'unknown'})`))
          return
        }
        try {
          const json = stdout.slice(markerIndex + RESULT_MARKER.length).trim()
          finish(undefined, normalizeSnapshot(JSON.parse(json)))
        } catch (error) {
          finish(error instanceof Error ? error : new Error('Invalid system status result'))
        }
      })

      const timeout = setTimeout(() => {
        child.kill()
        finish(new Error('System status scan timed out'))
      }, SCAN_TIMEOUT_MS)
    })
  }
}
