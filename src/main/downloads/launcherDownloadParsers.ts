import type { LauncherDownloadActivity } from '../../shared/ipc'
import { clampLauncherProgress } from '../../shared/launcherDownloads'
import { parseSteamAppManifest } from '../steam/steamManifest'

const STEAM_FULLY_INSTALLED = 4
const STEAM_UPDATE_REQUIRED = 2
const STEAM_UPDATE_RUNNING = 256
const STEAM_UPDATE_PAUSED = 512
const STEAM_UPDATE_STARTED = 1_024
const STEAM_VALIDATING = 131_072
const STEAM_ADDING_FILES = 262_144
const STEAM_PREALLOCATING = 524_288
const STEAM_DOWNLOADING = 1_048_576
const STEAM_STAGING = 2_097_152
const STEAM_COMMITTING = 4_194_304
const STEAM_UPDATE_STOPPING = 8_388_608

const STEAM_ACTIVE_MASK =
  STEAM_UPDATE_RUNNING |
  STEAM_UPDATE_STARTED |
  STEAM_VALIDATING |
  STEAM_ADDING_FILES |
  STEAM_PREALLOCATING |
  STEAM_DOWNLOADING |
  STEAM_STAGING |
  STEAM_COMMITTING |
  STEAM_UPDATE_STOPPING

function safeText(value: unknown, maxLength = 160): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  return normalized ? normalized.slice(0, maxLength) : undefined
}

function finiteNonNegative(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  return value
}

export interface SteamDownloadSample {
  id: string
  providerGameId: string
  title: string
  stateFlags: number
  updateResult: number
  bytesToDownload?: number
  bytesDownloaded?: number
  bytesToStage?: number
  bytesStaged?: number
  sampledAt: number
}

export function parseSteamDownloadSample(
  source: string,
  sampledAt = Date.now()
): SteamDownloadSample | null {
  const manifest = parseSteamAppManifest(source)
  if (!manifest.appId || manifest.appId <= 0 || manifest.appId === 228980) return null

  const providerGameId = String(manifest.appId)
  return {
    id: `steam:${providerGameId}`,
    providerGameId,
    title: safeText(manifest.name) ?? `Steam ${providerGameId}`,
    stateFlags: manifest.stateFlags ?? 0,
    updateResult: manifest.updateResult ?? 0,
    bytesToDownload: finiteNonNegative(manifest.bytesToDownload),
    bytesDownloaded: finiteNonNegative(manifest.bytesDownloaded),
    bytesToStage: finiteNonNegative(manifest.bytesToStage),
    bytesStaged: finiteNonNegative(manifest.bytesStaged),
    sampledAt
  }
}

function usableProgress(completed: number | undefined, total: number | undefined): number | undefined {
  if (completed === undefined || total === undefined || total <= 0) return undefined
  return clampLauncherProgress(completed / total)
}

export function isSteamDownloadComplete(sample: SteamDownloadSample): boolean {
  const downloadComplete =
    sample.bytesToDownload !== undefined &&
    sample.bytesToDownload > 0 &&
    sample.bytesDownloaded !== undefined &&
    sample.bytesDownloaded >= sample.bytesToDownload
  const stageComplete =
    sample.bytesToStage === undefined ||
    sample.bytesToStage <= 0 ||
    (sample.bytesStaged !== undefined && sample.bytesStaged >= sample.bytesToStage)
  const readyState =
    (sample.stateFlags & STEAM_FULLY_INSTALLED) !== 0 &&
    (sample.stateFlags & STEAM_UPDATE_REQUIRED) === 0 &&
    sample.updateResult === 0
  return (
    (sample.stateFlags & STEAM_ACTIVE_MASK) === 0 &&
    ((downloadComplete && stageComplete) || readyState)
  )
}

export function isSteamDownloadFailed(sample: SteamDownloadSample): boolean {
  return sample.updateResult !== 0 && (sample.stateFlags & STEAM_ACTIVE_MASK) === 0
}

