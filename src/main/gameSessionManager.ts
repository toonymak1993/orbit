import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { createInterface, type Interface as ReadlineInterface } from 'node:readline'
import type { BrowserWindow } from 'electron'
import type { GameLaunchStatus, LibraryGame, LocalGameBackupResult } from '@shared/ipc'
import { launchGame } from './gameLauncher'
import { settingsStore } from './settingsStore'

interface WindowsProcess {
  ProcessId?: number
  ParentProcessId?: number
  Name?: string
  ExecutablePath?: string
  CommandLine?: string
  MainWindowHandle?: number
  MainWindowTitle?: string
}

interface ProcessSnapshot {
  sequence: number
  capturedAt: number
  processes: WindowsProcess[]
}

interface ProcessStreamMessage {
  Kind?: 'snapshot' | 'delta'
  Processes?: WindowsProcess | WindowsProcess[]
  Started?: WindowsProcess | WindowsProcess[]
  Stopped?: number | number[]
  Updated?: WindowsProcess | WindowsProcess[]
}

interface ScoredProcess {
  process: WindowsProcess
  pid: number
  key: string
  score: number
  visible: boolean
}

export interface CompletedGameSession {
  detectedAt: number
  endedAt: number
  durationSeconds: number
}

export interface CompletedGameSessionResult {
  totalPlaytimeSeconds?: number
}

export interface GameSessionCallbacks {
  onGameConfirmed?: (game: LibraryGame, detectedAt: number) => void | Promise<void>
  onSessionCompleted?: (
    game: LibraryGame,
    session: CompletedGameSession
  ) => CompletedGameSessionResult | void | Promise<CompletedGameSessionResult | void>
  onGameEnded?: (game: LibraryGame) => Promise<LocalGameBackupResult>
}

const PROCESS_SAMPLE_INTERVAL_MS = 250
const SNAPSHOT_TIMEOUT_MS = 2_000
const PROCESS_STALL_TIMEOUT_MS = 6_000
const BASELINE_TIMEOUT_MS = 3_000
const STARTUP_TIMEOUT_MS = 4 * 60_000
const CANDIDATE_STABILITY_MS = 650
const GAME_CONFIRMATION_MS = 4_000
const EARLY_SESSION_WINDOW_MS = 20_000
const EARLY_HANDOFF_GRACE_MS = 6_000
const PROCESS_EXIT_GRACE_MS = 1_200
const SPLASH_LEAD_IN_MS = 350
const LAUNCH_SHIELD_TIMEOUT_MS = 10_000
const RETURN_SPLASH_MS = 520
const BACKUP_RESULT_SPLASH_MS = 1_400
const RETURN_FOCUS_GUARD_MS = 1_800
const FOCUS_GUARD_POLL_MS = 250
const ERROR_SPLASH_MS = 3_000
const MIN_GAME_PROCESS_SCORE = 90

type LauncherFamily =
  | 'steam'
  | 'epic'
  | 'ea'
  | 'ubisoft'
  | 'gog'
  | 'battlenet'
  | 'rockstar'
  | '2k'
  | 'xbox'

const LAUNCHER_PROCESS_FAMILIES = new Map<string, LauncherFamily>([
  ['steam.exe', 'steam'],
  ['steamwebhelper.exe', 'steam'],
  ['gameoverlayui.exe', 'steam'],
  ['epicgameslauncher.exe', 'epic'],
  ['epicwebhelper.exe', 'epic'],
  ['eadesktop.exe', 'ea'],
  ['ealauncher.exe', 'ea'],
  ['eabackgroundservice.exe', 'ea'],
  ['origin.exe', 'ea'],
  ['originwebhelperservice.exe', 'ea'],
  ['ubisoftconnect.exe', 'ubisoft'],
  ['upc.exe', 'ubisoft'],
  ['uplay.exe', 'ubisoft'],
  ['uplaywebcore.exe', 'ubisoft'],
  ['galaxyclient.exe', 'gog'],
  ['galaxyclientservice.exe', 'gog'],
  ['galaxycommunication.exe', 'gog'],
  ['battle.net.exe', 'battlenet'],
  ['agent.exe', 'battlenet'],
  ['rockstar-games-launcher.exe', 'rockstar'],
  ['launcherpatcher.exe', 'rockstar'],
  ['socialclubhelper.exe', 'rockstar'],
  ['2klauncher.exe', '2k'],
  ['xboxpcapp.exe', 'xbox'],
  ['gamingapp.exe', 'xbox']
])

const LAUNCHER_ROOT_PROCESSES = new Set([
  'steam.exe',
  'epicgameslauncher.exe',
  'eadesktop.exe',
  'ealauncher.exe',
  'origin.exe',
  'ubisoftconnect.exe',
  'upc.exe',
  'uplay.exe',
  'galaxyclient.exe',
  'battle.net.exe',
  'rockstar-games-launcher.exe',
  '2klauncher.exe',
  'xboxpcapp.exe',
  'gamingapp.exe'
])

