import { spawn, type ChildProcess } from 'node:child_process'
import { app, type BrowserWindow } from 'electron'
import {
  IPC,
  type HardwareControlStatus,
  type OrbitBackgroundServiceAction,
  type OrbitBackgroundServiceStatus
} from '@shared/ipc'
import {
  ORBIT_AGENT_ARGUMENT,
  isOrbitAgentSnapshot,
  orbitServicePipeNames,
  requestOrbitPipe,
  type OrbitAgentCommand,
  type OrbitAgentSnapshot
} from './orbitServiceProtocol'
import {
  BACKGROUND_AGENT_STABLE_MS,
  backgroundAgentRestartDelayMs
} from './orbitBackgroundServicePolicy'
import {
  ORBIT_BACKGROUND_SERVICE_LOGIN_ITEM_NAME,
  getOrbitBackgroundServiceLoginItemInstallation,
  orbitBackgroundServiceLoginItemArguments
} from './orbitBackgroundServiceLoginItem'
import {
  clearBackgroundAgentSuspension,
  backgroundAgentSuspensionPath,
  isBackgroundAgentSuspended,
  readBackgroundAgentSuspension,
  suspendBackgroundAgent
} from './orbitBackgroundServiceSuspension'
import { scheduleBackgroundAgentRecovery } from './orbitBackgroundServiceRecovery'
import {
  isProcessAlive,
  terminateWindowsProcessIfIdentityMatches
} from './windowsProcess'

const POLL_INTERVAL_MS = 1_500
const START_TIMEOUT_MS = 30_000
const LATE_START_STOP_GRACE_MS = 12_000
const STOP_TIMEOUT_MS = 4_000
const FORCE_STOP_GRACE_MS = 1_000
const STOP_CONFIRMATION_COUNT = 3

class BackgroundAgentStartCancelledError extends Error {
  constructor() {
    super('ORBIT background service start was superseded')
  }
}

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

function isBackgroundServiceSupported(): boolean {
  return process.platform === 'win32' && !process.windowsStore
}

function normalizedWindowsPath(value: string): string {
  return value.trim().replace(/^"|"$/g, '').toLowerCase()
}

function isChildProcessAlive(child: ChildProcess | null): boolean {
  if (!child || child.exitCode !== null || child.signalCode !== null) return false
  return child.pid ? isProcessAlive(child.pid) : !child.killed
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, milliseconds)
    signal?.addEventListener('abort', finish, { once: true })
  })
}

export class OrbitBackgroundServiceManager {
  private readonly userDataPath = app.getPath('userData')
  private readonly pipeName = orbitServicePipeNames(this.userDataPath).agent
  private pollTimer: NodeJS.Timeout | null = null
  private disposed = false
  private refreshInFlight: Promise<OrbitBackgroundServiceStatus> | null = null
  private lifecycleQueue: Promise<void> = Promise.resolve()
  private lifecycleRevision = 0
  private startAbort: AbortController | null = null
  private ensureRunningQueued = false
  private ensureStoppedQueued = false
  private spawnedAgent: ChildProcess | null = null
  private startingUntil = 0
  private consecutiveStartFailures = 0
  private nextAutomaticStartAt = 0
  private lastObservedAgentStartedAt: number | undefined
  private lastAccountedAgentStartedAt: number | undefined
  private manualTransition = false
  private startupReconciliationPending = false
  private updateSuspended = false
  private status: OrbitBackgroundServiceStatus = {
    installation: isBackgroundServiceSupported() ? 'not-installed' : 'unsupported',
    runtime: 'stopped',
    hardwareControl: stoppedHardwareStatus(false),
    reason:
      process.platform !== 'win32'
        ? 'unsupported-platform'
        : process.windowsStore
          ? 'unsupported-package'
          : undefined
  }

  constructor(
    private readonly mainWindow: BrowserWindow,
    private readonly isHardwareControlEnabled: () => boolean
  ) {}

