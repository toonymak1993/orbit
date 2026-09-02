import { app, autoUpdater as electronAutoUpdater, type BrowserWindow } from 'electron'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { isAbsolute, join, resolve } from 'node:path'
import electronUpdater, { type AppUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import {
  IPC,
  type AppUpdateError,
  type AppUpdateInstallMode,
  type AppUpdateSnapshot,
  type GameLaunchPhase
} from '@shared/ipc'
import {
  compareAppVersions,
  isValidAppUpdateContentRange,
  parseGitHubAppUpdateRelease,
  selectLatestBetaRelease,
  type AppUpdateReleaseCandidate
} from '@shared/appUpdatePolicy'
import { fetchWithElectronNet } from './networkFetch'
import {
  PENDING_INSTALL_LAUNCH_GRACE_MS,
  PENDING_INSTALL_MAX_RUNTIME_MS,
  isPendingInstallConfirmation,
  isPendingInstallJournal,
  shouldWaitForPendingInstall,
  type PendingInstallConfirmation,
  type PendingInstallJournal
} from './appUpdateInstallJournal'
import { launchNsisInstaller } from './nsisInstallerLaunch'
import {
  readBackgroundAgentSuspension,
  renewBackgroundAgentSuspension
} from './orbitBackgroundServiceSuspension'
import { getDisplayVersion, getReleaseManifest, type ReleaseManifest } from './releaseManifest'
import { isProcessAlive, windowsProcessIdentity } from './windowsProcess'

const ACTIVE_DOWNLOAD_PHASES = new Set(['downloading', 'updating', 'installing', 'verifying'])
const INSTALL_COUNTDOWN_MS = 8_000
const PROGRESS_EMIT_INTERVAL_MS = 250
const SIGNATURE_TIMEOUT_MS = 30_000
const DOWNLOAD_CONNECT_TIMEOUT_MS = 30_000
const DOWNLOAD_STALL_TIMEOUT_MS = 45_000
const AUTOMATIC_RETRY_MS = 30 * 60 * 1_000
const PENDING_INSTALL_POLL_MS = 500
const PENDING_INSTALL_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000
const INSTALLER_START_TOLERANCE_MS = 30_000

interface AppUpdateServiceOptions {
  getGameLaunchPhase: () => GameLaunchPhase
  hasActiveLauncherDownload: () => boolean
  prepareForInstall: (transactionId: string) => Promise<void>
  recoverFromFailedInstall: (transactionId?: string) => Promise<void>
  getAutoDownloadEnabled: () => boolean
}

type UpdaterCancellationToken = NonNullable<Parameters<AppUpdater['downloadUpdate']>[0]>

interface NsisUpdaterRuntime {
  downloadedUpdateHelper?: {
    file: string | null
    packageFile: string | null
    downloadedFileInfo: { isAdminRightsRequired?: boolean } | null
  }
  installDirectory?: string
}

/** Loads the token from electron-updater's own dependency tree so pnpm cannot hand
 * the updater a nominally incompatible token from another transitive version. */
function createUpdaterCancellationToken(): UpdaterCancellationToken {
  const appRequire = createRequire(join(app.getAppPath(), 'package.json'))
  const updaterRequire = createRequire(appRequire.resolve('electron-updater'))
  const runtime = updaterRequire('builder-util-runtime') as {
    CancellationToken: new () => UpdaterCancellationToken
  }
  return new runtime.CancellationToken()
}

function installMode(): AppUpdateInstallMode {
  if (!app.isPackaged) return 'development'
  if (process.platform !== 'win32') return 'unsupported'
  return process.windowsStore ? 'appx' : 'nsis'
}

function safeReleaseNotes(value: unknown): string | undefined {
  const source = Array.isArray(value)
    ? value
        .map((entry) =>
          entry && typeof entry === 'object' && 'note' in entry ? String(entry.note ?? '') : ''
        )
        .join('\n\n')
    : typeof value === 'string'
      ? value
      : ''
  const sanitized = source
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, 6_000)
  return sanitized || undefined
}

function isAllowedDownloadResponseUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    const host = parsed.hostname.toLowerCase()
    return (
      parsed.protocol === 'https:' &&
      (host === 'github.com' ||
        host === 'objects.githubusercontent.com' ||
        host.endsWith('.githubusercontent.com'))
    )
  } catch {
    return false
  }
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size
  } catch {
    return 0
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

export class AppUpdateService {
  private readonly manifest: ReleaseManifest = getReleaseManifest()
  private readonly mode = installMode()
  private readonly updatesDirectory = join(app.getPath('userData'), 'app-updates')
  private readonly pendingInstallPath = join(this.updatesDirectory, 'pending-install.json')
  private readonly pendingInstallTempPath = `${this.pendingInstallPath}.tmp`
  private readonly pendingInstallConfirmationPath = join(
    this.updatesDirectory,
    'pending-install-confirmed.json'
  )
  private readonly pendingInstallConfirmationTempPath = `${this.pendingInstallConfirmationPath}.tmp`
  private snapshot: AppUpdateSnapshot
  private updater: AppUpdater | null = null
  private release: AppUpdateReleaseCandidate | null = null
  private expectedNsisVersion: string | null = null
  private automaticCheckTimer: NodeJS.Timeout | null = null
  private installTimer: NodeJS.Timeout | null = null
  private downloadAbortController: AbortController | null = null
  private nsisDownloadToken: UpdaterCancellationToken | null = null
  private nsisCancellationExpected = false
  private checkInFlight: Promise<AppUpdateSnapshot> | null = null
  private downloadInFlight: Promise<void> | null = null
  private disposed = false
  private lastProgressEmittedAt = 0
  private installFailureHandled = false
  private installerLaunchConfirmed = false
  private activeInstallTransactionId: string | undefined
  private readonly updaterDisposers: Array<() => void> = []

  constructor(
    private readonly mainWindow: BrowserWindow,
    private readonly options: AppUpdateServiceOptions
  ) {
    const supported =
      this.manifest.automaticUpdatesEnabled &&
      this.manifest.updateMode === 'github-release' &&
      (this.mode === 'appx' || this.mode === 'nsis') &&
      (this.mode !== 'appx' || this.manifest.updates.signerThumbprints.length > 0)
    this.snapshot = {
      stage: supported ? 'idle' : 'unsupported',
      installMode: this.mode,
      currentVersion: getDisplayVersion(),
      channel: this.manifest.channel,
      automaticChecksEnabled: supported,
      autoDownloadEnabled: supported && this.isAutoDownloadEnabled(),
      checkIntervalHours: this.manifest.updates.checkIntervalHours,
      verification: this.mode === 'nsis' ? 'installer-managed' : 'pending',
      canInstall: false,
      installScheduled: false
    }
  }

  start(): Promise<void> {
    if (this.snapshot.stage === 'unsupported') return Promise.resolve()
    if (this.mode === 'nsis') this.configureNsisUpdater()
    return this.initialize()
  }

  dispose(): void {
    this.disposed = true
    if (this.automaticCheckTimer) clearTimeout(this.automaticCheckTimer)
    if (this.installTimer) clearTimeout(this.installTimer)
    this.automaticCheckTimer = null
    this.installTimer = null
    this.downloadAbortController?.abort()
    this.downloadAbortController = null
    this.nsisCancellationExpected = true
    this.nsisDownloadToken?.cancel()
    this.nsisDownloadToken = null
    for (const disposeListener of this.updaterDisposers.splice(0)) disposeListener()
  }

  getSnapshot(): AppUpdateSnapshot {
    return { ...this.snapshot }
  }

  check(manual = true): Promise<AppUpdateSnapshot> {
    if (this.checkInFlight) return this.checkInFlight
    if (
      this.disposed ||
      this.snapshot.stage === 'unsupported' ||
      this.snapshot.stage === 'installing' ||
      this.snapshot.stage === 'downloading' ||
      this.snapshot.stage === 'verifying' ||
      this.snapshot.stage === 'ready'
    ) {
      return Promise.resolve(this.getSnapshot())
    }
    this.checkInFlight = this.performCheck(manual).finally(() => {
      this.checkInFlight = null
    })
    return this.checkInFlight
  }

  download(): AppUpdateSnapshot {
    if (this.disposed || this.snapshot.stage !== 'available') return this.getSnapshot()
    if (this.mode === 'appx') {
      if (!this.release) {
        this.setError('release-invalid')
        return this.getSnapshot()
      }
      void this.downloadAppxUpdate(this.release)
    } else if (this.mode === 'nsis' && this.updater) {
      void this.downloadNsisUpdate()
    }
    return this.getSnapshot()
  }

  refreshPreferences(): AppUpdateSnapshot {
    const autoDownloadEnabled = this.isAutoDownloadEnabled()
    this.setSnapshot({ autoDownloadEnabled })
    if (autoDownloadEnabled && this.snapshot.stage === 'available') this.download()
    return this.getSnapshot()
  }

  async install(): Promise<AppUpdateSnapshot> {
    if (this.snapshot.stage !== 'ready') return this.getSnapshot()
    if (this.options.getGameLaunchPhase() !== 'idle') {
      this.setSnapshot({ installScheduled: true, installCountdownEndsAt: undefined })
      return this.getSnapshot()
    }
    await this.performInstall()
    return this.getSnapshot()
  }

  defer(): AppUpdateSnapshot {
    if (this.installTimer) clearTimeout(this.installTimer)
    this.installTimer = null
    this.setSnapshot({ installScheduled: false, installCountdownEndsAt: undefined })
    return this.getSnapshot()
  }

  refreshBlockers(): void {
    this.publish()
    if (
      this.mode === 'nsis' &&
      this.snapshot.stage === 'downloading' &&
      (this.options.getGameLaunchPhase() !== 'idle' || this.options.hasActiveLauncherDownload()) &&
      this.nsisDownloadToken &&
      !this.nsisDownloadToken.cancelled
    ) {
      this.nsisCancellationExpected = true
      this.nsisDownloadToken.cancel()
    }
    if (this.snapshot.stage !== 'ready' || !this.snapshot.installScheduled) return
    if (this.options.getGameLaunchPhase() !== 'idle') {
      if (this.installTimer) clearTimeout(this.installTimer)
      this.installTimer = null
      this.setSnapshot({ installCountdownEndsAt: undefined })
      return
    }
    if (this.installTimer) return
    const installCountdownEndsAt = Date.now() + INSTALL_COUNTDOWN_MS
    this.setSnapshot({ installCountdownEndsAt })
    this.installTimer = setTimeout(() => {
      this.installTimer = null
      if (
        this.snapshot.stage === 'ready' &&
        this.snapshot.installScheduled &&
        this.options.getGameLaunchPhase() === 'idle'
      ) {
        void this.performInstall()
      }
    }, INSTALL_COUNTDOWN_MS)
  }

  private async initialize(): Promise<void> {
    try {
      await this.reconcilePendingInstall()
    } catch {
      // Startup reconciliation is a lifecycle gate for the background agent.
      // Always resolve it explicitly, even when AV/file locks break cleanup.
      await this.removePendingInstallFiles()
      await this.recoverBackgroundAfterFailedInstall()
      this.setError('install-failed')
    }
    if (this.disposed) return
    this.scheduleAutomaticCheck(this.manifest.updates.startupDelaySeconds * 1_000)
  }

  private scheduleAutomaticCheck(delayMs: number): void {
    if (this.disposed || this.snapshot.stage === 'unsupported') return
    if (this.automaticCheckTimer) clearTimeout(this.automaticCheckTimer)
    const safeDelay = Math.max(1_000, delayMs)
    this.setSnapshot({ nextCheckAt: Date.now() + safeDelay })
    this.automaticCheckTimer = setTimeout(async () => {
      this.automaticCheckTimer = null
      const result = await this.check(false)
      if (this.disposed) return
      const normalInterval = this.manifest.updates.checkIntervalHours * 60 * 60 * 1_000
      this.scheduleAutomaticCheck(result.stage === 'error' ? AUTOMATIC_RETRY_MS : normalInterval)
    }, safeDelay)
  }

  private isAutoDownloadEnabled(): boolean {
    return this.manifest.updates.autoDownload && this.options.getAutoDownloadEnabled()
  }

  private async removePendingInstallFiles(): Promise<void> {
    await Promise.all(
      [
        this.pendingInstallPath,
        this.pendingInstallTempPath,
        this.pendingInstallConfirmationPath,
        this.pendingInstallConfirmationTempPath
      ].map((path) => rm(path, { force: true }).catch(() => undefined))
    )
  }

  private async readPendingInstallWithGrace(): Promise<
    PendingInstallJournal | null | undefined
  > {
    let deadline = Date.now() + PENDING_INSTALL_LAUNCH_GRACE_MS
    while (!this.disposed) {
      try {
        const parsed = JSON.parse(await readFile(this.pendingInstallPath, 'utf8')) as unknown
        if (isPendingInstallJournal(parsed)) return parsed
        try {
          const metadata = await stat(this.pendingInstallPath)
          deadline = Math.min(deadline, metadata.mtimeMs + PENDING_INSTALL_LAUNCH_GRACE_MS)
        } catch {
          // The initial bounded deadline still applies.
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          await Promise.all(
            [
              this.pendingInstallTempPath,
              this.pendingInstallConfirmationPath,
              this.pendingInstallConfirmationTempPath
            ].map((path) => rm(path, { force: true }).catch(() => undefined))
          )
          return undefined
        }
      }
      if (Date.now() >= deadline) return null
      await wait(Math.min(PENDING_INSTALL_POLL_MS, Math.max(1, deadline - Date.now())))
    }
    return undefined
  }

  private async readPendingInstallConfirmation(
    transactionId: string
  ): Promise<PendingInstallConfirmation | undefined> {
    try {
      const parsed = JSON.parse(
        await readFile(this.pendingInstallConfirmationPath, 'utf8')
      ) as unknown
      if (
        isPendingInstallConfirmation(parsed) &&
        parsed.transactionId === transactionId &&
        isAbsolute(parsed.installerPath)
      ) {
        return parsed
      }
    } catch {
      // The launcher may still be between process confirmation and journal rename.
    }
    return undefined
  }

  private async isConfirmedInstallerRunning(
    confirmation: PendingInstallConfirmation
  ): Promise<boolean> {
    if (!isProcessAlive(confirmation.processId)) return false
    if (process.platform !== 'win32') return true
    const identity = await windowsProcessIdentity(confirmation.processId)
    if (!identity) return true
    return (
      identity.executablePath.trim().replace(/^"|"$/g, '').toLowerCase() ===
        confirmation.installerPath.trim().replace(/^"|"$/g, '').toLowerCase() &&
      Math.abs(identity.startedAt - confirmation.startedAt) <= INSTALLER_START_TOLERANCE_MS
    )
  }

  private async waitForPendingInstall(journal: PendingInstallJournal): Promise<boolean> {
    const confirmation = await this.readPendingInstallConfirmation(journal.transactionId)
    const installerRunning = confirmation
      ? await this.isConfirmedInstallerRunning(confirmation)
      : false
    const suspension = await readBackgroundAgentSuspension(app.getPath('userData'))
    const now = Date.now()
    const matchingSuspensionActive =
      suspension?.transactionId === journal.transactionId && suspension.expiresAt > now
    // Never keep an old UI resident while a prepared/confirmed installer owns
    // the application directory. Reconciliation remains unresolved until this
    // process exits, so the manager cannot clear the suspension marker.
    return shouldWaitForPendingInstall(
      journal,
      confirmation,
      installerRunning,
      matchingSuspensionActive,
      now
    )
  }

  private async reconcilePendingInstall(): Promise<void> {
    const pending = await this.readPendingInstallWithGrace()
    if (pending === undefined) return
    if (
      pending === null ||
      pending.createdAt > Date.now() + PENDING_INSTALL_LAUNCH_GRACE_MS ||
      Date.now() - pending.createdAt > PENDING_INSTALL_MAX_AGE_MS
    ) {
      await this.removePendingInstallFiles()
      await this.cleanupUpdateCache(new Set())
      await this.recoverBackgroundAfterFailedInstall()
      this.setError('install-failed')
      return
    }

    const comparison = compareAppVersions(this.snapshot.currentVersion, pending.targetVersion)
    if (comparison !== null && comparison >= 0) {
      this.setSnapshot({
        stage: 'up-to-date',
        installedVersion: this.snapshot.currentVersion,
        checkedAt: Date.now(),
        error: undefined
      })
      await this.removePendingInstallFiles()
      await this.cleanupUpdateCache(new Set())
      // Completing the durable journal is the only startup path authorized to
      // release the matching background-agent suspension before it expires.
      await this.recoverBackgroundAfterFailedInstall(pending.transactionId)
      return
    }

    const installerConfirmed = await this.waitForPendingInstall(pending)
    if (this.disposed) return
    if (installerConfirmed) {
      app.quit()
      await new Promise<void>(() => undefined)
      return
    }
    await this.removePendingInstallFiles()
    await this.recoverBackgroundAfterFailedInstall(pending.transactionId)
    this.setError('install-failed')
  }

  private configureNsisUpdater(): void {
    const { autoUpdater } = electronUpdater
    this.updater = autoUpdater
    // ORBIT starts downloads explicitly so they can yield to games and launcher downloads.
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.autoRunAppAfterInstall = true
    autoUpdater.allowPrerelease = this.manifest.channel === 'beta'
    autoUpdater.allowDowngrade = false
    autoUpdater.disableWebInstaller = true
    autoUpdater.logger = console

    const onCheckingForUpdate = (): void => {
      this.setSnapshot({ stage: 'checking', error: undefined })
    }
    const onUpdateNotAvailable = (): void => {
      this.setSnapshot({ stage: 'up-to-date', checkedAt: Date.now(), error: undefined })
    }
    const onUpdateAvailable = (info: UpdateInfo): void => {
      if (this.expectedNsisVersion && info.version !== this.expectedNsisVersion) {
        this.setError('release-invalid')
        return
      }
      this.setSnapshot({
        stage: 'available',
        targetVersion: info.version,
        releaseName: `ORBIT ${info.version}`,
        releaseNotes: safeReleaseNotes(info.releaseNotes),
        releasePageUrl: this.releasePageUrl(info.version),
        verification: 'installer-managed',
        checkedAt: Date.now(),
        error: undefined
      })
      if (this.isAutoDownloadEnabled()) this.download()
    }
    const onDownloadProgress = (progress: ProgressInfo): void => {
      this.setSnapshot({
        stage: 'downloading',
        targetVersion: this.snapshot.targetVersion,
        transferredBytes: progress.transferred,
        totalBytes: progress.total,
        percent: Math.max(0, Math.min(100, progress.percent)),
        bytesPerSecond: progress.bytesPerSecond
      })
    }
    const onUpdateDownloaded = (info: UpdateInfo): void => {
      this.setSnapshot({
        stage: 'ready',
        targetVersion: info.version,
        releaseName: `ORBIT ${info.version}`,
        releaseNotes: safeReleaseNotes(info.releaseNotes),
        releasePageUrl: this.releasePageUrl(info.version),
        transferredBytes: undefined,
        totalBytes: undefined,
        percent: 100,
        bytesPerSecond: undefined,
        verification: 'installer-managed',
        downloadedAt: Date.now(),
        error: undefined
      })
    }
    const onError = (): void => {
      if (this.nsisCancellationExpected) return
      if (this.snapshot.stage === 'installing') {
        void this.handleInstallLaunchFailure()
        return
      }
      this.setError(
        this.snapshot.stage === 'checking'
          ? 'release-unavailable'
          : 'download-failed'
      )
    }

    autoUpdater.on('checking-for-update', onCheckingForUpdate)
    autoUpdater.on('update-not-available', onUpdateNotAvailable)
    autoUpdater.on('update-available', onUpdateAvailable)
    autoUpdater.on('download-progress', onDownloadProgress)
    autoUpdater.on('update-downloaded', onUpdateDownloaded)
    autoUpdater.on('error', onError)
    this.updaterDisposers.push(
      () => autoUpdater.removeListener('checking-for-update', onCheckingForUpdate),
      () => autoUpdater.removeListener('update-not-available', onUpdateNotAvailable),
      () => autoUpdater.removeListener('update-available', onUpdateAvailable),
      () => autoUpdater.removeListener('download-progress', onDownloadProgress),
      () => autoUpdater.removeListener('update-downloaded', onUpdateDownloaded),
      () => autoUpdater.removeListener('error', onError)
    )
  }

  private async performCheck(manual: boolean): Promise<AppUpdateSnapshot> {
    const previous = this.getSnapshot()
    this.setSnapshot({
      stage: 'checking',
      verification: this.mode === 'nsis' ? 'installer-managed' : 'pending',
      error: undefined
    })
    try {
      const endpoint = this.githubReleaseEndpoint()
      const response = await fetchWithElectronNet(endpoint, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `ORBIT/${this.snapshot.currentVersion}`,
          'X-GitHub-Api-Version': '2022-11-28'
        },
        signal: AbortSignal.timeout(20_000)
      })
      if (!response.ok) throw new Error(`GitHub release request failed (${response.status})`)
      const payload = (await response.json()) as unknown
      const release =
        this.manifest.channel === 'beta'
          ? selectLatestBetaRelease(payload)
          : parseGitHubAppUpdateRelease(payload, 'stable')
      if (!release) {
        this.setError('release-invalid')
        return this.getSnapshot()
      }
      const comparison = compareAppVersions(release.version, this.snapshot.currentVersion)
      if (comparison === null) {
        this.setError('release-invalid')
        return this.getSnapshot()
      }
      if (comparison <= 0) {
        this.release = null
        this.expectedNsisVersion = null
        this.setSnapshot({
          stage: 'up-to-date',
          targetVersion: undefined,
          releaseName: undefined,
          releaseNotes: undefined,
          releasePageUrl: undefined,
          transferredBytes: undefined,
          totalBytes: undefined,
          percent: undefined,
          bytesPerSecond: undefined,
          verification: this.mode === 'nsis' ? 'installer-managed' : 'pending',
          checkedAt: Date.now(),
          error: undefined
        })
        return this.getSnapshot()
      }

      if (this.mode === 'nsis') {
        this.expectedNsisVersion = release.version
        await this.updater?.checkForUpdates()
        return this.getSnapshot()
      }

      this.release = release
      this.setSnapshot({
        stage: 'available',
        targetVersion: release.version,
        releaseName: release.name,
        releaseNotes: release.notes || undefined,
        releasePageUrl: release.pageUrl,
        totalBytes: release.asset.size,
        verification: 'pending',
        checkedAt: Date.now(),
        error: undefined
      })
      if (this.isAutoDownloadEnabled()) void this.downloadAppxUpdate(release)
      return this.getSnapshot()
    } catch {
      if (!manual && (previous.stage === 'ready' || previous.stage === 'downloading')) {
        this.snapshot = previous
        this.publish()
      } else {
        this.setError('release-unavailable')
      }
      return this.getSnapshot()
    }
  }

  private downloadAppxUpdate(release: AppUpdateReleaseCandidate): Promise<void> {
    if (this.downloadInFlight) return this.downloadInFlight
    this.downloadInFlight = this.performAppxDownload(release).finally(() => {
      this.downloadInFlight = null
    })
    return this.downloadInFlight
  }

  private downloadNsisUpdate(): Promise<void> {
    if (this.downloadInFlight) return this.downloadInFlight
    this.downloadInFlight = this.performNsisDownload().finally(() => {
      this.downloadInFlight = null
    })
    return this.downloadInFlight
  }

  private async performNsisDownload(): Promise<void> {
    if (!this.updater) return
    this.setSnapshot({
      stage: 'downloading',
      verification: 'installer-managed',
      error: undefined
    })
    while (!this.disposed && this.snapshot.stage === 'downloading') {
      try {
        await this.waitWhileDownloadPaused()
        if (this.disposed || this.snapshot.stage !== 'downloading') return
        const token = createUpdaterCancellationToken()
        this.nsisDownloadToken = token
        this.nsisCancellationExpected = false
        await this.updater.downloadUpdate(token)
        return
      } catch {
        if (this.disposed) return
        if (this.nsisCancellationExpected) {
          continue
        }
        this.setError('download-failed')
        return
      } finally {
        this.nsisDownloadToken?.dispose()
        this.nsisDownloadToken = null
      }
    }
  }

  private async performAppxDownload(release: AppUpdateReleaseCandidate): Promise<void> {
    await mkdir(this.updatesDirectory, { recursive: true })
    const finalPath = this.updatePath(release.asset.name)
    const partialPath = `${finalPath}.part`
    await this.cleanupUpdateCache(new Set([release.asset.name, `${release.asset.name}.part`]))
    this.setSnapshot({
      stage: 'downloading',
      targetVersion: release.version,
      transferredBytes: 0,
      totalBytes: release.asset.size,
      percent: 0,
      verification: 'pending',
      error: undefined
    })
    this.lastProgressEmittedAt = 0

    try {
      if ((await fileSize(finalPath)) === release.asset.size) {
        this.setSnapshot({ stage: 'verifying', verification: 'verifying' })
        if (
          (await sha256File(finalPath)) === release.asset.digest &&
          (await this.verifyWindowsSignature(finalPath))
        ) {
          this.markReady(release)
          return
        }
      }
      await rm(finalPath, { force: true })

      let transferred = await fileSize(partialPath)
      if (transferred > release.asset.size) {
        await rm(partialPath, { force: true })
        transferred = 0
      }
      if (transferred === release.asset.size) {
        this.setSnapshot({ stage: 'verifying', verification: 'verifying' })
        if ((await sha256File(partialPath)) !== release.asset.digest) {
          await rm(partialPath, { force: true })
          this.setError('verification-failed')
          return
        }
        await rename(partialPath, finalPath)
        if (!(await this.verifyWindowsSignature(finalPath))) {
          await rm(finalPath, { force: true })
          this.setError('verification-failed')
          return
        }
        this.markReady(release)
        return
      }
      await this.waitWhileDownloadPaused()
      this.downloadAbortController = new AbortController()
      const headers: Record<string, string> = {
        Accept: 'application/octet-stream',
        'User-Agent': `ORBIT/${this.snapshot.currentVersion}`
      }
      if (transferred > 0) headers.Range = `bytes=${transferred}-`
      const fetchDownload = async (requestHeaders: Record<string, string>): Promise<Response> => {
        const timeout = setTimeout(
          () => this.downloadAbortController?.abort(),
          DOWNLOAD_CONNECT_TIMEOUT_MS
        )
        try {
          return await fetchWithElectronNet(release.asset.downloadUrl, {
            headers: requestHeaders,
            signal: this.downloadAbortController?.signal
          })
        } finally {
          clearTimeout(timeout)
        }
      }
      let response = await fetchDownload(headers)
      if (
        transferred > 0 &&
        (response.status !== 206 ||
          !isValidAppUpdateContentRange(
            response.headers.get('content-range'),
            transferred,
            release.asset.size
          ))
      ) {
        await rm(partialPath, { force: true })
        transferred = 0
        response = await fetchDownload({
          Accept: 'application/octet-stream',
          'User-Agent': headers['User-Agent']
        })
      }
      if (
        response.status !== (transferred > 0 ? 206 : 200) ||
        !response.body ||
        !isAllowedDownloadResponseUrl(response.url)
      ) {
        throw new Error('Invalid GitHub release download response')
      }
      const contentLength = Number(response.headers.get('content-length'))
      if (
        Number.isFinite(contentLength) &&
        contentLength > 0 &&
        contentLength !== release.asset.size - transferred
      ) {
        throw new Error('GitHub release download length does not match manifest')
      }

      const file = await open(partialPath, transferred > 0 ? 'a' : 'w')
      const reader = response.body.getReader()
      const startedAt = Date.now()
      const initialTransferred = transferred
      try {
        while (true) {
          await this.waitWhileDownloadPaused()
          const chunk = await new Promise<ReadableStreamReadResult<Uint8Array>>(
            (resolveRead, rejectRead) => {
              const timeout = setTimeout(() => {
                this.downloadAbortController?.abort()
                rejectRead(new Error('Update download stalled'))
              }, DOWNLOAD_STALL_TIMEOUT_MS)
              reader.read().then(
                (result) => {
                  clearTimeout(timeout)
                  resolveRead(result)
                },
                (error) => {
                  clearTimeout(timeout)
                  rejectRead(error)
                }
              )
            }
          )
          if (chunk.done) break
          if (!chunk.value || chunk.value.byteLength === 0) continue
          transferred += chunk.value.byteLength
          if (transferred > release.asset.size) throw new Error('Update exceeds declared size')
          await file.write(chunk.value)
          const now = Date.now()
          if (now - this.lastProgressEmittedAt >= PROGRESS_EMIT_INTERVAL_MS) {
            const elapsedSeconds = Math.max(0.25, (now - startedAt) / 1_000)
            this.lastProgressEmittedAt = now
            this.setSnapshot({
              stage: 'downloading',
              transferredBytes: transferred,
              totalBytes: release.asset.size,
              percent: (transferred / release.asset.size) * 100,
              bytesPerSecond: Math.round((transferred - initialTransferred) / elapsedSeconds)
            })
          }
        }
      } finally {
        reader.releaseLock()
        await file.close()
      }

      if (transferred !== release.asset.size) throw new Error('Update download is incomplete')
      this.setSnapshot({ stage: 'verifying', verification: 'verifying', bytesPerSecond: undefined })
      const digest = await sha256File(partialPath)
      if (digest !== release.asset.digest) {
        await rm(partialPath, { force: true })
        this.setError('verification-failed')
        return
      }
      await rename(partialPath, finalPath)
      if (!(await this.verifyWindowsSignature(finalPath))) {
        await rm(finalPath, { force: true })
        this.setError('verification-failed')
        return
      }
      this.markReady(release)
    } catch {
      if (!this.disposed) this.setError('download-failed')
    } finally {
      this.downloadAbortController = null
    }
  }

  private async waitWhileDownloadPaused(): Promise<void> {
    while (
      !this.disposed &&
      (this.options.getGameLaunchPhase() !== 'idle' || this.options.hasActiveLauncherDownload())
    ) {
      await wait(750)
    }
    if (this.disposed) throw new Error('Update service disposed')
  }

  private markReady(release: AppUpdateReleaseCandidate): void {
    this.setSnapshot({
      stage: 'ready',
      targetVersion: release.version,
      releaseName: release.name,
      releaseNotes: release.notes || undefined,
      releasePageUrl: release.pageUrl,
      transferredBytes: undefined,
      totalBytes: release.asset.size,
      percent: 100,
      bytesPerSecond: undefined,
      verification: 'verified',
      downloadedAt: Date.now(),
      error: undefined
    })
  }

  private async verifyWindowsSignature(path: string): Promise<boolean> {
    const thumbprints = this.manifest.updates.signerThumbprints
      .map((thumbprint) => thumbprint.replace(/\s/g, '').toUpperCase())
      .filter((thumbprint) => /^[A-F0-9]{40}$/.test(thumbprint))
    if (thumbprints.length === 0) return false
    const script = [
      "$ErrorActionPreference='Stop'",
      "$path=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:ORBIT_UPDATE_PATH_B64))",
      "$allowed=$env:ORBIT_UPDATE_SIGNERS.Split(';',[System.StringSplitOptions]::RemoveEmptyEntries)",
      '$signature=Get-AuthenticodeSignature -LiteralPath $path',
      "$thumbprint=if($signature.SignerCertificate){$signature.SignerCertificate.Thumbprint}else{''}",
      "$valid=$signature.Status -eq 'Valid' -and $signature.TimeStamperCertificate -and $allowed -contains $thumbprint",
      'if(!$valid){exit 7}'
    ].join(';')
    const powershellPath = join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe'
    )
    return new Promise((resolvePromise) => {
      let settled = false
      let timeout: NodeJS.Timeout | null = null
      const settle = (result: boolean): void => {
        if (settled) return
        settled = true
        if (timeout) clearTimeout(timeout)
        resolvePromise(result)
      }
      try {
        const child = spawn(
          powershellPath,
          ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
          {
            windowsHide: true,
            stdio: 'ignore',
            env: {
              ...process.env,
              ORBIT_UPDATE_PATH_B64: Buffer.from(path, 'utf8').toString('base64'),
              ORBIT_UPDATE_SIGNERS: thumbprints.join(';')
            }
          }
        )
        timeout = setTimeout(() => {
          child.kill()
          settle(false)
        }, SIGNATURE_TIMEOUT_MS)
        child.once('error', () => settle(false))
        child.once('exit', (code) => settle(code === 0))
      } catch {
        settle(false)
      }
    })
  }

  private async writePendingInstallJournal(journal: PendingInstallJournal): Promise<void> {
    await rm(this.pendingInstallTempPath, { force: true })
    await writeFile(this.pendingInstallTempPath, JSON.stringify(journal), 'utf8')
    await rm(this.pendingInstallPath, { force: true })
    await rename(this.pendingInstallTempPath, this.pendingInstallPath)
  }

  private async writePendingInstallConfirmation(
    confirmation: PendingInstallConfirmation
  ): Promise<void> {
    await rm(this.pendingInstallConfirmationTempPath, { force: true })
    await writeFile(
      this.pendingInstallConfirmationTempPath,
      JSON.stringify(confirmation),
      'utf8'
    )
    await rm(this.pendingInstallConfirmationPath, { force: true })
    await rename(
      this.pendingInstallConfirmationTempPath,
      this.pendingInstallConfirmationPath
    )
  }

  private async performInstall(): Promise<void> {
    if (this.snapshot.stage !== 'ready' || !this.snapshot.targetVersion) return
    if (this.options.getGameLaunchPhase() !== 'idle') {
      this.setSnapshot({ installScheduled: true })
      return
    }
    const targetVersion = this.snapshot.targetVersion
    const transactionId = randomUUID()
    this.activeInstallTransactionId = transactionId
    this.installFailureHandled = false
    this.installerLaunchConfirmed = false
    this.setSnapshot({
      stage: 'installing',
      installScheduled: false,
      installCountdownEndsAt: undefined,
      error: undefined
    })
    try {
      await mkdir(this.updatesDirectory, { recursive: true })
      if (this.mode === 'appx') {
        if (!this.release) throw new Error('Missing AppX update release')
        const setupPath = this.updatePath(this.release.asset.name)
        if (
          (await fileSize(setupPath)) !== this.release.asset.size ||
          (await sha256File(setupPath)) !== this.release.asset.digest ||
          !(await this.verifyWindowsSignature(setupPath))
        ) {
          await rm(setupPath, { force: true })
          this.setError('verification-failed')
          return
        }
      }
      await Promise.all(
        [this.pendingInstallConfirmationPath, this.pendingInstallConfirmationTempPath].map(
          (path) => rm(path, { force: true })
        )
      )
      await this.writePendingInstallJournal({
        targetVersion,
        createdAt: Date.now(),
        transactionId,
        phase: 'launching'
      })
      await this.options.prepareForInstall(transactionId)
      // Persist the full installer ownership window before spawning anything.
      // If this fails, recovery is still safe because no external installer can
      // have started yet. A shutdown helper may subsequently extend, but never
      // shorten, this exact transaction.
      if (
        !(await renewBackgroundAgentSuspension(
          app.getPath('userData'),
          transactionId,
          PENDING_INSTALL_MAX_RUNTIME_MS
        ))
      ) {
        throw new Error('ORBIT background service suspension could not be extended')
      }
      // Rebase the bounded reconciliation window after preparation completes,
      // while failure is still fully recoverable and before the external spawn.
      await this.writePendingInstallJournal({
        targetVersion,
        createdAt: Date.now(),
        transactionId,
        phase: 'launching'
      })
      if (this.mode === 'nsis') {
        // electron-updater 6.8.x quits immediately after scheduling its own
        // asynchronous spawn. Use its verified download metadata, but own the
        // spawn so a launch error can fully recover before ORBIT ever quits.
        const updater = this.updater as (AppUpdater & NsisUpdaterRuntime) | null
        const downloadedUpdate = updater?.downloadedUpdateHelper
        const installerPath = downloadedUpdate?.file
        if (!installerPath || (await fileSize(installerPath)) === 0) {
          throw new Error('Missing downloaded NSIS installer')
        }
        const packagePath = downloadedUpdate.packageFile ?? undefined
        if (packagePath && (await fileSize(packagePath)) === 0) {
          throw new Error('Missing downloaded NSIS package')
        }
        const launch = await launchNsisInstaller({
          installerPath,
          packagePath,
          installDirectory: updater?.installDirectory,
          isAdminRightsRequired:
            downloadedUpdate.downloadedFileInfo?.isAdminRightsRequired === true
        })
        this.installerLaunchConfirmed = true
        await this.writePendingInstallConfirmation({
          transactionId,
          installerPath: launch.executablePath,
          processId: launch.processId,
          startedAt: launch.startedAt
        }).catch((error) => {
          console.warn(
            '[app-update] NSIS launch confirmation could not be persisted:',
            error instanceof Error ? error.message : error
          )
        })
        try {
          electronAutoUpdater.emit('before-quit-for-update')
        } catch (error) {
          console.warn(
            '[app-update] before-quit-for-update listener failed:',
            error instanceof Error ? error.message : error
          )
        }
        app.quit()
        return
      }
      if (!this.release) throw new Error('Missing AppX update release')
      const setupPath = this.updatePath(this.release.asset.name)
      const startedAt = Date.now()
      const child = spawn(setupPath, ['/ORBIT-UPDATE=1'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      })
      await new Promise<void>((resolvePromise, reject) => {
        child.once('error', reject)
        child.once('spawn', resolvePromise)
      })
      if (!child.pid) throw new Error('AppX installer did not report a process ID')
      this.installerLaunchConfirmed = true
      await this.writePendingInstallConfirmation({
        transactionId,
        installerPath: setupPath,
        processId: child.pid,
        startedAt
      }).catch((error) => {
        console.warn(
          '[app-update] AppX launch confirmation could not be persisted:',
          error instanceof Error ? error.message : error
        )
      })
      child.once('error', () => void this.handleInstallLaunchFailure(true))
      child.once('exit', (code) => {
        if (code !== 0 && !this.disposed && !this.mainWindow.isDestroyed()) {
          void this.handleInstallLaunchFailure(true)
        }
      })
      child.unref()
    } catch {
      if (this.installerLaunchConfirmed) return
      await this.handleInstallLaunchFailure()
    }
  }

  private async handleInstallLaunchFailure(afterConfirmedLaunch = false): Promise<void> {
    if (this.installerLaunchConfirmed && !afterConfirmedLaunch) return
    if (this.installFailureHandled) return
    this.installFailureHandled = true
    await this.removePendingInstallFiles()
    await this.recoverBackgroundAfterFailedInstall()
    this.setError('install-failed')
  }

  private async recoverBackgroundAfterFailedInstall(
    transactionId = this.activeInstallTransactionId
  ): Promise<void> {
    try {
      await this.options.recoverFromFailedInstall(transactionId)
    } catch {
      // The update error remains actionable even when the optional service recovery fails.
    } finally {
      if (this.activeInstallTransactionId === transactionId) {
        this.activeInstallTransactionId = undefined
      }
    }
  }

  private githubReleaseEndpoint(): string {
    const { owner, repository } = this.manifest.updates
    const base = `https://api.github.com/repos/${owner}/${repository}/releases`
    return this.manifest.channel === 'beta' ? `${base}?per_page=20` : `${base}/latest`
  }

  private releasePageUrl(version: string): string {
    const { owner, repository } = this.manifest.updates
    return `https://github.com/${owner}/${repository}/releases/tag/v${encodeURIComponent(version)}`
  }

  private updatePath(fileName: string): string {
    if (!/^[a-zA-Z0-9._-]{1,200}$/.test(fileName)) throw new Error('Unsafe update filename')
    const path = resolve(this.updatesDirectory, fileName)
    const root = `${resolve(this.updatesDirectory)}\\`
    if (!path.toLowerCase().startsWith(root.toLowerCase())) throw new Error('Unsafe update path')
    return path
  }

  private async cleanupUpdateCache(keepNames: ReadonlySet<string>): Promise<void> {
    try {
      const entries = await readdir(this.updatesDirectory, { withFileTypes: true })
      await Promise.all(
        entries.map(async (entry) => {
          if (
            !entry.isFile() ||
            keepNames.has(entry.name) ||
            !/^ORBIT(?:-Beta)?-XboxMode-Setup-[a-zA-Z0-9.-]+-x64\.exe(?:\.part)?$/.test(
              entry.name
            )
          ) {
            return
          }
          await rm(this.updatePath(entry.name), { force: true })
        })
      )
    } catch {
      // Cache cleanup is best-effort and never blocks update recovery.
    }
  }

  private setError(error: AppUpdateError): void {
    this.setSnapshot({
      stage: 'error',
      error,
      installScheduled: false,
      installCountdownEndsAt: undefined,
      transferredBytes: undefined,
      bytesPerSecond: undefined,
      verification: this.mode === 'nsis' ? 'installer-managed' : 'pending'
    })
  }

  private setSnapshot(patch: Partial<AppUpdateSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    this.publish()
  }

  private publish(): void {
    const gameActive = this.options.getGameLaunchPhase() !== 'idle'
    const blockedReason =
      this.snapshot.stage === 'ready'
        ? gameActive
          ? 'game-active'
          : undefined
        : this.snapshot.stage === 'available'
          ? 'not-downloaded'
          : undefined
    const downloadPausedReason =
      this.snapshot.stage === 'downloading'
        ? gameActive
          ? 'game-active'
          : this.options.hasActiveLauncherDownload()
            ? 'launcher-download-active'
            : undefined
        : undefined
    this.snapshot = {
      ...this.snapshot,
      canInstall: this.snapshot.stage === 'ready' && blockedReason === undefined,
      blockedReason,
      downloadPausedReason
    }
    if (
      this.disposed ||
      this.mainWindow.isDestroyed() ||
      this.mainWindow.webContents.isDestroyed()
    ) {
      return
    }
    this.mainWindow.webContents.send(IPC.appUpdateStatus, this.getSnapshot())
  }
}

export function launcherHasActiveDownload(phases: readonly string[]): boolean {
  return phases.some((phase) => ACTIVE_DOWNLOAD_PHASES.has(phase))
}