const SYSTEM_PROCESSES = new Set([
  'applicationframehost.exe',
  'conhost.exe',
  'csrss.exe',
  'dwm.exe',
  'explorer.exe',
  'fontdrvhost.exe',
  'lsass.exe',
  'powershell.exe',
  'pwsh.exe',
  'registry',
  'runtimebroker.exe',
  'searchhost.exe',
  'services.exe',
  'shellexperiencehost.exe',
  'sihost.exe',
  'smss.exe',
  'spoolsv.exe',
  'startmenuexperiencehost.exe',
  'svchost.exe',
  'system',
  'systemsettings.exe',
  'taskhostw.exe',
  'textinputhost.exe',
  'userinit.exe',
  'wininit.exe',
  'winlogon.exe',
  'wmiprvse.exe'
])

const NON_GAME_PROCESS =
  /(activationui|anti.?cheat|battleye|bootstrap|browser|cef|crash|dedicated|dxsetup|gamelaunchhelper|helper|installer|launcher|link2ea|overlay|prereq|protectedgame|redist|report|server|service|setup|startprotectedgame|telemetry|tray|unins|updat|vc_redist|watchdog|webhelper)/i

const GAME_NAME_STOP_WORDS = new Set([
  'and',
  'complete',
  'definitive',
  'deluxe',
  'edition',
  'for',
  'game',
  'gold',
  'remastered',
  'the',
  'ultimate',
  'with'
])

const PROCESS_SNAPSHOT_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$metadata = @{}
  $windowState = @{}

function New-ProcessRow($entry, $details) {
  $fallbackName = if ([string]$entry.ProcessName -match '\.exe$') { [string]$entry.ProcessName } else { "$($entry.ProcessName).exe" }
  [pscustomobject]@{
    ProcessId = [int]$entry.Id
    ParentProcessId = if ($null -ne $details) { [int]$details.ParentProcessId } else { 0 }
    Name = if ($null -ne $details -and $details.Name) { [string]$details.Name } else { $fallbackName }
    ExecutablePath = if ($entry.Path) { [string]$entry.Path } elseif ($null -ne $details) { [string]$details.ExecutablePath } else { '' }
    CommandLine = if ($null -ne $details) { [string]$details.CommandLine } else { '' }
    MainWindowHandle = [int64]$entry.MainWindowHandle
    MainWindowTitle = [string]$entry.MainWindowTitle
  }
}

$live = @(Get-Process)
foreach ($cim in @(Get-CimInstance Win32_Process)) {
  $metadata[[int]$cim.ProcessId] = [pscustomobject]@{
    ParentProcessId = [int]$cim.ParentProcessId
    Name = [string]$cim.Name
    ExecutablePath = [string]$cim.ExecutablePath
    CommandLine = [string]$cim.CommandLine
  }
}
$initialRows = @($live | ForEach-Object {
  $windowState[[int]$_.Id] = "$( [int64]$_.MainWindowHandle ):$([string]$_.MainWindowTitle)"
  New-ProcessRow $_ $metadata[[int]$_.Id]
})
[Console]::Out.WriteLine((ConvertTo-Json -InputObject ([pscustomobject]@{
  Kind = 'snapshot'
  Processes = [object[]]$initialRows
}) -Compress -Depth 3))
[Console]::Out.Flush()