  start(startupReconciliation: Promise<void> = Promise.resolve()): void {
    // Fail closed until AppUpdateService has reconciled a possible pending
    // install. Otherwise this process could erase the install suspension and
    // relaunch the agent while the installer still owns the application files.
    this.startupReconciliationPending = true
    void this.initialize(startupReconciliation).catch((error) => {
      console.warn(
        '[background-service] initial reconciliation failed:',
        error instanceof Error ? error.message : error
      )
    })
    this.pollTimer = setInterval(() => {
      void this.refresh().catch((error) => {
        console.warn(
          '[background-service] status refresh failed:',
          error instanceof Error ? error.message : error
        )
      })
    }, POLL_INTERVAL_MS)
  }

  dispose(): void {
    this.disposed = true
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
  }

  async getStatus(): Promise<OrbitBackgroundServiceStatus> {
    return this.refresh()
  }

  control(action: OrbitBackgroundServiceAction): Promise<OrbitBackgroundServiceStatus> {
    if (!isBackgroundServiceSupported()) return this.refresh()
    const revision = this.invalidatePendingStart()
    return this.enqueueLifecycle(async () => {
      this.manualTransition = true
      try {
        if ((this.startupReconciliationPending || this.updateSuspended) && action !== 'remove') {
          throw new Error('ORBIT background service maintenance is active during the update')
        }
        const installationBeforeAction = this.getInstallation()
        if (installationBeforeAction.reason === 'machine-configuration-mismatch') {
          throw new Error(
            'The machine-managed ORBIT background service must be repaired by an administrator'
          )
        }
        if (action === 'install') {
          await clearBackgroundAgentSuspension(this.userDataPath)
          this.writeLoginItem(true)
          this.assertInstalled()
          await this.startAgent(revision, true)
        } else if (action === 'repair') {
          await suspendBackgroundAgent(this.userDataPath, { recoverAgent: false })
          try {
            this.writeLoginItem(false)
          } catch (error) {
            await clearBackgroundAgentSuspension(this.userDataPath)
            throw error
          }
          try {
            await this.stopAgent(LATE_START_STOP_GRACE_MS)
          } finally {
            // A failed stop must never turn Repair into an accidental removal.
            try {
              this.writeLoginItem(true)
              this.assertInstalled()
            } finally {
              await clearBackgroundAgentSuspension(this.userDataPath)
            }
          }
          await this.startAgent(revision, true)
        } else if (action === 'restart') {
          const before = await this.tryProbeAgent()
          const suspension = await suspendBackgroundAgent(this.userDataPath, {
            recoverAgent: true
          })
          if (
            !(await scheduleBackgroundAgentRecovery({
              markerPath: backgroundAgentSuspensionPath(this.userDataPath),
              executablePath: process.execPath,
              developmentAppPath: app.isPackaged ? undefined : app.getAppPath(),
              transactionId: suspension.transactionId
            }))
          ) {
            await clearBackgroundAgentSuspension(this.userDataPath)
            throw new Error('ORBIT background service restart recovery could not be armed')
          }
          try {
            await this.stopAgent()
          } finally {
            // Releasing the marker wakes the independent recovery host even if
            // this foreground process disappears before the direct start.
            await clearBackgroundAgentSuspension(this.userDataPath)
          }
          const after = await this.startAgent(revision, true)
          if (before && after.startedAt === before.startedAt) {
            throw new Error('ORBIT background service did not restart')
          }
        } else if (action === 'remove') {
          if (this.getInstallation().reason === 'machine-login-item') {
            throw new Error('A machine-managed ORBIT background service cannot be removed here')
          }
          await suspendBackgroundAgent(this.userDataPath, { recoverAgent: false })
          try {
            this.writeLoginItem(false)
          } catch (error) {
            await clearBackgroundAgentSuspension(this.userDataPath)
            throw error
          }
          try {
            await this.stopAgent(LATE_START_STOP_GRACE_MS)
            this.assertRemoved()
          } catch (error) {
            try {
              this.writeLoginItem(true)
              this.assertInstalled()
            } finally {
              await clearBackgroundAgentSuspension(this.userDataPath)
            }
            throw error
          }
        }
        return await this.refresh()
      } finally {
        this.manualTransition = false
      }
    })
  }

