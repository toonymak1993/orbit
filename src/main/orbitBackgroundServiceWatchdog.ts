import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { ORBIT_AGENT_ARGUMENT } from './orbitServiceProtocol'
import {
  windowsCommandLineHasArgument,
  windowsProcessIdentity,
  type WindowsProcessIdentity
} from './windowsProcess'

const WINDOWS_POWERSHELL_PATH = join(
  process.env.SystemRoot ?? 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe'
)
const WATCHDOG_STATE_FILE_NAME = 'orbit-background-service-watchdog.json'
const WATCHDOG_READY_PREFIX = 'ORBIT_BACKGROUND_WATCHDOG_READY:'
const WATCHDOG_READY_TIMEOUT_MS = 8_000
const WATCHDOG_STOP_TIMEOUT_MS = 3_000
const WATCHDOG_SUPERVISOR_RESTART_BASE_MS = 500
const WATCHDOG_SUPERVISOR_RESTART_MAX_MS = 5_000
const WATCHDOG_REPLACEMENT_ACK_FILE_PREFIX = 'orbit-background-service-watchdog-ack-'

export const BACKGROUND_SERVICE_WATCHDOG_RESTART_BASE_MS = 1_500
export const BACKGROUND_SERVICE_WATCHDOG_RESTART_MAX_MS = 60_000
export const BACKGROUND_SERVICE_WATCHDOG_STABLE_MS = 30_000
export const BACKGROUND_SERVICE_WATCHDOG_REPLACEMENT_ACK_TIMEOUT_MS = 30_000
export const BACKGROUND_SERVICE_WATCHDOG_INTENTIONAL_EXIT_CODE = 0
export const BACKGROUND_SERVICE_WATCHDOG_RETRY_EXIT_CODE = 1
export const BACKGROUND_SERVICE_WATCHDOG_ACK_PATH_ENV =
  'ORBIT_BACKGROUND_WATCHDOG_ACK_PATH_B64'
export const BACKGROUND_SERVICE_WATCHDOG_ACK_TOKEN_ENV =
  'ORBIT_BACKGROUND_WATCHDOG_ACK_TOKEN_B64'

export interface BackgroundServiceWatchdogReplacementAck {
  path: string
  token: string
}

export interface BackgroundServiceWatchdogOptions {
  userDataPath: string
  /** Required by Electron development runs, where the executable needs the app
   * directory before the agent argument. Packaged agents omit this value. */
  developmentAppPath?: string
  /** Primarily useful for verification. Production agents monitor themselves. */
  parentProcessId?: number
  readyTimeoutMs?: number
  /** Test-host escape hatch. Production callers must leave the default detached mode enabled. */
  attachedForVerification?: boolean
}

export interface BackgroundServiceWatchdogHandle {
  readonly processId: number | undefined
  /** Replaces a damaged watcher without changing the monitored agent generation. */
  restart(): Promise<boolean>
  /** Stops the watcher intentionally, so a graceful agent shutdown is not recovered. */
  shutdown(): Promise<void>
}

interface MonitoredAgentIdentity extends WindowsProcessIdentity {
  processId: number
}

function encoded(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64')
}

function encodedPowerShellCommand(value: string): string {
  return Buffer.from(value, 'utf16le').toString('base64')
}

function normalizedWindowsPath(value: string): string {
  return value.trim().replace(/^"|"$/g, '').toLowerCase()
}

export function backgroundServiceWatchdogStatePath(userDataPath: string): string {
  return join(userDataPath, WATCHDOG_STATE_FILE_NAME)
}

