import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  launchNsisInstaller,
  nsisInstallerArguments,
  quoteWindowsProcessArgument
} from '../src/main/nsisInstallerLaunch.ts'
import {
  PENDING_INSTALL_EXIT_GRACE_MS,
  PENDING_INSTALL_LAUNCH_GRACE_MS,
  PENDING_INSTALL_MAX_RUNTIME_MS,
  isPendingInstallConfirmation,
  isPendingInstallJournal,
  shouldWaitForPendingInstall,
  type PendingInstallConfirmation,
  type PendingInstallJournal
} from '../src/main/appUpdateInstallJournal.ts'
import {
  compareAppVersions,
  isValidAppUpdateContentRange,
  parseGitHubAppUpdateRelease,
  selectLatestBetaRelease
} from '../src/shared/appUpdatePolicy.ts'

const root = resolve(import.meta.dirname, '..')
const digest = `sha256:${'a'.repeat(64)}`

function release(version: string, prerelease = false): Record<string, unknown> {
  const betaPrefix = prerelease ? 'ORBIT-Beta' : 'ORBIT'
  return {
    tag_name: `v${version}`,
    name: `ORBIT ${version}`,
    body: 'Security and controller polish.',
    html_url: `https://github.com/toonymak1993/orbit/releases/tag/v${version}`,
    published_at: '2026-08-27T10:00:00Z',
    draft: false,
    prerelease,
    assets: [
      {
        id: 42,
        name: `${betaPrefix}-XboxMode-Setup-${version}-x64.exe`,
        size: 10_000_000,
        digest,
        state: 'uploaded',
        browser_download_url: `https://github.com/toonymak1993/orbit/releases/download/v${version}/${betaPrefix}-XboxMode-Setup-${version}-x64.exe`
      }
    ]
  }
}

assert.equal(compareAppVersions('1.2.0', '1.1.9'), 1)
assert.ok((compareAppVersions('1.0.0-beta.2', '1.0.0-beta.10') ?? 0) < 0)
assert.equal(compareAppVersions('1.0.0', '1.0.0-beta.10'), 1)
assert.equal(compareAppVersions('1.0', '1.0.0'), null)
assert.equal(compareAppVersions('1.0.0-beta.01', '1.0.0-beta.1'), null)
assert.equal(isValidAppUpdateContentRange('bytes 500-999/1000', 500, 1000), true)
assert.equal(isValidAppUpdateContentRange('bytes 499-999/1000', 500, 1000), false)
assert.equal(isValidAppUpdateContentRange('bytes 500-999/1001', 500, 1000), false)
assert.equal(isValidAppUpdateContentRange('bytes */1000', 500, 1000), false)
assert.deepEqual(
  nsisInstallerArguments({
    installDirectory: 'C:\\Users\\Orbit\\App',
    packagePath: 'C:\\Temp\\orbit-package.7z'
  }),
  [
    '--updated',
    '/S',
    '--force-run',
    '/D=C:\\Users\\Orbit\\App',
    '--package-file=C:\\Temp\\orbit-package.7z'
  ]
)
assert.equal(quoteWindowsProcessArgument('--updated'), '--updated')
assert.equal(
  quoteWindowsProcessArgument('/D=C:\\Program Files\\ORBIT\\'),
  '"/D=C:\\Program Files\\ORBIT\\\\"'
)
await assert.rejects(
  launchNsisInstaller({ installerPath: 'relative-installer.exe' }),
  /must be absolute/
)
await assert.rejects(
  launchNsisInstaller({ installerPath: resolve(root, 'missing-update-installer.exe') }),
  /ENOENT|not found/i
)
const confirmedChild = await launchNsisInstaller({ installerPath: process.execPath })
assert.ok(confirmedChild.processId)