while ($true) {
  Start-Sleep -Milliseconds ${PROCESS_SAMPLE_INTERVAL_MS}
  $live = @(Get-Process)
  $liveIds = @{}
  foreach ($entry in $live) { $liveIds[[int]$entry.Id] = $true }

  $stopped = @($metadata.Keys | Where-Object { -not $liveIds.ContainsKey([int]$_) } | ForEach-Object { [int]$_ })
  foreach ($stoppedId in $stopped) {
    $metadata.Remove($stoppedId)
    $windowState.Remove($stoppedId)
  }

  $newEntries = @($live | Where-Object { -not $metadata.ContainsKey([int]$_.Id) })
  $newIds = @($newEntries | ForEach-Object { [int]$_.Id })
  if ($newIds.Count -gt 0) {
    $filter = ($newIds | ForEach-Object { "ProcessId = $_" }) -join ' OR '
    foreach ($cim in @(Get-CimInstance Win32_Process -Filter $filter)) {
    $metadata[[int]$cim.ProcessId] = [pscustomobject]@{
      ParentProcessId = [int]$cim.ParentProcessId
      Name = [string]$cim.Name
      ExecutablePath = [string]$cim.ExecutablePath
      CommandLine = [string]$cim.CommandLine
    }
  }
  }

  $newLookup = @{}
  $started = @($newEntries | ForEach-Object {
    $newLookup[[int]$_.Id] = $true
    $windowState[[int]$_.Id] = "$( [int64]$_.MainWindowHandle ):$([string]$_.MainWindowTitle)"
    New-ProcessRow $_ $metadata[[int]$_.Id]
  })

  $updated = @($live | Where-Object { -not $newLookup.ContainsKey([int]$_.Id) } | ForEach-Object {
    $windowIdentity = "$( [int64]$_.MainWindowHandle ):$([string]$_.MainWindowTitle)"
    if ($windowState[[int]$_.Id] -ne $windowIdentity) {
      $windowState[[int]$_.Id] = $windowIdentity
      [pscustomobject]@{
        ProcessId = [int]$_.Id
        MainWindowHandle = [int64]$_.MainWindowHandle
        MainWindowTitle = [string]$_.MainWindowTitle
      }
    }
  })

  [Console]::Out.WriteLine((ConvertTo-Json -InputObject ([pscustomobject]@{
    Kind = 'delta'
    Started = [object[]]$started
    Stopped = [int[]]$stopped
    Updated = [object[]]$updated
  }) -Compress -Depth 3))
  [Console]::Out.Flush()
}`

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function encodedPowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

function processId(candidate: WindowsProcess): number {
  return candidate.ProcessId ?? 0
}

function processName(candidate: WindowsProcess): string {
  return (candidate.Name ?? '').trim().toLowerCase()
}

function normalizedPath(value?: string): string {
  return (value ?? '').trim().replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

function processKey(candidate: WindowsProcess): string {
  return normalizedPath(candidate.ExecutablePath) || processName(candidate)
}

function hasVisibleWindow(candidate: WindowsProcess): boolean {
  return Boolean(candidate.MainWindowHandle)
}

function isInsideInstallDir(candidate: WindowsProcess, installDir?: string): boolean {
  const root = normalizedPath(installDir)
  const executable = normalizedPath(candidate.ExecutablePath)
  return Boolean(root && executable && (executable === root || executable.startsWith(`${root}\\`)))
}

function launcherFamily(candidate: WindowsProcess): LauncherFamily | undefined {
  const knownFamily = LAUNCHER_PROCESS_FAMILIES.get(processName(candidate))
  if (knownFamily) return knownFamily
  const executable = normalizedPath(candidate.ExecutablePath)
  if (executable.includes('\\rockstar games\\launcher\\')) return 'rockstar'
  if (executable.includes('\\2klauncher\\') || executable.includes('\\2k launcher\\')) return '2k'
  return undefined
}

function isLauncherRootProcess(candidate: WindowsProcess): boolean {
  const name = processName(candidate)
  if (LAUNCHER_ROOT_PROCESSES.has(name)) return true
  const family = launcherFamily(candidate)
  return Boolean(family && (name === 'launcher.exe' || name === 'launcherpatcher.exe'))
}

function baselineInstance(
  candidate: WindowsProcess,
  baselineByPid: ReadonlyMap<number, WindowsProcess>
): boolean {
  const baseline = baselineByPid.get(processId(candidate))
  if (!baseline) return false
  return processName(baseline) === processName(candidate) && processKey(baseline) === processKey(candidate)
}

function ancestorMatches(
  candidate: WindowsProcess,
  processesByPid: ReadonlyMap<number, WindowsProcess>,
  predicate: (ancestor: WindowsProcess) => boolean
): boolean {
  let parentId = candidate.ParentProcessId ?? 0
  const visited = new Set<number>()
  for (let depth = 0; depth < 14 && parentId > 0 && !visited.has(parentId); depth += 1) {
    visited.add(parentId)
    const parent = processesByPid.get(parentId)
    if (!parent) return false
    if (predicate(parent)) return true
    parentId = parent.ParentProcessId ?? 0
  }
  return false
}

function gameNameTokens(game: LibraryGame): string[] {
  return game.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !GAME_NAME_STOP_WORDS.has(token))
}

function scoreGameProcess(
  candidate: WindowsProcess,
  game: LibraryGame,
  baselineByPid: ReadonlyMap<number, WindowsProcess>,
  processesByPid: ReadonlyMap<number, WindowsProcess>,
  trackedPids: ReadonlySet<number>
): ScoredProcess | null {
  const pid = processId(candidate)
  const name = processName(candidate)
  const executable = normalizedPath(candidate.ExecutablePath)
  const exactLocalExecutable =
    game.provider === 'local' &&
    Boolean(executable && executable === normalizedPath(game.local?.executablePath))
  if (
    pid <= 0 ||
    !name.endsWith('.exe') ||
    baselineInstance(candidate, baselineByPid) ||
    launcherFamily(candidate) ||
    SYSTEM_PROCESSES.has(name) ||
    (NON_GAME_PROCESS.test(name) && !exactLocalExecutable)
  ) {
    return null
  }

  const commandLine = (candidate.CommandLine ?? '').toLowerCase()
  const visible = hasVisibleWindow(candidate)
  const insideInstallDir = isInsideInstallDir(candidate, game.installDir)
  const fromLauncher = ancestorMatches(candidate, processesByPid, (ancestor) =>
    Boolean(launcherFamily(ancestor))
  )
  const fromTrackedGame = ancestorMatches(candidate, processesByPid, (ancestor) =>
    trackedPids.has(processId(ancestor))
  )
  const nameMatches = gameNameTokens(game).some((token) => name.includes(token))
  const providerIds = [game.providerGameId, game.appId ? String(game.appId) : '']
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length >= 4)
  const idMatches = providerIds.some(
    (value) => commandLine.includes(value) || executable.includes(value)
  )

  let score = 0
  if (exactLocalExecutable) score += 320
  if (insideInstallDir) score += 140
  if (visible) score += 85
  if (fromLauncher) score += 55
  if (fromTrackedGame) score += 70
  if (nameMatches) score += 35
  if (idMatches) score += 45
  if (game.provider === 'xbox' && visible) score += 25
  if (executable.includes('\\windowsapps\\')) score += 20

  if (score < MIN_GAME_PROCESS_SCORE) return null
  return { process: candidate, pid, key: processKey(candidate), score, visible }
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

class WindowsProcessSampler extends EventEmitter {
  private child: ChildProcess | null = null
  private reader: ReadlineInterface | null = null
  private processesByPid = new Map<number, WindowsProcess>()
  private latest: ProcessSnapshot = { sequence: 0, capturedAt: 0, processes: [] }
  private failure: Error | null = null
  private stopping = false

  start(): void {
    if (process.platform !== 'win32' || this.child) return
    this.failure = null
    this.stopping = false
    const child = spawn(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        encodedPowerShell(PROCESS_SNAPSHOT_SCRIPT)
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
    )
    this.child = child
    const fail = (error: Error): void => {
      if (this.stopping || this.failure) return
      this.failure = error
      this.reader?.close()
      this.reader = null
      this.child = null
      this.emit('failed', error)
    }
    child.once('error', (error) => fail(new Error(`Process monitor failed: ${error.message}`)))
    child.once('exit', (code, signal) => {
      if (!this.stopping) {
        fail(new Error(`Process monitor stopped (${code ?? signal ?? 'unknown'})`))
      }
    })
    if (!child.stdout) {
      fail(new Error('Process monitor has no output stream'))
      child.kill()
      return
    }
    const reader = createInterface({ input: child.stdout })
    this.reader = reader
    reader.on('line', (line) => {
      if (!line.trim()) return
      try {
        const message = JSON.parse(line) as ProcessStreamMessage
        if (message.Kind === 'snapshot') {
          this.processesByPid = new Map(
            asArray(message.Processes)
              .filter((candidate) => processId(candidate) > 0)
              .map((candidate) => [processId(candidate), candidate] as const)
          )
        } else if (message.Kind === 'delta') {
          for (const pid of asArray(message.Stopped)) this.processesByPid.delete(pid)
          for (const candidate of asArray(message.Started)) {
            if (processId(candidate) > 0) this.processesByPid.set(processId(candidate), candidate)
          }
          for (const update of asArray(message.Updated)) {
            const pid = processId(update)
            const current = this.processesByPid.get(pid)
            if (current) this.processesByPid.set(pid, { ...current, ...update })
          }
        } else {
          return
        }
        this.latest = {
          sequence: this.latest.sequence + 1,
          capturedAt: Date.now(),
          processes: [...this.processesByPid.values()]
        }
        this.emit('snapshot', this.latest)
      } catch {
        // A single malformed snapshot is ignored; the persistent sampler keeps running.
      }
    })
  }

  getLatest(): ProcessSnapshot {
    return this.latest
  }

  waitForNext(afterSequence: number, timeoutMs: number): Promise<ProcessSnapshot> {
    if (this.failure) return Promise.reject(this.failure)
    if (this.latest.sequence > afterSequence) return Promise.resolve(this.latest)
    return new Promise((resolve, reject) => {
      let settled = false
      const cleanup = (): void => {
        clearTimeout(timer)
        this.removeListener('snapshot', onSnapshot)
        this.removeListener('failed', onFailure)
      }
      const finish = (snapshot: ProcessSnapshot): void => {
        if (settled) return
        settled = true
        cleanup()
        resolve(snapshot)
      }
      const onSnapshot = (snapshot: ProcessSnapshot): void => {
        if (snapshot.sequence > afterSequence) finish(snapshot)
      }
      const onFailure = (error: Error): void => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      }
      const timer = setTimeout(() => finish(this.latest), timeoutMs)
      this.on('snapshot', onSnapshot)
      this.once('failed', onFailure)
    })
  }

  stop(): void {
    this.stopping = true
    this.emit('failed', new Error('Process monitor stopped'))
    this.reader?.close()
    this.reader = null
    this.child?.kill()
    this.child = null
    this.failure = null
    this.removeAllListeners()
  }
}

function closeLauncherProcesses(
  processes: WindowsProcess[],
  ownedFamilies: ReadonlySet<LauncherFamily>
): Promise<void> {
  if (process.platform !== 'win32' || ownedFamilies.size === 0) return Promise.resolve()
  const processIds = processes
    .filter(
      (candidate) =>
        isLauncherRootProcess(candidate) &&
        ownedFamilies.has(launcherFamily(candidate) as LauncherFamily)
    )
    .map(processId)
    .filter((pid) => pid > 0 && pid !== process.pid)
  if (processIds.length === 0) return Promise.resolve()

  const ids = processIds.join(',')
  const script = `