function decodedEnvironmentValue(value: string): string | undefined {
  if (!value || value.length > 16_384 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return undefined
  try {
    return Buffer.from(value, 'base64').toString('utf8')
  } catch {
    return undefined
  }
}

/** Must be called before the replacement agent starts any children. It removes
 * the inherited capability from the process environment and validates that the
 * untrusted values can only acknowledge a token-bound file inside userData. */
export function consumeBackgroundServiceWatchdogReplacementAck(
  userDataPath: string
): BackgroundServiceWatchdogReplacementAck | undefined {
  const encodedPath = process.env[BACKGROUND_SERVICE_WATCHDOG_ACK_PATH_ENV]
  const encodedToken = process.env[BACKGROUND_SERVICE_WATCHDOG_ACK_TOKEN_ENV]
  delete process.env[BACKGROUND_SERVICE_WATCHDOG_ACK_PATH_ENV]
  delete process.env[BACKGROUND_SERVICE_WATCHDOG_ACK_TOKEN_ENV]
  if (!encodedPath || !encodedToken) return undefined

  const path = decodedEnvironmentValue(encodedPath)
  const token = decodedEnvironmentValue(encodedToken)?.toLowerCase()
  if (!path || !token || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(token)) {
    return undefined
  }
  const resolvedUserDataPath = resolve(userDataPath)
  const resolvedAckPath = resolve(path)
  const expectedName = `${WATCHDOG_REPLACEMENT_ACK_FILE_PREFIX}${token}.json`
  if (
    dirname(resolvedAckPath).toLowerCase() !== resolvedUserDataPath.toLowerCase() ||
    basename(resolvedAckPath).toLowerCase() !== expectedName
  ) {
    return undefined
  }
  return { path: resolvedAckPath, token }
}

/** Call only after the replacement owns the service pipe and its own watchdog
 * has completed the ready handshake. Rename publishes one complete ack. */
export async function acknowledgeBackgroundServiceWatchdogReplacement(
  ack: BackgroundServiceWatchdogReplacementAck
): Promise<void> {
  const temporaryPath = `${ack.path}.${process.pid}.${randomUUID()}.tmp`
  const payload = JSON.stringify({
    schemaVersion: 1,
    token: ack.token,
    processId: process.pid,
    acknowledgedAt: Date.now()
  })
  try {
    await writeFile(temporaryPath, payload, { encoding: 'utf8', flag: 'wx' })
    await rename(temporaryPath, ack.path)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

/** `previousFailures` is the number persisted by the prior short-lived agent.
 * The first recovery waits 1.5 seconds, then doubles up to one minute. */
export function backgroundServiceWatchdogRestartDelayMs(previousFailures: number): number {
  const normalizedFailures = Number.isFinite(previousFailures)
    ? Math.max(0, Math.floor(previousFailures))
    : 0
  return Math.min(
    BACKGROUND_SERVICE_WATCHDOG_RESTART_MAX_MS,
    BACKGROUND_SERVICE_WATCHDOG_RESTART_BASE_MS * 2 ** normalizedFailures
  )
}

/** The script deliberately makes no install/login-item decision. A replacement
 * agent must perform the authoritative suspension and installation checks before
 * and after binding its pipe. */
export function createBackgroundServiceWatchdogScript(): string {
  return [
    "$ErrorActionPreference='Stop'",
    "function Decode([string]$value){[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($value))}",
    "function Encode([string]$value){[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($value))}",
    '$parentPid=[int]$env:ORBIT_WATCHDOG_PARENT_PID',
    '$parentStartedAt=[long]$env:ORBIT_WATCHDOG_PARENT_STARTED_AT',
    '$parentExecutable=Decode $env:ORBIT_WATCHDOG_PARENT_EXECUTABLE_B64',
    '$restartExecutable=Decode $env:ORBIT_WATCHDOG_RESTART_EXECUTABLE_B64',
    "$developmentApp=if($env:ORBIT_WATCHDOG_APP_B64){Decode $env:ORBIT_WATCHDOG_APP_B64}else{''}",
    '$agentArgument=Decode $env:ORBIT_WATCHDOG_ARGUMENT_B64',
    '$statePath=Decode $env:ORBIT_WATCHDOG_STATE_B64',
    '$readyPath=Decode $env:ORBIT_WATCHDOG_READY_PATH_B64',
    '$readyToken=Decode $env:ORBIT_WATCHDOG_READY_B64',
    '$mutexName=Decode $env:ORBIT_WATCHDOG_MUTEX_B64',
    '$stableMs=[long]$env:ORBIT_WATCHDOG_STABLE_MS',
    '$restartBaseMs=[long]$env:ORBIT_WATCHDOG_RESTART_BASE_MS',
    '$restartMaxMs=[long]$env:ORBIT_WATCHDOG_RESTART_MAX_MS',
    '$replacementAckTimeoutMs=[long]$env:ORBIT_WATCHDOG_REPLACEMENT_ACK_TIMEOUT_MS',
    `$argumentPattern='(?:^|[\\s"])'+[Regex]::Escape($agentArgument)+'(?=$|[\\s"])'`,
    'function Test-ExpectedParent {',
    '  try {',
    "    $candidate=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$parentPid) -ErrorAction Stop",
    '    if($null -eq $candidate){return $false}',
    '    $candidateStartedAt=([DateTimeOffset]($candidate.CreationDate.ToUniversalTime())).ToUnixTimeMilliseconds()',
    '    if($candidateStartedAt -ne $parentStartedAt){return $false}',
    '    if(![string]::Equals(([string]$candidate.ExecutablePath).Trim().Trim([char]34),$parentExecutable.Trim().Trim([char]34),[StringComparison]::OrdinalIgnoreCase)){return $false}',
    '    return [Regex]::IsMatch([string]$candidate.CommandLine,$argumentPattern,[Text.RegularExpressions.RegexOptions]::IgnoreCase)',
    '  } catch { return $false }',
    '}',
    'if(!(Test-ExpectedParent)){exit 10}',
    'try {$parentProcess=[Diagnostics.Process]::GetProcessById($parentPid)}catch{exit 10}',
    'try {',
    '  $handleStartedAt=([DateTimeOffset]($parentProcess.StartTime.ToUniversalTime())).ToUnixTimeMilliseconds()',
    '  if($handleStartedAt -ne $parentStartedAt -or !(Test-ExpectedParent)){$parentProcess.Dispose();exit 10}',
    '} catch {$parentProcess.Dispose();exit 10}',
    `[IO.File]::WriteAllText($readyPath,'${WATCHDOG_READY_PREFIX}'+$readyToken,[Text.UTF8Encoding]::new($false))`,
    '$parentProcess.WaitForExit()',
    '$parentProcess.Dispose()',
    "$generation=([string]$parentPid)+':'+([string]$parentStartedAt)",
    '$stateDirectory=[IO.Path]::GetDirectoryName($statePath)',
    '[IO.Directory]::CreateDirectory($stateDirectory)|Out-Null',
    'function Write-WatchdogState([int]$failures,[string]$handled,[object[]]$suppressed,[int]$replacementPid,[string]$status){',
    '  $payload=[ordered]@{schemaVersion=2;consecutiveFailures=$failures;lastHandledGeneration=$handled;suppressedGenerations=@($suppressed);replacementProcessId=$replacementPid;status=$status;updatedAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()}|ConvertTo-Json -Compress',
    '  for($writeAttempt=0;$writeAttempt -lt 5;$writeAttempt++){',
    "    $temporaryPath=$statePath+'.'+[Guid]::NewGuid().ToString('N')+'.tmp'",
    "    $backupPath=$statePath+'.'+[Guid]::NewGuid().ToString('N')+'.bak'",
    '    try {',
    '      [IO.File]::WriteAllText($temporaryPath,$payload,[Text.UTF8Encoding]::new($false))',
    '      if([IO.File]::Exists($statePath)){[IO.File]::Replace($temporaryPath,$statePath,$backupPath,$true)}else{[IO.File]::Move($temporaryPath,$statePath)}',
    '      return',
    '    } catch {',
    '      if($writeAttempt -ge 4){throw}',
    '      Start-Sleep -Milliseconds 50',
    '    } finally {',
    '      if([IO.File]::Exists($temporaryPath)){[IO.File]::Delete($temporaryPath)}',
    '      if([IO.File]::Exists($backupPath)){[IO.File]::Delete($backupPath)}',
    '    }',
    '  }',
    '}',
    '$mutex=$null',
    '$ownsMutex=$false',
    'try {',
    '  $mutex=[Threading.Mutex]::new($false,$mutexName)',
    '  try {$ownsMutex=$mutex.WaitOne()}catch [Threading.AbandonedMutexException] {$ownsMutex=$true}',
    '  $previousFailures=0',
    "  $lastHandledGeneration=''",
    '  $suppressedGenerations=@()',
    '  if([IO.File]::Exists($statePath)){',
    '    try {',
    '      $state=[IO.File]::ReadAllText($statePath)|ConvertFrom-Json -ErrorAction Stop',
    '      $lastHandledGeneration=[string]$state.lastHandledGeneration',
    '      $suppressedGenerations=@($state.suppressedGenerations|ForEach-Object {[string]$_}|Where-Object {$_})',
    '      if($lastHandledGeneration -eq $generation -or $suppressedGenerations -contains $generation){exit 0}',
    '      $previousFailures=[int]$state.consecutiveFailures',
    '      if($previousFailures -lt 0){$previousFailures=0}',
    '      if($previousFailures -gt 16){$previousFailures=16}',
    '    } catch { $previousFailures=0 }',
    '  }',
    '  $lifetimeMs=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()-$parentStartedAt',
    '  if($lifetimeMs -gt $stableMs){$previousFailures=0}',
    '  while($true){',
    '    $restartDelayMs=[long][Math]::Min($restartMaxMs,[Math]::Round($restartBaseMs*[Math]::Pow(2,$previousFailures)))',
    '    Start-Sleep -Milliseconds $restartDelayMs',
    '    $ackToken=[Guid]::NewGuid().ToString()',
    `    $ackPath=[IO.Path]::Combine($stateDirectory,'${WATCHDOG_REPLACEMENT_ACK_FILE_PREFIX}'+$ackToken+'.json')`,
    '    [IO.File]::Delete($ackPath)',
    `    [Environment]::SetEnvironmentVariable('${BACKGROUND_SERVICE_WATCHDOG_ACK_PATH_ENV}',(Encode $ackPath),'Process')`,
    `    [Environment]::SetEnvironmentVariable('${BACKGROUND_SERVICE_WATCHDOG_ACK_TOKEN_ENV}',(Encode $ackToken),'Process')`,
    '    $replacement=$null',
    '    try {',
    `      $arguments=if($developmentApp){'"'+$developmentApp+'" '+$agentArgument}else{$agentArgument}`,
    '      $replacement=Start-Process -FilePath $restartExecutable -ArgumentList $arguments -WindowStyle Hidden -PassThru -ErrorAction Stop',
    '      if($null -eq $replacement -or $replacement.Id -le 0){throw "Replacement process was not created"}',
    '    } catch {',
    '      $previousFailures=[Math]::Min(16,$previousFailures+1)',
    "      Write-WatchdogState $previousFailures $lastHandledGeneration $suppressedGenerations 0 'spawn-failed'",
    '      continue',
    '    } finally {',
    `      [Environment]::SetEnvironmentVariable('${BACKGROUND_SERVICE_WATCHDOG_ACK_PATH_ENV}',$null,'Process')`,
    `      [Environment]::SetEnvironmentVariable('${BACKGROUND_SERVICE_WATCHDOG_ACK_TOKEN_ENV}',$null,'Process')`,
    '    }',
    '    $acknowledged=$false',
    '    $intentionalExit=$false',
    '    $deadline=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+$replacementAckTimeoutMs',
    '    while([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -lt $deadline){',
    '      if([IO.File]::Exists($ackPath)){',
    '        try {',
    '          $ack=[IO.File]::ReadAllText($ackPath)|ConvertFrom-Json -ErrorAction Stop',
    '          if([string]::Equals([string]$ack.token,$ackToken,[StringComparison]::OrdinalIgnoreCase) -and [int]$ack.processId -eq $replacement.Id){$acknowledged=$true;break}',
    '        } catch {}',
    '      }',
    '      $replacement.Refresh()',
    '      if($replacement.HasExited){$intentionalExit=($replacement.ExitCode -eq 0);break}',
    '      Start-Sleep -Milliseconds 100',
    '    }',
    '    [IO.File]::Delete($ackPath)',
    '    if($acknowledged){',
    '      $nextCrashFailures=[Math]::Min(16,$previousFailures+1)',
    "      Write-WatchdogState $nextCrashFailures $generation $suppressedGenerations $replacement.Id 'acknowledged'",
    '      exit 0',
    '    }',
    '    if($intentionalExit){',
    "      Write-WatchdogState $previousFailures $lastHandledGeneration $suppressedGenerations $replacement.Id 'intentional-exit'",
    '      exit 0',
    '    }',
    '    try {',
    '      $failedStartedAt=([DateTimeOffset]($replacement.StartTime.ToUniversalTime())).ToUnixTimeMilliseconds()',
    "      $failedGeneration=([string]$replacement.Id)+':'+([string]$failedStartedAt)",
    '      if(!($suppressedGenerations -contains $failedGeneration)){',
    '        $suppressedGenerations=@($suppressedGenerations)+@($failedGeneration)',
    '        if($suppressedGenerations.Count -gt 16){$suppressedGenerations=@($suppressedGenerations[($suppressedGenerations.Count-16)..($suppressedGenerations.Count-1)])}',
    '      }',
    '    } catch {}',
    '    $replacement.Refresh()',
    '    if(!$replacement.HasExited){try {$replacement.Kill();$replacement.WaitForExit(5000)|Out-Null}catch{}}',
    '    $previousFailures=[Math]::Min(16,$previousFailures+1)',
    "    Write-WatchdogState $previousFailures $lastHandledGeneration $suppressedGenerations $replacement.Id 'retrying'",
    '  }',
    '} finally {',
    '  if($ownsMutex){$mutex.ReleaseMutex()}',
    '  if($null -ne $mutex){$mutex.Dispose()}',
    '}',
    'exit 0'
  ].join('\n')
}

async function observedAgentIdentity(
  processId: number
): Promise<MonitoredAgentIdentity | undefined> {
  const identity = await windowsProcessIdentity(processId)
  if (!identity || !windowsCommandLineHasArgument(identity.commandLine, ORBIT_AGENT_ARGUMENT)) {
    return undefined
  }
  return { ...identity, processId }
}

async function monitoredAgentIdentityStatus(
  expected: MonitoredAgentIdentity
): Promise<'match' | 'gone' | 'query-unavailable'> {
  const actual = await windowsProcessIdentity(expected.processId)
  if (actual) {
    return actual.startedAt === expected.startedAt &&
      normalizedWindowsPath(actual.executablePath) ===
        normalizedWindowsPath(expected.executablePath) &&
      windowsCommandLineHasArgument(actual.commandLine, ORBIT_AGENT_ARGUMENT)
      ? 'match'
      : 'gone'
  }
  try {
    process.kill(expected.processId, 0)
    return 'query-unavailable'
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH' ? 'gone' : 'query-unavailable'
  }
}

function supervisorRestartDelayMs(attempt: number): number {
  return Math.min(
    WATCHDOG_SUPERVISOR_RESTART_MAX_MS,
    WATCHDOG_SUPERVISOR_RESTART_BASE_MS * 2 ** Math.max(0, Math.floor(attempt))
  )
}

function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve()
    }
    const timeout = setTimeout(finish, timeoutMs)
    child.once('exit', finish)
  })
}

