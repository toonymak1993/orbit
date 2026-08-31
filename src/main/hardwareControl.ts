import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type HardwareControlButton,
  type HardwareControlStatus,
  type OrbitSettings
} from '@shared/ipc'
import { createDualSenseMonitorScript } from './dualsenseMonitor'

type HardwareControlSettings = Pick<
  OrbitSettings,
  'hardwareControlEnabled' | 'hardwareControlButton' | 'hardwareControlHoldSeconds'
>

type XInputHardwareControlButton = Exclude<HardwareControlButton, 'playstation'>

const BUTTON_INPUTS: Record<
  XInputHardwareControlButton,
  { buttonMask: number; trigger: 'none' | 'left' | 'right' }
> = {
  menu: { buttonMask: 0x0010, trigger: 'none' },
  view: { buttonMask: 0x0020, trigger: 'none' },
  guide: { buttonMask: 0x0400, trigger: 'none' },
  a: { buttonMask: 0x1000, trigger: 'none' },
  b: { buttonMask: 0x2000, trigger: 'none' },
  x: { buttonMask: 0x4000, trigger: 'none' },
  y: { buttonMask: 0x8000, trigger: 'none' },
  'dpad-up': { buttonMask: 0x0001, trigger: 'none' },
  'dpad-down': { buttonMask: 0x0002, trigger: 'none' },
  'dpad-left': { buttonMask: 0x0004, trigger: 'none' },
  'dpad-right': { buttonMask: 0x0008, trigger: 'none' },
  'left-trigger': { buttonMask: 0, trigger: 'left' },
  'right-trigger': { buttonMask: 0, trigger: 'right' },
  'left-bumper': { buttonMask: 0x0100, trigger: 'none' },
  'right-bumper': { buttonMask: 0x0200, trigger: 'none' },
  'left-stick': { buttonMask: 0x0040, trigger: 'none' },
  'right-stick': { buttonMask: 0x0080, trigger: 'none' }
}

