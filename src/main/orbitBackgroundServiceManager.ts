import { spawn } from 'node:child_process'
import { app, type BrowserWindow } from 'electron'
import {
  IPC,
  type HardwareControlStatus,
  type OrbitBackgroundServiceAction,
  type OrbitBackgroundServiceStatus
} from '@shared/ipc'
import {
  ORBIT_AGENT_ARGUMENT,
  orbitServicePipeNames,
  requestOrbitPipe,
  type OrbitAgentCommand,
  type OrbitAgentSnapshot
} from './orbitServiceProtocol'

const LOGIN_ITEM_NAME = 'ORBIT Background Service'
const POLL_INTERVAL_MS = 1_500
const START_TIMEOUT_MS = 10_000

function sameStatus(
  left: OrbitBackgroundServiceStatus,
  right: OrbitBackgroundServiceStatus
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function stoppedHardwareStatus(enabled: boolean): HardwareControlStatus {
  return enabled
    ? { state: 'unavailable', connectedControllers: 0, reason: 'service-not-running' }
    : { state: 'disabled', connectedControllers: 0 }
}

function normalizedWindowsPath(value: string): string {
  return value.replace(/^"|"$/g, '').toLocaleLowerCase()
}

function loginArgumentsMatch(actual: string[], expected: string[]): boolean {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => normalizedWindowsPath(value) === normalizedWindowsPath(expected[index]))
  )
}

export class OrbitBackgroundServiceManager {
  private readonly pipeName = orbitServicePipeNames(app.getPath('userData')).agent
  private pollTimer: NodeJS.Timeout | null = null
  private disposed = false
  private refreshInFlight: Promise<OrbitBackgroundServiceStatus> | null = null
  private startInFlight: Promise<void> | null = null
  private startingUntil = 0
  private status: OrbitBackgroundServiceStatus = {
    installation: process.platform === 'win32' ? 'not-installed' : 'unsupported',
    runtime: 'stopped',
    hardwareControl: stoppedHardwareStatus(false),
    reason: process.platform === 'win32' ? undefined : 'unsupported-platform'
  }

  constructor(
    private readonly mainWindow: BrowserWindow,
    private readonly isHardwareControlEnabled: () => boolean
  ) {}

  start(): void {
    void this.refresh().then((status) => {
      if (
        this.isHardwareControlEnabled() &&
        (status.installation === 'not-installed' ||
          (status.installation === 'repair-needed' &&
            status.reason === 'configuration-mismatch'))
      ) {
        // Migrate the earlier in-process Hardware Control setting to the
        // background host required for it to remain active outside ORBIT.
        void this.control('install')
      } else if (status.installation === 'installed' && status.runtime !== 'running') {
        void this.startAgent()
      }
    })
    this.pollTimer = setInterval(() => void this.refresh(), POLL_INTERVAL_MS)
  }

  dispose(): void {
    this.disposed = true
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
  }

  async getStatus(): Promise<OrbitBackgroundServiceStatus> {
    return this.refresh()
  }

  async control(action: OrbitBackgroundServiceAction): Promise<OrbitBackgroundServiceStatus> {
    if (process.platform !== 'win32') return this.refresh()
    if (action === 'install') {
      this.writeLoginItem(true)
      await this.startAgent()
    } else if (action === 'repair') {
      this.writeLoginItem(false)
      this.writeLoginItem(true)
      await this.restartAgent()
    } else if (action === 'restart') {
      await this.restartAgent()
    } else if (action === 'remove') {
      this.writeLoginItem(false)
      await this.stopAgent()
    }
    return this.refresh()
  }

  async reloadSettings(): Promise<void> {
    try {
      await requestOrbitPipe<OrbitAgentSnapshot>(this.pipeName, {
        command: 'reload-settings' satisfies OrbitAgentCommand
      })
    } catch {
      const installation = this.getInstallation()
      if (installation.installation === 'installed') void this.startAgent()
    }
    await this.refresh()
  }

  private loginItemArguments(): string[] {
    if (app.isPackaged) return [ORBIT_AGENT_ARGUMENT]
    return [app.getAppPath(), ORBIT_AGENT_ARGUMENT]
  }

  private writeLoginItem(openAtLogin: boolean): void {
    app.setLoginItemSettings({
      openAtLogin,
      enabled: openAtLogin,
      name: LOGIN_ITEM_NAME,
      path: process.execPath,
      args: this.loginItemArguments()
    })
  }

