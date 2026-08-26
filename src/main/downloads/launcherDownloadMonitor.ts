import { EventEmitter } from 'node:events'
import { readdir, readFile, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type {
  LauncherDownloadActivity,
  LauncherDownloadSnapshot
} from '../../shared/ipc'
import { gameRepository } from '../library/gameRepository'
import { getSteamAppsDirectories } from '../steam/steamInstall'
import { xboxLibraryService } from '../xbox/xboxLibrary'
import {
  xboxPackageActivityMonitor,
  type XboxPackageProgressEvent
} from '../xbox/xboxPackageActivity'
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

interface TerminalActivity {
  activity: LauncherDownloadActivity
  expiresAt: number
}

interface SteamManifestCacheEntry {
  modifiedAt: number
  size: number
  sample: SteamDownloadSample | null
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
    this.terminalActivities.clear()
    this.fingerprint = ''
    this.snapshot = {
      revision: this.snapshot.revision + 1,
      updatedAt: Date.now(),
      activities: []
    }
    xboxPackageActivityMonitor.off('progress', this.receiveXboxProgress)
    xboxPackageActivityMonitor.off('unavailable', this.receiveXboxUnavailable)
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

  private readonly receiveXboxProgress = (event: XboxPackageProgressEvent): void => {
    if (!this.running) return
    const game = xboxLibraryService.resolvePackageFamilyName(event.packageFamilyName)
    if (!game) return
    const now = Date.now()
    const activity: LauncherDownloadActivity = {
      id: `${game.id}:${event.activityId}`,
      provider: 'xbox',
      providerGameId: game.providerGameId,
      gameId: game.id,
      title: game.name.slice(0, 160),
      phase: event.isComplete
        ? event.errorHResult === 0
          ? 'completed'
          : 'error'
        : event.operation === 'update'
          ? 'updating'
          : 'downloading',
      confidence: 'approximate',
      progress: event.progress,
      updatedAt: now
    }
    if (event.isComplete) {
      this.xboxActivities.delete(activity.id)
      this.terminalActivities.set(
        activity.id,
        terminalActivity(activity, activity.phase === 'error' ? 'error' : 'completed', now)
      )
    } else {
      this.terminalActivities.delete(activity.id)
      this.xboxActivities.set(activity.id, activity)
    }
    this.publish(now)
  }

  private readonly receiveXboxUnavailable = (): void => {
    if (!this.running || this.xboxActivities.size === 0) return
    this.xboxActivities.clear()
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
      if (now - activity.updatedAt > XBOX_ACTIVITY_STALE_MS) this.xboxActivities.delete(id)
    }
    for (const [id, terminal] of this.terminalActivities) {
      if (terminal.expiresAt <= now) this.terminalActivities.delete(id)
    }
    const liveIds = new Set([
      ...this.steamActivities.keys(),
      ...this.epicActivities.keys(),
      ...this.xboxActivities.keys()
    ])
    const activities = [
      ...this.steamActivities.values(),
      ...this.epicActivities.values(),
      ...this.xboxActivities.values(),
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