  async reloadSettings(): Promise<void> {
    try {
      const snapshot = await requestOrbitPipe<unknown>(this.pipeName, {
        command: 'reload-settings' satisfies OrbitAgentCommand
      })
      if (!isOrbitAgentSnapshot(snapshot)) {
        throw new Error('ORBIT background service returned an invalid status')
      }
    } catch {
      const installation = this.getInstallation()
      if (installation.installation === 'installed') this.queueEnsureRunning()
    }
    await this.refresh()
  }

  /** Prevent the login agent from reopening ORBIT while a detached installer
   * replaces the packaged application. Starts already in flight are cancelled
   * before the serialized stop, so a late process cannot undo the suspension. */
  prepareForAppUpdate(transactionId?: string): Promise<void> {
    this.updateSuspended = true
    const revision = this.invalidatePendingStart()
    return this.enqueueLifecycle(async () => {
      this.manualTransition = true
      try {
        const installation = this.getInstallation()
        const recoverAgent = installation.installation === 'installed'
        try {
          const suspension = await suspendBackgroundAgent(this.userDataPath, {
            transactionId,
            recoverAgent
          })
          if (
            recoverAgent &&
            !(await scheduleBackgroundAgentRecovery({
              markerPath: backgroundAgentSuspensionPath(this.userDataPath),
              executablePath: process.execPath,
              developmentAppPath: app.isPackaged ? undefined : app.getAppPath(),
              transactionId: suspension.transactionId
            }))
          ) {
            throw new Error('ORBIT background service recovery scheduler did not start')
          }
          await this.stopAgent(LATE_START_STOP_GRACE_MS)
          await this.refresh()
        } catch (error) {
          // Preparing an installer is transactional: if the independent
          // fallback cannot be armed (or stopping fails), keep the configured
          // service usable and let AppUpdateService report install-failed.
          this.updateSuspended = false
          await clearBackgroundAgentSuspension(this.userDataPath).catch(() => undefined)
          if (
            installation.installation === 'installed' &&
            !(await this.tryProbeAgent())
          ) {
            await this.startAgent(revision, true)
          }
          await this.refresh()
          throw error
        }
      } finally {
        this.manualTransition = false
      }
    })
  }

  recoverFromFailedAppUpdate(transactionId?: string): Promise<void> {
    const revision = this.invalidatePendingStart()
    return this.enqueueLifecycle(async () => {
      this.manualTransition = true
      try {
        this.updateSuspended = false
        const suspension = await readBackgroundAgentSuspension(this.userDataPath)
        if (transactionId && suspension?.transactionId === transactionId) {
          await clearBackgroundAgentSuspension(this.userDataPath)
        }
        const installation = this.getInstallation()
        if (
          installation.installation === 'installed' &&
          !this.startupReconciliationPending &&
          !(await isBackgroundAgentSuspended(this.userDataPath))
        ) {
          await this.startAgent(revision, true)
        }
        await this.refresh()
      } finally {
        this.manualTransition = false
      }
    })
  }

  private async initialize(startupReconciliation: Promise<void>): Promise<void> {
    await startupReconciliation
    if (this.disposed) return
    // A marker without an updater journal can still belong to a standalone
    // uninstaller/repair helper. Never let an independently opened UI cancel
    // that transaction; its owner or bounded recovery host clears it.
    let suspensionWarningLogged = false
    while (!this.disposed && (await isBackgroundAgentSuspended(this.userDataPath))) {
      if (!suspensionWarningLogged) {
        suspensionWarningLogged = true
        console.warn('[background-service] maintenance is still active; startup is waiting')
      }
      await delay(1_000)
    }
    if (this.disposed) return
    this.startupReconciliationPending = false
    const status = await this.refresh()
    if (
      status.installation === 'repair-needed' &&
      status.reason === 'configuration-mismatch'
    ) {
      // Repair launch arguments reported for the current executable without
      // overriding a login item that the user explicitly disabled in Windows.
      await this.control('repair')
      return
    }
    if (this.isHardwareControlEnabled() && status.installation === 'not-installed') {
      // Migrate the earlier in-process Hardware Control setting to the
      // background host required for it to remain active outside ORBIT.
      await this.control('install')
      return
    }
    if (status.installation === 'installed' && status.runtime !== 'running') {
      this.queueEnsureRunning()
    }
  }

