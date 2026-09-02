import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { ORBIT_AGENT_ARGUMENT } from './orbitServiceProtocol'
import {
  ORBIT_BACKGROUND_SERVICE_LOGIN_ITEM_NAME,
  orbitBackgroundServiceLoginItemCommand
} from './orbitBackgroundServiceLoginItem'
import { readBackgroundAgentSuspension } from './orbitBackgroundServiceSuspension'

const WINDOWS_POWERSHELL_PATH = join(
  process.env.SystemRoot ?? 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe'
)
const RECOVERY_SPAWN_TIMEOUT_MS = 5_000
const RECOVERY_READY_MESSAGE = 'ORBIT_RECOVERY_READY'

function encoded(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64')
}

/** The retry host is PowerShell rather than ORBIT.exe so Windows can replace or
 * remove the application while maintenance is active. It follows renewed marker
 * deadlines and therefore cannot relaunch into a second update transaction. */
export function createBackgroundAgentRecoveryScript(): string {
  return [
    "$marker=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:ORBIT_RECOVERY_MARKER_B64))",
    "$executable=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:ORBIT_RECOVERY_EXECUTABLE_B64))",
    "$transaction=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:ORBIT_RECOVERY_TRANSACTION_B64))",
    "$loginName=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:ORBIT_RECOVERY_LOGIN_NAME_B64))",
    "$loginCommand=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:ORBIT_RECOVERY_LOGIN_COMMAND_B64))",
    "$developmentApp=if($env:ORBIT_RECOVERY_APP_B64){[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:ORBIT_RECOVERY_APP_B64))}else{''}",
    '$authorized=$false',
    'if(!(Test-Path -LiteralPath $marker)){exit 0}',
    'try{',
    '  $initialSuspension=Get-Content -LiteralPath $marker -Raw -ErrorAction Stop|ConvertFrom-Json -ErrorAction Stop',
    '  if($initialSuspension.transactionId -ne $transaction -or $initialSuspension.recoverAgent -ne $true){exit 0}',
    '  $authorized=$true',
    '}catch{exit 0}',
    `[Console]::Out.WriteLine('${RECOVERY_READY_MESSAGE}')`,
    '[Console]::Out.Flush()',
    'while(Test-Path -LiteralPath $marker){',
    '  $active=$true',
    '  try{',
    '    $suspension=Get-Content -LiteralPath $marker -Raw -ErrorAction Stop|ConvertFrom-Json -ErrorAction Stop',
    '    if($suspension.transactionId -ne $transaction -or $suspension.recoverAgent -ne $true){exit 0}',
    '    $now=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()',
    '    $active=([double]$suspension.expiresAt -gt $now)',
    '  }catch{',
    '    try{$active=((Get-Item -LiteralPath $marker -ErrorAction Stop).LastWriteTimeUtc.AddMinutes(5) -gt [DateTime]::UtcNow)}catch{$active=$false}',
    '  }',
    '  if(!$active){Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue;break}',
    '  Start-Sleep -Milliseconds 1000',
    '}',
    "$runRoots=@('Registry::HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run','Registry::HKEY_LOCAL_MACHINE\\Software\\Microsoft\\Windows\\CurrentVersion\\Run')",
    "$approvedRoots=@('Registry::HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run','Registry::HKEY_LOCAL_MACHINE\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run')",
    '$loginEnabled=$false',
    'for($index=0;$index -lt $runRoots.Count;$index++){',
    '  try{',
    '    $currentCommand=[string](Get-ItemPropertyValue -LiteralPath $runRoots[$index] -Name $loginName -ErrorAction Stop)',
    '    if(![string]::Equals($currentCommand.Trim(),$loginCommand,[StringComparison]::OrdinalIgnoreCase)){continue}',
    '    try{',
    '      [byte[]]$approval=Get-ItemPropertyValue -LiteralPath $approvedRoots[$index] -Name $loginName -ErrorAction Stop',
    '      if($approval.Length -eq 0 -or $approval[0] -ne 2){continue}',
    // A missing StartupApproved value means Windows has not disabled this Run item.
    '    }catch{}',
    '    $loginEnabled=$true;break',
    '  }catch{}',
    '}',
    'if($authorized -and $loginEnabled -and (Test-Path -LiteralPath $executable)){',
    `  $arguments=if($developmentApp){'"'+$developmentApp+'" ${ORBIT_AGENT_ARGUMENT}'}else{'${ORBIT_AGENT_ARGUMENT}'}`,
    '  Start-Process -FilePath $executable -ArgumentList $arguments -WindowStyle Hidden',
    '}'
  ].join('\n')
}

export function scheduleBackgroundAgentRecovery(options: {
  markerPath: string
  executablePath: string
  developmentAppPath?: string
  transactionId?: string
}): Promise<boolean> {
  if (process.platform !== 'win32') return Promise.resolve(true)
  return (async () => {
    const userDataPath = dirname(options.markerPath)
    const suspension = await readBackgroundAgentSuspension(userDataPath)
    const transactionId = options.transactionId ?? suspension?.transactionId
    if (
      !transactionId ||
      !suspension ||
      suspension.transactionId !== transactionId ||
      !suspension.recoverAgent
    ) {
      return options.transactionId === undefined
    }

    return new Promise<boolean>((resolve) => {
      let child: ReturnType<typeof spawn>
      try {
        child = spawn(
          WINDOWS_POWERSHELL_PATH,
          [
            '-NoLogo',
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            createBackgroundAgentRecoveryScript()
          ],
          {
            detached: true,
            stdio: ['ignore', 'pipe', 'ignore'],
            windowsHide: true,
            env: {
              ...process.env,
              ORBIT_RECOVERY_MARKER_B64: encoded(options.markerPath),
              ORBIT_RECOVERY_EXECUTABLE_B64: encoded(options.executablePath),
              ORBIT_RECOVERY_TRANSACTION_B64: encoded(transactionId),
              ORBIT_RECOVERY_LOGIN_NAME_B64: encoded(
                ORBIT_BACKGROUND_SERVICE_LOGIN_ITEM_NAME
              ),
              ORBIT_RECOVERY_LOGIN_COMMAND_B64: encoded(
                orbitBackgroundServiceLoginItemCommand(
                  options.executablePath,
                  options.developmentAppPath
                )
              ),
              ORBIT_RECOVERY_APP_B64: options.developmentAppPath
                ? encoded(options.developmentAppPath)
                : ''
            }
          }
        )
      } catch {
        resolve(false)
        return
      }
      let settled = false
      const finish = (result: boolean): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        child.stdout?.removeAllListeners()
        child.stdout?.destroy()
        if (result) child.unref()
        resolve(result)
      }
      const timeout = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill()
        finish(false)
      }, RECOVERY_SPAWN_TIMEOUT_MS)
      child.once('error', () => finish(false))
      child.once('close', () => finish(false))
      child.stdout?.setEncoding('utf8')
      let readyOutput = ''
      child.stdout?.on('data', (chunk: string) => {
        readyOutput += chunk
        if (readyOutput.includes(RECOVERY_READY_MESSAGE)) finish(true)
      })
    })
  })().catch(() => false)
}
