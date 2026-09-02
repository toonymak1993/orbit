import { execFile } from 'node:child_process'
import { join } from 'node:path'

const WINDOWS_POWERSHELL_PATH = join(
  process.env.SystemRoot ?? 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe'
)
const PROCESS_START_TOLERANCE_MS = 30_000

export interface WindowsProcessIdentity {
  executablePath: string
  commandLine: string
  startedAt: number
}

export interface ExpectedWindowsProcessIdentity {
  executablePath: string
  requiredArgument: string
  startedAt: number
}

function normalizedWindowsPath(value: string): string {
  return value.trim().replace(/^"|"$/g, '').toLowerCase()
}

function escapedRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Matches one complete Windows command-line token. It deliberately fails closed
 * for ambiguous quoting instead of risking terminating the foreground ORBIT UI. */
export function windowsCommandLineHasArgument(
  commandLine: string,
  expectedArgument: string
): boolean {
  const expected = expectedArgument.trim().replace(/^"|"$/g, '')
  if (!expected || !commandLine) return false
  const token = escapedRegularExpression(expected)
  return new RegExp(`(?:^|[\\s"])(?:${token})(?=$|[\\s"])`, 'i').test(commandLine)
}

export function windowsProcessIdentityMatches(
  actual: WindowsProcessIdentity,
  expected: ExpectedWindowsProcessIdentity
): boolean {
  return (
    normalizedWindowsPath(actual.executablePath) ===
      normalizedWindowsPath(expected.executablePath) &&
    windowsCommandLineHasArgument(actual.commandLine, expected.requiredArgument) &&
    Number.isFinite(actual.startedAt) &&
    Number.isFinite(expected.startedAt) &&
    Math.abs(actual.startedAt - expected.startedAt) <= PROCESS_START_TOLERANCE_MS
  )
}

export function isProcessAlive(processId: number): boolean {
  if (!Number.isInteger(processId) || processId <= 0 || processId === process.pid) return false
  try {
    process.kill(processId, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export function windowsProcessIdentity(
  processId: number
): Promise<WindowsProcessIdentity | undefined> {
  if (process.platform !== 'win32' || !Number.isInteger(processId) || processId <= 0) {
    return Promise.resolve(undefined)
  }
  const script = [
    `$candidate=Get-CimInstance Win32_Process -Filter 'ProcessId = ${processId}' -ErrorAction SilentlyContinue`,
    "if($candidate){$created=if($candidate.CreationDate){$candidate.CreationDate.ToUniversalTime().ToString('o')}else{$null};[Console]::Out.Write(([pscustomobject]@{executablePath=$candidate.ExecutablePath;commandLine=$candidate.CommandLine;createdAt=$created}|ConvertTo-Json -Compress))}"
  ].join(';')
  return new Promise((resolve) => {
    execFile(
      WINDOWS_POWERSHELL_PATH,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', timeout: 3_000, windowsHide: true },
      (error, stdout) => {
        if (error || !stdout.trim()) {
          resolve(undefined)
          return
        }
        try {
          const parsed = JSON.parse(stdout) as {
            executablePath?: unknown
            commandLine?: unknown
            createdAt?: unknown
          }
          const startedAt =
            typeof parsed.createdAt === 'string' ? Date.parse(parsed.createdAt) : Number.NaN
          if (
            typeof parsed.executablePath !== 'string' ||
            typeof parsed.commandLine !== 'string' ||
            !Number.isFinite(startedAt)
          ) {
            resolve(undefined)
            return
          }
          resolve({
            executablePath: parsed.executablePath,
            commandLine: parsed.commandLine,
            startedAt
          })
        } catch {
          resolve(undefined)
        }
      }
    )
  })
}

export async function terminateWindowsProcessIfIdentityMatches(
  processId: number,
  expectedIdentity: ExpectedWindowsProcessIdentity
): Promise<boolean> {
  if (!isProcessAlive(processId)) return true
  const actualIdentity = await windowsProcessIdentity(processId)
  if (!actualIdentity || !windowsProcessIdentityMatches(actualIdentity, expectedIdentity)) {
    return false
  }
  try {
    process.kill(processId)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH'
  }
}
