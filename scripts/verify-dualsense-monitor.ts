import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDualSenseMonitorScript } from '../src/main/dualsenseMonitor.ts'

const testDirectory = mkdtempSync(join(tmpdir(), 'orbit-dualsense-monitor-'))

function runMonitor(envName: string): { stdout: string; stderr: string } {
  const script = createDualSenseMonitorScript(1_000)
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
  const parser = runMonitor('ORBIT_HARDWARE_MONITOR_SELF_TEST')
  assert.match(parser.stdout, /self-test:ok/)

  const rawInput = runMonitor('ORBIT_HARDWARE_MONITOR_PROBE')
  assert.match(rawInput.stdout, /ready/)
  const connectedControllers = rawInput.stdout.match(/controllers:(\d+)/)
  assert.ok(connectedControllers)
  assert.equal(rawInput.stderr.trim(), '')

  console.log(
    `DualSense Raw Input monitor checks passed (${connectedControllers[1]} connected controller${connectedControllers[1] === '1' ? '' : 's'})`
  )
} finally {
  rmSync(testDirectory, { recursive: true, force: true })
}