export function deriveSteamDownloadActivity(
  sample: SteamDownloadSample,
  previous?: SteamDownloadSample
): LauncherDownloadActivity | null {
  const elapsedSeconds = previous ? (sample.sampledAt - previous.sampledAt) / 1_000 : 0
  const downloadDelta =
    previous && sample.bytesDownloaded !== undefined && previous.bytesDownloaded !== undefined
      ? sample.bytesDownloaded - previous.bytesDownloaded
      : 0
  const stageDelta =
    previous && sample.bytesStaged !== undefined && previous.bytesStaged !== undefined
      ? sample.bytesStaged - previous.bytesStaged
      : 0
  const hasForwardProgress = downloadDelta > 0 || stageDelta > 0
  const paused = (sample.stateFlags & STEAM_UPDATE_PAUSED) !== 0
  const active = (sample.stateFlags & STEAM_ACTIVE_MASK) !== 0 || hasForwardProgress
  if (!paused && !active) return null

  const applying =
    (sample.stateFlags &
      (STEAM_ADDING_FILES | STEAM_PREALLOCATING | STEAM_STAGING | STEAM_COMMITTING)) !==
    0
  const verifying = (sample.stateFlags & STEAM_VALIDATING) !== 0
  const phase = paused
    ? 'paused'
    : verifying
      ? 'verifying'
      : applying
        ? 'installing'
        : (sample.stateFlags & STEAM_FULLY_INSTALLED) !== 0
          ? 'updating'
          : 'downloading'
  const progress = applying
    ? (usableProgress(sample.bytesStaged, sample.bytesToStage) ??
      usableProgress(sample.bytesDownloaded, sample.bytesToDownload))
    : usableProgress(sample.bytesDownloaded, sample.bytesToDownload)
  const bytesPerSecond =
    elapsedSeconds > 0 && downloadDelta > 0 ? Math.round(downloadDelta / elapsedSeconds) : undefined
  const etaSeconds =
    bytesPerSecond && sample.bytesToDownload !== undefined && sample.bytesDownloaded !== undefined
      ? Math.max(0, Math.round((sample.bytesToDownload - sample.bytesDownloaded) / bytesPerSecond))
      : undefined

  return {
    id: sample.id,
    provider: 'steam',
    providerGameId: sample.providerGameId,
    gameId: sample.id,
    title: sample.title,
    phase,
    confidence: 'exact',
    progress,
    bytesDownloaded: sample.bytesDownloaded,
    bytesTotal: sample.bytesToDownload,
    bytesPerSecond,
    etaSeconds,
    updatedAt: sample.sampledAt
  }
}

interface EpicPendingPayload {
  AppName?: unknown
  DisplayName?: unknown
  FullAppName?: unknown
  InstallLocation?: unknown
  InstallSize?: unknown
  bIsIncompleteInstall?: unknown
}

export interface EpicDownloadSample {
  id: string
  providerGameId: string
  title: string
  installLocation?: string
  bytesTotal?: number
  modifiedAt: number
}

export function parseEpicDownloadSample(
  source: string,
  modifiedAt = Date.now()
): EpicDownloadSample | null {
  let payload: EpicPendingPayload
  try {
    payload = JSON.parse(source) as EpicPendingPayload
  } catch {
    return null
  }
  if (payload.bIsIncompleteInstall === false) return null
  const providerGameId = safeText(payload.AppName, 120)
  if (!providerGameId) return null
  const rawSize =
    typeof payload.InstallSize === 'string' ? Number(payload.InstallSize) : payload.InstallSize

  return {
    id: `epic:${providerGameId}`,
    providerGameId,
    title:
      safeText(payload.DisplayName) ?? safeText(payload.FullAppName) ?? `Epic ${providerGameId}`,
    installLocation: safeText(payload.InstallLocation, 1_024),
    bytesTotal: finiteNonNegative(rawSize),
    modifiedAt
  }
}

export function deriveEpicDownloadActivity(
  sample: EpicDownloadSample,
  latestDiskActivityAt: number,
  now = Date.now(),
  activeWindowMs = 20_000,
  visiblePausedWindowMs = 15 * 60_000
): LauncherDownloadActivity | null {
  const latestActivityAt = Math.max(sample.modifiedAt, latestDiskActivityAt)
  const age = Math.max(0, now - latestActivityAt)
  if (age > visiblePausedWindowMs) return null

  return {
    id: sample.id,
    provider: 'epic',
    providerGameId: sample.providerGameId,
    gameId: sample.id,
    title: sample.title,
    phase: age <= activeWindowMs ? 'downloading' : 'paused',
    confidence: 'heuristic',
    bytesTotal: sample.bytesTotal,
    updatedAt: now
  }
}
