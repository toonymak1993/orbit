import { spawn, type ChildProcess } from 'node:child_process'
import { isAbsolute, join } from 'node:path'

const INSTALLER_SPAWN_TIMEOUT_MS = 5_000
const ELEVATION_DECISION_TIMEOUT_MS = 2 * 60_000
const WINDOWS_POWERSHELL_PATH = join(
  process.env.SystemRoot ?? 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe'
)

export interface NsisInstallerLaunchOptions {
  installerPath: string
  packagePath?: string
  installDirectory?: string
  isAdminRightsRequired?: boolean
}

export interface NsisInstallerLaunchConfirmation {
  processId: number
  executablePath: string
  startedAt: number
}

function encoded(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64')
}

export function quoteWindowsProcessArgument(value: string): string {
  if (!/[\s"]/.test(value)) return value
  return `"${value
    .replace(/(\\*)"/g, '$1$1\\"')
    .replace(/(\\+)$/g, '$1$1')}"`
}

export function nsisInstallerArguments(
  options: Pick<NsisInstallerLaunchOptions, 'packagePath' | 'installDirectory'>
): string[] {
  const args = ['--updated', '/S', '--force-run']
  if (options.installDirectory) args.push(`/D=${options.installDirectory}`)
  if (options.packagePath) args.push(`--package-file=${options.packagePath}`)
  return args
}

/** Launches the already downloaded and updater-verified NSIS executable and
 * resolves only after Node confirms that Windows created the child process. */
export function launchNsisInstaller(
  options: NsisInstallerLaunchOptions
): Promise<NsisInstallerLaunchConfirmation> {
  if (!isAbsolute(options.installerPath)) {
    return Promise.reject(new Error('NSIS installer path must be absolute'))
  }
  const installerArguments = nsisInstallerArguments(options)
  if (options.isAdminRightsRequired) {
    if (process.platform !== 'win32') {
      return Promise.reject(new Error('NSIS installer elevation is only supported on Windows'))
    }
    const argumentLine = installerArguments.map(quoteWindowsProcessArgument).join(' ')
    const script = [
      "$installer=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:ORBIT_NSIS_INSTALLER_B64))",
      "$arguments=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:ORBIT_NSIS_ARGUMENTS_B64))",
      'try{$launched=Start-Process -FilePath $installer -ArgumentList $arguments -Verb RunAs -PassThru -WindowStyle Hidden -ErrorAction Stop;if(!$launched){exit 2};$startedAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();[Console]::Out.Write("$($launched.Id)|$startedAt")}catch{exit 2}'
    ].join(';')
    return new Promise((resolvePromise, reject) => {
      let child: ChildProcess
      let confirmation = ''
      try {
        child = spawn(
          WINDOWS_POWERSHELL_PATH,
          ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
          {
            stdio: ['ignore', 'pipe', 'ignore'],
            windowsHide: true,
            env: {
              ...process.env,
              ORBIT_NSIS_INSTALLER_B64: encoded(options.installerPath),
              ORBIT_NSIS_ARGUMENTS_B64: encoded(argumentLine)
            }
          }
        )
      } catch (error) {
        reject(error)
        return
      }
      let settled = false
      const settleFailure = (error: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        reject(error)
      }
      const timeout = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          try {
            child.kill()
          } catch {
            // The rejected launch promise drives service recovery.
          }
        }
        settleFailure(new Error('NSIS installer elevation was not confirmed in time'))
      }, ELEVATION_DECISION_TIMEOUT_MS)
      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => {
        confirmation += chunk
      })
      child.once('error', settleFailure)
      child.once('exit', (code) => {
        if (settled) return
        const [processIdValue, startedAtValue] = confirmation.trim().split('|')
        const processId = Number(processIdValue)
        const startedAt = Number(startedAtValue)
        if (
          code !== 0 ||
          !Number.isInteger(processId) ||
          processId <= 0 ||
          !Number.isFinite(startedAt)
        ) {
          settleFailure(new Error('NSIS installer elevation was declined or failed'))
          return
        }
        settled = true
        clearTimeout(timeout)
        resolvePromise({ processId, executablePath: options.installerPath, startedAt })
      })
    })
  }
  return new Promise((resolvePromise, reject) => {
    let child: ChildProcess
    const startedAt = Date.now()
    try {
      child = spawn(options.installerPath, installerArguments, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      })
    } catch (error) {
      reject(error)
      return
    }

    let settled = false
    const settleFailure = (error: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(error)
    }
    const timeout = setTimeout(() => {
      settleFailure(new Error('NSIS installer did not start in time'))
      if (child.exitCode === null && child.signalCode === null) {
        try {
          child.kill()
        } catch {
          // Recovery is already driven by the rejected launch promise.
        }
      }
    }, INSTALLER_SPAWN_TIMEOUT_MS)

    child.once('error', settleFailure)
    child.once('spawn', () => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      child.unref()
      resolvePromise({
        processId: child.pid!,
        executablePath: options.installerPath,
        startedAt
      })
    })
  })
}