async function launchWatchdog(
  options: BackgroundServiceWatchdogOptions,
  parent: MonitoredAgentIdentity,
  readyToken: string
): Promise<ChildProcess> {
  const statePath = backgroundServiceWatchdogStatePath(options.userDataPath)
  const readyPath = join(
    options.userDataPath,
    `orbit-background-service-watchdog-ready-${readyToken}.tmp`
  )
  const mutexName = `Local\\OrbitBackgroundWatchdog-${createHash('sha256')
    .update(statePath.toLowerCase())
    .digest('hex')
    .slice(0, 32)}`
  await rm(readyPath, { force: true }).catch(() => undefined)
  const child = spawn(
    WINDOWS_POWERSHELL_PATH,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      encodedPowerShellCommand(createBackgroundServiceWatchdogScript())
    ],
    {
      detached: !options.attachedForVerification,
      windowsHide: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        ORBIT_WATCHDOG_PARENT_PID: String(parent.processId),
        ORBIT_WATCHDOG_PARENT_STARTED_AT: String(parent.startedAt),
        ORBIT_WATCHDOG_PARENT_EXECUTABLE_B64: encoded(parent.executablePath),
        ORBIT_WATCHDOG_RESTART_EXECUTABLE_B64: encoded(parent.executablePath),
        ORBIT_WATCHDOG_APP_B64: options.developmentAppPath
          ? encoded(options.developmentAppPath)
          : '',
        ORBIT_WATCHDOG_ARGUMENT_B64: encoded(ORBIT_AGENT_ARGUMENT),
        ORBIT_WATCHDOG_STATE_B64: encoded(statePath),
        ORBIT_WATCHDOG_READY_PATH_B64: encoded(readyPath),
        ORBIT_WATCHDOG_READY_B64: encoded(readyToken),
        ORBIT_WATCHDOG_MUTEX_B64: encoded(mutexName),
        ORBIT_WATCHDOG_STABLE_MS: String(BACKGROUND_SERVICE_WATCHDOG_STABLE_MS),
        ORBIT_WATCHDOG_RESTART_BASE_MS: String(BACKGROUND_SERVICE_WATCHDOG_RESTART_BASE_MS),
        ORBIT_WATCHDOG_RESTART_MAX_MS: String(BACKGROUND_SERVICE_WATCHDOG_RESTART_MAX_MS),
        ORBIT_WATCHDOG_REPLACEMENT_ACK_TIMEOUT_MS: String(
          BACKGROUND_SERVICE_WATCHDOG_REPLACEMENT_ACK_TIMEOUT_MS
        )
      }
    }
  )

  let spawnError: Error | undefined
  const captureSpawnError = (error: Error): void => {
    spawnError = error
  }
  child.once('error', captureSpawnError)
  const deadline = Date.now() + Math.max(1_000, options.readyTimeoutMs ?? WATCHDOG_READY_TIMEOUT_MS)
  const expectedReadyValue = `${WATCHDOG_READY_PREFIX}${readyToken}`
  try {
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(
          `Background service watchdog exited before readiness (${child.exitCode ?? 'signal'})`
        )
      }
      try {
        const readyValue = await readFile(readyPath, 'utf8')
        if (readyValue.trim() === expectedReadyValue) return child
        // A reader may briefly observe WriteAllText between create and flush.
        // Only impossible oversized content fails immediately; partial content
        // remains eligible until the bounded readiness deadline.
        if (readyValue.length > 1_024) {
          throw new Error('Background service watchdog emitted an invalid handshake')
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error('Background service watchdog readiness timed out')
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill()
    await waitForChildExit(child, WATCHDOG_STOP_TIMEOUT_MS)
    throw error
  } finally {
    await rm(readyPath, { force: true }).catch(() => undefined)
  }
}

