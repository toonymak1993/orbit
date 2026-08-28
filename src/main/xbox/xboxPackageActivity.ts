import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { createInterface, type Interface as ReadlineInterface } from 'node:readline'
import type { LauncherDownloadPhase } from '@shared/ipc'
import { normalizeXboxPackageFamilyName } from './xboxPackageIdentity'

const MIN_RESTART_DELAY_MS = 2_000
const MAX_RESTART_DELAY_MS = 30_000
const CLEAN_STOP_TIMEOUT_MS = 1_500
const MAX_EVENT_LINE_LENGTH = 8_192

const XBOX_PACKAGE_ACTIVITY_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$catalog = [Windows.ApplicationModel.PackageCatalog,Windows.ApplicationModel,ContentType=WindowsRuntime]::OpenForCurrentUser()
$queue = [System.Collections.Concurrent.ConcurrentQueue[object]]::new()

function New-OrbitPackageHandler([Type] $eventArgsType, [Type] $handlerType) {
  $sender = [System.Linq.Expressions.Expression]::Parameter(
    [Windows.ApplicationModel.PackageCatalog], 'sender')
  $eventArgs = [System.Linq.Expressions.Expression]::Parameter($eventArgsType, 'eventArgs')
  $queueConstant = [System.Linq.Expressions.Expression]::Constant($queue)
  $enqueue = $queue.GetType().GetMethod('Enqueue')
  $boxedArgs = [System.Linq.Expressions.Expression]::Convert($eventArgs, [object])
  $body = [System.Linq.Expressions.Expression]::Call($queueConstant, $enqueue, $boxedArgs)
  $parameters = [System.Linq.Expressions.ParameterExpression[]] @($sender, $eventArgs)
  [System.Linq.Expressions.Expression]::Lambda($handlerType, $body, $parameters).Compile()
}

$installType = [Windows.Foundation.TypedEventHandler[Windows.ApplicationModel.PackageCatalog,Windows.ApplicationModel.PackageInstallingEventArgs]]
$stagingType = [Windows.Foundation.TypedEventHandler[Windows.ApplicationModel.PackageCatalog,Windows.ApplicationModel.PackageStagingEventArgs]]
$updateType = [Windows.Foundation.TypedEventHandler[Windows.ApplicationModel.PackageCatalog,Windows.ApplicationModel.PackageUpdatingEventArgs]]
$contentType = [Windows.Foundation.TypedEventHandler[Windows.ApplicationModel.PackageCatalog,Windows.ApplicationModel.PackageContentGroupStagingEventArgs]]
$statusType = [Windows.Foundation.TypedEventHandler[Windows.ApplicationModel.PackageCatalog,Windows.ApplicationModel.PackageStatusChangedEventArgs]]
$installHandler = New-OrbitPackageHandler ([Windows.ApplicationModel.PackageInstallingEventArgs]) $installType
$stagingHandler = New-OrbitPackageHandler ([Windows.ApplicationModel.PackageStagingEventArgs]) $stagingType
$updateHandler = New-OrbitPackageHandler ([Windows.ApplicationModel.PackageUpdatingEventArgs]) $updateType
$contentHandler = New-OrbitPackageHandler ([Windows.ApplicationModel.PackageContentGroupStagingEventArgs]) $contentType
$statusHandler = New-OrbitPackageHandler ([Windows.ApplicationModel.PackageStatusChangedEventArgs]) $statusType
$installToken = $catalog.add_PackageInstalling($installHandler)
$stagingToken = $catalog.add_PackageStaging($stagingHandler)
$updateToken = $catalog.add_PackageUpdating($updateHandler)
$contentToken = $catalog.add_PackageContentGroupStaging($contentHandler)
$statusToken = $catalog.add_PackageStatusChanged($statusHandler)

function Get-OrbitPlainText([object] $value) {
  try {
    $text = ([string]$value).Trim()
    if ($text -and -not $text.StartsWith('ms-resource:', [System.StringComparison]::OrdinalIgnoreCase)) {
      return $text
    }
  } catch {}
  return $null
}

