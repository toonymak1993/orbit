import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { createInterface, type Interface as ReadlineInterface } from 'node:readline'

const RESULT_MARKER = 'ORBIT_XBOX_INSTALL_RESULT:'
const PROGRESS_MARKER = 'ORBIT_XBOX_INSTALL_PROGRESS:'
const INSTALL_TIMEOUT_MS = 30_000

export type XboxInstallRequestStatus = 'queued' | 'unsupported' | 'failed'
export type XboxProductInstallPhase =
  | 'downloading'
  | 'installing'
  | 'paused'
  | 'completed'
  | 'error'

export interface XboxProductInstallProgress {
  productId: string
  phase: XboxProductInstallPhase
  progress?: number
  bytesDownloaded?: number
  bytesTotal?: number
}

const XBOX_INSTALL_SCRIPT = String.raw`
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$resultMarker = '${RESULT_MARKER}'
$progressMarker = '${PROGRESS_MARKER}'

function Write-OrbitInstallResult {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('queued', 'unsupported', 'failed')]
    [string]$Status,

    [bool]$ExitProcess = $true
  )

  [Console]::Out.WriteLine($resultMarker + $Status)
  if ($ExitProcess) { exit 0 }
}

function Wait-WindowsRuntimeOperation {
  param(
    [Parameter(Mandatory = $true)]
    [object]$Operation,

    [Parameter(Mandatory = $true)]
    [Type]$ResultType
  )

  $asTaskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object {
      $_.Name -eq 'AsTask' -and
      $_.IsGenericMethodDefinition -and
      $_.GetParameters().Count -eq 1 -and
      $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation*'
    } |
    Select-Object -First 1

  if ($null -eq $asTaskMethod) {
    throw 'Windows Runtime task bridge is unavailable.'
  }

  $task = $asTaskMethod.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
  $task.GetAwaiter().GetResult()
}

function Get-OrbitAggregateInstallProgress {
  param(
    [Parameter(Mandatory = $true)]
    [object[]]$InstallItems,

    [Parameter(Mandatory = $true)]
    [string]$ProductId
  )

  $statuses = @($InstallItems | ForEach-Object { $_.GetCurrentStatus() })
  if ($statuses.Count -eq 0) { throw 'The install queue returned no status.' }

  [double]$percentTotal = 0
  [UInt64]$bytesDownloaded = 0
  [UInt64]$bytesTotal = 0
  $states = @()
  foreach ($status in $statuses) {
    $states += [string]$status.InstallState
    $percentTotal += [Math]::Min(100.0, [Math]::Max(0.0, [double]$status.PercentComplete))
    try { $bytesDownloaded += [UInt64]$status.BytesDownloaded } catch {}
    try { $bytesTotal += [UInt64]$status.DownloadSizeInBytes } catch {}
  }

  $failed = @($states | Where-Object { $_ -eq 'Error' -or $_ -eq 'Canceled' }).Count -gt 0
  $completed = @($states | Where-Object { $_ -eq 'Completed' }).Count -eq $states.Count
  $paused = @($states | Where-Object { $_ -like 'Paused*' }).Count -gt 0
  $installing = @($states | Where-Object { $_ -eq 'Installing' -or $_ -eq 'RestoringData' }).Count -gt 0
  $phase = if ($failed) {
    'error'
  } elseif ($completed) {
    'completed'
  } elseif ($paused) {
    'paused'
  } elseif ($installing) {
    'installing'
  } else {
    'downloading'
  }
  $progress = if ($bytesTotal -gt 0) {
    [Math]::Min(1.0, [double]$bytesDownloaded / [double]$bytesTotal)
  } else {
    [Math]::Min(1.0, [Math]::Max(0.0, ($percentTotal / $statuses.Count) / 100.0))
  }

  [ordered]@{
    productId = $ProductId
    phase = $phase
    progress = $progress
    bytesDownloaded = $bytesDownloaded
    bytesTotal = $bytesTotal
    terminal = $failed -or $completed
  }
}

$productId = ([string]$env:ORBIT_XBOX_PRODUCT_ID).Trim().ToUpperInvariant()
if ($productId -notmatch '^[A-Z0-9]{12}$') {
  Write-OrbitInstallResult 'failed'
}

try {
  $null = Add-Type -AssemblyName System.Runtime.WindowsRuntime -PassThru
  $null = [Windows.ApplicationModel.Store.Preview.InstallControl.AppInstallManager, Windows.ApplicationModel.Store, ContentType = WindowsRuntime]
  $null = [Windows.ApplicationModel.Store.Preview.InstallControl.AppInstallOptions, Windows.ApplicationModel.Store, ContentType = WindowsRuntime]
  $null = [Windows.ApplicationModel.Store.Preview.InstallControl.AppInstallItem, Windows.ApplicationModel.Store, ContentType = WindowsRuntime]
} catch {
  Write-OrbitInstallResult 'unsupported'
}

try {
  $manager = [Windows.ApplicationModel.Store.Preview.InstallControl.AppInstallManager]::new()
  $options = [Windows.ApplicationModel.Store.Preview.InstallControl.AppInstallOptions]::new()
  $options.AllowForcedAppRestart = $false
  $options.ForceUseOfNonRemovableStorage = $false
  $options.LaunchAfterInstall = $false
  $options.Repair = $false
  $options.StageButDoNotInstall = $false

  $operation = $manager.StartProductInstallAsync(
    $productId,
    '',
    'ORBIT',
    '',
    $options
  )
  $resultType = [System.Collections.Generic.IReadOnlyList[Windows.ApplicationModel.Store.Preview.InstallControl.AppInstallItem]]
  $installItems = @(Wait-WindowsRuntimeOperation $operation $resultType)
  if ($installItems.Count -eq 0) { throw 'The install queue returned no items.' }

  Write-OrbitInstallResult 'queued' $false
  $lastProgressJson = ''
  while ($true) {
    $progress = Get-OrbitAggregateInstallProgress $installItems $productId
    $progressJson = $progress | ConvertTo-Json -Compress
    if ($progressJson -ne $lastProgressJson) {
      [Console]::Out.WriteLine($progressMarker + $progressJson)
      $lastProgressJson = $progressJson
    }
    if ($progress.terminal) { exit 0 }
    [Threading.Thread]::Sleep(500)
  }
} catch {}

Write-OrbitInstallResult 'failed'
`

