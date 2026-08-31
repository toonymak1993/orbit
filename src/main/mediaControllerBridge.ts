import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { WebContents } from 'electron'
import type { MediaKeyboardShortcut } from '@shared/ipc'

export type MediaDirection = 'up' | 'down' | 'left' | 'right'

export interface MediaControllerHandlers {
  direction: (direction: MediaDirection) => void
  confirm: () => void
  back: () => void
  backHold: () => void
  playPause: () => void
  search: () => void
  history: (direction: -1 | 1) => void
}

interface MediaKeyboardControllerTarget {
  webContents: WebContents
  shortcut: (shortcut: MediaKeyboardShortcut) => void
}

const XINPUT_MONITOR_SCRIPT = [
  "Add-Type -TypeDefinition @'",
  'using System;',
  'using System.Runtime.InteropServices;',
  '[StructLayout(LayoutKind.Sequential)] public struct OrbitMediaGamepad { public ushort Buttons; public byte LeftTrigger; public byte RightTrigger; public short LX; public short LY; public short RX; public short RY; }',
  '[StructLayout(LayoutKind.Sequential)] public struct OrbitMediaState { public uint Packet; public OrbitMediaGamepad Gamepad; }',
  'public static class OrbitMediaXInput {',
  '  [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate uint GetStateDelegate(uint index, out OrbitMediaState state);',
  '  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] private static extern IntPtr LoadLibrary(string name);',
  '  [DllImport("kernel32.dll", CharSet=CharSet.Ansi, SetLastError=true)] private static extern IntPtr GetProcAddress(IntPtr module, string name);',
  '  private static GetStateDelegate Resolve() {',
  '    foreach (string name in new [] { "xinput1_4.dll", "xinput1_3.dll", "xinput9_1_0.dll" }) {',
  '      IntPtr module = LoadLibrary(name); if (module == IntPtr.Zero) continue;',
  '      IntPtr address = GetProcAddress(module, "XInputGetState");',
  '      if (address != IntPtr.Zero) return (GetStateDelegate)Marshal.GetDelegateForFunctionPointer(address, typeof(GetStateDelegate));',
  '    }',
  '    return null;',
  '  }',
  '  private static readonly GetStateDelegate ReadState = Resolve();',
  '  public static bool Available { get { return ReadState != null; } }',
  '  public static int Buttons(int index) {',
  '    OrbitMediaState state; if (ReadState == null || ReadState((uint)index, out state) != 0) return -1;',
  '    int buttons = state.Gamepad.Buttons; const int deadzone = 16000;',
  '    int x = state.Gamepad.LX; int y = state.Gamepad.LY;',
  '    int absX = Math.Abs(x); int absY = Math.Abs(y);',
  '    if (Math.Max(absX, absY) > deadzone) {',
  '      if (absX > absY) buttons |= x < 0 ? 0x0004 : 0x0008;',
  '      else buttons |= y > 0 ? 0x0001 : 0x0002;',
  '    }',
  '    if (state.Gamepad.LeftTrigger > 30) buttons |= 0x10000;',
  '    if (state.Gamepad.RightTrigger > 30) buttons |= 0x20000;',
  '    return buttons;',
  '  }',
  '}',
  "'@",
  'if (-not [OrbitMediaXInput]::Available) { [Console]::WriteLine("unavailable"); exit 2 }',
  '[Console]::WriteLine("ready"); [Console]::Out.Flush()',
  '$lastMask = -1',
  'while ($true) {',
  '  $mask = 0',
  '  for ($index = 0; $index -lt 4; $index++) { $buttons = [OrbitMediaXInput]::Buttons($index); if ($buttons -gt 0) { $mask = $mask -bor $buttons } }',
  '  if ($mask -ne $lastMask) { $lastMask = $mask; [Console]::WriteLine("mask:" + $mask); [Console]::Out.Flush() }',
  '  Start-Sleep -Milliseconds 32',
  '}'
].join('\n')