function Get-OrbitStreamingIdentity([object] $request) {
  try {
    $caller = [string]$request.Caller.CallerIdentity
    $storeId = ([string]$request.StoreId).Trim().ToUpperInvariant()
    $crdPath = [string]$request.ActiveSource.CrdPath
    $sessionId = [guid]::Empty
    if (-not $caller.StartsWith('Microsoft.GamingApp_', [System.StringComparison]::OrdinalIgnoreCase) -or
        $storeId -notmatch '^[A-Z0-9]{12}$' -or
        -not [guid]::TryParse([string]$request.Scheme.SessionId, [ref]$sessionId) -or
        $crdPath -notmatch '(?i)(?<name>[A-Z0-9.-]+)_[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+_(?:x64|x86|arm64|neutral)_[A-Z0-9.-]*_(?<publisher>[A-Z0-9]+)\.msixvc(?:,|$)') {
      return $null
    }
    return [pscustomobject]@{
      activityId = $sessionId.ToString('D')
      packageFamilyName = $Matches['name'] + '_' + $Matches['publisher']
      gamingProductId = $storeId
      displayName = @($Matches['name'] -split '\.')[-1]
    }
  } catch {
    return $null
  }
}

function Write-OrbitStreamingEvent([object] $identity, [bool] $isComplete) {
  $payload = [ordered]@{
    type = 'package-progress'
    stage = 'streaming'
    activityId = $identity.activityId
    packageFamilyName = $identity.packageFamilyName
    displayName = $identity.displayName
    gamingProductId = $identity.gamingProductId
    isGamingPackage = $true
    contentGroupRequired = $false
    isComplete = $isComplete
    errorHResult = 0
    isFramework = $false
    isResourcePackage = $false
    isOptional = $false
  }
  [Console]::Out.WriteLine(($payload | ConvertTo-Json -Compress))
}

$streamingRoot = 'HKLM:\SOFTWARE\Microsoft\GamingServices\StreamingRequests'
$streamingSeen = @{}
$deploymentsSeen = @{}
$lastStreamingPoll = [DateTime]::MinValue

