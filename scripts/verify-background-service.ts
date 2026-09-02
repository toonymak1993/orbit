import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { register } from 'node:module'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDualSenseMonitorScript } from '../src/main/dualsenseMonitor.ts'
import { createBackgroundAgentRecoveryScript } from '../src/main/orbitBackgroundServiceRecovery.ts'
import {
  BACKGROUND_SERVICE_WATCHDOG_ACK_PATH_ENV,
  BACKGROUND_SERVICE_WATCHDOG_ACK_TOKEN_ENV,
  BACKGROUND_SERVICE_WATCHDOG_REPLACEMENT_ACK_TIMEOUT_MS,
  BACKGROUND_SERVICE_WATCHDOG_RESTART_BASE_MS,
  BACKGROUND_SERVICE_WATCHDOG_RESTART_MAX_MS,
  BACKGROUND_SERVICE_WATCHDOG_STABLE_MS,
  acknowledgeBackgroundServiceWatchdogReplacement,
  backgroundServiceWatchdogRestartDelayMs,
  backgroundServiceWatchdogStatePath,
  consumeBackgroundServiceWatchdogReplacementAck,
  createBackgroundServiceWatchdogScript,
  startBackgroundServiceWatchdog,
  type BackgroundServiceWatchdogHandle
} from '../src/main/orbitBackgroundServiceWatchdog.ts'
import {
  ORBIT_BACKGROUND_SERVICE_LOGIN_ITEM_NAME,
  orbitBackgroundServiceLoginItemCommand
} from '../src/main/orbitBackgroundServiceLoginItem.ts'
import {
  BACKGROUND_AGENT_STABLE_MS,
  backgroundAgentRestartDelayMs,
  classifyWindowsLoginItem
} from '../src/main/orbitBackgroundServicePolicy.ts'
import {
  backgroundAgentSuspensionPath,
  clearBackgroundAgentSuspension,
  isBackgroundAgentSuspended,
  readBackgroundAgentSuspension,
  renewBackgroundAgentSuspension,
  suspendBackgroundAgent
} from '../src/main/orbitBackgroundServiceSuspension.ts'
import {
  ORBIT_AGENT_ARGUMENT,
  ORBIT_AGENT_SHUTDOWN_ARGUMENT,
  closePipeServer,
  createOrbitPipeServer,
  hasOrbitProcessArgument,
  isOrbitAgentSnapshot,
  requestOrbitPipe,
  type OrbitAgentSnapshot,
  type OrbitPipeRequest
} from '../src/main/orbitServiceProtocol.ts'
import {
  windowsCommandLineHasArgument,
  windowsProcessIdentity,
  windowsProcessIdentityMatches
} from '../src/main/windowsProcess.ts'

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 5_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

async function waitForValue<T>(
  probe: () => T | undefined,
  label: string,
  timeoutMs = 15_000
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = probe()
    if (value !== undefined) return value
    await delay(50)
  }
  throw new Error(`${label} timed out`)
}

function requestRawLine(pipeName: string, payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(pipeName)
    let buffer = ''
    let settled = false
    const finish = (error?: Error, value?: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      if (error) reject(error)
      else resolve(value ?? '')
    }
    const timer = setTimeout(() => finish(new Error('Raw named-pipe request timed out')), 5_000)

    socket.setEncoding('utf8')
    socket.once('connect', () => socket.write(payload))
    socket.once('error', (error) => finish(error))
    socket.once('end', () => finish(new Error('Named pipe closed without a complete response')))
    socket.on('data', (chunk: string) => {
      buffer += chunk
      const newline = buffer.indexOf('\n')
      if (newline >= 0) finish(undefined, buffer.slice(0, newline))
    })
  })
}

const expectedLoginItem = {
  name: 'ORBIT Background Service',
  path: 'C:\\Program Files\\ORBIT\\ORBIT.exe',
  args: ['orbit-background-agent']
}
const enabledLoginItem = {
  name: expectedLoginItem.name.toLowerCase(),
  path: `"${expectedLoginItem.path.toUpperCase()}"`,
  args: ['"ORBIT-BACKGROUND-AGENT"'],
  enabled: true
}

