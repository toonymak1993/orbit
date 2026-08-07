import type { ImageOrientation } from '@shared/ipc'

/**
 * Optional fallback artwork source. Steam's own CDN occasionally 404s for a given
 * appid (delisted apps, unusual packages, etc.) — if the user has supplied a free
 * SteamGridDB API key in Settings, we ask SteamGridDB for community-sourced cover
 * art instead of showing a broken image.
 */
type SteamGridDbOrientation = Exclude<ImageOrientation, 'icon'>

const DIMENSIONS: Record<SteamGridDbOrientation, string> = {
  vertical: '600x900',
  horizontal: '1920x620,3840x1240'
}

interface SteamGridDbAsset {
  url: string
  width?: number
  height?: number
}

interface SteamGridDbGame {
  id: number
  name: string
}

const searchCache = new Map<string, Promise<number | null>>()

function searchKey(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[®™©]/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase()
}

function stripEditionWords(value: string): string {
  return value
    .replace(
      /\b(resynced|remastered|remaster|remake|definitive|enhanced|complete|ultimate|gold|game of the year|goty)\b/gi,
      ' '
    )
    .replace(/\bedition\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function titleCoverage(query: string, candidate: string): number {
  const queryTokens = new Set(searchKey(query).split(' ').filter((token) => token.length > 1))
  const candidateTokens = new Set(searchKey(candidate).split(' ').filter((token) => token.length > 1))
  if (queryTokens.size === 0) return 0
  let matches = 0
  for (const token of queryTokens) if (candidateTokens.has(token)) matches++
  return matches / queryTokens.size
}

async function fetchJson<T>(url: string, apiKey: string): Promise<T | null> {
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(20_000)
    })
    if (!response.ok) return null
    return (await response.json()) as T
  } catch {
    return null
  }
}

async function searchGameId(gameName: string, apiKey: string): Promise<number | null> {
  const normalized = searchKey(gameName)
  const cached = searchCache.get(normalized)
  if (cached) return cached

  const request = (async (): Promise<number | null> => {
    const queries = [...new Set([gameName.trim(), stripEditionWords(gameName)])].filter(Boolean)
    for (const query of queries) {
      const url = `https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(query)}`
      const result = await fetchJson<{ success: boolean; data?: SteamGridDbGame[] }>(url, apiKey)
      if (!result?.success || !result.data?.length) continue

      const ranked = result.data
        .map((game) => ({ game, score: titleCoverage(stripEditionWords(gameName), game.name) }))
        .sort((a, b) => b.score - a.score || a.game.name.length - b.game.name.length)
      if (ranked[0]?.score >= 0.65) return ranked[0].game.id
    }
    return null
  })()

  searchCache.set(normalized, request)
  return request
}

async function fetchAssets(
  target: `steam/${number}` | `game/${number}`,
  apiKey: string,
  orientation: SteamGridDbOrientation
): Promise<SteamGridDbAsset[]> {
  const assetType = orientation === 'vertical' ? 'grids' : 'heroes'
  const url = `https://www.steamgriddb.com/api/v2/${assetType}/${target}?dimensions=${DIMENSIONS[orientation]}`
  const result = await fetchJson<{ success: boolean; data?: SteamGridDbAsset[] }>(url, apiKey)
  return result?.success && result.data ? result.data : []
}

export async function fetchSteamGridDbImage(
  appId: number | undefined,
  apiKey: string,
  orientation: SteamGridDbOrientation,
  gameName?: string
): Promise<string | null> {
  if (appId) {
    const directAssets = await fetchAssets(`steam/${appId}`, apiKey, orientation)
    if (directAssets.length > 0) return directAssets[0].url
  }

  // Brand-new Steam app IDs often reach SteamGridDB later than the game name.
  // Search by title (and a conservative edition-stripped alias) before giving up.
  if (!gameName?.trim()) return null
  const gameId = await searchGameId(gameName, apiKey)
  if (!gameId) return null
  const nameAssets = await fetchAssets(`game/${gameId}`, apiKey, orientation)
  return nameAssets[0]?.url ?? null
}