const pendingCreatedAt = Date.now()
const pendingJournal: PendingInstallJournal = {
  targetVersion: '9.9.9',
  createdAt: pendingCreatedAt,
  transactionId: 'update-transaction',
  phase: 'launching'
}
const pendingConfirmation: PendingInstallConfirmation = {
  transactionId: pendingJournal.transactionId,
  installerPath: 'C:\\Temp\\ORBIT-Setup.exe',
  processId: 4242,
  startedAt: pendingCreatedAt + 1_000
}
assert.equal(isPendingInstallJournal(pendingJournal), true)
assert.equal(isPendingInstallJournal({ ...pendingJournal, transactionId: '' }), false)
assert.equal(isPendingInstallConfirmation(pendingConfirmation), true)
assert.equal(
  shouldWaitForPendingInstall(
    pendingJournal,
    undefined,
    false,
    false,
    pendingCreatedAt + 1_000
  ),
  true
)
assert.equal(
  shouldWaitForPendingInstall(
    pendingJournal,
    undefined,
    false,
    false,
    pendingCreatedAt + PENDING_INSTALL_LAUNCH_GRACE_MS
  ),
  false
)
assert.equal(
  shouldWaitForPendingInstall(
    pendingJournal,
    undefined,
    false,
    true,
    pendingCreatedAt + PENDING_INSTALL_LAUNCH_GRACE_MS
  ),
  true
)
assert.equal(
  shouldWaitForPendingInstall(
    pendingJournal,
    pendingConfirmation,
    true,
    false,
    pendingCreatedAt + PENDING_INSTALL_MAX_RUNTIME_MS - 1
  ),
  true
)
assert.equal(
  shouldWaitForPendingInstall(
    pendingJournal,
    pendingConfirmation,
    false,
    false,
    pendingConfirmation.startedAt + PENDING_INSTALL_EXIT_GRACE_MS
  ),
  false
)
assert.equal(
  shouldWaitForPendingInstall(
    pendingJournal,
    pendingConfirmation,
    true,
    true,
    pendingCreatedAt + PENDING_INSTALL_MAX_RUNTIME_MS
  ),
  false
)

const stable = parseGitHubAppUpdateRelease(release('1.2.3'), 'stable')
assert.equal(stable?.version, '1.2.3')
assert.equal(stable?.asset.digest, 'a'.repeat(64))
assert.equal(parseGitHubAppUpdateRelease(release('1.2.3'), 'beta'), null)

const wrongAsset = release('1.2.3')
;(wrongAsset.assets as Array<Record<string, unknown>>)[0].name = 'orbit.exe'
assert.equal(parseGitHubAppUpdateRelease(wrongAsset, 'stable'), null)

const wrongDigest = release('1.2.3')
;(wrongDigest.assets as Array<Record<string, unknown>>)[0].digest = 'sha256:1234'
assert.equal(parseGitHubAppUpdateRelease(wrongDigest, 'stable'), null)

const newestBeta = selectLatestBetaRelease([
  release('2.0.0-beta.2', true),
  release('2.0.0-beta.11', true),
  release('1.9.9-beta.99', true)
])
assert.equal(newestBeta?.version, '2.0.0-beta.11')

const manifest = JSON.parse(
  readFileSync(resolve(root, 'resources/release-manifest.json'), 'utf8')
) as Record<string, any>
assert.equal(manifest.updateMode, 'github-release')
assert.equal(manifest.automaticUpdatesEnabled, true)
assert.equal(manifest.xboxMode.automaticLegacyRemoval, false)
assert.equal(manifest.xboxMode.legacyPackageRetentionRequired, true)
assert.match(manifest.updates.owner, /^[a-zA-Z0-9-]+$/)
assert.match(manifest.updates.repository, /^[a-zA-Z0-9._-]+$/)
assert.ok(manifest.updates.signerThumbprints.length > 0)

const installerScript = readFileSync(
  resolve(root, 'scripts/windows/Install-OrbitXboxMode.ps1'),
  'utf8'
)
assert.match(installerScript, /\[switch\]\$UpdateOnly/)
assert.match(installerScript, /!\$ValidateOnly -and !\$UpdateOnly -and !\$isAdministrator/)
assert.doesNotMatch(installerScript, /Add-ValidatedCertificateTrust|Import-Certificate/)
assert.doesNotMatch(installerScript, /Remove-AppxPackage -Package \$legacyPackage\.PackageFullName/)
assert.match(installerScript, /legacyPackageRetained = \$true/)
assert.match(installerScript, /61E90C0AACBF2F407A575903FCC197F45B61706D/)
assert.match(installerScript, /Update-only mode will not change machine policy/)