class WindowsBackgroundServiceWatchdogHandle implements BackgroundServiceWatchdogHandle {
  private readonly options: BackgroundServiceWatchdogOptions
  private readonly parent: MonitoredAgentIdentity
  private child: ChildProcess | undefined
  private shuttingDown = false
  private supervisorAttempt = 0
  private supervisorTimer: NodeJS.Timeout | undefined
  private operation: Promise<unknown> = Promise.resolve()
  private readonly intentionalStops = new WeakSet<ChildProcess>()

  constructor(
    options: BackgroundServiceWatchdogOptions,
    parent: MonitoredAgentIdentity,
    initialChild: ChildProcess
  ) {
    this.options = options
    this.parent = parent
    this.attach(initialChild)
  }

  get processId(): number | undefined {
    return this.child?.pid
  }

  restart(): Promise<boolean> {
    return this.enqueue(() => this.replaceWatchdog(true))
  }

  shutdown(): Promise<void> {
    this.shuttingDown = true
    if (this.supervisorTimer) {
      clearTimeout(this.supervisorTimer)
      this.supervisorTimer = undefined
    }
    return this.enqueue(async () => {
      const child = this.child
      this.child = undefined
      if (!child) return
      this.intentionalStops.add(child)
      if (child.exitCode === null && child.signalCode === null) child.kill()
      await waitForChildExit(child, WATCHDOG_STOP_TIMEOUT_MS)
      child.stdout?.destroy()
    }).then(() => undefined)
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.operation.then(work, work)
    this.operation = result.catch(() => undefined)
    return result
  }