  private enqueueLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.lifecycleQueue.then(operation, operation)
    this.lifecycleQueue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  private invalidatePendingStart(): number {
    this.lifecycleRevision += 1
    this.startAbort?.abort()
    return this.lifecycleRevision
  }

  private loginItemArguments(): string[] {
    return orbitBackgroundServiceLoginItemArguments(
      app.isPackaged ? undefined : app.getAppPath()
    )
  }

  private writeLoginItem(openAtLogin: boolean): void {
    app.setLoginItemSettings({
      openAtLogin,
      enabled: openAtLogin,
      name: ORBIT_BACKGROUND_SERVICE_LOGIN_ITEM_NAME,
      path: process.execPath,
      args: this.loginItemArguments()
    })
  }

  private getInstallation(): Pick<OrbitBackgroundServiceStatus, 'installation' | 'reason'> {
    if (!isBackgroundServiceSupported()) {
      return {
        installation: 'unsupported',
        reason: process.platform === 'win32' ? 'unsupported-package' : 'unsupported-platform'
      }
    }

    return getOrbitBackgroundServiceLoginItemInstallation(
      app,
      process.execPath,
      app.isPackaged ? undefined : app.getAppPath()
    )
  }

  private assertInstalled(): void {
    const installation = this.getInstallation()
    if (installation.installation !== 'installed') {
      throw new Error('ORBIT background service login item could not be enabled')
    }
  }

  private assertRemoved(): void {
    const installation = this.getInstallation()
    if (installation.installation !== 'not-installed') {
      throw new Error('ORBIT background service login item could not be removed')
    }
  }

  private async probeAgent(): Promise<OrbitAgentSnapshot> {
    const snapshot = await requestOrbitPipe<unknown>(this.pipeName, {
      command: 'status' satisfies OrbitAgentCommand
    })
    if (!isOrbitAgentSnapshot(snapshot)) {
      throw new Error('Unsupported or invalid ORBIT background service protocol')
    }
    if (!this.isCompatibleAgent(snapshot)) {
      throw new Error('A stale ORBIT background service is still running')
    }
    return snapshot
  }

  private async inspectAgent(): Promise<{
    reachable: boolean
    snapshot?: OrbitAgentSnapshot
  }> {
    try {
      const snapshot = await requestOrbitPipe<unknown>(this.pipeName, {
        command: 'status' satisfies OrbitAgentCommand
      })
      return {
        reachable: true,
        snapshot: isOrbitAgentSnapshot(snapshot) ? snapshot : undefined
      }
    } catch {
      return { reachable: false }
    }
  }

  private isCompatibleAgent(snapshot: OrbitAgentSnapshot): boolean {
    return (
      snapshot.appVersion === app.getVersion() &&
      this.isCurrentAgentExecutable(snapshot)
    )
  }

  private isCurrentAgentExecutable(snapshot: OrbitAgentSnapshot): boolean {
    return (
      normalizedWindowsPath(snapshot.executablePath) === normalizedWindowsPath(process.execPath)
    )
  }

  private async tryProbeAgent(): Promise<OrbitAgentSnapshot | undefined> {
    try {
      return await this.probeAgent()
    } catch {
      return undefined
    }
  }

  private async probeAgentWithRetry(): Promise<OrbitAgentSnapshot> {
    try {
      return await this.probeAgent()
    } catch {
      await delay(150)
      return this.probeAgent()
    }
  }

  private noteAgentRunning(snapshot: OrbitAgentSnapshot): void {
    this.lastObservedAgentStartedAt = snapshot.startedAt
    if (Date.now() - snapshot.startedAt < BACKGROUND_AGENT_STABLE_MS) return
    this.consecutiveStartFailures = 0
    this.nextAutomaticStartAt = 0
  }

