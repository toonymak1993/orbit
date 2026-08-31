export interface LibraryIdentityRecord {
  id: string
}

export interface LibraryVisibilityProjection<T extends LibraryIdentityRecord> {
  visibleGames: T[]
  excludedGames: T[]
}

/**
 * Applies the user's exact provider-neutral game IDs without guessing from a
 * title. Provider syncs can safely replace record data without making an
 * excluded game visible again.
 */
export function projectLibraryVisibility<T extends LibraryIdentityRecord>(
  games: readonly T[],
  excludedGameIds: readonly string[]
): LibraryVisibilityProjection<T> {
  const excludedIds = new Set(excludedGameIds)
  const visibleGames: T[] = []
  const excludedGames: T[] = []

  for (const game of games) {
    if (excludedIds.has(game.id)) excludedGames.push(game)
    else visibleGames.push(game)
  }

  return { visibleGames, excludedGames }
}