$ids = @(${ids})
foreach ($id in $ids) {
  $client = Get-Process -Id $id -ErrorAction SilentlyContinue
  if ($null -ne $client -and $client.MainWindowHandle -ne 0) {
    $null = $client.CloseMainWindow()
  }
}
Start-Sleep -Milliseconds 1200
foreach ($id in $ids) {
  if (Get-Process -Id $id -ErrorAction SilentlyContinue) {
    Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
  }
}`

  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodedPowerShell(script)],
      { windowsHide: true, encoding: 'utf8' },
      () => resolve()
    )
  })
}

function focusExternalProcess(pid: number): void {
  if (process.platform !== 'win32' || pid <= 0) return
  const script = `
$target = Get-Process -Id ${pid} -ErrorAction SilentlyContinue
if ($null -ne $target) {
  $shell = New-Object -ComObject WScript.Shell
  $null = $shell.AppActivate($target.Id)
}`
  execFile(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodedPowerShell(script)],
    { windowsHide: true, encoding: 'utf8' },
    () => undefined
  )
}

function nativeWindowHandle(window: BrowserWindow): bigint | null {
  if (process.platform !== 'win32' || window.isDestroyed()) return null
  const handle = window.getNativeWindowHandle()
  if (handle.length >= 8) return handle.readBigUInt64LE(0)
  if (handle.length >= 4) return BigInt(handle.readUInt32LE(0))
  return null
}

export function activateOrbitWindow(window: BrowserWindow): Promise<void> {
  const handle = nativeWindowHandle(window)
  if (handle === null || handle <= 0n) return Promise.resolve()

  // BrowserWindow.focus() alone is best-effort on Windows. In particular,
  // Steam can remain the foreground owner after its game child exits. Attach
  // this helper's input queue to both windows before activating ORBIT so the
  // focus hand-off is accepted instead of merely flashing the taskbar entry.
  const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class OrbitWindowActivation {
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr processId);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint attach, uint attachTo, bool value);
  [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr hWnd, int command);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] static extern IntPtr SetFocus(IntPtr hWnd);

  public static bool Activate(IntPtr target) {
    IntPtr foreground = GetForegroundWindow();
    uint currentThread = GetCurrentThreadId();
    uint foregroundThread = GetWindowThreadProcessId(foreground, IntPtr.Zero);
    uint targetThread = GetWindowThreadProcessId(target, IntPtr.Zero);
    bool foregroundAttached = foregroundThread != 0 && foregroundThread != currentThread &&
      AttachThreadInput(currentThread, foregroundThread, true);
    bool targetAttached = targetThread != 0 && targetThread != currentThread &&
      AttachThreadInput(currentThread, targetThread, true);

    try {
      ShowWindowAsync(target, 9);
      BringWindowToTop(target);
      SetForegroundWindow(target);
      SetFocus(target);
      return GetForegroundWindow() == target;
    } finally {
      if (targetAttached) AttachThreadInput(currentThread, targetThread, false);
      if (foregroundAttached) AttachThreadInput(currentThread, foregroundThread, false);
    }
  }
}
'@

$target = [IntPtr]::new([Int64]${handle.toString()})
for ($attempt = 0; $attempt -lt 3; $attempt++) {
  if ([OrbitWindowActivation]::Activate($target)) { break }
  Start-Sleep -Milliseconds 120
}
`

  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodedPowerShell(script)],
      { windowsHide: true, encoding: 'utf8', timeout: 2_000 },
      () => resolve()
    )
  })
}

