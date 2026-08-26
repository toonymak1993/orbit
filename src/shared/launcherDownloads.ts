import type { LauncherDownloadActivity, LauncherDownloadSnapshot } from './ipc'

const PHASE_PRIORITY: Record<LauncherDownloadActivity['phase'], number> = {
  downloading: 0,
  updating: 1,
  installing: 2,
  verifying: 3,
  paused: 4,
  error: 5,
  completed: 6
}

export function clampLauncherProgress(value: number | undefined): number | undefined {
  return value === undefined || !Number.isFinite(value)
    ? undefined
    : Math.min(1, Math.max(0, value))
}

export function orderedLauncherDownloads(
  activities: readonly LauncherDownloadActivity[]
): LauncherDownloadActivity[] {
  return [...activities].sort(
    (left, right) =>
      PHASE_PRIORITY[left.phase] - PHASE_PRIORITY[right.phase] ||
      right.updatedAt - left.updatedAt ||
      left.id.localeCompare(right.id)
  )
}

export function shouldApplyLauncherDownloadSnapshot(
  current: LauncherDownloadSnapshot,
  incoming: LauncherDownloadSnapshot
): boolean {
  return Number.isSafeInteger(incoming.revision) && incoming.revision > current.revision
}