assert.deepEqual(
  classifyWindowsLoginItem(
    {
      openAtLogin: true,
      executableWillLaunchAtLogin: true,
      launchItems: [enabledLoginItem]
    },
    expectedLoginItem
  ),
  { installation: 'installed' }
)
assert.deepEqual(
  classifyWindowsLoginItem(
    {
      openAtLogin: true,
      executableWillLaunchAtLogin: true,
      launchItems: [{ ...enabledLoginItem, scope: 'machine' }]
    },
    expectedLoginItem
  ),
  { installation: 'installed', reason: 'machine-login-item' }
)
assert.deepEqual(
  classifyWindowsLoginItem(
    {
      openAtLogin: true,
      executableWillLaunchAtLogin: true,
      launchItems: [
        { ...enabledLoginItem, scope: 'user' },
        { ...enabledLoginItem, path: 'C:\\Old\\ORBIT.exe', scope: 'machine' }
      ]
    },
    expectedLoginItem
  ),
  { installation: 'repair-needed', reason: 'machine-configuration-mismatch' }
)
assert.deepEqual(
  classifyWindowsLoginItem(
    {
      openAtLogin: true,
      executableWillLaunchAtLogin: true,
      launchItems: [
        { ...enabledLoginItem, scope: 'user' },
        { ...enabledLoginItem, enabled: false, scope: 'machine' }
      ]
    },
    expectedLoginItem
  ),
  { installation: 'installed' }
)
assert.deepEqual(
  classifyWindowsLoginItem(
    {
      openAtLogin: true,
      executableWillLaunchAtLogin: true,
      launchItems: [
        { ...enabledLoginItem, enabled: false, scope: 'user' },
        { ...enabledLoginItem, scope: 'machine' }
      ]
    },
    expectedLoginItem
  ),
  { installation: 'installed', reason: 'machine-login-item' }
)
assert.deepEqual(
  classifyWindowsLoginItem(
    {
      openAtLogin: true,
      executableWillLaunchAtLogin: false,
      launchItems: [{ ...enabledLoginItem, enabled: false, scope: 'machine' }]
    },
    expectedLoginItem
  ),
  { installation: 'not-installed' }
)
assert.deepEqual(
  classifyWindowsLoginItem(
    {
      openAtLogin: true,
      executableWillLaunchAtLogin: true,
      launchItems: [
        { ...enabledLoginItem, scope: 'machine' },
        { ...enabledLoginItem, scope: 'user' }
      ]
    },
    expectedLoginItem
  ),
  { installation: 'installed', reason: 'machine-login-item' }
)
assert.deepEqual(
  classifyWindowsLoginItem(
    {
      openAtLogin: true,
      executableWillLaunchAtLogin: false,
      launchItems: [{ ...enabledLoginItem, enabled: false }]
    },
    expectedLoginItem
  ),
  { installation: 'repair-needed', reason: 'login-item-disabled' }
)
assert.deepEqual(
  classifyWindowsLoginItem(
    {
      openAtLogin: true,
      executableWillLaunchAtLogin: true,
      launchItems: [{ ...enabledLoginItem, path: 'C:\\Old\\ORBIT.exe' }]
    },
    expectedLoginItem
  ),
  { installation: 'repair-needed', reason: 'configuration-mismatch' }
)
assert.deepEqual(
  classifyWindowsLoginItem(
    { openAtLogin: false, executableWillLaunchAtLogin: false, launchItems: [] },
    expectedLoginItem
  ),
  { installation: 'not-installed' }
)
assert.deepEqual(
  classifyWindowsLoginItem(
    { openAtLogin: true, executableWillLaunchAtLogin: true, launchItems: [] },
    expectedLoginItem
  ),
  { installation: 'installed' }
)

assert.equal(backgroundAgentRestartDelayMs(-1), 1_500)
assert.equal(backgroundAgentRestartDelayMs(0), 1_500)
assert.equal(backgroundAgentRestartDelayMs(1), 3_000)
assert.equal(backgroundAgentRestartDelayMs(5), 48_000)
assert.equal(backgroundAgentRestartDelayMs(6), 60_000)
assert.equal(backgroundAgentRestartDelayMs(100), 60_000)
assert.equal(BACKGROUND_AGENT_STABLE_MS, 30_000)