/**
 * Provider-neutral session detection for store and third-party hand-offs.
 * A snapshot taken before launch prevents existing clients from being mistaken
 * for the game. The monitor then combines install paths, process ancestry,
 * provider IDs and visible top-level windows, while launcher/helper processes
 * are explicitly excluded from the game lifetime.
 */
export class GameSessionManager extends EventEmitter {
  private status: GameLaunchStatus = { phase: 'idle' }
  private activeToken = 0
  private sampler: WindowsProcessSampler | null = null
  private launchTargetRevealed = false

  constructor(
    private readonly mainWindow: BrowserWindow,
    private readonly callbacks: GameSessionCallbacks = {}
  ) {
    super()
  }

  getStatus(): GameLaunchStatus {
    return { ...this.status }
  }

  revealLauncher(): void {
    if (this.status.phase === 'idle' || this.status.phase === 'returning') return
    this.launchTargetRevealed = true
    this.releaseLaunchShield(true)
  }

  async start(game: LibraryGame): Promise<void> {
    if (this.status.phase !== 'idle') throw new Error('A game session is already active')

    const token = ++this.activeToken
    const startedAt = Date.now()
    this.launchTargetRevealed = false
    this.update({
      phase: 'launching',
      gameId: game.id,
      gameName: game.name,
      provider: game.provider,
      startedAt
    })
    this.maintainLaunchShield(token)

    const sampler = new WindowsProcessSampler()
    this.sampler = sampler
    let baseline: ProcessSnapshot
    try {
      sampler.start()
      const baselinePromise = sampler.waitForNext(0, BASELINE_TIMEOUT_MS)
      const [initialBaseline] = await Promise.all([baselinePromise, wait(SPLASH_LEAD_IN_MS)])
      baseline = initialBaseline
    } catch (error) {
      sampler.stop()
      if (this.sampler === sampler) this.sampler = null
      await this.fail(
        token,
        error instanceof Error ? error.message : 'Game process monitor unavailable'
      )
      return
    }

    try {
      await launchGame(game)
    } catch (error) {
      sampler.stop()
      if (this.sampler === sampler) this.sampler = null
      await this.fail(token, error instanceof Error ? error.message : 'Launch failed')
      return
    }

    // The provider-neutral launch shield keeps this in-app splash in front while
    // Steam/Epic/Xbox/EA/Ubisoft hand off. The monitor releases it only for the
    // detected game's own visible process (or the explicit timeout/Y fallback).
    void this.monitor(token, game, startedAt, sampler, baseline)
  }