const MONITOR_SCRIPT = [
  "Add-Type -TypeDefinition @'",
  'using System;',
  'using System.Runtime.InteropServices;',
  '',
  '[StructLayout(LayoutKind.Sequential)]',
  'public struct OrbitXInputGamepad {',
  '  public ushort Buttons;',
  '  public byte LeftTrigger;',
  '  public byte RightTrigger;',
  '  public short ThumbLX;',
  '  public short ThumbLY;',
  '  public short ThumbRX;',
  '  public short ThumbRY;',
  '}',
  '',
  '[StructLayout(LayoutKind.Sequential)]',
  'public struct OrbitXInputState {',
  '  public uint PacketNumber;',
  '  public OrbitXInputGamepad Gamepad;',
  '}',
  '',
  'public struct OrbitXInputReading {',
  '  public int Buttons;',
  '  public int LeftTrigger;',
  '  public int RightTrigger;',
  '}',
  '',
  'public static class OrbitXInput {',
  '  [UnmanagedFunctionPointer(CallingConvention.StdCall)]',
  '  private delegate uint GetStateDelegate(uint index, out OrbitXInputState state);',
  '',
  '  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]',
  '  private static extern IntPtr LoadLibrary(string fileName);',
  '',
  '  [DllImport("kernel32.dll", CharSet = CharSet.Ansi, SetLastError = true)]',
  '  private static extern IntPtr GetProcAddress(IntPtr module, string procedureName);',
  '',
  '  [DllImport("kernel32.dll", EntryPoint = "GetProcAddress", SetLastError = true)]',
  '  private static extern IntPtr GetProcAddressOrdinal(IntPtr module, IntPtr ordinal);',
  '',
  '  private static readonly GetStateDelegate GetState = Resolve();',
  '',
  '  private static GetStateDelegate Resolve() {',
  '    string[] libraries = { "xinput1_4.dll", "xinput1_3.dll", "xinput9_1_0.dll" };',
  '    foreach (string library in libraries) {',
  '      IntPtr module = LoadLibrary(library);',
  '      if (module == IntPtr.Zero) continue;',
  '      IntPtr address = GetProcAddressOrdinal(module, new IntPtr(100));',
  '      if (address == IntPtr.Zero) address = GetProcAddress(module, "XInputGetState");',
  '      if (address != IntPtr.Zero) {',
  '        return (GetStateDelegate)Marshal.GetDelegateForFunctionPointer(address, typeof(GetStateDelegate));',
  '      }',
  '    }',
  '    return null;',
  '  }',
  '',
  '  public static bool Available { get { return GetState != null; } }',
  '',
  '  public static OrbitXInputReading Read(int index) {',
  '    OrbitXInputReading reading = new OrbitXInputReading { Buttons = -1 };',
  '    if (GetState == null) return reading;',
  '    OrbitXInputState state;',
  '    if (GetState((uint)index, out state) != 0) return reading;',
  '    reading.Buttons = state.Gamepad.Buttons;',
  '    reading.LeftTrigger = state.Gamepad.LeftTrigger;',
  '    reading.RightTrigger = state.Gamepad.RightTrigger;',
  '    return reading;',
  '  }',
  '}',
  "'@",
  '',
  '$buttonMask = __BUTTON_MASK__',
  '$triggerSide = "__TRIGGER_SIDE__"',
  '$triggerThreshold = 30',
  '$holdMilliseconds = __HOLD_MILLISECONDS__',
  '',
  'if (-not [OrbitXInput]::Available) {',
  '  [Console]::WriteLine("unavailable")',
  '  [Console]::Out.Flush()',
  '  exit 2',
  '}',
  '',
  '[Console]::WriteLine("ready")',
  '[Console]::Out.Flush()',
  '$pressedAt = @(-1L, -1L, -1L, -1L)',
  '$releasedAt = @(-1L, -1L, -1L, -1L)',
  '$triggered = @($false, $false, $false, $false)',
  '$lastButtonMasks = @(-1, -1, -1, -1)',
  '$releaseGraceMilliseconds = 180',
  '$lastConnectedCount = -1',
  '$clock = [Diagnostics.Stopwatch]::StartNew()',
  '',
  'while ($true) {',
  '  $now = $clock.ElapsedMilliseconds',
  '  $connectedCount = 0',
  '',
  '  for ($controller = 0; $controller -lt 4; $controller++) {',
  '    $reading = [OrbitXInput]::Read($controller)',
  '    $buttons = $reading.Buttons',
  '    if ($buttons -ge 0) { $connectedCount++ }',
  '    if ($buttons -ne $lastButtonMasks[$controller]) {',
  '      $lastButtonMasks[$controller] = $buttons',
  '      if ($buttons -gt 0) {',
  '        [Console]::WriteLine("buttons:" + $controller + ":" + $buttons)',
  '        [Console]::Out.Flush()',
  '      }',
  '    }',
  '    $pressed = $buttons -ge 0 -and (',
  '      (($triggerSide -eq "left") -and $reading.LeftTrigger -ge $triggerThreshold) -or',
  '      (($triggerSide -eq "right") -and $reading.RightTrigger -ge $triggerThreshold) -or',
  '      (($triggerSide -eq "none") -and (($buttons -band $buttonMask) -ne 0))',
  '    )',
  '',
  '    if (-not $pressed) {',
  '      if ($pressedAt[$controller] -lt 0) { continue }',
  '      if ($releasedAt[$controller] -lt 0) { $releasedAt[$controller] = $now }',
  '      if (($now - $releasedAt[$controller]) -ge $releaseGraceMilliseconds) {',
  '        $pressDuration = [Math]::Max([long]0, [long]($releasedAt[$controller] - $pressedAt[$controller]))',
  '        [Console]::WriteLine("released:" + $controller + ":" + $pressDuration)',
  '        [Console]::Out.Flush()',
  '        $pressedAt[$controller] = -1L',
  '        $releasedAt[$controller] = -1L',
  '        $triggered[$controller] = $false',
  '        continue',
  '      }',
  '    } else {',
  '      $releasedAt[$controller] = -1L',
  '      if ($pressedAt[$controller] -lt 0) {',
  '        $pressedAt[$controller] = $now',
  '        [Console]::WriteLine("pressed:" + $controller)',
  '        [Console]::Out.Flush()',
  '      }',
  '    }',
  '',
  '    if (-not $triggered[$controller] -and ($now - $pressedAt[$controller]) -ge $holdMilliseconds) {',
  '      $triggered[$controller] = $true',
  '      [Console]::WriteLine("trigger")',
  '      [Console]::Out.Flush()',
  '    }',
  '  }',
  '',
  '  if ($connectedCount -ne $lastConnectedCount) {',
  '    $lastConnectedCount = $connectedCount',
  '    [Console]::WriteLine("controllers:" + $connectedCount)',
  '    [Console]::Out.Flush()',
  '  }',
  '',
  '  Start-Sleep -Milliseconds 40',
  '}'
].join('\n')