assert.equal(backgroundServiceWatchdogRestartDelayMs(-1), 1_500)
assert.equal(backgroundServiceWatchdogRestartDelayMs(0), 1_500)
assert.equal(backgroundServiceWatchdogRestartDelayMs(1), 3_000)
assert.equal(backgroundServiceWatchdogRestartDelayMs(5), 48_000)
assert.equal(backgroundServiceWatchdogRestartDelayMs(6), 60_000)
assert.equal(backgroundServiceWatchdogRestartDelayMs(100), 60_000)
assert.equal(BACKGROUND_SERVICE_WATCHDOG_RESTART_BASE_MS, 1_500)
assert.equal(BACKGROUND_SERVICE_WATCHDOG_RESTART_MAX_MS, 60_000)
assert.equal(BACKGROUND_SERVICE_WATCHDOG_STABLE_MS, 30_000)
assert.equal(BACKGROUND_SERVICE_WATCHDOG_REPLACEMENT_ACK_TIMEOUT_MS, 30_000)
const watchdogScript = createBackgroundServiceWatchdogScript()
assert.match(watchdogScript, /Get-CimInstance Win32_Process/)
assert.match(watchdogScript, /CreationDate/)
assert.match(watchdogScript, /ExecutablePath/)
assert.match(watchdogScript, /Regex\]::Escape\(\$agentArgument\)/)
assert.match(watchdogScript, /ORBIT_BACKGROUND_WATCHDOG_READY/)
assert.match(watchdogScript, /lastHandledGeneration/)
assert.match(watchdogScript, /\[Threading\.Mutex\]::new/)
assert.match(watchdogScript, /\$lifetimeMs -gt \$stableMs/)
assert.match(watchdogScript, /Start-Process -FilePath \$restartExecutable/)
assert.match(watchdogScript, /-WindowStyle Hidden/)
assert.match(watchdogScript, /-PassThru -ErrorAction Stop/)
assert.match(watchdogScript, /\$acknowledged/)
assert.match(watchdogScript, /\$replacement\.ExitCode -eq 0/)
assert.match(watchdogScript, /suppressedGenerations/)
assert.match(
  watchdogScript,
  /\[IO\.File\]::Replace\(\$temporaryPath,\$statePath,\$backupPath,\$true\)/
)
assert.doesNotMatch(watchdogScript, /\[IO\.File\]::Replace\([^\n]*\$null/)
assert.match(
  watchdogScript,
  /if\(\$acknowledged\)[\s\S]*Write-WatchdogState \$nextCrashFailures \$generation[^\n]*'acknowledged'/
)
assert.doesNotMatch(watchdogScript, /Registry|StartupApproved|loginItem/i)

const recoveryScript = createBackgroundAgentRecoveryScript()
assert.match(recoveryScript, /while\(Test-Path -LiteralPath \$marker\)/)
assert.match(recoveryScript, /expiresAt/)
assert.match(recoveryScript, /transactionId/)
assert.match(recoveryScript, /recoverAgent/)
assert.match(recoveryScript, /StartupApproved/)
assert.match(recoveryScript, /OrdinalIgnoreCase/)
assert.match(recoveryScript, /Start-Process -FilePath \$executable/)
assert.match(recoveryScript, /orbit-background-agent/)
const recoverySource = readFileSync(
  new URL('../src/main/orbitBackgroundServiceRecovery.ts', import.meta.url),
  'utf8'
)
assert.match(recoverySource, /Promise<boolean>/)
assert.match(recoverySource, /ORBIT_RECOVERY_READY/)
assert.match(recoverySource, /stdio: \['ignore', 'pipe', 'ignore'\]/)
assert.match(recoverySource, /ORBIT_RECOVERY_TRANSACTION_B64/)
assert.match(recoverySource, /ORBIT_RECOVERY_LOGIN_COMMAND_B64/)
if (process.platform === 'win32') {
  const encodeProbeValue = (value: string): string =>
    Buffer.from(value, 'utf8').toString('base64')
  const powershellPath = join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  )
  const recoveryProbeDirectory = mkdtempSync(join(tmpdir(), 'orbit-recovery-probe-'))
  const recoveryProbeMarker = join(recoveryProbeDirectory, 'suspension.json')
  const recoveryProbeTransaction = randomUUID()
  const runRecoveryProbe = (markerPath: string, transactionId: string) =>
    spawnSync(
      powershellPath,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', recoveryScript],
      {
        encoding: 'utf8',
        timeout: 5_000,
        windowsHide: true,
        env: {
          ...process.env,
          ORBIT_RECOVERY_MARKER_B64: encodeProbeValue(markerPath),
          ORBIT_RECOVERY_EXECUTABLE_B64: encodeProbeValue(
            join(recoveryProbeDirectory, 'missing.exe')
          ),
          ORBIT_RECOVERY_TRANSACTION_B64: encodeProbeValue(transactionId),
          ORBIT_RECOVERY_LOGIN_NAME_B64: encodeProbeValue(`ORBIT Probe ${randomUUID()}`),
          ORBIT_RECOVERY_LOGIN_COMMAND_B64: encodeProbeValue('missing.exe orbit-probe'),
          ORBIT_RECOVERY_APP_B64: ''
        }
      }
    )
  try {
    writeFileSync(
      recoveryProbeMarker,
      JSON.stringify({
        transactionId: recoveryProbeTransaction,
        recoverAgent: true,
        expiresAt: Date.now() - 1
      }),
      'utf8'
    )
    const authorizedProbe = runRecoveryProbe(
      recoveryProbeMarker,
      recoveryProbeTransaction
    )
    assert.ifError(authorizedProbe.error)
    assert.equal(authorizedProbe.status, 0, authorizedProbe.stderr)
    assert.match(authorizedProbe.stdout, /ORBIT_RECOVERY_READY/)

    writeFileSync(
      recoveryProbeMarker,
      JSON.stringify({
        transactionId: randomUUID(),
        recoverAgent: true,
        expiresAt: Date.now() + 60_000
      }),
      'utf8'
    )
    const mismatchedProbe = runRecoveryProbe(
      recoveryProbeMarker,
      recoveryProbeTransaction
    )
    assert.ifError(mismatchedProbe.error)
    assert.equal(mismatchedProbe.status, 0, mismatchedProbe.stderr)
    assert.doesNotMatch(mismatchedProbe.stdout, /ORBIT_RECOVERY_READY/)

    rmSync(recoveryProbeMarker, { force: true })
    const missingProbe = runRecoveryProbe(recoveryProbeMarker, recoveryProbeTransaction)
    assert.ifError(missingProbe.error)
    assert.equal(missingProbe.status, 0, missingProbe.stderr)
    assert.doesNotMatch(missingProbe.stdout, /ORBIT_RECOVERY_READY/)
  } finally {
    rmSync(recoveryProbeDirectory, { force: true, recursive: true })
  }
}
assert.equal(ORBIT_BACKGROUND_SERVICE_LOGIN_ITEM_NAME, 'ORBIT Background Service')
assert.equal(
  orbitBackgroundServiceLoginItemCommand(
    'C:\\Program Files\\ORBIT\\ORBIT.exe'
  ),
  '"C:\\Program Files\\ORBIT\\ORBIT.exe" orbit-background-agent'
)
const managerSource = readFileSync(
  new URL('../src/main/orbitBackgroundServiceManager.ts', import.meta.url),
  'utf8'
)
assert.match(managerSource, /recoverAgent = installation\.installation === 'installed'/)
assert.match(managerSource, /!\(await scheduleBackgroundAgentRecovery/)
const indexSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
assert.match(indexSource, /installation\.installation === 'installed'/)
assert.match(indexSource, /await scheduleBackgroundAgentRecovery/)
const backgroundAgentSource = readFileSync(
  new URL('../src/main/orbitBackgroundAgent.ts', import.meta.url),
  'utf8'
)
const consumeReplacementAck = backgroundAgentSource.indexOf(
  'consumeBackgroundServiceWatchdogReplacementAck'
)
const bindAgentPipe = backgroundAgentSource.indexOf('createOrbitPipeServer')
const startAgentWatchdog = backgroundAgentSource.indexOf('await startBackgroundServiceWatchdog')
const acknowledgeReplacement = backgroundAgentSource.indexOf(
  'await acknowledgeBackgroundServiceWatchdogReplacement'
)
assert.ok(
  consumeReplacementAck >= 0 &&
    bindAgentPipe > consumeReplacementAck &&
    startAgentWatchdog > bindAgentPipe &&
    acknowledgeReplacement > startAgentWatchdog
)
assert.match(backgroundAgentSource, /'installed' \| 'disabled' \| 'unavailable'/)
assert.match(backgroundAgentSource, /isBackgroundAgentSuspended\(userDataPath\)/)
assert.match(backgroundAgentSource, /shutdownScheduled \|\| shuttingDown/)

const suspensionDirectory = mkdtempSync(join(tmpdir(), 'orbit-background-suspension-'))
try {
  assert.equal(await isBackgroundAgentSuspended(suspensionDirectory), false)
  const recoverableSuspension = await suspendBackgroundAgent(suspensionDirectory, {
    transactionId: 'update-a',
    recoverAgent: true
  })
  assert.equal(recoverableSuspension.transactionId, 'update-a')
  assert.equal(recoverableSuspension.recoverAgent, true)
  assert.equal(await isBackgroundAgentSuspended(suspensionDirectory), true)
  assert.equal(
    await renewBackgroundAgentSuspension(suspensionDirectory, 'update-a', 15 * 60_000),
    true
  )
  assert.equal(await renewBackgroundAgentSuspension(suspensionDirectory, 'update-b'), false)
  const extendedExpiry = (await readBackgroundAgentSuspension(suspensionDirectory))?.expiresAt
  const inheritedSuspension = await suspendBackgroundAgent(suspensionDirectory)
  assert.equal(inheritedSuspension.transactionId, 'update-a')
  assert.equal(inheritedSuspension.recoverAgent, true)
  assert.ok(extendedExpiry)
  assert.ok(inheritedSuspension.expiresAt >= extendedExpiry)
  const removalSuspension = await suspendBackgroundAgent(suspensionDirectory, {
    recoverAgent: false
  })
  assert.notEqual(removalSuspension.transactionId, 'update-a')
  assert.equal((await readBackgroundAgentSuspension(suspensionDirectory))?.recoverAgent, false)
  await clearBackgroundAgentSuspension(suspensionDirectory)
  assert.equal(await isBackgroundAgentSuspended(suspensionDirectory), false)
  writeFileSync(backgroundAgentSuspensionPath(suspensionDirectory), '{', 'utf8')
  assert.equal(await isBackgroundAgentSuspended(suspensionDirectory), true)
  await clearBackgroundAgentSuspension(suspensionDirectory)
} finally {
  rmSync(suspensionDirectory, { force: true, recursive: true })
}

assert.equal(ORBIT_AGENT_SHUTDOWN_ARGUMENT, 'orbit-background-agent-shutdown')
assert.equal(hasOrbitProcessArgument(['ORBIT-BACKGROUND-AGENT'], 'orbit-background-agent'), true)
assert.equal(
  hasOrbitProcessArgument(['"orbit-background-agent-shutdown"'], ORBIT_AGENT_SHUTDOWN_ARGUMENT),
  true
)
assert.equal(
  windowsCommandLineHasArgument(
    '"C:\\Program Files\\ORBIT\\ORBIT.exe" ORBIT-BACKGROUND-AGENT',
    ORBIT_AGENT_ARGUMENT
  ),
  true
)
assert.equal(
  windowsCommandLineHasArgument(
    '"C:\\Program Files\\ORBIT\\ORBIT.exe" orbit-background-agent-shutdown',
    ORBIT_AGENT_ARGUMENT
  ),
  false
)
const processStartedAt = Date.now()
assert.equal(
  windowsProcessIdentityMatches(
    {
      executablePath: 'C:\\PROGRAM FILES\\ORBIT\\ORBIT.EXE',
      commandLine: '"C:\\Program Files\\ORBIT\\ORBIT.exe" "orbit-background-agent"',
      startedAt: processStartedAt + 500
    },
    {
      executablePath: 'C:\\Program Files\\ORBIT\\ORBIT.exe',
      requiredArgument: ORBIT_AGENT_ARGUMENT,
      startedAt: processStartedAt
    }
  ),
  true
)
assert.equal(
  windowsProcessIdentityMatches(
    {
      executablePath: 'C:\\Program Files\\ORBIT\\ORBIT.exe',
      commandLine: '"C:\\Program Files\\ORBIT\\ORBIT.exe" orbit-background-agent',
      startedAt: processStartedAt + 60_000
    },
    {
      executablePath: 'C:\\Program Files\\ORBIT\\ORBIT.exe',
      requiredArgument: ORBIT_AGENT_ARGUMENT,
      startedAt: processStartedAt
    }
  ),
  false
)
if (process.platform === 'win32') {
  const ownIdentity = await windowsProcessIdentity(process.pid)
  assert.ok(ownIdentity)
  assert.equal(ownIdentity.executablePath.toLowerCase(), process.execPath.toLowerCase())
  assert.match(ownIdentity.commandLine, /verify-background-service/i)
  assert.ok(Math.abs(ownIdentity.startedAt - processStartedAt) < 30_000)
}

if (process.platform === 'win32') {
  const watchdogDirectory = mkdtempSync(join(tmpdir(), 'orbit-background-watchdog-'))
  const fixturePath = join(watchdogDirectory, 'agent-fixture.mjs')
  const restartSentinelPath = join(watchdogDirectory, 'restarts.log')
  const fixtureSource = [
    "import { appendFileSync,renameSync,writeFileSync } from 'node:fs'",
    `const sentinelPath=${JSON.stringify(restartSentinelPath)}`,
    `const ackPathKey=${JSON.stringify(BACKGROUND_SERVICE_WATCHDOG_ACK_PATH_ENV)}`,
    `const ackTokenKey=${JSON.stringify(BACKGROUND_SERVICE_WATCHDOG_ACK_TOKEN_ENV)}`,
    "const ackPathValue=process.env[ackPathKey],ackTokenValue=process.env[ackTokenKey];delete process.env[ackPathKey];delete process.env[ackTokenKey]",
    "if(process.argv.includes('watchdog-parent')){setInterval(()=>undefined,1000)}else{if(ackPathValue&&ackTokenValue){const ackPath=Buffer.from(ackPathValue,'base64').toString('utf8'),token=Buffer.from(ackTokenValue,'base64').toString('utf8'),temporaryPath=ackPath+'.writing';writeFileSync(temporaryPath,JSON.stringify({schemaVersion:1,token,processId:process.pid,acknowledgedAt:Date.now()}),'utf8');renameSync(temporaryPath,ackPath)}appendFileSync(sentinelPath,String(process.pid)+':'+Boolean(ackPathValue)+':'+Boolean(ackTokenValue)+'\\n','utf8');setTimeout(()=>process.exit(0),100)}"
  ].join('\n')
  writeFileSync(fixturePath, fixtureSource, 'utf8')

  const helperToken = randomUUID()
  const helperAckPath = join(
    watchdogDirectory,
    `orbit-background-service-watchdog-ack-${helperToken}.json`
  )
  process.env[BACKGROUND_SERVICE_WATCHDOG_ACK_PATH_ENV] = Buffer.from(
    helperAckPath,
    'utf8'
  ).toString('base64')
  process.env[BACKGROUND_SERVICE_WATCHDOG_ACK_TOKEN_ENV] = Buffer.from(
    helperToken,
    'utf8'
  ).toString('base64')
  const helperAck = consumeBackgroundServiceWatchdogReplacementAck(watchdogDirectory)
  assert.ok(helperAck)
  assert.deepEqual(helperAck, { path: helperAckPath, token: helperToken })
  assert.equal(process.env[BACKGROUND_SERVICE_WATCHDOG_ACK_PATH_ENV], undefined)
  assert.equal(process.env[BACKGROUND_SERVICE_WATCHDOG_ACK_TOKEN_ENV], undefined)
  await acknowledgeBackgroundServiceWatchdogReplacement(helperAck)
  const helperPayload = JSON.parse(readFileSync(helperAckPath, 'utf8')) as {
    token?: string
    processId?: number
  }
  assert.equal(helperPayload.token, helperToken)
  assert.equal(helperPayload.processId, process.pid)
  rmSync(helperAckPath, { force: true })

  const parents: ChildProcess[] = []
  const watchdogs: BackgroundServiceWatchdogHandle[] = []
  const sentinelLines = (): string[] => {
    if (!existsSync(restartSentinelPath)) return []
    return readFileSync(restartSentinelPath, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
  }
  const startFixtureParent = async (): Promise<ChildProcess> => {
    const child = spawn(
      process.execPath,
      [fixturePath, ORBIT_AGENT_ARGUMENT, 'watchdog-parent'],
      { stdio: 'ignore', windowsHide: true }
    )
    parents.push(child)
    await withTimeout(once(child, 'spawn').then(() => undefined), 'Watchdog fixture process')
    assert.ok(child.pid)
    await delay(250)
    assert.equal(child.exitCode, null, 'Watchdog fixture parent exited unexpectedly')
    assert.ok(await windowsProcessIdentity(child.pid))
    return child
  }
  const stopFixtureParent = async (child: ChildProcess): Promise<void> => {
    if (child.exitCode !== null || child.signalCode !== null) return
    const exited = once(child, 'exit').then(() => undefined)
    assert.equal(child.kill(), true)
    await withTimeout(exited, 'Watchdog fixture shutdown')
  }

  try {
    const firstParent = await startFixtureParent()
    const primaryWatchdog = await startBackgroundServiceWatchdog({
      userDataPath: watchdogDirectory,
      developmentAppPath: fixturePath,
      parentProcessId: firstParent.pid,
      attachedForVerification: true
    })
    assert.ok(primaryWatchdog)
    watchdogs.push(primaryWatchdog)
    const originalWatchdogPid = primaryWatchdog.processId
    assert.ok(originalWatchdogPid)
    assert.equal(await primaryWatchdog.restart(), true)
    assert.ok(primaryWatchdog.processId)
    assert.notEqual(primaryWatchdog.processId, originalWatchdogPid)

    // Even if two ready watchers overlap, the generation mutex/state permits
    // exactly one replacement launch after the monitored agent dies.
    const overlappingWatchdog = await startBackgroundServiceWatchdog({
      userDataPath: watchdogDirectory,
      developmentAppPath: fixturePath,
      parentProcessId: firstParent.pid,
      attachedForVerification: true
    })
    assert.ok(overlappingWatchdog)
    watchdogs.push(overlappingWatchdog)
    const firstCrashAt = Date.now()
    await stopFixtureParent(firstParent)
    await waitForValue(
      () => (sentinelLines().length >= 1 ? sentinelLines() : undefined),
      'First watchdog recovery',
      15_000
    )
    assert.ok(Date.now() - firstCrashAt >= BACKGROUND_SERVICE_WATCHDOG_RESTART_BASE_MS)
    await delay(500)
    assert.equal(sentinelLines().length, 1)

    const firstState = JSON.parse(
      readFileSync(backgroundServiceWatchdogStatePath(watchdogDirectory), 'utf8')
    ) as { consecutiveFailures?: number; lastHandledGeneration?: string }
    assert.equal(firstState.consecutiveFailures, 1)
    assert.match(firstState.lastHandledGeneration ?? '', /^\d+:\d+$/)

    // A second short-lived agent generation consumes the persisted failure
    // count, so its one-shot recovery waits twice as long.
    const secondParent = await startFixtureParent()
    const secondWatchdog = await startBackgroundServiceWatchdog({
      userDataPath: watchdogDirectory,
      developmentAppPath: fixturePath,
      parentProcessId: secondParent.pid,
      attachedForVerification: true
    })
    assert.ok(secondWatchdog)
    watchdogs.push(secondWatchdog)
    const secondCrashAt = Date.now()
    await stopFixtureParent(secondParent)
    await waitForValue(
      () => (sentinelLines().length >= 2 ? sentinelLines() : undefined),
      'Second watchdog recovery',
      20_000
    )
    assert.ok(sentinelLines().every((line) => /:\s*true:true$/.test(line)))
    assert.ok(
      Date.now() - secondCrashAt >= backgroundServiceWatchdogRestartDelayMs(1)
    )
    let secondState: { consecutiveFailures?: number }
    try {
      secondState = await waitForValue(() => {
        try {
          const state = JSON.parse(
            readFileSync(backgroundServiceWatchdogStatePath(watchdogDirectory), 'utf8')
          ) as { consecutiveFailures?: number }
          return state.consecutiveFailures === 2 ? state : undefined
        } catch {
          return undefined
        }
      }, 'Second watchdog state commit')
    } catch (error) {
      const finalState = readFileSync(
        backgroundServiceWatchdogStatePath(watchdogDirectory),
        'utf8'
      )
      throw new Error(
        `${error instanceof Error ? error.message : error}; first=${JSON.stringify(firstState)}; state=${finalState}; sentinels=${JSON.stringify(sentinelLines())}`
      )
    }
    assert.equal(secondState.consecutiveFailures, 2)
  } finally {
    await Promise.all(watchdogs.map((watchdog) => watchdog.shutdown()))
    await Promise.all(parents.map((parent) => stopFixtureParent(parent)))
    await delay(250)
    rmSync(watchdogDirectory, { force: true, recursive: true })
  }
}
const installerScript = readFileSync(new URL('../build/installer.nsh', import.meta.url), 'utf8')
const installerBuildScript = readFileSync(
  new URL('./windows/Build-OrbitInstaller.ps1', import.meta.url),
  'utf8'
)
const electronBuilderPatchScript = readFileSync(
  new URL('./windows/Apply-OrbitElectronBuilderPatch.mjs', import.meta.url),
  'utf8'
)
assert.match(installerBuildScript, /Apply-OrbitElectronBuilderPatch\.mjs/u)
assert.match(electronBuilderPatchScript, /Windows Smart App Control/u)
assert.match(electronBuilderPatchScript, /UninstallerReader\.exec\(installerPath, uninstallerPath\)/u)
assert.match(installerScript, /orbit-background-agent-shutdown/)
assert.match(installerScript, /\$\{ifNot\} \$\{isUpdated\}/)
assert.match(installerScript, /CurrentVersion\\Explorer\\StartupApproved\\Run/)
const shutdownMacroStart = installerScript.indexOf('!macro orbitStopBackgroundService')
const customUnWelcomeStart = installerScript.indexOf('!macro customUnWelcomePage')
const customUnInitStart = installerScript.indexOf('!macro customUnInit')
const customUnInstallStart = installerScript.indexOf('!macro customUnInstall')
assert.ok(
  shutdownMacroStart >= 0 &&
    shutdownMacroStart < customUnWelcomeStart &&
    customUnWelcomeStart < customUnInitStart &&
    customUnInitStart < customUnInstallStart
)
assert.doesNotMatch(
  installerScript,
  /APP_EXECUTABLE_FILENAME/u,
  'custom NSIS hooks must use command-line defines available when they are parsed'
)
assert.match(
  installerScript,
  /!ifdef BUILD_UNINSTALLER[\s\S]*Function un\.orbitStopBackgroundServiceBeforeRemove[\s\S]*!endif/u
)
assert.match(
  installerScript.slice(shutdownMacroStart, customUnWelcomeStart),
  /IfFileExists[\s\S]*ExecWait .*orbit-background-agent-shutdown/
)
assert.match(
  installerScript.slice(customUnWelcomeStart, customUnInitStart),
  /MUI_PAGE_CUSTOMFUNCTION_LEAVE un\.orbitStopBackgroundServiceBeforeRemove[\s\S]*MUI_UNPAGE_WELCOME/
)
assert.doesNotMatch(
  installerScript.slice(customUnWelcomeStart, customUnInitStart),
  /MUI_PAGE_CUSTOMFUNCTION_PRE/
)
assert.match(
  installerScript.slice(customUnInitStart, customUnInstallStart),
  /\$\{If\} \$\{Silent\}[\s\S]*!insertmacro orbitStopBackgroundService/
)

const validSnapshot: OrbitAgentSnapshot = {
  protocolVersion: 2,
  startedAt: Date.now(),
  processId: process.pid,
  appVersion: '0.1.2-beta.2',
  executablePath: process.execPath,
  hardwareControl: {
    state: 'ready',
    connectedControllers: 1,
    lastInputAt: Date.now(),
    lastRawButtonMask: 0x0010
  },
  lastActivationAt: Date.now(),
  lastActivationResult: 'focused'
}
assert.equal(isOrbitAgentSnapshot(validSnapshot), true)

const invalidSnapshots: unknown[] = [
  { ...validSnapshot, protocolVersion: 1 },
  { ...validSnapshot, startedAt: Number.NaN },
  { ...validSnapshot, processId: 0 },
  { ...validSnapshot, appVersion: '' },
  { ...validSnapshot, executablePath: '' },
  { ...validSnapshot, hardwareControl: { state: 'ready', connectedControllers: 17 } },
  { ...validSnapshot, hardwareControl: { state: 'broken', connectedControllers: 0 } },
  { ...validSnapshot, lastActivationResult: 'unknown' }
]
for (const candidate of invalidSnapshots) assert.equal(isOrbitAgentSnapshot(candidate), false)

const pipeName =
  process.platform === 'win32'
    ? `\\\\.\\pipe\\orbit-background-service-verify-${process.pid}-${randomUUID()}`
    : join(tmpdir(), `orbit-background-service-verify-${process.pid}-${randomUUID()}.sock`)
let markDisconnectHandlerStarted: (() => void) | undefined
const disconnectHandlerStarted = new Promise<void>((resolve) => {
  markDisconnectHandlerStarted = resolve
})
let releaseDisconnectHandler: (() => void) | undefined
const disconnectHandlerReleased = new Promise<void>((resolve) => {
  releaseDisconnectHandler = resolve
})
const server = await createOrbitPipeServer(
  pipeName,
  async (request: OrbitPipeRequest): Promise<unknown> => {
    if (request.command === 'status') return validSnapshot
    if (request.command === 'disconnect-test') {
      markDisconnectHandlerStarted?.()
      await disconnectHandlerReleased
      return validSnapshot
    }
    throw new Error('Unknown verification command')
  }
)

try {
  assert.deepEqual(await requestOrbitPipe<OrbitAgentSnapshot>(pipeName, { command: 'status' }), validSnapshot)

  const oversizedResponse = JSON.parse(
    await requestRawLine(pipeName, `${'x'.repeat(70 * 1024)}\n`)
  ) as { ok?: boolean; error?: string }
  assert.equal(oversizedResponse.ok, false)
  assert.match(oversizedResponse.error ?? '', /too large/i)
  assert.deepEqual(await requestOrbitPipe<OrbitAgentSnapshot>(pipeName, { command: 'status' }), validSnapshot)

  const partialSocket = createConnection(pipeName)
  partialSocket.on('error', () => undefined)
  await withTimeout(once(partialSocket, 'connect').then(() => undefined), 'Partial pipe connection')
  partialSocket.write('{"command":"status"')
  partialSocket.destroy()
  await delay(50)
  assert.deepEqual(await requestOrbitPipe<OrbitAgentSnapshot>(pipeName, { command: 'status' }), validSnapshot)

  const disconnectSocket = createConnection(pipeName)
  disconnectSocket.on('error', () => undefined)
  await withTimeout(once(disconnectSocket, 'connect').then(() => undefined), 'Disconnect pipe connection')
  disconnectSocket.write(`${JSON.stringify({ command: 'disconnect-test' })}\n`)
  await withTimeout(disconnectHandlerStarted, 'Disconnect handler start')
  disconnectSocket.destroy()
  releaseDisconnectHandler?.()
  await delay(50)
  assert.deepEqual(await requestOrbitPipe<OrbitAgentSnapshot>(pipeName, { command: 'status' }), validSnapshot)
} finally {
  releaseDisconnectHandler?.()
  await closePipeServer(server)
  if (process.platform !== 'win32' && existsSync(pipeName)) rmSync(pipeName, { force: true })
}

const dualSenseScript = createDualSenseMonitorScript(1_000)
assert.match(dualSenseScript, /WriteLine\("heartbeat"\)/)
assert.match(dualSenseScript, /ElapsedMilliseconds/)
assert.match(dualSenseScript, /Start-Sleep -Seconds 1/)

// `hardwareControl.ts` uses the electron-vite alias at runtime. Register that
// one alias locally so this standalone Node verification exercises the real class.
const sharedIpcUrl = new URL('../src/shared/ipc.ts', import.meta.url).href
const aliasResolver = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@shared/ipc') {
    return { url: ${JSON.stringify(sharedIpcUrl)}, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
`
register(`data:text/javascript,${encodeURIComponent(aliasResolver)}`, import.meta.url)
const {
  HARDWARE_MONITOR_RESTART_BASE_MS,
  HardwareControlWatcher,
  hardwareMonitorRestartDelayMs
} = await import('../src/main/hardwareControl.ts')

assert.equal(hardwareMonitorRestartDelayMs(-1), 750)
assert.equal(hardwareMonitorRestartDelayMs(0), 750)
assert.equal(hardwareMonitorRestartDelayMs(1), 1_500)
assert.equal(hardwareMonitorRestartDelayMs(5), 24_000)
assert.equal(hardwareMonitorRestartDelayMs(6), 30_000)
assert.equal(hardwareMonitorRestartDelayMs(100), 30_000)

if (process.platform === 'win32') {
  const watcher = new HardwareControlWatcher({
    hardwareControlEnabled: true,
    hardwareControlButton: 'menu',
    hardwareControlHoldSeconds: 1
  } as ConstructorParameters<typeof HardwareControlWatcher>[0])
  const diagnostics = watcher as unknown as {
    monitor: {
      pid?: number
      killed: boolean
      exitCode: number | null
      signalCode: NodeJS.Signals | null
      kill: () => boolean
    } | null
  }
  let replacement:
    | {
        pid?: number
        killed: boolean
        exitCode: number | null
        signalCode: NodeJS.Signals | null
        kill: () => boolean
      }
    | undefined
  try {
    const first = await waitForValue(() => {
      const child = diagnostics.monitor
      return child?.pid && watcher.getStatus().state === 'ready' ? child : undefined
    }, 'Initial XInput monitor readiness')
    assert.equal(first.killed, false)
    assert.equal(first.kill(), true)

    replacement = await waitForValue(() => {
      const child = diagnostics.monitor
      return child && child !== first && child.pid && watcher.getStatus().state === 'ready'
        ? child
        : undefined
    }, 'Replacement XInput monitor readiness')
    assert.equal(replacement.killed, false)
  } finally {
    await watcher.shutdown()
  }

  assert.equal(diagnostics.monitor, null)
  assert.equal(replacement?.killed, true)
  await delay(HARDWARE_MONITOR_RESTART_BASE_MS + 250)
  assert.equal(diagnostics.monitor, null)
}

console.log(
  `Background service verification passed (${process.platform === 'win32' ? 'including XInput recovery' : 'Windows XInput recovery skipped'}).`
)