  private getInstallation(): Pick<OrbitBackgroundServiceStatus, 'installation' | 'reason'> {
    if (process.platform !== 'win32') {
      return { installation: 'unsupported', reason: 'unsupported-platform' }
    }

    const desired = app.getLoginItemSettings({
      path: process.execPath,
      args: this.loginItemArguments()
    })
    if (desired.openAtLogin) return { installation: 'installed' }

    const namedItem = desired.launchItems.find((item) => item.name === LOGIN_ITEM_NAME)
    if (
      namedItem?.enabled &&
      normalizedWindowsPath(namedItem.path) === normalizedWindowsPath(process.execPath) &&
      loginArgumentsMatch(namedItem.args, this.loginItemArguments())
    ) {
      return { installation: 'installed' }
    }
    if (namedItem && !namedItem.enabled) {
      return { installation: 'repair-needed', reason: 'login-item-disabled' }
    }
    if (namedItem) {
      return { installation: 'repair-needed', reason: 'configuration-mismatch' }
    }
    return { installation: 'not-installed' }
  }

  private async probeAgent(): Promise<OrbitAgentSnapshot> {
    const snapshot = await requestOrbitPipe<OrbitAgentSnapshot>(this.pipeName, {
      command: 'status' satisfies OrbitAgentCommand
    })
    if (snapshot.protocolVersion !== 1) throw new Error('Unsupported ORBIT service protocol')
    return snapshot
  }

  private launchAgentProcess(): void {
    const child = spawn(process.execPath, this.loginItemArguments(), {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })
    child.unref()
  }

  private async startAgent(): Promise<void> {
    if (this.startInFlight) return this.startInFlight
    this.startInFlight = this.performStartAgent().finally(() => {
      this.startInFlight = null
      this.startingUntil = 0
    })
    return this.startInFlight
  }

  private async performStartAgent(): Promise<void> {
    try {
      await this.probeAgent()
      return
    } catch {
      // No compatible agent is reachable yet.
    }

    this.startingUntil = Date.now() + START_TIMEOUT_MS
    this.setStatus({
      ...this.status,
      installation: this.getInstallation().installation,
      runtime: 'starting',
      hardwareControl: stoppedHardwareStatus(this.isHardwareControlEnabled()),
      reason: undefined
    })
    this.launchAgentProcess()

    while (Date.now() < this.startingUntil) {
      await new Promise((resolve) => setTimeout(resolve, 200))
      try {
        await this.probeAgent()
        return
      } catch {
        // Agent startup is bounded by START_TIMEOUT_MS.
      }
    }
  }

  private async stopAgent(): Promise<void> {
    try {
      await requestOrbitPipe<void>(this.pipeName, {
        command: 'shutdown' satisfies OrbitAgentCommand
      })
    } catch {
      return
    }

    const deadline = Date.now() + 3_000
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      try {
        await this.probeAgent()
      } catch {
        return
      }
    }
  }

  private async restartAgent(): Promise<void> {
    await this.stopAgent()
    await this.startAgent()
  }

  private refresh(): Promise<OrbitBackgroundServiceStatus> {
    if (this.refreshInFlight) return this.refreshInFlight
    this.refreshInFlight = this.performRefresh().finally(() => {
      this.refreshInFlight = null
    })
    return this.refreshInFlight
  }

  private async performRefresh(): Promise<OrbitBackgroundServiceStatus> {
    const installation = this.getInstallation()
    let next: OrbitBackgroundServiceStatus
    try {
      const agent = await this.probeAgent()
      next = {
        ...installation,
        runtime: 'running',
        hardwareControl: agent.hardwareControl,
        lastActivationAt: agent.lastActivationAt,
        lastActivationResult: agent.lastActivationResult
      }
    } catch {
      next = {
        ...installation,
        runtime: Date.now() < this.startingUntil ? 'starting' : 'stopped',
        hardwareControl: stoppedHardwareStatus(this.isHardwareControlEnabled()),
        reason:
          installation.reason ??
          (installation.installation === 'installed' ? 'agent-unreachable' : undefined)
      }
    }
    this.setStatus(next)
    if (
      !this.disposed &&
      next.installation === 'installed' &&
      next.runtime === 'stopped'
    ) {
      void this.startAgent()
    }
    return next
  }

  private setStatus(next: OrbitBackgroundServiceStatus): void {
    if (sameStatus(this.status, next)) return
    this.status = next
    if (this.disposed || this.mainWindow.isDestroyed() || this.mainWindow.webContents.isDestroyed()) {
      return
    }
    this.mainWindow.webContents.send(IPC.backgroundServiceStatus, next)
    this.mainWindow.webContents.send(IPC.hardwareControlStatus, next.hardwareControl)
  }
}