function removeMonitorScript(scriptPath: string): void {
  void unlink(scriptPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') {
      console.warn('[hardware-control] could not remove controller monitor script:', error.message)
    }
  })
}

function settingsSignature(settings: HardwareControlSettings): string {
  return [
    settings.hardwareControlEnabled,
    settings.hardwareControlButton,
    settings.hardwareControlHoldSeconds
  ].join(':')
}

export class HardwareControlWatcher extends EventEmitter {
  private monitor: ChildProcessWithoutNullStreams | null = null
  private monitorScriptPath: string | null = null
  private monitorGeneration = 0
  private settings: HardwareControlSettings
  private signature = ''
  private disposed = false
  private status: HardwareControlStatus = {
    state: 'disabled',
    connectedControllers: 0
  }

  constructor(settings: OrbitSettings) {
    super()
    this.settings = settings
    this.updateSettings(settings)
  }

  getStatus(): HardwareControlStatus {
    return { ...this.status }
  }

  updateSettings(settings: OrbitSettings): void {
    const next: HardwareControlSettings = {
      hardwareControlEnabled: settings.hardwareControlEnabled,
      hardwareControlButton: settings.hardwareControlButton,
      hardwareControlHoldSeconds: settings.hardwareControlHoldSeconds
    }
    const nextSignature = settingsSignature(next)
    this.settings = next
    if (nextSignature === this.signature || this.disposed) return
    this.signature = nextSignature
    this.stopMonitor()

    if (!next.hardwareControlEnabled) {
      this.setStatus({ state: 'disabled', connectedControllers: 0 })
      return
    }
    if (process.platform !== 'win32') {
      this.setStatus({
        state: 'unavailable',
        connectedControllers: 0,
        reason: 'unsupported-platform'
      })
      return
    }

    this.startMonitor()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.stopMonitor()
  }

  private startMonitor(): void {
    const generation = this.monitorGeneration
    const holdMilliseconds = Math.round(this.settings.hardwareControlHoldSeconds * 1_000)
    const button = this.settings.hardwareControlButton
    this.setStatus({ state: 'starting', connectedControllers: 0 })

    if (button === 'playstation') {
      void this.startDualSenseMonitor(createDualSenseMonitorScript(holdMilliseconds), generation)
      return
    }

    const script = MONITOR_SCRIPT.replace(
      '__BUTTON_MASK__',
      String(BUTTON_INPUTS[button].buttonMask)
    )
      .replace('__TRIGGER_SIDE__', BUTTON_INPUTS[button].trigger)
      .replace('__HOLD_MILLISECONDS__', String(holdMilliseconds))
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    this.launchMonitor(
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      generation
    )
  }

  private async startDualSenseMonitor(script: string, generation: number): Promise<void> {
    const scriptPath = join(
      tmpdir(),
      `orbit-hardware-control-${process.pid}-${randomUUID()}.ps1`
    )
    try {
      await writeFile(scriptPath, script, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    } catch (error) {
      removeMonitorScript(scriptPath)
      if (this.disposed || generation !== this.monitorGeneration) return
      console.warn(
        '[hardware-control] could not prepare DualSense controller monitor:',
        error instanceof Error ? error.message : error
      )
      this.setStatus({
        state: 'unavailable',
        connectedControllers: 0,
        reason: 'monitor-failed'
      })
      return
    }

    if (this.disposed || generation !== this.monitorGeneration) {
      removeMonitorScript(scriptPath)
      return
    }

    this.launchMonitor(
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath
      ],
      generation,
      scriptPath
    )
  }

  private launchMonitor(args: string[], generation: number, scriptPath?: string): void {
    if (this.disposed || generation !== this.monitorGeneration) {
      if (scriptPath) removeMonitorScript(scriptPath)
      return
    }

    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn('powershell.exe', args, { windowsHide: true })
    } catch (error) {
      if (scriptPath) removeMonitorScript(scriptPath)
      console.warn(
        '[hardware-control] controller monitor failed to start:',
        error instanceof Error ? error.message : error
      )
      this.setStatus({
        state: 'unavailable',
        connectedControllers: 0,
        reason: 'monitor-failed'
      })
      return
    }

