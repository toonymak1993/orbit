import { EventEmitter } from 'node:events'
import { readdir, readFile, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type {
  LauncherDownloadActivity,
  LauncherDownloadSnapshot,
  LibraryGame
} from '../../shared/ipc'
import { gameRepository } from '../library/gameRepository'
import { getSteamAppsDirectories } from '../steam/steamInstall'
import { xboxLibraryService } from '../xbox/xboxLibrary'
import {
  deriveXboxPackageProgressState,
  xboxPackageActivityMonitor,
  type XboxPackageProgressEvent
} from '../xbox/xboxPackageActivity'
import {
  xboxProductInstallService,
  type XboxProductInstallProgress
} from '../xbox/xboxInstallRequest'
import {
  deriveEpicDownloadActivity,
  deriveSteamDownloadActivity,
  isSteamDownloadComplete,
  isSteamDownloadFailed,
  parseEpicDownloadSample,
  parseSteamDownloadSample,
  type EpicDownloadSample,
  type SteamDownloadSample
} from './launcherDownloadParsers'

const ACTIVE_POLL_MS = 1_250
const IDLE_POLL_MS = 5_000
const STEAM_DIRECTORIES_REFRESH_MS = 60_000
const TRANSIENT_FILE_GRACE_MS = 5_000
const TERMINAL_VISIBLE_MS = 4_500
const MAX_STEAM_MANIFEST_BYTES = 2 * 1024 * 1024
const MAX_EPIC_PENDING_ITEMS = 32
const MAX_EPIC_MANIFEST_BYTES = 2 * 1024 * 1024
const MAX_EPIC_SHALLOW_ENTRIES = 128
const XBOX_ACTIVITY_STALE_MS = 2 * 60_000
const XBOX_REQUEST_STALE_MS = 10 * 60_000
const XBOX_PHASE_TRANSITION_MS = 20_000
const XBOX_PENDING_EVENT_MS = 2 * 60_000
const MAX_PENDING_XBOX_PACKAGES = 32
const XBOX_LIBRARY_RETRY_DELAYS_MS = [250, 1_500, 5_000, 12_000] as const

interface TerminalActivity {
  activity: LauncherDownloadActivity
  expiresAt: number
}

interface SteamManifestCacheEntry {
  modifiedAt: number
  size: number
  sample: SteamDownloadSample | null
}

interface PendingXboxEvent {
  event: XboxPackageProgressEvent
  receivedAt: number
}

interface XboxLibraryRefresh {
  packageFamilyName: string
  gamingProductId?: string
  completeIslandOnSuccess: boolean
  attempt: number
  timer?: ReturnType<typeof setTimeout>
}

function sanitizedLibraryTitle(activity: LauncherDownloadActivity): LauncherDownloadActivity {
  try {
    const game = activity.gameId ? gameRepository.getGame(activity.gameId) : undefined
    return game?.name ? { ...activity, title: game.name.slice(0, 160) } : activity
  } catch {
    return activity
  }
}

function publicActivityFingerprint(activity: LauncherDownloadActivity): string {
  const { updatedAt: _updatedAt, ...stable } = activity
  return JSON.stringify(stable)
}

function terminalActivity(
  activity: LauncherDownloadActivity,
  phase: 'completed' | 'error',
  now: number
): TerminalActivity {
  return {
    activity: {
      ...activity,
      phase,
      progress: phase === 'completed' ? 1 : activity.progress,
      bytesDownloaded:
        phase === 'completed' ? (activity.bytesTotal ?? activity.bytesDownloaded) : activity.bytesDownloaded,
      bytesPerSecond: undefined,
      etaSeconds: undefined,
      updatedAt: now
    },
    expiresAt: now + TERMINAL_VISIBLE_MS
  }
}

async function steamSamples(
  steamAppsDirectories: readonly string[],
  sampledAt: number,
  cache: Map<string, SteamManifestCacheEntry>,
  activeIds: ReadonlySet<string>,
  refreshAll: boolean
): Promise<Map<string, SteamDownloadSample>> {
  const paths: string[] = []
  for (const directory of steamAppsDirectories) {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    for (const entry of entries) {
      if (entry.isFile() && /^appmanifest_\d+\.acf$/i.test(entry.name)) {
        paths.push(join(directory, entry.name))
      }
    }
  }

  const result = new Map<string, SteamDownloadSample>()
  const livePaths = new Set(paths)
  for (const path of cache.keys()) {
    if (!livePaths.has(path)) cache.delete(path)
  }
  const attempts = await Promise.allSettled(
    paths.map(async (path) => {
      const cached = cache.get(path)
      if (cached && !refreshAll && (!cached.sample || !activeIds.has(cached.sample.id))) {
        return cached.sample ? { ...cached.sample, sampledAt } : null
      }
      const metadata = await stat(path)
      if (cached && cached.modifiedAt === metadata.mtimeMs && cached.size === metadata.size) {
        return cached.sample ? { ...cached.sample, sampledAt } : null
      }
      if (metadata.size <= 0 || metadata.size > MAX_STEAM_MANIFEST_BYTES) {
        cache.set(path, { modifiedAt: metadata.mtimeMs, size: metadata.size, sample: null })
        return null
      }
      const sample = parseSteamDownloadSample(await readFile(path, 'utf8'), sampledAt)
      cache.set(path, { modifiedAt: metadata.mtimeMs, size: metadata.size, sample })
      return sample
    })
  )
  attempts.forEach((attempt) => {
    if (attempt.status !== 'fulfilled') return
    if (attempt.value) result.set(attempt.value.id, attempt.value)
  })
  return result
}

async function epicSamples(pendingDirectory: string): Promise<Map<string, EpicDownloadSample>> {
  let entries
  try {
    entries = await readdir(pendingDirectory, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map()
    throw error
  }

  const itemPaths = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.item'))
    .slice(0, MAX_EPIC_PENDING_ITEMS)
    .map((entry) => join(pendingDirectory, entry.name))
  const attempts = await Promise.allSettled(
    itemPaths.map(async (path) => {
      const metadata = await stat(path)
      if (metadata.size <= 0 || metadata.size > MAX_EPIC_MANIFEST_BYTES) return null
      const source = await readFile(path, 'utf8')
      return parseEpicDownloadSample(source, metadata.mtimeMs)
    })
  )

  const result = new Map<string, EpicDownloadSample>()
  for (const attempt of attempts) {
    if (attempt.status === 'fulfilled' && attempt.value) result.set(attempt.value.id, attempt.value)
  }
  return result
}

async function latestShallowMtime(directory: string): Promise<number> {
  let latest = 0
  try {
    const metadata = await stat(directory)
    latest = metadata.mtimeMs
    const entries = (await readdir(directory, { withFileTypes: true })).slice(
      0,
      MAX_EPIC_SHALLOW_ENTRIES
    )
    const timestamps = await Promise.allSettled(entries.map((entry) => stat(join(directory, entry.name))))
    for (const timestamp of timestamps) {
      if (timestamp.status === 'fulfilled') latest = Math.max(latest, timestamp.value.mtimeMs)
    }
  } catch {
    // Missing or locked staging folders are a normal partial signal.
  }
  return latest
}

async function latestEpicDiskActivity(sample: EpicDownloadSample): Promise<number> {
  const location = sample.installLocation
  if (!location || !isAbsolute(location) || location.includes('\0')) return sample.modifiedAt
  const stagingRoot = join(location, '.egstore')
  const timestamps = await Promise.all([
    latestShallowMtime(stagingRoot),
    latestShallowMtime(join(stagingRoot, 'Pending')),
    latestShallowMtime(join(stagingRoot, 'bps')),
    latestShallowMtime(join(stagingRoot, 'bps', 'f'))
  ])
  return Math.max(sample.modifiedAt, ...timestamps)
}

export class LauncherDownloadMonitor extends EventEmitter {
  private running = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private steamAppsDirectories: string[] | undefined
  private steamDirectoriesCheckedAt = 0
  private lastFullSteamScanAt = 0
  private steamManifestCache = new Map<string, SteamManifestCacheEntry>()
  private steamSamples = new Map<string, SteamDownloadSample>()
  private steamActivities = new Map<string, LauncherDownloadActivity>()
  private epicActivities = new Map<string, LauncherDownloadActivity>()
  private xboxActivities = new Map<string, LauncherDownloadActivity>()
  private xboxRequestedActivities = new Map<string, LauncherDownloadActivity>()
  private xboxTransitionExpiries = new Map<string, number>()
  private pendingXboxEvents = new Map<string, PendingXboxEvent>()
  private xboxLibraryRefreshes = new Map<string, XboxLibraryRefresh>()
  private terminalActivities = new Map<string, TerminalActivity>()
  private fingerprint = ''
  private snapshot: LauncherDownloadSnapshot = {
    revision: 0,
    updatedAt: Date.now(),
    activities: []
  }

  start(): void {
    if (this.running) return
    this.running = true
    xboxPackageActivityMonitor.on('progress', this.receiveXboxProgress)
    xboxPackageActivityMonitor.on('unavailable', this.receiveXboxUnavailable)
    xboxProductInstallService.on('progress', this.receiveXboxProductInstallProgress)
    xboxLibraryService.on('updated', this.receiveXboxLibraryUpdate)
    xboxPackageActivityMonitor.start()
    this.schedule(350)
  }

  stop(): void {
    if (!this.running) return
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.steamAppsDirectories = undefined
    this.steamDirectoriesCheckedAt = 0
    this.lastFullSteamScanAt = 0
    this.steamManifestCache.clear()
    this.steamSamples.clear()
    this.steamActivities.clear()
    this.epicActivities.clear()
    this.xboxActivities.clear()
    this.xboxRequestedActivities.clear()
    this.xboxTransitionExpiries.clear()
    this.pendingXboxEvents.clear()
    for (const refresh of this.xboxLibraryRefreshes.values()) {
      if (refresh.timer) clearTimeout(refresh.timer)
    }
    this.xboxLibraryRefreshes.clear()
    this.terminalActivities.clear()
    this.fingerprint = ''
    this.snapshot = {
      revision: this.snapshot.revision + 1,
      updatedAt: Date.now(),
      activities: []
    }
    xboxPackageActivityMonitor.off('progress', this.receiveXboxProgress)
    xboxPackageActivityMonitor.off('unavailable', this.receiveXboxUnavailable)
    xboxProductInstallService.off('progress', this.receiveXboxProductInstallProgress)
    xboxProductInstallService.stop()
    xboxLibraryService.off('updated', this.receiveXboxLibraryUpdate)
    xboxPackageActivityMonitor.stop()
  }

  getSnapshot(): LauncherDownloadSnapshot {
    return {
      ...this.snapshot,
      activities: this.snapshot.activities.map((activity) => ({ ...activity }))
    }
  }

  private schedule(delay: number): void {
    if (!this.running) return
    this.timer = setTimeout(() => void this.scanAndSchedule(), delay)
  }

  /** Makes an accepted ORBIT install request visible immediately. The exact
   * AppInstallStatus stream replaces this optimistic 0% state as soon as
   * Windows publishes its first queue sample. */
  announceXboxInstallRequest(game: LibraryGame, productId: string): void {
    if (!this.running || game.provider !== 'xbox' || !/^[A-Z0-9]{12}$/.test(productId)) return
    const now = Date.now()
    const id = `xbox:request:${productId.toLowerCase()}`
    if (this.xboxRequestedActivities.get(id)?.confidence === 'exact') return
    this.xboxRequestedActivities.set(id, {
      id,
      provider: 'xbox',
      providerGameId: productId,
      gameId: game.id,
      title: game.name.slice(0, 160),
      phase: 'downloading',
      confidence: 'heuristic',
      progress: 0,
      updatedAt: now
    })
    this.publish(now)
  }

  private readonly receiveXboxProductInstallProgress = (
    event: XboxProductInstallProgress
  ): void => {
    if (!this.running) return
    const now = Date.now()
    const id = `xbox:request:${event.productId.toLowerCase()}`
    const previous = this.xboxRequestedActivities.get(id)
    let game = previous?.gameId ? gameRepository.getGame(previous.gameId) : undefined
    if (!game) game = gameRepository.getGame(`xbox:${event.productId}`)
    const activity: LauncherDownloadActivity = {
      id,
      provider: 'xbox',
      providerGameId: event.productId,
      gameId: game?.id ?? previous?.gameId,
      title: (game?.name ?? previous?.title ?? 'Xbox game').slice(0, 160),
      phase: event.phase,
      confidence: 'exact',
      progress: event.progress,
      bytesDownloaded: event.bytesDownloaded,
      bytesTotal: event.bytesTotal,
      updatedAt: now
    }

    for (const [packageId, packageActivity] of this.xboxActivities) {
      if (
        packageActivity.providerGameId === event.productId ||
        (activity.gameId && packageActivity.gameId === activity.gameId)
      ) {
        this.xboxActivities.delete(packageId)
        this.xboxTransitionExpiries.delete(packageId)
      }
    }

    if (event.phase === 'completed' || event.phase === 'error') {
      this.xboxRequestedActivities.delete(id)
      this.terminalActivities.set(
        id,
        terminalActivity(activity, event.phase === 'error' ? 'error' : 'completed', now)
      )
    } else {
      this.terminalActivities.delete(id)
      this.xboxRequestedActivities.set(id, activity)
    }
    this.publish(now)
  }

  private readonly receiveXboxProgress = (event: XboxPackageProgressEvent): void => {
    if (!this.running) return
    const now = Date.now()
    const key = event.packageFamilyName.toLowerCase()
    let game
    try {
      game = xboxLibraryService.resolvePackageFamilyName(
        event.packageFamilyName,
        event.gamingProductId
      )
    } catch {
      // The monitor can become ready a few milliseconds before the renderer
      // hydrates the persistent library. The next heartbeat resolves identity.
      game = undefined
    }
    const state = deriveXboxPackageProgressState(event)
    if (event.stage === 'status') {
      if (state.refreshLibrary && (game || event.isGamingPackage)) {
        this.scheduleXboxLibraryRefresh(event)
      }
      return
    }
    const requestedId = event.gamingProductId
      ? `xbox:request:${event.gamingProductId.toLowerCase()}`
      : undefined
    const requested = requestedId
      ? this.xboxRequestedActivities.get(requestedId)
      : [...this.xboxRequestedActivities.values()].find(
          (activity) => game?.id && activity.gameId === game.id
        )
    if (requested?.confidence === 'exact') {
      if (state.refreshLibrary) this.scheduleXboxLibraryRefresh(event)
      return
    }
    if (requested) this.xboxRequestedActivities.delete(requested.id)
    if (!game && !event.isGamingPackage) {
      if (this.pendingXboxEvents.size >= MAX_PENDING_XBOX_PACKAGES) {
        const oldest = this.pendingXboxEvents.keys().next().value as string | undefined
        if (oldest) this.pendingXboxEvents.delete(oldest)
      }
      this.pendingXboxEvents.set(key, { event, receivedAt: now })
      if (
        state.refreshLibrary
      ) {
        this.scheduleXboxLibraryRefresh(event)
      }
      return
    }
    this.pendingXboxEvents.delete(key)
    const activityId = `xbox:${key}`
    const activity: LauncherDownloadActivity = {
      id: activityId,
      provider: 'xbox',
      providerGameId:
        game?.providerGameId ?? event.gamingProductId ?? `package:${event.packageFamilyName}`,
      gameId: game?.id,
      title: (game?.name ?? event.displayName ?? 'Xbox game').slice(0, 160),
      phase: state.phase ?? 'downloading',
      confidence: event.stage === 'streaming' ? 'heuristic' : 'approximate',
      progress: event.progress,
      updatedAt: now
    }
    if (state.terminal) {
      this.xboxActivities.delete(activity.id)
      this.xboxTransitionExpiries.delete(activity.id)
      this.terminalActivities.set(
        activity.id,
        terminalActivity(activity, activity.phase === 'error' ? 'error' : 'completed', now)
      )
    } else {
      this.terminalActivities.delete(activity.id)
      this.xboxActivities.set(activity.id, activity)
      if (state.phaseTransition) {
        this.xboxTransitionExpiries.set(activity.id, now + XBOX_PHASE_TRANSITION_MS)
      } else {
        this.xboxTransitionExpiries.delete(activity.id)
      }
    }
    if (state.refreshLibrary) this.scheduleXboxLibraryRefresh(event)
    this.publish(now)
  }

  private readonly receiveXboxLibraryUpdate = (): void => {
    if (!this.running || this.pendingXboxEvents.size === 0) return
    const now = Date.now()
    for (const [key, pending] of [...this.pendingXboxEvents]) {
      if (now - pending.receivedAt > XBOX_PENDING_EVENT_MS) {
        this.pendingXboxEvents.delete(key)
        continue
      }
      let game
      try {
        game = xboxLibraryService.resolvePackageFamilyName(
          pending.event.packageFamilyName,
          pending.event.gamingProductId
        )
      } catch {
        continue
      }
      if (!game) continue
      this.pendingXboxEvents.delete(key)
      this.receiveXboxProgress(pending.event)
    }
  }

  private scheduleXboxLibraryRefresh(event: XboxPackageProgressEvent): void {
    const key = event.packageFamilyName.toLowerCase()
    const current = this.xboxLibraryRefreshes.get(key)
    if (current) {
      if (!current.gamingProductId && event.gamingProductId) {
        current.gamingProductId = event.gamingProductId
      }
      if (event.stage === 'status') current.completeIslandOnSuccess = true
      return
    }
    const refresh: XboxLibraryRefresh = {
      packageFamilyName: event.packageFamilyName,
      gamingProductId: event.gamingProductId,
      completeIslandOnSuccess: event.stage === 'status',
      attempt: 0
    }
    this.xboxLibraryRefreshes.set(key, refresh)
    this.scheduleXboxLibraryRefreshAttempt(key, refresh)
  }

  private scheduleXboxLibraryRefreshAttempt(key: string, refresh: XboxLibraryRefresh): void {
    const delay = XBOX_LIBRARY_RETRY_DELAYS_MS[refresh.attempt]
    if (delay === undefined) {
      this.xboxLibraryRefreshes.delete(key)
      return
    }
    refresh.timer = setTimeout(() => {
      refresh.timer = undefined
      void xboxLibraryService
        .refreshInstalledPackage(refresh.packageFamilyName, refresh.gamingProductId)
        .then((found) => {
          if (!this.running || this.xboxLibraryRefreshes.get(key) !== refresh) return
          if (found) {
            this.xboxLibraryRefreshes.delete(key)
            if (refresh.completeIslandOnSuccess) {
              const activityId = `xbox:${key}`
              const activity = this.xboxActivities.get(activityId)
              if (activity) {
                const now = Date.now()
                this.xboxActivities.delete(activityId)
                this.xboxTransitionExpiries.delete(activityId)
                this.terminalActivities.set(
                  activityId,
                  terminalActivity(activity, 'completed', now)
                )
                this.publish(now)
              }
            }
            return
          }
          refresh.attempt += 1
          this.scheduleXboxLibraryRefreshAttempt(key, refresh)
        })
        .catch(() => {
          if (!this.running || this.xboxLibraryRefreshes.get(key) !== refresh) return
          refresh.attempt += 1
          this.scheduleXboxLibraryRefreshAttempt(key, refresh)
        })
    }, delay)
  }

  private readonly receiveXboxUnavailable = (): void => {
    if (!this.running || this.xboxActivities.size === 0) return
    this.xboxActivities.clear()
    this.xboxTransitionExpiries.clear()
    this.publish(Date.now())
  }

  private async scanAndSchedule(): Promise<void> {
    const now = Date.now()
    if (
      !this.steamAppsDirectories ||
      now - this.steamDirectoriesCheckedAt >= STEAM_DIRECTORIES_REFRESH_MS
    ) {
      try {
        this.steamAppsDirectories = getSteamAppsDirectories()
      } catch {
        this.steamAppsDirectories = []
      }
      this.steamDirectoriesCheckedAt = now
    }

    const epicPendingDirectory = join(
      process.env.ProgramData ?? 'C:\\ProgramData',
      'Epic',
      'EpicGamesLauncher',
      'Data',
      'Manifests',
      'Pending'
    )
    const refreshAllSteamManifests = now - this.lastFullSteamScanAt >= IDLE_POLL_MS
    const [steamAttempt, epicAttempt] = await Promise.allSettled([
      steamSamples(
        this.steamAppsDirectories,
        now,
        this.steamManifestCache,
        new Set(this.steamActivities.keys()),
        refreshAllSteamManifests
      ),
      epicSamples(epicPendingDirectory)
    ])
    if (!this.running) return
    if (steamAttempt.status === 'fulfilled') {
      if (refreshAllSteamManifests) this.lastFullSteamScanAt = now
      this.reconcileSteam(steamAttempt.value, now)
    }
    if (epicAttempt.status === 'fulfilled') await this.reconcileEpic(epicAttempt.value, now)
    if (!this.running) return

    this.publish(now)
    this.schedule(this.snapshot.activities.length > 0 ? ACTIVE_POLL_MS : IDLE_POLL_MS)
  }

  private reconcileSteam(samples: Map<string, SteamDownloadSample>, now: number): void {
    const next = new Map<string, LauncherDownloadActivity>()
    for (const sample of samples.values()) {
      const activity = deriveSteamDownloadActivity(sample, this.steamSamples.get(sample.id))
      if (activity) {
        next.set(activity.id, sanitizedLibraryTitle(activity))
        this.terminalActivities.delete(activity.id)
        continue
      }

      const previous = this.steamActivities.get(sample.id)
      if (!previous) continue
      if (isSteamDownloadFailed(sample)) {
        this.terminalActivities.set(sample.id, terminalActivity(previous, 'error', now))
      } else if (isSteamDownloadComplete(sample)) {
        this.terminalActivities.set(sample.id, terminalActivity(previous, 'completed', now))
      } else if (now - previous.updatedAt <= TRANSIENT_FILE_GRACE_MS) {
        next.set(previous.id, previous)
      }
    }

    for (const previous of this.steamActivities.values()) {
      if (
        !samples.has(previous.id) &&
        now - previous.updatedAt <= TRANSIENT_FILE_GRACE_MS
      ) {
        next.set(previous.id, previous)
      }
    }
    this.steamSamples = samples
    this.steamActivities = next
  }

  private async reconcileEpic(samples: Map<string, EpicDownloadSample>, now: number): Promise<void> {
    const next = new Map<string, LauncherDownloadActivity>()
    const candidates = await Promise.all(
      [...samples.values()].map(async (sample) =>
        deriveEpicDownloadActivity(sample, await latestEpicDiskActivity(sample), now)
      )
    )
    if (!this.running) return
    for (const activity of candidates) {
      if (!activity) continue
      next.set(activity.id, sanitizedLibraryTitle(activity))
      this.terminalActivities.delete(activity.id)
    }

    for (const previous of this.epicActivities.values()) {
      if (samples.has(previous.id)) continue
      if (now - previous.updatedAt <= TRANSIENT_FILE_GRACE_MS) {
        next.set(previous.id, previous)
      }
    }
    this.epicActivities = next
  }

  private publish(now: number): void {
    for (const [id, activity] of this.xboxActivities) {
      const transitionExpiry = this.xboxTransitionExpiries.get(id)
      if (
        (transitionExpiry !== undefined && transitionExpiry <= now) ||
        now - activity.updatedAt > XBOX_ACTIVITY_STALE_MS
      ) {
        this.xboxActivities.delete(id)
        this.xboxTransitionExpiries.delete(id)
      }
    }
    for (const [key, pending] of this.pendingXboxEvents) {
      if (now - pending.receivedAt > XBOX_PENDING_EVENT_MS) this.pendingXboxEvents.delete(key)
    }
    for (const [id, activity] of this.xboxRequestedActivities) {
      if (now - activity.updatedAt > XBOX_REQUEST_STALE_MS) {
        this.xboxRequestedActivities.delete(id)
      }
    }
    for (const [id, terminal] of this.terminalActivities) {
      if (terminal.expiresAt <= now) this.terminalActivities.delete(id)
    }
    const liveIds = new Set([
      ...this.steamActivities.keys(),
      ...this.epicActivities.keys(),
      ...this.xboxActivities.keys(),
      ...this.xboxRequestedActivities.keys()
    ])
    const activities = [
      ...this.steamActivities.values(),
      ...this.epicActivities.values(),
      ...this.xboxActivities.values(),
      ...this.xboxRequestedActivities.values(),
      ...[...this.terminalActivities.values()]
        .filter((terminal) => !liveIds.has(terminal.activity.id))
        .map((terminal) => terminal.activity)
    ].sort((left, right) => {
      const leftTerminal = left.phase === 'completed' || left.phase === 'error'
      const rightTerminal = right.phase === 'completed' || right.phase === 'error'
      return Number(leftTerminal) - Number(rightTerminal) || right.updatedAt - left.updatedAt
    })
    const fingerprint = activities.map(publicActivityFingerprint).join('\n')
    if (fingerprint === this.fingerprint) return

    this.fingerprint = fingerprint
    this.snapshot = {
      revision: this.snapshot.revision + 1,
      updatedAt: now,
      activities
    }
    this.emit('updated', this.getSnapshot())
  }
}

export const launcherDownloadMonitor = new LauncherDownloadMonitor()