  private async monitor(
    token: number,
    game: LibraryGame,
    startedAt: number,
    sampler: WindowsProcessSampler,
    baseline: ProcessSnapshot
  ): Promise<void> {
    const baselineByPid = new Map(
      baseline.processes.map((candidate) => [processId(candidate), candidate] as const)
    )
    const baselineLauncherFamilies = new Set<LauncherFamily>(
      baseline.processes
        .filter(isLauncherRootProcess)
        .map(launcherFamily)
        .filter((family): family is LauncherFamily => Boolean(family))
    )
    const ownedLauncherFamilies = new Set<LauncherFamily>()
    const trackedPids = new Set<number>()
    const primaryProcessKeys = new Set<string>()
    const candidateSeenAt = new Map<string, number>()
    let sequence = baseline.sequence
    let lastFreshSnapshotAt = Date.now()
    let detectedAt: number | undefined
    let primaryStableSince: number | undefined
    let sessionConfirmed = false
    let gameFocusHandedOff = false
    let missingSince: number | undefined
    let lastProcesses = baseline.processes
    const startupDeadline = startedAt + STARTUP_TIMEOUT_MS

    try {
      while (token === this.activeToken) {
        const snapshot = await sampler.waitForNext(sequence, SNAPSHOT_TIMEOUT_MS)
        const now = Date.now()

        if (!detectedAt && !this.launchTargetRevealed) {
          if (now - startedAt < LAUNCH_SHIELD_TIMEOUT_MS) this.maintainLaunchShield(token)
          else this.revealLauncher()
        }
        if (!detectedAt && now >= startupDeadline) {
          await this.fail(token, 'No game process was detected')
          return
        }
        if (snapshot.sequence <= sequence) {
          if (now - lastFreshSnapshotAt >= PROCESS_STALL_TIMEOUT_MS) {
            await this.fail(token, 'Game process monitor stopped responding')
            return
          }
          continue
        }
        sequence = snapshot.sequence
        lastFreshSnapshotAt = now
        lastProcesses = snapshot.processes
        const processesByPid = new Map(
          lastProcesses.map((candidate) => [processId(candidate), candidate] as const)
        )

        for (const candidate of lastProcesses) {
          if (!isLauncherRootProcess(candidate)) continue
          const family = launcherFamily(candidate)
          if (family && !baselineLauncherFamilies.has(family)) ownedLauncherFamilies.add(family)
        }

        const candidates = lastProcesses
          .map((candidate) =>
            scoreGameProcess(candidate, game, baselineByPid, processesByPid, trackedPids)
          )
          .filter((candidate): candidate is ScoredProcess => Boolean(candidate))
          .sort((left, right) => right.score - left.score)

        if (!detectedAt) {
          const best = candidates[0]
          if (best) {
            const seenAt = candidateSeenAt.get(best.key) ?? now
            candidateSeenAt.set(best.key, seenAt)
            if (now - seenAt >= CANDIDATE_STABILITY_MS) {
              detectedAt = seenAt
              primaryStableSince = now
              sessionConfirmed = false
              trackedPids.add(best.pid)
              primaryProcessKeys.add(best.key)
              missingSince = undefined
              this.update({
                phase: 'running',
                gameId: game.id,
                gameName: game.name,
                provider: game.provider,
                startedAt,
                detectedAt
              })
              if (best.visible) {
                this.handoffToGame(token, best.pid)
                gameFocusHandedOff = true
              }
            }
          } else {
            candidateSeenAt.clear()
          }

          continue
        }

        const activePrimary = candidates.filter((candidate) => {
          if (primaryProcessKeys.has(candidate.key)) return true
          const inherited = ancestorMatches(candidate.process, processesByPid, (ancestor) =>
            trackedPids.has(processId(ancestor))
          )
          if (inherited && (candidate.visible || candidate.score >= 180)) {
            primaryProcessKeys.add(candidate.key)
            return true
          }
          if (missingSince && candidate.visible && candidate.score >= 110) {
            primaryProcessKeys.add(candidate.key)
            return true
          }
          if (missingSince && candidate.score >= 140) {
            primaryProcessKeys.add(candidate.key)
            return true
          }
          return false
        })

        trackedPids.clear()
        for (const candidate of activePrimary) trackedPids.add(candidate.pid)

        if (activePrimary.length > 0) {
          if (!gameFocusHandedOff) {
            const visibleGame = activePrimary.find((candidate) => candidate.visible)
            if (visibleGame) {
              this.handoffToGame(token, visibleGame.pid)
              gameFocusHandedOff = true
            }
          }
          primaryStableSince ??= now
          if (now - primaryStableSince >= GAME_CONFIRMATION_MS && !sessionConfirmed) {
            sessionConfirmed = true
            try {
              await this.callbacks.onGameConfirmed?.(game, detectedAt)
            } catch {
              // Recency persistence must never break session monitoring.
            }
          }
          missingSince = undefined
        } else {
          if (!sessionConfirmed) {
            // Short-lived launch shims (EA/Ubisoft/Xbox bootstrap processes,
            // anti-cheat hand-offs, etc.) are provisional. Losing one returns
            // to launch detection instead of incorrectly ending the session.
            detectedAt = undefined
            primaryStableSince = undefined
            gameFocusHandedOff = false
            missingSince = undefined
            trackedPids.clear()
            primaryProcessKeys.clear()
            candidateSeenAt.clear()
            this.update({
              phase: 'launching',
              gameId: game.id,
              gameName: game.name,
              provider: game.provider,
              startedAt
            })
            if (!this.launchTargetRevealed && now - startedAt < LAUNCH_SHIELD_TIMEOUT_MS) {
              this.maintainLaunchShield(token)
            }
            continue
          }
          missingSince ??= now
          const exitGrace =
            now - detectedAt < EARLY_SESSION_WINDOW_MS
              ? EARLY_HANDOFF_GRACE_MS
              : PROCESS_EXIT_GRACE_MS
          if (now - missingSince >= exitGrace) {
            await this.returnToOrbit(
              token,
              game,
              startedAt,
              detectedAt,
              missingSince,
              lastProcesses,
              ownedLauncherFamilies
            )
            return
          }
        }
      }
    } catch (error) {
      if (token === this.activeToken) {
        await this.fail(
          token,
          error instanceof Error ? error.message : 'Game process monitor unavailable'
        )
      }
    } finally {
      sampler.stop()
      if (this.sampler === sampler) this.sampler = null
    }
  }