const MEDIA_BUTTONS = {
  dpadUp: 0x0001,
  dpadDown: 0x0002,
  dpadLeft: 0x0004,
  dpadRight: 0x0008,
  start: 0x0010,
  lb: 0x0100,
  rb: 0x0200,
  a: 0x1000,
  b: 0x2000,
  x: 0x4000,
  y: 0x8000,
  lt: 0x10000,
  rt: 0x20000
} as const

export class MediaControllerBridge {
  private child: ChildProcessWithoutNullStreams | null = null
  private inputTimer: NodeJS.Timeout | null = null
  private backHoldTimer: NodeJS.Timeout | null = null
  private mask = 0
  private previousMask = 0
  private blockedUntilReleaseMask = 0
  private inputContextVersion = 0
  private backHoldTriggered = false
  private nextRepeatAt = new Map<number, number>()
  private keyboardTarget: MediaKeyboardControllerTarget | null = null

  setKeyboardTarget(target: MediaKeyboardControllerTarget | null): void {
    this.keyboardTarget = target
    // A button held while the target changes must not activate the new target
    // on its release or immediately start repeating there.
    this.blockedUntilReleaseMask |= this.mask
    this.previousMask = 0
    this.inputContextVersion += 1
    this.nextRepeatAt.clear()
    if (this.backHoldTimer) clearTimeout(this.backHoldTimer)
    this.backHoldTimer = null
    this.backHoldTriggered = false
  }

  async start(handlers: MediaControllerHandlers): Promise<boolean> {
    if (process.platform !== 'win32') return false
    this.dispose()
    const encoded = Buffer.from(XINPUT_MONITOR_SCRIPT, 'utf16le').toString('base64')
    let controllerProcess: ChildProcessWithoutNullStreams
    try {
      controllerProcess = spawn(
        'powershell.exe',
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
        { windowsHide: true }
      )
      this.child = controllerProcess
    } catch {
      return false
    }

    let buffer = ''
    let ready = false
    let settleReady: ((value: boolean) => void) | null = null
    const readyPromise = new Promise<boolean>((resolve) => {
      settleReady = resolve
    })
    let readyTimeout: NodeJS.Timeout | null = null
    const finishReady = (value: boolean): void => {
      if (!settleReady) return
      if (readyTimeout) clearTimeout(readyTimeout)
      const settle = settleReady
      settleReady = null
      ready = value
      settle(value)
    }
    readyTimeout = setTimeout(() => finishReady(false), 3_500)
    controllerProcess.stdout.setEncoding('utf8')
    controllerProcess.stdout.on('data', (chunk: string) => {
      buffer += chunk
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (line === 'ready') finishReady(true)
        else if (line === 'unavailable') finishReady(false)
        else if (line.startsWith('mask:')) {
          const mask = Number.parseInt(line.slice(5), 10)
          if (Number.isFinite(mask)) this.mask = Math.max(0, mask)
        }
      }
    })
    const handleProcessEnd = (): void => {
      finishReady(false)
      if (this.child !== controllerProcess) return
      this.child = null
      this.mask = 0
      if (ready) this.dispose()
    }
    controllerProcess.once('exit', handleProcessEnd)
    controllerProcess.once('error', handleProcessEnd)
    controllerProcess.stderr.resume()

    let currentInputMask = 0
    const pressedNow = (button: number): boolean =>
      (currentInputMask & button) !== 0 && (this.previousMask & button) === 0
    const releasedNow = (button: number): boolean =>
      (currentInputMask & button) === 0 && (this.previousMask & button) !== 0
    const repeated = (button: number, action: () => void, now: number): void => {
      if ((currentInputMask & button) === 0) {
        this.nextRepeatAt.delete(button)
        return
      }
      const nextAt = this.nextRepeatAt.get(button)
      if (nextAt === undefined) {
        action()
        this.nextRepeatAt.set(button, now + 420)
      } else if (now >= nextAt) {
        action()
        this.nextRepeatAt.set(button, now + 130)
      }
    }
    const sendKeyboardKey = (keyCode: string): void => {
      const target = this.keyboardTarget?.webContents
      if (!target || target.isDestroyed()) return
      target.sendInputEvent({ type: 'keyDown', keyCode })
      target.sendInputEvent({ type: 'keyUp', keyCode })
    }

