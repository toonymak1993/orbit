export interface PlaytimeRecord {
  playtimeSeconds?: number
  playtimeMinutes?: number
  providerPlaytimeSeconds?: number
  pendingPlaytimeSeconds?: number
}

export function validPlaytimeSeconds(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  return Math.round(value)
}

export function playtimeSecondsFrom(candidate: {
  playtimeSeconds?: number
  playtimeMinutes?: number
}): number | undefined {
  return (
    validPlaytimeSeconds(candidate.playtimeSeconds) ??
    validPlaytimeSeconds(
      typeof candidate.playtimeMinutes === 'number' ? candidate.playtimeMinutes * 60 : undefined
    )
  )
}

export function reconcileProviderPlaytime(
  existing: PlaytimeRecord | undefined,
  reportedSeconds: number | undefined
): PlaytimeRecord {
  const currentSeconds = existing ? playtimeSecondsFrom(existing) : undefined
  const currentProviderSeconds = validPlaytimeSeconds(existing?.providerPlaytimeSeconds)
  const currentPendingSeconds = validPlaytimeSeconds(existing?.pendingPlaytimeSeconds) ?? 0

  if (reportedSeconds === undefined) {
    return {
      playtimeSeconds: currentSeconds,
      playtimeMinutes: currentSeconds === undefined ? existing?.playtimeMinutes : currentSeconds / 60,
      providerPlaytimeSeconds: currentProviderSeconds,
      pendingPlaytimeSeconds: currentPendingSeconds || undefined
    }
  }

  // Provider totals are monotonic. A lower response is treated as stale so a
  // temporary partial account response cannot erase a known-good playtime.
  const acceptedProviderSeconds = Math.max(reportedSeconds, currentProviderSeconds ?? 0)
  const acknowledgedSeconds =
    currentProviderSeconds === undefined
      ? 0
      : Math.max(0, acceptedProviderSeconds - currentProviderSeconds)
  // Historical ORBIT fallback time is replaced by the first provider total,
  // while explicitly pending sessions remain until the launcher acknowledges
  // them. After a baseline exists, acknowledgements reduce that pending part.
  const pendingPlaytimeSeconds =
    currentProviderSeconds === undefined
      ? currentPendingSeconds
      : Math.max(0, currentPendingSeconds - acknowledgedSeconds)
  const playtimeSeconds = acceptedProviderSeconds + pendingPlaytimeSeconds

  return {
    playtimeSeconds,
    playtimeMinutes: playtimeSeconds / 60,
    providerPlaytimeSeconds: acceptedProviderSeconds,
    pendingPlaytimeSeconds: pendingPlaytimeSeconds || undefined
  }
}