  finalizeForShutdown(): { gameId: string; durationSeconds: number; endedAt: number } | null {
    const status = this.getStatus()
    const endedAt = status.endedAt ?? Date.now()
    const durationSeconds =
      status.sessionDurationSeconds ??
      (status.detectedAt ? Math.max(1, Math.round((endedAt - status.detectedAt) / 1_000)) : 0)
    const completed =
      Boolean(status.gameId && status.detectedAt) &&
      (status.phase === 'running' || status.phase === 'returning') &&
      durationSeconds * 1_000 >= GAME_CONFIRMATION_MS
        ? { gameId: status.gameId as string, durationSeconds, endedAt }
        : null

    this.activeToken++
    this.sampler?.stop()
    this.sampler = null
    this.releaseLaunchShield(false)
    this.status = { phase: 'idle' }
    this.removeAllListeners()
    return completed
  }

  private async returnToOrbit(
    token: number,
    game: LibraryGame,
    startedAt: number,
    detectedAt: number,
    endedAt: number,
    processes: WindowsProcess[],
    ownedLauncherFamilies: ReadonlySet<LauncherFamily>
  ): Promise<void> {
    if (token !== this.activeToken) return
    const completedSession = {
      detectedAt,
      endedAt,
      durationSeconds: Math.max(1, Math.round((endedAt - detectedAt) / 1_000))
    }
    const shouldBackup = Boolean(
      game.local?.backupEnabled && game.local.savePath && this.callbacks.onGameEnded
    )
    this.update({
      phase: 'returning',
      gameId: game.id,
      gameName: game.name,
      provider: game.provider,
      startedAt,
      detectedAt,
      endedAt,
      sessionDurationSeconds: completedSession.durationSeconds,
      returnTask: shouldBackup ? 'backing-up' : undefined
    })
    await this.focusOrbit(token)
    try {
      const result = await this.callbacks.onSessionCompleted?.(game, completedSession)
      if (token === this.activeToken) {
        this.update({
          ...this.status,
          sessionDurationSeconds: completedSession.durationSeconds,
          totalPlaytimeSeconds: result?.totalPlaytimeSeconds
        })
      }
    } catch {
      // Playtime persistence failure must not trap the user outside ORBIT.
    }
    if (settingsStore.store.closeLaunchersAfterGame) {
      void closeLauncherProcesses(processes, ownedLauncherFamilies)
    }
    if (shouldBackup && this.callbacks.onGameEnded) {
      let result: LocalGameBackupResult
      try {
        result = await this.callbacks.onGameEnded(game)
      } catch {
        result = { state: 'failed', completedAt: Date.now() }
      }
      if (token !== this.activeToken) return
      this.update({
        ...this.status,
        returnTask: result.state === 'success' ? 'backup-complete' : 'backup-failed'
      })
    }
    await wait(shouldBackup ? BACKUP_RESULT_SPLASH_MS : RETURN_SPLASH_MS)
    if (token === this.activeToken) {
      this.update({ phase: 'idle' })
      void this.finishReturnFocus(token)
    }
  }