  private attach(child: ChildProcess): void {
    this.child = child
    child.once('exit', (code) => this.onExit(child, code))
    child.once('error', () => this.onExit(child, null))
  }

  private onExit(child: ChildProcess, _code: number | null): void {
    if (this.intentionalStops.delete(child) || this.shuttingDown || this.child !== child) return
    this.child = undefined
    child.stdout?.destroy()
    child.stderr?.destroy()
    this.replaceExitedWatcher()
  }

  private replaceExitedWatcher(): void {
    if (this.shuttingDown || this.child || this.supervisorTimer) return
    const delay = supervisorRestartDelayMs(this.supervisorAttempt++)
    this.supervisorTimer = setTimeout(() => {
      this.supervisorTimer = undefined
      void this.enqueue(() => this.replaceWatchdog(false)).catch(() => {
        if (!this.shuttingDown) this.onExitForRetry()
      })
    }, delay)
  }

  private onExitForRetry(): void {
    if (this.supervisorTimer || this.shuttingDown || this.child) return
    const delay = supervisorRestartDelayMs(this.supervisorAttempt++)
    this.supervisorTimer = setTimeout(() => {
      this.supervisorTimer = undefined
      void this.enqueue(() => this.replaceWatchdog(false)).catch(() => this.onExitForRetry())
    }, delay)
  }