  private noteAgentUnavailable(
    installation: OrbitBackgroundServiceStatus['installation']
  ): void {
    const startedAt = this.lastObservedAgentStartedAt
    if (
      this.manualTransition ||
      this.startupReconciliationPending ||
      this.updateSuspended ||
      installation !== 'installed' ||
      startedAt === undefined ||
      this.lastAccountedAgentStartedAt === startedAt
    ) {
      return
    }
    this.lastAccountedAgentStartedAt = startedAt
    const restartDelay = backgroundAgentRestartDelayMs(this.consecutiveStartFailures)
    this.consecutiveStartFailures += 1
    this.nextAutomaticStartAt = Math.max(this.nextAutomaticStartAt, Date.now() + restartDelay)
  }

  private launchAgentProcess(): Promise<ChildProcess> {
    return new Promise((resolve, reject) => {
      let child: ChildProcess
      try {
        child = spawn(process.execPath, this.loginItemArguments(), {
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        })
      } catch (error) {
        reject(error)
        return
      }

      this.spawnedAgent = child
      let launched = false
      child.once('spawn', () => {
        launched = true
        child.unref()
        resolve(child)
      })
      child.once('error', (error) => {
        if (this.spawnedAgent === child) this.spawnedAgent = null
        if (!launched) {
          reject(error)
          return
        }
        console.warn('[background-service] agent process error:', error.message)
      })
      child.once('exit', (code, signal) => {
        if (this.spawnedAgent === child) this.spawnedAgent = null
        if (this.disposed) return
        console.warn(
          `[background-service] agent exited (code ${code ?? 'none'}, signal ${signal ?? 'none'})`
        )
        void this.refresh().catch(() => undefined)
      })
    })
  }

  private async startAgent(revision: number, force: boolean): Promise<OrbitAgentSnapshot> {
    if (!force && Date.now() < this.nextAutomaticStartAt) {
      throw new Error('ORBIT background service restart is cooling down')
    }
    if (force) this.nextAutomaticStartAt = 0

    const controller = new AbortController()
    this.startAbort = controller
    try {
      const snapshot = await this.performStartAgent(revision, controller.signal)
      this.noteAgentRunning(snapshot)
      return snapshot
    } catch (error) {
      if (error instanceof BackgroundAgentStartCancelledError) throw error
      const restartDelay = backgroundAgentRestartDelayMs(this.consecutiveStartFailures)
      this.consecutiveStartFailures += 1
      this.nextAutomaticStartAt = Date.now() + restartDelay
      throw error
    } finally {
      if (this.startAbort === controller) this.startAbort = null
      this.startingUntil = 0
    }
  }

  private async performStartAgent(
    revision: number,
    signal: AbortSignal
  ): Promise<OrbitAgentSnapshot> {
    this.assertStartAllowed(revision, signal)
    if (await isBackgroundAgentSuspended(this.userDataPath)) {
      throw new BackgroundAgentStartCancelledError()
    }
    this.assertStartAllowed(revision, signal)
    const existing = await this.inspectAgent()
    this.assertStartAllowed(revision, signal)
    if (existing.snapshot && this.isCompatibleAgent(existing.snapshot)) return existing.snapshot
    if (existing.reachable) {
      await this.stopAgent()
      this.assertStartAllowed(revision, signal)
    }

    this.assertInstalled()
    const installation = this.getInstallation()
    this.startingUntil = Date.now() + START_TIMEOUT_MS
    this.setStatus({
      ...this.status,
      ...installation,
      runtime: 'starting',
      hardwareControl: stoppedHardwareStatus(this.isHardwareControlEnabled()),
      reason: installation.reason
    })

    const child = await this.launchAgentProcess()
    if (!this.isStartAllowed(revision, signal)) {
      if (this.spawnedAgent === child && child.exitCode === null && !child.killed) child.kill()
      throw new BackgroundAgentStartCancelledError()
    }

    while (Date.now() < this.startingUntil) {
      await delay(200, signal)
      if (!this.isStartAllowed(revision, signal)) {
        if (this.spawnedAgent === child && child.exitCode === null && !child.killed) child.kill()
        throw new BackgroundAgentStartCancelledError()
      }
      const snapshot = await this.tryProbeAgent()
      if (snapshot) return snapshot
      if (child.exitCode !== null || child.signalCode !== null) break
    }

    if (this.spawnedAgent === child && child.exitCode === null && !child.killed) child.kill()
    throw new Error('ORBIT background service did not become reachable in time')
  }