const xboxBootstrapper = readFileSync(resolve(root, 'build/xbox/OrbitXboxInstaller.nsi'), 'utf8')
assert.match(xboxBootstrapper, /\/ORBIT-UPDATE=/)
assert.match(xboxBootstrapper, /-UpdateOnly -Launch/)
assert.doesNotMatch(xboxBootstrapper, /Local Machine\\Trusted People|ORBIT-Development\.cer/)

const builderConfig = readFileSync(resolve(root, 'electron-builder.yml'), 'utf8')
assert.match(builderConfig, /provider: github/)
assert.match(builderConfig, /owner: toonymak1993/)
assert.match(builderConfig, /certificateSha1:\s*61E90C0AACBF2F407A575903FCC197F45B61706D/)
assert.match(builderConfig, /rfc3161TimeStampServer:\s*http:\/\/time\.certum\.pl/)
assert.doesNotMatch(builderConfig, /differentialPackage:\s*false/)

const appUpdateService = readFileSync(resolve(root, 'src/main/appUpdateService.ts'), 'utf8')
assert.match(appUpdateService, /isValidAppUpdateContentRange/)
assert.match(appUpdateService, /DOWNLOAD_STALL_TIMEOUT_MS/)
assert.match(appUpdateService, /pending-install\.json\.tmp|pendingInstallTempPath/)
assert.match(appUpdateService, /pending-install-confirmed\.json/)
assert.match(appUpdateService, /verification: 'verifying'/)
assert.match(appUpdateService, /autoUpdater\.autoDownload = false/)
assert.match(appUpdateService, /createUpdaterCancellationToken/)
assert.match(appUpdateService, /expectedNsisVersion/)
assert.match(
  appUpdateService,
  /snapshot\.stage === 'installing'[\s\S]{0,160}handleInstallLaunchFailure\(\)/
)
assert.match(
  appUpdateService,
  /installerLaunchConfirmed && !afterConfirmedLaunch/
)
assert.doesNotMatch(appUpdateService, /\.quitAndInstall\(/)
const confirmedNsisLaunch = appUpdateService.indexOf('await launchNsisInstaller')
const quitAfterNsisLaunch = appUpdateService.indexOf('app.quit()', confirmedNsisLaunch)
assert.ok(confirmedNsisLaunch >= 0 && quitAfterNsisLaunch > confirmedNsisLaunch)
assert.match(appUpdateService, /start\(\): Promise<void>/)
assert.match(appUpdateService, /prepareForInstall\(transactionId\)/)
assert.match(appUpdateService, /await this\.waitForPendingInstall\(pending\)/)
const suspensionRenewal = appUpdateService.indexOf('await renewBackgroundAgentSuspension')
const installerLaunch = appUpdateService.indexOf('await launchNsisInstaller')
assert.ok(suspensionRenewal >= 0 && installerLaunch > suspensionRenewal)

const backgroundServiceManager = readFileSync(
  resolve(root, 'src/main/orbitBackgroundServiceManager.ts'),
  'utf8'
)
const startupBarrier = backgroundServiceManager.indexOf('await startupReconciliation')
const suspensionWait = backgroundServiceManager.indexOf(
  'await isBackgroundAgentSuspended(this.userDataPath)',
  startupBarrier
)
assert.ok(startupBarrier >= 0 && suspensionWait > startupBarrier)
assert.match(
  appUpdateService,
  /comparison !== null && comparison >= 0[\s\S]{0,700}recoverBackgroundAfterFailedInstall\(pending\.transactionId\)/
)
assert.match(
  appUpdateService,
  /pending === null[\s\S]{0,500}recoverBackgroundAfterFailedInstall\(\)/
)

const ipcHandlers = readFileSync(resolve(root, 'src/main/ipcHandlers.ts'), 'utf8')
const updateStartup = ipcHandlers.indexOf('const appUpdateStartup = appUpdateService.start()')
const backgroundStartup = ipcHandlers.indexOf(
  'backgroundServiceManager.start(appUpdateStartup)',
  updateStartup
)
assert.ok(updateStartup >= 0 && backgroundStartup > updateStartup)

const sharedIpc = readFileSync(resolve(root, 'src/shared/ipc.ts'), 'utf8')
assert.match(sharedIpc, /appUpdateDownload: 'app:update:download'/)
assert.match(sharedIpc, /appUpdateAutoDownload: boolean/)

console.log('App update policy and packaging contracts verified.')
