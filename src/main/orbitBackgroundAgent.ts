import { spawn } from 'node:child_process'
import { app } from 'electron'
import { HardwareControlWatcher } from './hardwareControl'
import { settingsStore } from './settingsStore'
import {
  closePipeServer,
  createOrbitPipeServer,
  orbitServicePipeNames,
  requestOrbitPipe,
  type OrbitAgentCommand,
  type OrbitAgentSnapshot,
  type OrbitAppCommand
} from './orbitServiceProtocol'

const startedAt = Date.now()
const SHOW_RETRY_INTERVAL_MS = 250
const SHOW_TIMEOUT_MS = 12_000

function launchOrbitUi(): void {
  const args = app.isPackaged ? [] : [app.getAppPath()]
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  })
  child.unref()
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export async function startOrbitBackgroundAgent(): Promise<void> {
  const pipeNames = orbitServicePipeNames(app.getPath('userData'))
  const watcher = new HardwareControlWatcher(settingsStore.store)
  let revealInFlight: Promise<void> | null = null
  let shuttingDown = false
  let lastActivationAt: number | undefined
  let lastActivationResult: OrbitAgentSnapshot['lastActivationResult']

  const snapshot = (): OrbitAgentSnapshot => ({
    protocolVersion: 1,
    startedAt,
    hardwareControl: watcher.getStatus(),
    lastActivationAt,
    lastActivationResult
  })

  const revealOrbit = async (): Promise<void> => {
    if (revealInFlight) return revealInFlight
    revealInFlight = (async () => {
      try {
        const focused = await requestOrbitPipe<boolean>(
          pipeNames.app,
          { command: 'show' satisfies OrbitAppCommand },
          6_000
        )
        lastActivationAt = Date.now()
        lastActivationResult = focused ? 'focused' : 'failed'
        return
      } catch {
        launchOrbitUi()
      }

      const deadline = Date.now() + SHOW_TIMEOUT_MS
      while (Date.now() < deadline) {
        await delay(SHOW_RETRY_INTERVAL_MS)
        try {
          const focused = await requestOrbitPipe<boolean>(
            pipeNames.app,
            { command: 'show' satisfies OrbitAppCommand },
            6_000
          )
          lastActivationAt = Date.now()
          lastActivationResult = focused ? 'launched' : 'failed'
          return
        } catch {
          // ORBIT is still starting; keep the single launch attempt bounded.
        }
      }
      lastActivationAt = Date.now()
      lastActivationResult = 'failed'
    })().finally(() => {
      revealInFlight = null
    })
    return revealInFlight
  }

  watcher.on('trigger', () => void revealOrbit())
  const unsubscribeSettings = settingsStore.onDidAnyChange(() => {
    watcher.updateSettings(settingsStore.store)
  })

  const server = await createOrbitPipeServer(pipeNames.agent, async ({ command }) => {
    if (command === ('status' satisfies OrbitAgentCommand)) return snapshot()
    if (command === ('reload-settings' satisfies OrbitAgentCommand)) {
      watcher.updateSettings(settingsStore.store)
      return snapshot()
    }
    if (command === ('show-orbit' satisfies OrbitAgentCommand)) {
      await revealOrbit()
      return snapshot()
    }
    if (command === ('shutdown' satisfies OrbitAgentCommand)) {
      setTimeout(() => app.quit(), 20)
      return undefined
    }
    throw new Error('Unknown ORBIT background service command')
  })

  const dispose = (): void => {
    if (shuttingDown) return
    shuttingDown = true
    unsubscribeSettings()
    watcher.dispose()
    void closePipeServer(server)
  }
  app.once('before-quit', dispose)
}