  private isStartAllowed(revision: number, signal: AbortSignal): boolean {
    return (
      revision === this.lifecycleRevision &&
      !signal.aborted &&
      !this.startupReconciliationPending &&
      !this.updateSuspended
    )
  }

  private assertStartAllowed(revision: number, signal: AbortSignal): void {
    if (!this.isStartAllowed(revision, signal)) {
      throw new BackgroundAgentStartCancelledError()
    }
  }

  private async stopAgent(lateStartGraceMs = FORCE_STOP_GRACE_MS): Promise<void> {
    const ownedChild = this.spawnedAgent
    const firstInspection = await this.inspectAgent()
    let observedProcessId =
      firstInspection.snapshot && this.isCurrentAgentExecutable(firstInspection.snapshot)
        ? firstInspection.snapshot.processId
        : undefined
    let observedProcessStartedAt =
      firstInspection.snapshot && this.isCurrentAgentExecutable(firstInspection.snapshot)
        ? firstInspection.snapshot.startedAt
        : undefined
    const recordShutdownIdentity = (value: unknown): void => {
      if (!isOrbitAgentSnapshot(value) || !this.isCurrentAgentExecutable(value)) return
      observedProcessId = value.processId
      observedProcessStartedAt = value.startedAt
    }
    let shutdownRequested = false
    try {
      const shutdownSnapshot = await requestOrbitPipe<unknown>(this.pipeName, {
        command: 'shutdown' satisfies OrbitAgentCommand
      })
      recordShutdownIdentity(shutdownSnapshot)
      shutdownRequested = true
    } catch {
      if (ownedChild && ownedChild.exitCode === null && !ownedChild.killed) ownedChild.kill()
    }

    let unreachableConfirmations = 0
    const observationStartedAt = Date.now()
    let deadline = Date.now() + (shutdownRequested ? STOP_TIMEOUT_MS : lateStartGraceMs)
    while (Date.now() < deadline) {
      const inspection = await this.inspectAgent()
      if (!inspection.reachable) {
        unreachableConfirmations += 1
        const observedProcessStopped =
          observedProcessId === undefined || !isProcessAlive(observedProcessId)
        const ownedProcessStopped = !isChildProcessAlive(ownedChild)
        const observedLongEnough =
          shutdownRequested ||
          Date.now() - observationStartedAt >= lateStartGraceMs
        if (
          unreachableConfirmations >= STOP_CONFIRMATION_COUNT &&
          observedProcessStopped &&
          ownedProcessStopped &&
          observedLongEnough
        ) {
          return
        }
        await delay(100)
        continue
      }
      unreachableConfirmations = 0
      if (inspection.snapshot && this.isCurrentAgentExecutable(inspection.snapshot)) {
        observedProcessId = inspection.snapshot.processId
        observedProcessStartedAt = inspection.snapshot.startedAt
      }
      if (!shutdownRequested) {
        try {
          const shutdownSnapshot = await requestOrbitPipe<unknown>(this.pipeName, {
            command: 'shutdown' satisfies OrbitAgentCommand
          })
          recordShutdownIdentity(shutdownSnapshot)
          shutdownRequested = true
          deadline = Date.now() + STOP_TIMEOUT_MS
          continue
        } catch {
          // The late-starting process may still be binding its command pipe.
        }
      }
      await delay(100)
    }

    for (let confirmation = 0; confirmation < STOP_CONFIRMATION_COUNT; confirmation += 1) {
      const inspection = await this.inspectAgent()
      if (inspection.reachable) {
        if (inspection.snapshot && this.isCurrentAgentExecutable(inspection.snapshot)) {
          observedProcessId = inspection.snapshot.processId
          observedProcessStartedAt = inspection.snapshot.startedAt
        }
        break
      }
      if (
        confirmation === STOP_CONFIRMATION_COUNT - 1 &&
        (observedProcessId === undefined || !isProcessAlive(observedProcessId)) &&
        !isChildProcessAlive(ownedChild)
      ) {
        return
      }
      await delay(100)
    }

    if (ownedChild && ownedChild.exitCode === null && !ownedChild.killed) {
      ownedChild.kill()
    }
    if (ownedChild?.pid && isChildProcessAlive(ownedChild)) {
      try {
        process.kill(ownedChild.pid)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
      }
    }
    if (
      observedProcessId !== undefined &&
      observedProcessStartedAt !== undefined &&
      isProcessAlive(observedProcessId)
    ) {
      await terminateWindowsProcessIfIdentityMatches(observedProcessId, {
        executablePath: process.execPath,
        requiredArgument: ORBIT_AGENT_ARGUMENT,
        startedAt: observedProcessStartedAt
      })
    }

    const forceDeadline = Date.now() + FORCE_STOP_GRACE_MS
    let finalUnreachableConfirmations = 0
    while (Date.now() < forceDeadline) {
      const inspection = await this.inspectAgent()
      if (!inspection.reachable) {
        finalUnreachableConfirmations += 1
        if (
          finalUnreachableConfirmations >= STOP_CONFIRMATION_COUNT &&
          (observedProcessId === undefined || !isProcessAlive(observedProcessId)) &&
          !isChildProcessAlive(ownedChild)
        ) {
          return
        }
      } else {
        finalUnreachableConfirmations = 0
      }
      await delay(100)
    }
    if (
      (await this.inspectAgent()).reachable ||
      (observedProcessId !== undefined && isProcessAlive(observedProcessId)) ||
      isChildProcessAlive(ownedChild)
    ) {
      throw new Error('ORBIT background service did not stop')
    }
  }