    this.monitor = child
    this.monitorScriptPath = scriptPath ?? null
    child.stdout.setEncoding('utf8')
    let stdoutBuffer = ''

    child.stdout.on('data', (chunk: string) => {
      stdoutBuffer += chunk
      const lines = stdoutBuffer.split(/\r?\n/)
      stdoutBuffer = lines.pop() ?? ''
      for (const line of lines) this.handleMonitorLine(line.trim())
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      const message = chunk.trim()
      if (message && message !== '#< CLIXML') {
        console.warn('[hardware-control] controller monitor:', message)
      }
    })

    child.once('error', (error) => {
      if (scriptPath) removeMonitorScript(scriptPath)
      if (this.monitor !== child) return
      this.monitor = null
      this.monitorScriptPath = null
      console.warn('[hardware-control] controller monitor failed to start:', error.message)
      this.setStatus({
        state: 'unavailable',
        connectedControllers: 0,
        reason: 'monitor-failed'
      })
    })

    child.once('exit', (code, signal) => {
      if (scriptPath) removeMonitorScript(scriptPath)
      if (this.monitor !== child) return
      this.monitor = null
      this.monitorScriptPath = null
      if (this.disposed || !this.settings.hardwareControlEnabled) return
      console.warn(
        `[hardware-control] controller monitor exited (code ${code ?? 'none'}, signal ${signal ?? 'none'})`
      )
      this.setStatus({
        state: 'unavailable',
        connectedControllers: 0,
        reason: 'monitor-failed'
      })
    })
  }

  private stopMonitor(): void {
    this.monitorGeneration += 1
    const child = this.monitor
    this.monitor = null
    const scriptPath = this.monitorScriptPath
    this.monitorScriptPath = null
    if (child && !child.killed) child.kill()
    if (scriptPath && !child) removeMonitorScript(scriptPath)
  }

  private handleMonitorLine(line: string): void {
    if (line === 'ready') {
      this.setStatus({ state: 'ready', connectedControllers: 0 })
      return
    }
    if (line === 'unavailable') {
      this.setStatus({
        state: 'unavailable',
        connectedControllers: 0,
        reason: 'monitor-failed'
      })
      return
    }
    if (line.startsWith('controllers:')) {
      const count = Number.parseInt(line.slice('controllers:'.length), 10)
      if (Number.isFinite(count)) {
        this.setStatus({
          state: 'ready',
          connectedControllers: Math.max(0, Math.min(4, count))
        })
      }
      return
    }
    if (line.startsWith('pressed:')) {
      this.setStatus({ ...this.status, lastInputAt: Date.now() })
      return
    }
    if (line.startsWith('buttons:')) {
      const mask = Number.parseInt(line.split(':')[2] ?? '', 10)
      if (Number.isFinite(mask)) {
        this.setStatus({
          ...this.status,
          lastAnyInputAt: Date.now(),
          lastRawButtonMask: Math.max(0, mask)
        })
      }
      return
    }
    if (line.startsWith('released:')) {
      const duration = Number.parseInt(line.split(':')[2] ?? '', 10)
      if (Number.isFinite(duration)) {
        this.setStatus({ ...this.status, lastPressDurationMs: Math.max(0, duration) })
      }
      return
    }
    if (line === 'trigger') {
      const triggeredAt = Date.now()
      this.setStatus({
        ...this.status,
        lastInputAt: triggeredAt,
        lastTriggerAt: triggeredAt
      })
      this.emit('trigger')
    }
  }

  private setStatus(status: HardwareControlStatus): void {
    if (
      this.status.state === status.state &&
      this.status.connectedControllers === status.connectedControllers &&
      this.status.reason === status.reason &&
      this.status.lastInputAt === status.lastInputAt &&
      this.status.lastTriggerAt === status.lastTriggerAt &&
      this.status.lastPressDurationMs === status.lastPressDurationMs &&
      this.status.lastAnyInputAt === status.lastAnyInputAt &&
      this.status.lastRawButtonMask === status.lastRawButtonMask
    ) {
      return
    }
    this.status = status
    this.emit('status', this.getStatus())
  }
}