export function normalizeXboxProductId(value: string): string {
  const productId = value.trim().toUpperCase()
  if (!/^[A-Z0-9]{12}$/.test(productId)) {
    throw new Error('Invalid Xbox product identifier')
  }
  return productId
}

export function parseXboxInstallRequestStatus(output: string): XboxInstallRequestStatus {
  const markerIndex = output.lastIndexOf(RESULT_MARKER)
  if (markerIndex < 0) return 'failed'
  const status = output.slice(markerIndex + RESULT_MARKER.length).trim()
  return status === 'queued' || status === 'unsupported' ? status : 'failed'
}

export function parseXboxProductInstallProgress(
  output: string
): XboxProductInstallProgress | null {
  if (!output.startsWith(PROGRESS_MARKER)) return null
  let payload: unknown
  try {
    payload = JSON.parse(output.slice(PROGRESS_MARKER.length))
  } catch {
    return null
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const value = payload as Record<string, unknown>
  const productId =
    typeof value.productId === 'string' && /^[A-Z0-9]{12}$/.test(value.productId)
      ? value.productId
      : undefined
  const phase = value.phase
  const progress =
    typeof value.progress === 'number' && Number.isFinite(value.progress)
      ? value.progress
      : undefined
  const bytesDownloaded =
    typeof value.bytesDownloaded === 'number' && Number.isSafeInteger(value.bytesDownloaded)
      ? value.bytesDownloaded
      : undefined
  const bytesTotal =
    typeof value.bytesTotal === 'number' && Number.isSafeInteger(value.bytesTotal)
      ? value.bytesTotal
      : undefined
  if (
    !productId ||
    (phase !== 'downloading' &&
      phase !== 'installing' &&
      phase !== 'paused' &&
      phase !== 'completed' &&
      phase !== 'error') ||
    progress === undefined ||
    progress < 0 ||
    progress > 1 ||
    (bytesDownloaded !== undefined && bytesDownloaded < 0) ||
    (bytesTotal !== undefined && bytesTotal < 0)
  ) {
    return null
  }
  return {
    productId,
    phase,
    progress,
    bytesDownloaded,
    bytesTotal
  }
}

interface ActiveXboxInstallRequest {
  child: ChildProcess
  lines: ReadlineInterface
  settle: (status: XboxInstallRequestStatus) => void
}

export class XboxProductInstallService extends EventEmitter {
  private requests = new Map<string, ActiveXboxInstallRequest>()

  request(value: string): Promise<XboxInstallRequestStatus> {
    const productId = normalizeXboxProductId(value)
    if (process.platform !== 'win32') return Promise.resolve('unsupported')
    if (this.requests.has(productId)) return Promise.resolve('queued')

    return new Promise((resolve) => {
      const child = spawn(
        'powershell.exe',
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', XBOX_INSTALL_SCRIPT],
        {
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            ORBIT_XBOX_PRODUCT_ID: productId
          }
        }
      )
      if (!child.stdout) {
        child.kill()
        resolve('failed')
        return
      }

      let settled = false
      let queueTimer: ReturnType<typeof setTimeout>
      const settle = (status: XboxInstallRequestStatus): void => {
        if (settled) return
        settled = true
        clearTimeout(queueTimer)
        resolve(status)
      }
      const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
      const request: ActiveXboxInstallRequest = { child, lines, settle }
      this.requests.set(productId, request)
      let diagnostic = ''
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (chunk: string) => {
        if (diagnostic.length < 1_024) diagnostic += chunk.slice(0, 1_024 - diagnostic.length)
      })

      queueTimer = setTimeout(() => {
        settle('failed')
        child.kill()
      }, INSTALL_TIMEOUT_MS)
      lines.on('line', (line) => {
        if (line.startsWith(RESULT_MARKER)) {
          settle(parseXboxInstallRequestStatus(line))
          return
        }
        const progress = parseXboxProductInstallProgress(line)
        if (progress) this.emit('progress', progress)
      })

      const release = (): void => {
        if (this.requests.get(productId) !== request) return
        this.requests.delete(productId)
        lines.close()
        settle('failed')
        const message = diagnostic.replace(/\s+/g, ' ').trim().slice(0, 240)
        if (message) console.warn(`[xbox-install] Progress helper stopped: ${message}`)
      }
      child.once('error', release)
      child.once('exit', release)
    })
  }

  stop(): void {
    for (const request of this.requests.values()) {
      request.settle('failed')
      request.lines.close()
      request.child.kill()
    }
    this.requests.clear()
  }
}

export const xboxProductInstallService = new XboxProductInstallService()

/** Uses Windows' Store installation queue and keeps its returned status item
 * alive so ORBIT can display the exact progress of its own request. */
export function requestXboxProductInstall(value: string): Promise<XboxInstallRequestStatus> {
  return xboxProductInstallService.request(value)
}
