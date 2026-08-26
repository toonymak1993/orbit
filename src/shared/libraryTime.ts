export interface LibraryActivityTimestamps {
  lastStartedAt?: number
  lastPlayedTimestamp?: number
}

/** Converts legacy Unix-second timestamps and current millisecond timestamps to milliseconds. */
export function normalizeLibraryTimestamp(value?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0
  return Math.round(value < 10_000_000_000 ? value * 1_000 : value)
}

export function latestLibraryActivity(game: LibraryActivityTimestamps): number {
  return Math.max(
    normalizeLibraryTimestamp(game.lastStartedAt),
    normalizeLibraryTimestamp(game.lastPlayedTimestamp)
  )
}
