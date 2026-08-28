export interface SteamGridDbGameSearchResult {
  id: number
  name: string
}

const MIN_TITLE_COVERAGE = 0.65

export function steamGridDbSearchKey(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[®™©]/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase()
}

export function stripSteamGridDbEditionWords(value: string): string {
  return value
    .replace(
      /\b(resynced|remastered|remaster|remake|definitive|enhanced|complete|ultimate|gold|game of the year|goty)\b/gi,
      ' '
    )
    .replace(/\bedition\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function significantTitleTokens(value: string): string[] {
  return steamGridDbSearchKey(value)
    .split(' ')
    .filter((token) => token.length > 1 || /^\d+$/.test(token))
}

function titleCoverage(queryTokens: Set<string>, candidateTokens: Set<string>): number {
  if (queryTokens.size === 0) return 0
  let matches = 0
  for (const token of queryTokens) if (candidateTokens.has(token)) matches++
  return matches / queryTokens.size
}

/**
 * Chooses the closest SteamGridDB autocomplete result without treating sequel
 * numbers as disposable one-character words. Every numeric query token must be
 * present in the candidate so a nearby sequel cannot silently win the ranking.
 */
export function selectSteamGridDbGame(
  query: string,
  candidates: SteamGridDbGameSearchResult[]
): SteamGridDbGameSearchResult | undefined {
  const comparableQuery = stripSteamGridDbEditionWords(query)
  const normalizedQuery = steamGridDbSearchKey(comparableQuery)
  const queryTokens = new Set(significantTitleTokens(comparableQuery))
  const numericQueryTokens = [...queryTokens].filter((token) => /^\d+$/.test(token))

  const ranked = candidates
    .map((game) => {
      const comparableCandidate = stripSteamGridDbEditionWords(game.name)
      const normalizedCandidate = steamGridDbSearchKey(comparableCandidate)
      const candidateTokens = new Set(significantTitleTokens(comparableCandidate))
      const containsEveryNumber = numericQueryTokens.every((token) => candidateTokens.has(token))
      const coverage = containsEveryNumber ? titleCoverage(queryTokens, candidateTokens) : 0
      const precision = candidateTokens.size > 0
        ? [...candidateTokens].filter((token) => queryTokens.has(token)).length / candidateTokens.size
        : 0
      return {
        game,
        exact: normalizedCandidate === normalizedQuery,
        coverage,
        precision
      }
    })
    .sort(
      (a, b) =>
        Number(b.exact) - Number(a.exact) ||
        b.coverage - a.coverage ||
        b.precision - a.precision ||
        a.game.name.length - b.game.name.length
    )

  return ranked[0]?.coverage >= MIN_TITLE_COVERAGE ? ranked[0].game : undefined
}