  private async replaceWatchdog(explicit: boolean): Promise<boolean> {
    if (this.shuttingDown) return false
    const parentStatus = await monitoredAgentIdentityStatus(this.parent)
    if (parentStatus === 'gone') return false
    if (parentStatus === 'query-unavailable') {
      throw new Error('Background service watchdog parent identity is temporarily unavailable')
    }
    const existing = this.child
    if (existing) {
      this.child = undefined
      this.intentionalStops.add(existing)
      if (existing.exitCode === null && existing.signalCode === null) existing.kill()
      await waitForChildExit(existing, WATCHDOG_STOP_TIMEOUT_MS)
      existing.stdout?.destroy()
    }
    const replacement = await launchWatchdog(this.options, this.parent, randomUUID())
    if (this.shuttingDown) {
      this.intentionalStops.add(replacement)
      replacement.kill()
      await waitForChildExit(replacement, WATCHDOG_STOP_TIMEOUT_MS)
      return false
    }
    if (explicit) this.supervisorAttempt = 0
    this.attach(replacement)
    return true
  }
}

export async function startBackgroundServiceWatchdog(
  options: BackgroundServiceWatchdogOptions
): Promise<BackgroundServiceWatchdogHandle | undefined> {
  if (process.platform !== 'win32') return undefined
  if (!options.userDataPath.trim()) {
    throw new Error('Background service watchdog requires a user-data path')
  }
  if (options.developmentAppPath?.includes('"')) {
    throw new Error('Background service watchdog received an invalid development app path')
  }
  const parentProcessId = options.parentProcessId ?? process.pid
  if (!Number.isInteger(parentProcessId) || parentProcessId <= 0) {
    throw new Error('Background service watchdog received an invalid parent process id')
  }
  const parent = await observedAgentIdentity(parentProcessId)
  if (!parent) {
    throw new Error('Background service watchdog could not verify the agent process identity')
  }
  const child = await launchWatchdog(options, parent, randomUUID())
  return new WindowsBackgroundServiceWatchdogHandle(options, parent, child)
}