  private async fail(token: number, message: string): Promise<void> {
    if (token !== this.activeToken) return
    this.update({ ...this.status, phase: 'error', message, endedAt: Date.now() })
    await this.focusOrbit(token)
    await wait(ERROR_SPLASH_MS)
    if (token === this.activeToken) {
      this.releaseLaunchShield(false)
      this.update({ phase: 'idle' })
    }
  }

  private async focusOrbit(token: number): Promise<void> {
    if (token !== this.activeToken || this.mainWindow.isDestroyed()) return
    if (this.mainWindow.isMinimized()) this.mainWindow.restore()
    // Keep ORBIT above a launcher until the OS-level activation has completed.
    // Dropping this flag first creates a race in which Steam wins the z-order.
    this.mainWindow.setAlwaysOnTop(true, 'screen-saver')
    this.mainWindow.show()
    this.mainWindow.setFullScreen(true)
    this.mainWindow.moveTop()
    this.mainWindow.focus()
    await activateOrbitWindow(this.mainWindow)
    if (token !== this.activeToken || this.mainWindow.isDestroyed()) return
    this.mainWindow.show()
    this.mainWindow.moveTop()
    this.mainWindow.focus()
  }

  private async finishReturnFocus(token: number): Promise<void> {
    const deadline = Date.now() + RETURN_FOCUS_GUARD_MS
    while (Date.now() < deadline) {
      await wait(Math.min(FOCUS_GUARD_POLL_MS, deadline - Date.now()))
      if (
        token !== this.activeToken ||
        this.status.phase !== 'idle' ||
        this.mainWindow.isDestroyed()
      ) {
        return
      }
      if (!this.mainWindow.isFocused()) await this.focusOrbit(token)
    }
    if (token === this.activeToken && this.status.phase === 'idle') {
      this.releaseLaunchShield(false)
    }
  }

  private maintainLaunchShield(token: number): void {
    if (token !== this.activeToken || this.launchTargetRevealed || this.mainWindow.isDestroyed()) {
      return
    }
    if (this.mainWindow.isMinimized()) this.mainWindow.restore()
    this.mainWindow.setFullScreen(true)
    this.mainWindow.setAlwaysOnTop(true, 'screen-saver')
    this.mainWindow.show()
    this.mainWindow.moveTop()
    this.mainWindow.focus()
  }

  private handoffToGame(token: number, pid: number): void {
    if (token !== this.activeToken) return
    this.releaseLaunchShield(true)
    focusExternalProcess(pid)
  }

  private releaseLaunchShield(minimize: boolean): void {
    if (this.mainWindow.isDestroyed()) return
    this.mainWindow.setAlwaysOnTop(false)
    if (minimize && !this.mainWindow.isMinimized()) this.mainWindow.minimize()
  }

  private update(status: GameLaunchStatus): void {
    this.status = status
    this.emit('updated', this.getStatus())
  }
}
