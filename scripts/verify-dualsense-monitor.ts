import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createDualSenseMonitorScript } from '../src/main/dualsenseMonitor.ts'

function runMonitor(envName: string): { stdout: string; stderr: string } {
  const script = createDualSenseMonitorScript(1_000)
  const result = spawnSync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-'],
    {
      encoding: 'utf8',
      timeout: 15_000,
      input: script,
      env: { ...process.env, [envName]: '1' }
    }
  )

  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return { stdout: result.stdout, stderr: result.stderr }
}

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
