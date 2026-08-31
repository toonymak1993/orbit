import { canonicalArtworkTitle } from '../shared/artworkMatching'

export interface SteamGridDbGameSearchResult {
  id: number
  name: string
}

export function steamGridDbSearchKey(value: string): string {
  return canonicalArtworkTitle(value)
}

export function stripSteamGridDbEditionWords(value: string): string {
  return value
    .replace(
      /\s*(?:[-–—:]\s*)?(?:(?:complete|ultimate|gold)\s+edition|game\s+of\s+the\s+year(?:\s+edition)?|goty(?:\s+edition)?|edition)\s*$/i,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Chooses a conservative SteamGridDB autocomplete result. Automatic artwork
 * may use only an exact normalized title or one exact after removing an
 * explicit edition suffix; broader fuzzy search belongs in the manual picker.
 */
export function selectSteamGridDbGame(
  query: string,
  candidates: SteamGridDbGameSearchResult[]
): SteamGridDbGameSearchResult | undefined {
  const rawNormalizedQuery = steamGridDbSearchKey(query)
  if (!rawNormalizedQuery) return undefined
  const rawExactMatches = candidates.filter(
    (candidate) => steamGridDbSearchKey(candidate.name) === rawNormalizedQuery
  )
  if (rawExactMatches.length === 1) return rawExactMatches[0]
  if (rawExactMatches.length > 1) return undefined

  const comparableQuery = stripSteamGridDbEditionWords(query)
  const normalizedQuery = steamGridDbSearchKey(comparableQuery)
  if (!normalizedQuery) return undefined

  const comparableExactMatches = candidates.filter(
    (candidate) =>
      steamGridDbSearchKey(stripSteamGridDbEditionWords(candidate.name)) === normalizedQuery
  )
  if (comparableExactMatches.length === 1) return comparableExactMatches[0]
  return undefined
}