  private queueEnsureRunning(): void {
    if (
      this.disposed ||
      this.manualTransition ||
      this.startupReconciliationPending ||
      this.updateSuspended ||
      this.ensureRunningQueued ||
      Date.now() < this.nextAutomaticStartAt
    ) {
      return
    }
    const revision = this.lifecycleRevision
    this.ensureRunningQueued = true
    void this.enqueueLifecycle(async () => {
      try {
        if (
          revision !== this.lifecycleRevision ||
          this.manualTransition ||
          this.startupReconciliationPending ||
          this.updateSuspended ||
          this.getInstallation().installation !== 'installed'
        ) {
          return
        }
        await this.startAgent(revision, false)
      } catch (error) {
        if (!(error instanceof BackgroundAgentStartCancelledError)) {
          console.warn(
            '[background-service] automatic restart failed:',
            error instanceof Error ? error.message : error
          )
        }
      } finally {
        this.ensureRunningQueued = false
      }
    })
  }

  private queueEnsureStopped(): void {
    if (this.disposed || this.manualTransition || this.ensureStoppedQueued) return
    const revision = this.lifecycleRevision
    this.ensureStoppedQueued = true
    void this.enqueueLifecycle(async () => {
      try {
        if (revision !== this.lifecycleRevision || this.manualTransition) return
        const installation = this.getInstallation()
        if (
          !this.startupReconciliationPending &&
          !this.updateSuspended &&
          installation.installation === 'installed'
        ) {
          return
        }
        await this.stopAgent()
      } catch (error) {
        console.warn(
          '[background-service] stray agent stop failed:',
          error instanceof Error ? error.message : error
        )
      } finally {
        this.ensureStoppedQueued = false
      }
    })
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
      const agent = await this.probeAgentWithRetry()
      this.noteAgentRunning(agent)
      next = {
        ...installation,
        runtime: 'running',
        hardwareControl: agent.hardwareControl,
        lastActivationAt: agent.lastActivationAt,
        lastActivationResult: agent.lastActivationResult
      }
    } catch {
      this.noteAgentUnavailable(installation.installation)
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

    if (!this.disposed && !this.manualTransition) {
      if (
        !this.updateSuspended &&
        next.installation === 'installed' &&
        next.runtime === 'stopped'
      ) {
        this.queueEnsureRunning()
      } else if (
        next.runtime === 'running' &&
        (this.startupReconciliationPending ||
          this.updateSuspended ||
          next.installation !== 'installed')
      ) {
        this.queueEnsureStopped()
      }
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
