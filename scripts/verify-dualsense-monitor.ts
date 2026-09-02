import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createDualSenseMediaMonitorScript,
  createDualSenseMonitorScript
} from '../src/main/dualsenseMonitor.ts'
import {
  combineMediaInputMasks,
  MediaControllerBridge
} from '../src/main/mediaControllerBridge.ts'

const testDirectory = mkdtempSync(join(tmpdir(), 'orbit-dualsense-monitor-'))

function runMonitor(envName: string, script: string): { stdout: string; stderr: string } {
  const scriptPath = join(testDirectory, `${envName}.ps1`)
  writeFileSync(scriptPath, script, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath
    ],
    {
      encoding: 'utf8',
      timeout: 15_000,
      env: { ...process.env, [envName]: '1' }
    }
  )

  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return { stdout: result.stdout, stderr: result.stderr }
}

try {
  const hardwareScript = createDualSenseMonitorScript(1_000)
  const parser = runMonitor('ORBIT_HARDWARE_MONITOR_SELF_TEST', hardwareScript)
  assert.match(parser.stdout, /self-test:ok/)

  const rawInput = runMonitor('ORBIT_HARDWARE_MONITOR_PROBE', hardwareScript)
  assert.match(rawInput.stdout, /ready/)
  const connectedControllers = rawInput.stdout.match(/controllers:(\d+)/)
  assert.ok(connectedControllers)
  assert.equal(rawInput.stderr.trim(), '')

  const mediaScript = createDualSenseMediaMonitorScript()
  const mediaParser = runMonitor('ORBIT_DUALSENSE_MEDIA_SELF_TEST', mediaScript)
  assert.match(mediaParser.stdout, /media-self-test:ok/)

  const mediaRawInput = runMonitor('ORBIT_DUALSENSE_MEDIA_PROBE', mediaScript)
  assert.match(mediaRawInput.stdout, /ready/)
  assert.match(mediaRawInput.stdout, /mask:0/)
  assert.match(mediaRawInput.stdout, /controllers:\d+/)
  assert.equal(mediaRawInput.stderr.trim(), '')

  assert.equal(combineMediaInputMasks(0x1000, 0x0008, 0x1000), 0x1008)
  const bridge = new MediaControllerBridge()
  let temporaryScript = ''
  try {
    const bridgeReady = await bridge.start({
      direction: () => undefined,
      confirm: () => undefined,
      back: () => undefined,
      backHold: () => undefined,
      playPause: () => undefined,
      search: () => undefined,
      history: () => undefined
    })
    const diagnostics = bridge as unknown as {
      xinputChild: unknown
      dualSenseChild: unknown
      dualSenseScriptPath: string | null
    }
    assert.equal(bridgeReady, true)
    assert.ok(diagnostics.xinputChild)
    assert.ok(diagnostics.dualSenseChild)
    assert.ok(diagnostics.dualSenseScriptPath)
    temporaryScript = diagnostics.dualSenseScriptPath ?? ''
    assert.equal(existsSync(temporaryScript), true)
  } finally {
    bridge.dispose()
  }
  await new Promise((resolve) => setTimeout(resolve, 250))
  assert.equal(existsSync(temporaryScript), false)

  console.log(
    `DualSense hardware and media Raw Input checks passed (${connectedControllers[1]} connected controller${connectedControllers[1] === '1' ? '' : 's'})`
  )
} finally {
  rmSync(testDirectory, { recursive: true, force: true })
}