try {
  [Console]::Out.WriteLine('{"type":"ready"}')
  $stopRequest = [Console]::In.ReadLineAsync()
  while (-not $stopRequest.IsCompleted) {
    $pollTime = [DateTime]::UtcNow
    if (($pollTime - $lastStreamingPoll).TotalMilliseconds -ge 750) {
      $lastStreamingPoll = $pollTime
      $currentStreaming = @{}
      try {
        if (Test-Path -LiteralPath $streamingRoot) {
          $requestKey = Get-Item -LiteralPath $streamingRoot -ErrorAction Stop
          foreach ($valueName in @($requestKey.GetValueNames() | Select-Object -First 64)) {
            $rawRequest = [string]$requestKey.GetValue($valueName)
            if (-not $rawRequest -or $rawRequest.Length -gt 131072) { continue }
            try { $request = $rawRequest | ConvertFrom-Json } catch { continue }
            $identity = Get-OrbitStreamingIdentity $request
            if ($null -eq $identity) { continue }
            $active = $request.Scheme.RegisterOnly -eq $false
            $currentStreaming[$valueName] = [pscustomobject]@{
              active = $active
              identity = $identity
            }
            $previous = $streamingSeen[$valueName]
            if ($active) {
              Write-OrbitStreamingEvent $identity $false
            } elseif ($null -ne $previous -and $previous.active) {
              Write-OrbitStreamingEvent $identity $true
            }
          }
        }
      } catch {}
      foreach ($valueName in @($streamingSeen.Keys)) {
        if (-not $currentStreaming.ContainsKey($valueName) -and $streamingSeen[$valueName].active) {
          Write-OrbitStreamingEvent $streamingSeen[$valueName].identity $true
        }
      }
      $streamingSeen = $currentStreaming
    }
    $eventArgs = $null
    if (-not $queue.TryDequeue([ref] $eventArgs)) {
      [Threading.Thread]::Sleep(100)
      continue
    }
    try {
      if ($eventArgs -is [Windows.ApplicationModel.PackageInstallingEventArgs]) {
        $stage = 'installing'
        $package = $eventArgs.Package
      } elseif ($eventArgs -is [Windows.ApplicationModel.PackageStagingEventArgs]) {
        $stage = 'staging'
        $package = $eventArgs.Package
      } elseif ($eventArgs -is [Windows.ApplicationModel.PackageUpdatingEventArgs]) {
        $stage = 'updating'
        $package = if ($null -ne $eventArgs.TargetPackage) {
          $eventArgs.TargetPackage
        } else {
          $eventArgs.SourcePackage
        }
      } elseif ($eventArgs -is [Windows.ApplicationModel.PackageContentGroupStagingEventArgs]) {
        $stage = 'content-staging'
        $package = $eventArgs.Package
      } elseif ($eventArgs -is [Windows.ApplicationModel.PackageStatusChangedEventArgs]) {
        $stage = 'status'
        $package = $eventArgs.Package
      } else {
        continue
      }
      if ($null -eq $package -or $null -eq $package.Id) { continue }
      $packageFullName = [string]$package.Id.FullName
      $gameConfigPath = Join-Path 'HKLM:\SOFTWARE\Microsoft\GamingServices\GameConfig' $packageFullName
      $isGamingPackage = $false
      try { $isGamingPackage = Test-Path -LiteralPath $gameConfigPath } catch {}
      $gamingProductId = $null
      if ($isGamingPackage) {
        try {
          $gamingProductId = Get-OrbitPlainText (
            Get-ItemPropertyValue -LiteralPath $gameConfigPath -Name StoreId -ErrorAction SilentlyContinue
          )
        } catch {}
      }
      $displayName = $null
      try { $displayName = Get-OrbitPlainText $package.DisplayName } catch {}
      if ($stage -eq 'status') {
        $activityId = [guid]::Empty.ToString('D')
        $eventProgress = $null
        $status = $package.Status
        $deploymentInProgress = (
          $status.DeploymentInProgress -or $status.Servicing -or $status.IsPartiallyStaged
        )
        $statusKey = ([string]$package.Id.FamilyName).ToLowerInvariant()
        if ($deploymentInProgress) {
          $deploymentsSeen[$statusKey] = $true
          continue
        }
        if (-not $deploymentsSeen.ContainsKey($statusKey)) { continue }
        [void]$deploymentsSeen.Remove($statusKey)
        $isComplete = $true
        $errorHResult = 0
      } else {
        $activityId = $eventArgs.ActivityId.ToString('D')
        $eventProgress = [Math]::Min(1.0, [Math]::Max(0.0, [double]$eventArgs.Progress))
        $isComplete = [bool]$eventArgs.IsComplete
        $errorHResult = if ($null -eq $eventArgs.ErrorCode) {
          0
        } else {
          [int] $eventArgs.ErrorCode.HResult
        }
      }
      $contentGroupRequired = if ($stage -eq 'content-staging') {
        [bool]$eventArgs.IsContentGroupRequired
      } else {
        $false
      }
      $payload = [ordered]@{
        type = 'package-progress'
        stage = $stage
        activityId = $activityId
        packageFamilyName = [string]$package.Id.FamilyName
        displayName = $displayName
        gamingProductId = $gamingProductId
        isGamingPackage = [bool]$isGamingPackage
        contentGroupRequired = $contentGroupRequired
        progress = $eventProgress
        isComplete = $isComplete
        errorHResult = $errorHResult
        isFramework = [bool]$package.IsFramework
        isResourcePackage = [bool]$package.IsResourcePackage
        isOptional = [bool]$package.IsOptional
      }
      [Console]::Out.WriteLine(($payload | ConvertTo-Json -Compress))
    } catch { }
  }
} finally {
  if ($null -ne $installToken) { $catalog.remove_PackageInstalling($installToken) }
  if ($null -ne $stagingToken) { $catalog.remove_PackageStaging($stagingToken) }
  if ($null -ne $updateToken) { $catalog.remove_PackageUpdating($updateToken) }
  if ($null -ne $contentToken) { $catalog.remove_PackageContentGroupStaging($contentToken) }
  if ($null -ne $statusToken) { $catalog.remove_PackageStatusChanged($statusToken) }
}
`

export type XboxPackageActivityStage =
  | 'streaming'
  | 'staging'
  | 'installing'
  | 'updating'
  | 'content-staging'
  | 'status'

export interface XboxPackageProgressEvent {
  stage: XboxPackageActivityStage
  activityId: string
  packageFamilyName: string
  displayName?: string
  gamingProductId?: string
  isGamingPackage: boolean
  contentGroupRequired: boolean
  progress?: number
  isComplete: boolean
  errorHResult: number
}

export interface XboxPackageProgressState {
  phase?: LauncherDownloadPhase
  terminal: boolean
  refreshLibrary: boolean
  phaseTransition: boolean
}

/** Converts the separate Windows/Gaming Services phases into one compact
 * Dynamic-Island state without treating staging as whole-game completion. */
export function deriveXboxPackageProgressState(
  event: XboxPackageProgressEvent
): XboxPackageProgressState {
  if (event.stage === 'status') {
    return {
      terminal: false,
      refreshLibrary: event.isComplete && event.errorHResult === 0,
      phaseTransition: false
    }
  }

  if (event.stage === 'content-staging') {
    const requiredFailure =
      event.isComplete && event.errorHResult !== 0 && event.contentGroupRequired
    return {
      phase: requiredFailure ? 'error' : event.isComplete ? 'installing' : 'downloading',
      terminal: requiredFailure,
      refreshLibrary: false,
      phaseTransition: event.isComplete && !requiredFailure
    }
  }

  const failed = event.isComplete && event.errorHResult !== 0
  const packageFinal = event.stage === 'installing' || event.stage === 'updating'
  const completed = event.isComplete && !failed && packageFinal
  return {
    phase: failed
      ? 'error'
      : completed
        ? 'completed'
        : event.stage === 'updating'
          ? 'updating'
          : event.stage === 'installing' || event.isComplete
            ? 'installing'
            : 'downloading',
    terminal: failed || completed,
    refreshLibrary: completed && packageFinal,
    phaseTransition:
      event.isComplete && !failed && (event.stage === 'streaming' || event.stage === 'staging')
  }
}

interface XboxPackageProgressPayload extends XboxPackageProgressEvent {
  type: 'package-progress'
  isFramework: boolean
  isResourcePackage: boolean
  isOptional: boolean
}

function safeDisplayName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!normalized || normalized.toLowerCase().startsWith('ms-resource:')) return undefined
  return normalized.slice(0, 160)
}

export function parseXboxPackageProgressEvent(line: string): XboxPackageProgressEvent | null {
  if (!line || line.length > MAX_EVENT_LINE_LENGTH) return null
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const payload = value as Partial<XboxPackageProgressPayload>
  const packageFamilyName = normalizeXboxPackageFamilyName(payload.packageFamilyName)
  const gamingProductId =
    typeof payload.gamingProductId === 'string' && /^[A-Z0-9]{12}$/i.test(payload.gamingProductId)
      ? payload.gamingProductId.toUpperCase()
      : undefined
  const progress =
    typeof payload.progress === 'number' && Number.isFinite(payload.progress)
      ? payload.progress
      : undefined
  if (
    payload.type !== 'package-progress' ||
    (payload.stage !== 'streaming' &&
      payload.stage !== 'staging' &&
      payload.stage !== 'installing' &&
      payload.stage !== 'updating' &&
      payload.stage !== 'content-staging' &&
      payload.stage !== 'status') ||
    typeof payload.activityId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      payload.activityId
    ) ||
    !packageFamilyName ||
    (payload.stage !== 'streaming' && payload.stage !== 'status' && progress === undefined) ||
    (progress !== undefined && (progress < 0 || progress > 1)) ||
    typeof payload.isComplete !== 'boolean' ||
    typeof payload.errorHResult !== 'number' ||
    !Number.isSafeInteger(payload.errorHResult) ||
    typeof payload.isGamingPackage !== 'boolean' ||
    typeof payload.contentGroupRequired !== 'boolean' ||
    typeof payload.isFramework !== 'boolean' ||
    typeof payload.isResourcePackage !== 'boolean' ||
    typeof payload.isOptional !== 'boolean' ||
    payload.isFramework ||
    payload.isResourcePackage
  ) {
    return null
  }

  return {
    stage: payload.stage,
    activityId: payload.activityId.toLowerCase(),
    packageFamilyName,
    displayName: safeDisplayName(payload.displayName),
    gamingProductId,
    isGamingPackage: payload.isGamingPackage,
    contentGroupRequired: payload.contentGroupRequired,
    progress,
    isComplete: payload.isComplete,
    errorHResult: payload.errorHResult
  }
}

export class XboxPackageActivityMonitor extends EventEmitter {
  private running = false
  private child: ChildProcess | undefined
  private lines: ReadlineInterface | undefined
  private restartTimer: ReturnType<typeof setTimeout> | undefined
  private restartAttempts = 0

  start(): void {
    if (this.running || process.platform !== 'win32') return
    this.running = true
    this.spawnHelper()
  }

  stop(): void {
    if (!this.running) return
    this.running = false
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = undefined
    this.restartAttempts = 0
    this.stopChild()
  }

  private spawnHelper(): void {
    if (!this.running || this.child) return
    const child = spawn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', XBOX_PACKAGE_ACTIVITY_SCRIPT],
      {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      }
    )
    if (!child.stdout || !child.stdin) {
      child.kill()
      this.scheduleRestart()
      return
    }
    this.child = child
    let helperError = ''
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      if (helperError.length < 2_048) helperError += chunk.slice(0, 2_048 - helperError.length)
    })
    this.lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
    this.lines.on('line', (line) => {
      if (line === '{"type":"ready"}') {
        this.restartAttempts = 0
        this.emit('ready')
        return
      }
      const event = parseXboxPackageProgressEvent(line)
      if (event) this.emit('progress', event)
    })
    const releaseChild = (): void => {
      if (this.child !== child) return
      this.lines?.close()
      this.lines = undefined
      this.child = undefined
      const diagnostic = helperError.replace(/\s+/g, ' ').trim().slice(0, 320)
      if (diagnostic) console.warn(`[xbox-downloads] Package monitor stopped: ${diagnostic}`)
      this.emit('unavailable')
      this.scheduleRestart()
    }
    child.once('error', releaseChild)
    child.once('exit', releaseChild)
  }

  private stopChild(): void {
    const child = this.child
    this.child = undefined
    this.lines?.close()
    this.lines = undefined
    if (!child) return
    child.stdin?.end()
    const killTimer = setTimeout(() => {
      if (child.exitCode === null) child.kill()
    }, CLEAN_STOP_TIMEOUT_MS)
    child.once('exit', () => clearTimeout(killTimer))
  }

  private scheduleRestart(): void {
    if (!this.running || this.restartTimer) return
    const delay = Math.min(
      MAX_RESTART_DELAY_MS,
      MIN_RESTART_DELAY_MS * 2 ** Math.min(this.restartAttempts, 4)
    )
    this.restartAttempts += 1
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined
      this.spawnHelper()
    }, delay)
  }
}

export const xboxPackageActivityMonitor = new XboxPackageActivityMonitor()
