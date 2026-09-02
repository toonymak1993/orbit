import { spawn, type ChildProcess } from 'node:child_process'
import type { Server } from 'node:net'
import { app, powerMonitor } from 'electron'
import { HardwareControlWatcher } from './hardwareControl'
import {
  backgroundAgentSuspensionPath,
  isBackgroundAgentSuspended
} from './orbitBackgroundServiceSuspension'
import { scheduleBackgroundAgentRecovery } from './orbitBackgroundServiceRecovery'
import { getOrbitBackgroundServiceLoginItemInstallation } from './orbitBackgroundServiceLoginItem'
import { backgroundAgentRestartDelayMs } from './orbitBackgroundServicePolicy'
import {
  acknowledgeBackgroundServiceWatchdogReplacement,
  consumeBackgroundServiceWatchdogReplacementAck,
  startBackgroundServiceWatchdog,
  type BackgroundServiceWatchdogHandle
} from './orbitBackgroundServiceWatchdog'
import { settingsStore } from './settingsStore'
import {
  closePipeServer,
  createOrbitPipeServer,
  orbitServicePipeNames,
  requestOrbitPipe,
  isOrbitAgentSnapshot,
  type OrbitAgentCommand,
  type OrbitAgentSnapshot,
  type OrbitAppCommand
} from './orbitServiceProtocol'

const startedAt = Date.now()
const SHOW_RETRY_INTERVAL_MS = 250
const SHOW_TIMEOUT_MS = 12_000
const SHOW_REQUEST_TIMEOUT_MS = 3_000
const RECOVERY_DEBOUNCE_MS = 2_000

function scheduleAfterMaintenance(userDataPath: string): Promise<boolean> {
  return scheduleBackgroundAgentRecovery({
    markerPath: backgroundAgentSuspensionPath(userDataPath),
    executablePath: process.execPath,
    developmentAppPath: app.isPackaged ? undefined : app.getAppPath()
  })
}

async function launchOrbitUi(isLaunchAllowed: () => Promise<boolean>): Promise<boolean> {
  if (!(await isLaunchAllowed())) return false
  return new Promise((resolve) => {
    const args = app.isPackaged ? [] : [app.getAppPath()]
    let child: ChildProcess
    try {
      child = spawn(process.execPath, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      })
    } catch (error) {
      console.warn(
        '[background-service] ORBIT UI process could not be launched:',
        error instanceof Error ? error.message : error
      )
      resolve(false)
      return
    }

    let launched = false
    child.once('spawn', () => {
      launched = true
      child.unref()
      resolve(true)
    })
    child.once('error', (error) => {
      console.warn('[background-service] ORBIT UI process error:', error.message)
      if (!launched) resolve(false)
    })
  })
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function waitForRetryOrSuspension(
  milliseconds: number,
  userDataPath: string
): Promise<boolean> {
  const deadline = Date.now() + milliseconds
  while (Date.now() < deadline) {
    if (await isBackgroundAgentSuspended(userDataPath)) return true
    await delay(Math.min(250, Math.max(1, deadline - Date.now())))
  }
  return isBackgroundAgentSuspended(userDataPath)
}