    const available = await readyPromise
    if (!available || !ready || this.child !== controllerProcess) {
      this.dispose()
      return false
    }
    this.blockedUntilReleaseMask = this.mask
    this.previousMask = 0

    this.inputTimer = setInterval(() => {
      this.blockedUntilReleaseMask &= this.mask
      currentInputMask = this.mask & ~this.blockedUntilReleaseMask
      const contextVersion = this.inputContextVersion
      const now = Date.now()
      const keyboard = this.keyboardTarget
      if (keyboard && !keyboard.webContents.isDestroyed()) {
        repeated(MEDIA_BUTTONS.dpadUp, () => sendKeyboardKey('Up'), now)
        repeated(MEDIA_BUTTONS.dpadDown, () => sendKeyboardKey('Down'), now)
        repeated(MEDIA_BUTTONS.dpadLeft, () => sendKeyboardKey('Left'), now)
        repeated(MEDIA_BUTTONS.dpadRight, () => sendKeyboardKey('Right'), now)
        if (pressedNow(MEDIA_BUTTONS.a)) sendKeyboardKey('Enter')
        if (pressedNow(MEDIA_BUTTONS.b)) sendKeyboardKey('Escape')
        if (pressedNow(MEDIA_BUTTONS.x)) keyboard.shortcut('backspace')
        if (pressedNow(MEDIA_BUTTONS.y)) keyboard.shortcut('space')
        if (pressedNow(MEDIA_BUTTONS.lb)) keyboard.shortcut('cursor-left')
        if (pressedNow(MEDIA_BUTTONS.rb)) keyboard.shortcut('cursor-right')
        if (pressedNow(MEDIA_BUTTONS.lt)) keyboard.shortcut('shift')
        if (pressedNow(MEDIA_BUTTONS.rt)) keyboard.shortcut('layout')
        if (pressedNow(MEDIA_BUTTONS.start)) keyboard.shortcut('done')
        if (this.inputContextVersion === contextVersion) this.previousMask = currentInputMask
        return
      }

      repeated(MEDIA_BUTTONS.dpadUp, () => handlers.direction('up'), now)
      repeated(MEDIA_BUTTONS.dpadDown, () => handlers.direction('down'), now)
      repeated(MEDIA_BUTTONS.dpadLeft, () => handlers.direction('left'), now)
      repeated(MEDIA_BUTTONS.dpadRight, () => handlers.direction('right'), now)
      if (pressedNow(MEDIA_BUTTONS.a)) handlers.confirm()
      if (pressedNow(MEDIA_BUTTONS.x)) handlers.playPause()
      if (pressedNow(MEDIA_BUTTONS.y)) handlers.search()
      if (pressedNow(MEDIA_BUTTONS.lb)) handlers.history(-1)
      if (pressedNow(MEDIA_BUTTONS.rb)) handlers.history(1)
      if (pressedNow(MEDIA_BUTTONS.b)) {
        this.backHoldTriggered = false
        this.backHoldTimer = setTimeout(() => {
          this.backHoldTriggered = true
          handlers.backHold()
        }, 1_250)
      }
      if (releasedNow(MEDIA_BUTTONS.b)) {
        if (this.backHoldTimer) clearTimeout(this.backHoldTimer)
        this.backHoldTimer = null
        if (!this.backHoldTriggered) handlers.back()
        this.backHoldTriggered = false
      }
      if (this.inputContextVersion === contextVersion) this.previousMask = currentInputMask
    }, 32)
    return true
  }

  dispose(): void {
    if (this.inputTimer) clearInterval(this.inputTimer)
    if (this.backHoldTimer) clearTimeout(this.backHoldTimer)
    this.inputTimer = null
    this.backHoldTimer = null
    this.keyboardTarget = null
    this.mask = 0
    this.previousMask = 0
    this.blockedUntilReleaseMask = 0
    this.inputContextVersion += 1
    this.backHoldTriggered = false
    this.nextRepeatAt.clear()
    const child = this.child
    this.child = null
    if (child && !child.killed) child.kill()
  }
}
