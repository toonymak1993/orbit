import type {
  LibraryActivitySummary,
  LibraryActivityWindow,
  LibrarySessionRecord
} from './ipc'

const DAY_MS = 24 * 60 * 60 * 1_000

function summarizeWindow(
  sessions: readonly LibrarySessionRecord[],
  windowDays: number,
  now: number
): LibraryActivityWindow {
  const startsAt = now - windowDays * DAY_MS
  let playtimeSeconds = 0
  let sessionCount = 0

  for (const session of sessions) {
    if (session.endedAt < startsAt || session.startedAt > now) continue
    const overlapStart = Math.max(session.startedAt, startsAt)
    const overlapEnd = Math.min(session.endedAt, now)
    if (overlapEnd <= overlapStart) continue
    playtimeSeconds += Math.min(
      session.durationSeconds,
      Math.max(0, Math.round((overlapEnd - overlapStart) / 1_000))
    )
    sessionCount++
  }

  return { playtimeSeconds, sessionCount }
}

export function summarizeLibraryActivity(
  sessions: readonly LibrarySessionRecord[],
  now = Date.now()
): Omit<LibraryActivitySummary, 'continueGameId'> {
  const ordered = [...sessions].sort((left, right) => right.endedAt - left.endedAt)
  return {
    lastSession: ordered[0],
    sevenDays: summarizeWindow(ordered, 7, now),
    thirtyDays: summarizeWindow(ordered, 30, now),
    recordedSessionCount: ordered.length
  }
}
