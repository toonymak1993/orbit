import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { createInterface, type Interface as ReadlineInterface } from 'node:readline'
import { normalizeXboxPackageFamilyName } from './xboxPackageIdentity'

const RESTART_DELAY_MS = 15_000
const CLEAN_STOP_TIMEOUT_MS = 1_500
const MAX_EVENT_LINE_LENGTH = 4_096

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
$updateType = [Windows.Foundation.TypedEventHandler[Windows.ApplicationModel.PackageCatalog,Windows.ApplicationModel.PackageUpdatingEventArgs]]
$installHandler = New-OrbitPackageHandler ([Windows.ApplicationModel.PackageInstallingEventArgs]) $installType
$updateHandler = New-OrbitPackageHandler ([Windows.ApplicationModel.PackageUpdatingEventArgs]) $updateType
$installToken = $catalog.add_PackageInstalling($installHandler)
$updateToken = $catalog.add_PackageUpdating($updateHandler)

try {
  [Console]::Out.WriteLine('{"type":"ready"}')
  $stopRequest = [Console]::In.ReadLineAsync()
  while (-not $stopRequest.IsCompleted) {
    $eventArgs = $null
    if (-not $queue.TryDequeue([ref] $eventArgs)) {
      [Threading.Thread]::Sleep(100)
      continue
    }
    try {
      if ($eventArgs -is [Windows.ApplicationModel.PackageInstallingEventArgs]) {
        $operation = 'install'
        $package = $eventArgs.Package
      } elseif ($eventArgs -is [Windows.ApplicationModel.PackageUpdatingEventArgs]) {
        $operation = 'update'
        $package = if ($null -ne $eventArgs.TargetPackage) {
          $eventArgs.TargetPackage
        } else {
          $eventArgs.SourcePackage
        }
      } else {
        continue
      }
      if ($null -eq $package -or $null -eq $package.Id) { continue }
      $errorHResult = if ($null -eq $eventArgs.ErrorCode) {
        0
      } else {
        [int] $eventArgs.ErrorCode.HResult
      }
      $payload = [ordered]@{
        type = 'package-progress'
        operation = $operation
        activityId = $eventArgs.ActivityId.ToString('D')
        packageFamilyName = [string]$package.Id.FamilyName
        progress = [Math]::Min(1.0, [Math]::Max(0.0, [double]$eventArgs.Progress))
        isComplete = [bool]$eventArgs.IsComplete
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
  if ($null -ne $updateToken) { $catalog.remove_PackageUpdating($updateToken) }
}
`

export interface XboxPackageProgressEvent {
  operation: 'install' | 'update'
  activityId: string
  packageFamilyName: string
  progress: number
  isComplete: boolean
  errorHResult: number
}

interface XboxPackageProgressPayload extends XboxPackageProgressEvent {
  type: 'package-progress'
  isFramework: boolean
  isResourcePackage: boolean
  isOptional: boolean
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
  if (
    payload.type !== 'package-progress' ||
    (payload.operation !== 'install' && payload.operation !== 'update') ||
    typeof payload.activityId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      payload.activityId
    ) ||
    !packageFamilyName ||
    typeof payload.progress !== 'number' ||
    !Number.isFinite(payload.progress) ||
    payload.progress < 0 ||
    payload.progress > 1 ||
    typeof payload.isComplete !== 'boolean' ||
    typeof payload.errorHResult !== 'number' ||
    !Number.isSafeInteger(payload.errorHResult) ||
    typeof payload.isFramework !== 'boolean' ||
    typeof payload.isResourcePackage !== 'boolean' ||
    typeof payload.isOptional !== 'boolean' ||
    payload.isFramework ||
    payload.isResourcePackage ||
    payload.isOptional
  ) {
    return null
  }

  return {
    operation: payload.operation,
    activityId: payload.activityId.toLowerCase(),
    packageFamilyName,
    progress: payload.progress,
    isComplete: payload.isComplete,
    errorHResult: payload.errorHResult
  }
}

export class XboxPackageActivityMonitor extends EventEmitter {
  private running = false
  private child: ChildProcess | undefined
  private lines: ReadlineInterface | undefined
  private restartTimer: ReturnType<typeof setTimeout> | undefined

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
    this.stopChild()
  }

  private spawnHelper(): void {
    if (!this.running || this.child) return
    const child = spawn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', XBOX_PACKAGE_ACTIVITY_SCRIPT],
      {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'ignore']
      }
    )
    if (!child.stdout || !child.stdin) {
      child.kill()
      this.scheduleRestart()
      return
    }
    this.child = child
    this.lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
    this.lines.on('line', (line) => {
      if (line === '{"type":"ready"}') {
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
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined
      this.spawnHelper()
    }, RESTART_DELAY_MS)
  }
}

export const xboxPackageActivityMonitor = new XboxPackageActivityMonitor()