export async function startOrbitBackgroundAgent(): Promise<void> {
  const userDataPath = app.getPath('userData')
  // Consume this capability before starting any child process so only this
  // exact replacement generation can acknowledge its predecessor.
  const replacementAck = consumeBackgroundServiceWatchdogReplacementAck(userDataPath)
  const developmentAppPath = app.isPackaged ? undefined : app.getAppPath()
  const inspectAgentConfiguration = (): 'installed' | 'disabled' | 'unavailable' => {
    if (process.platform !== 'win32' || process.windowsStore) return 'disabled'
    try {
      return (
        getOrbitBackgroundServiceLoginItemInstallation(
          app,
          process.execPath,
          developmentAppPath
        ).installation === 'installed'
          ? 'installed'
          : 'disabled'
      )
    } catch {
      return 'unavailable'
    }
  }
  const waitForAgentConfiguration = async (): Promise<
    'installed' | 'disabled' | 'suspended'
  > => {
    let attempt = 0
    while (true) {
      if (await isBackgroundAgentSuspended(userDataPath)) return 'suspended'
      const configuration = inspectAgentConfiguration()
      if (configuration !== 'unavailable') return configuration
      console.warn('[background-service] login-item state is temporarily unavailable; retrying')
      if (await waitForRetryOrSuspension(backgroundAgentRestartDelayMs(attempt++), userDataPath)) {
        return 'suspended'
      }
    }
  }
  const initialConfiguration = await waitForAgentConfiguration()
  if (initialConfiguration !== 'installed') {
    if (initialConfiguration === 'suspended') await scheduleAfterMaintenance(userDataPath)
    app.quit()
    return
  }

  const pipeNames = orbitServicePipeNames(userDataPath)
  let watcher: HardwareControlWatcher | null = null
  let watchdog: BackgroundServiceWatchdogHandle | undefined
  let revealInFlight: Promise<void> | null = null
  let shuttingDown = false
  let shutdownScheduled = false
  let acceptingCommands = false
  let shutdownInFlight: Promise<void> | null = null
  let server: Server | null = null
  let unsubscribeSettings = (): void => undefined
  let powerListenersAttached = false
  let lastActivationAt: number | undefined
  let lastActivationResult: OrbitAgentSnapshot['lastActivationResult']

  const snapshot = (): OrbitAgentSnapshot => ({
    protocolVersion: 2,
    startedAt,
    processId: process.pid,
    appVersion: app.getVersion(),
    executablePath: process.execPath,
    hardwareControl:
      watcher?.getStatus() ??
      (settingsStore.store.hardwareControlEnabled
        ? { state: 'starting', connectedControllers: 0 }
        : { state: 'disabled', connectedControllers: 0 }),
    lastActivationAt,
    lastActivationResult
  })

  const revealOrbit = async (): Promise<void> => {
    if (revealInFlight) return revealInFlight
    revealInFlight = (async () => {
      const activationAllowed = async (): Promise<boolean> =>
        !shutdownScheduled &&
        !shuttingDown &&
        inspectAgentConfiguration() === 'installed' &&
        !(await isBackgroundAgentSuspended(userDataPath))
      if (!(await activationAllowed())) return
      let result: 'focused' | 'launched' = 'focused'
      let launchAttempted = false
      try {
        const focused = await requestOrbitPipe<boolean>(
          pipeNames.app,
          { command: 'show' satisfies OrbitAppCommand },
          SHOW_REQUEST_TIMEOUT_MS
        )
        if (focused) {
          lastActivationAt = Date.now()
          lastActivationResult = 'focused'
          return
        }
      } catch {
        launchAttempted = true
        if (!(await launchOrbitUi(activationAllowed))) {
          lastActivationAt = Date.now()
          lastActivationResult = 'failed'
          return
        }
        result = 'launched'
      }

      const deadline = Date.now() + SHOW_TIMEOUT_MS
      while (Date.now() < deadline) {
        await delay(SHOW_RETRY_INTERVAL_MS)
        if (!(await activationAllowed())) break
        try {
          const focused = await requestOrbitPipe<boolean>(
            pipeNames.app,
            { command: 'show' satisfies OrbitAppCommand },
            SHOW_REQUEST_TIMEOUT_MS
          )
          if (focused) {
            lastActivationAt = Date.now()
            lastActivationResult = result
            return
          }
        } catch {
          if (!launchAttempted) {
            launchAttempted = true
            if (!(await launchOrbitUi(activationAllowed))) break
            result = 'launched'
          }
        }
      }
      lastActivationAt = Date.now()
      lastActivationResult = 'failed'
    })().finally(() => {
      revealInFlight = null
    })
    return revealInFlight
  }

  let lastRecoveryAt = 0
  const recoverHardwareControl = (): void => {
    const now = Date.now()
    if (now - lastRecoveryAt < RECOVERY_DEBOUNCE_MS) return
    lastRecoveryAt = now
    watcher?.recover()
  }

  const releaseSubscriptions = (): void => {
    unsubscribeSettings()
    unsubscribeSettings = (): void => undefined
    if (!powerListenersAttached) return
    powerListenersAttached = false
    powerMonitor.removeListener('resume', recoverHardwareControl)
    powerMonitor.removeListener('unlock-screen', recoverHardwareControl)
  }

  const shutdownAgent = (): Promise<void> => {
    if (shutdownInFlight) return shutdownInFlight
    shutdownInFlight = (async () => {
      if (shuttingDown) return
      shuttingDown = true
      acceptingCommands = false
      releaseSubscriptions()
      try {
        await watcher?.shutdown()
      } finally {
        try {
          await watchdog?.shutdown()
        } finally {
          await closePipeServer(server)
        }
      }
    })()
    return shutdownInFlight
  }

  const scheduleGracefulShutdown = (): void => {
    if (shutdownScheduled) return
    shutdownScheduled = true
    setTimeout(() => {
      void shutdownAgent()
        .catch((error) => {
          console.warn(
            '[background-service] graceful shutdown failed:',
            error instanceof Error ? error.message : error
          )
        })
        .finally(() => app.quit())
    }, 20)
  }

  try {
    server = await createOrbitPipeServer(pipeNames.agent, async ({ command }) => {
      if (!acceptingCommands && command !== ('shutdown' satisfies OrbitAgentCommand)) {
        throw new Error('ORBIT background service is still starting')
      }
      if (command === ('status' satisfies OrbitAgentCommand)) return snapshot()
      if (command === ('reload-settings' satisfies OrbitAgentCommand)) {
        watcher?.updateSettings(settingsStore.store)
        return snapshot()
      }
      if (command === ('show-orbit' satisfies OrbitAgentCommand)) {
        await revealOrbit()
        return snapshot()
      }
      if (command === ('shutdown' satisfies OrbitAgentCommand)) {
        scheduleGracefulShutdown()
        return snapshot()
      }
      throw new Error('Unknown ORBIT background service command')
    })
  } catch (error) {
    // A manager and the prior generation's watchdog may race to restore the
    // singleton. Exit successfully only after proving the winner is healthy.
    try {
      const existing = await requestOrbitPipe<unknown>(
        pipeNames.agent,
        { command: 'status' satisfies OrbitAgentCommand },
        SHOW_REQUEST_TIMEOUT_MS
      )
      if (
        isOrbitAgentSnapshot(existing) &&
        existing.appVersion === app.getVersion() &&
        existing.executablePath.trim().replace(/^"|"$/g, '').toLowerCase() ===
          process.execPath.trim().replace(/^"|"$/g, '').toLowerCase()
      ) {
        app.quit()
        return
      }
    } catch {
      // Preserve the original singleton-bind failure for the crash backoff.
    }
    throw error
  }

  // Close the only startup gap: maintenance may begin after the first marker
  // read but before this process has made its command pipe reachable.
  const configurationAfterBind = await waitForAgentConfiguration()
  const suspendedAfterBind =
    configurationAfterBind === 'suspended' ||
    (configurationAfterBind === 'installed' &&
      (await isBackgroundAgentSuspended(userDataPath)))
  if (configurationAfterBind === 'disabled' || suspendedAfterBind) {
    await closePipeServer(server)
    if (suspendedAfterBind) await scheduleAfterMaintenance(userDataPath)
    app.quit()
    return
  }

  try {
    watcher = new HardwareControlWatcher(settingsStore.store)
    const activeWatcher = watcher
    let watchdogAttempt = 0
    while (!watchdog && !shutdownScheduled && !shuttingDown) {
      const suspended = await isBackgroundAgentSuspended(userDataPath)
      if (suspended) {
        await activeWatcher.shutdown().catch(() => undefined)
        await closePipeServer(server)
        await scheduleAfterMaintenance(userDataPath)
        app.quit()
        return
      }
      const configuration = inspectAgentConfiguration()
      if (configuration === 'unavailable') {
        await waitForRetryOrSuspension(
          backgroundAgentRestartDelayMs(watchdogAttempt++),
          userDataPath
        )
        continue
      }
      if (configuration === 'disabled') {
        await activeWatcher.shutdown().catch(() => undefined)
        await closePipeServer(server)
        app.quit()
        return
      }
      try {
        const candidate = await startBackgroundServiceWatchdog({
          userDataPath,
          developmentAppPath
        })
        if (!candidate) throw new Error('ORBIT background service watchdog is unavailable')
        if (shutdownScheduled || shuttingDown) {
          await candidate.shutdown()
          return
        }
        watchdog = candidate
      } catch (error) {
        console.warn(
          '[background-service] watchdog startup failed; retrying:',
          error instanceof Error ? error.message : error
        )
        await waitForRetryOrSuspension(
          backgroundAgentRestartDelayMs(watchdogAttempt++),
          userDataPath
        )
      }
    }
    if (!watchdog) return
    const configurationAfterWatchdog = await waitForAgentConfiguration()
    const suspendedAfterWatchdog =
      configurationAfterWatchdog === 'suspended' ||
      (configurationAfterWatchdog === 'installed' &&
        (await isBackgroundAgentSuspended(userDataPath)))
    if (configurationAfterWatchdog === 'disabled' || suspendedAfterWatchdog) {
      await watchdog.shutdown().catch(() => undefined)
      await activeWatcher.shutdown().catch(() => undefined)
      await closePipeServer(server)
      if (suspendedAfterWatchdog) await scheduleAfterMaintenance(userDataPath)
      app.quit()
      return
    }
    activeWatcher.on('trigger', () => {
      void revealOrbit().catch((error) => {
        console.warn(
          '[background-service] ORBIT activation failed:',
          error instanceof Error ? error.message : error
        )
      })
    })
    unsubscribeSettings = settingsStore.onDidAnyChange(() => {
      activeWatcher.updateSettings(settingsStore.store)
    })
  } catch (error) {
    await watcher?.shutdown().catch(() => undefined)
    await watchdog?.shutdown().catch(() => undefined)
    await closePipeServer(server)
    throw error
  }

  powerMonitor.on('resume', recoverHardwareControl)
  powerMonitor.on('unlock-screen', recoverHardwareControl)
  powerListenersAttached = true
  acceptingCommands = true

  server.once('close', () => {
    if (shuttingDown) return
    // Losing the singleton command pipe invalidates this agent generation. Exit
    // non-zero and leave the detached watchdog alive to create a clean one.
    shuttingDown = true
    acceptingCommands = false
    releaseSubscriptions()
    watcher?.dispose()
    app.exit(2)
  })

  if (replacementAck) {
    await acknowledgeBackgroundServiceWatchdogReplacement(replacementAck)
  }

  const dispose = (): void => {
    if (shuttingDown) return
    shuttingDown = true
    acceptingCommands = false
    releaseSubscriptions()
    watcher?.dispose()
    void watchdog?.shutdown()
    void closePipeServer(server)
  }
  app.once('before-quit', dispose)
}
