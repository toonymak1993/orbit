import type {
  ImageOrientation,
  SteamGridDbArtworkOption,
  SteamGridDbTokenStatus
} from '@shared/ipc'
import { fetchWithElectronNet } from './networkFetch'
import { steamGridDbTokenExpiresAt } from './steamGridDbCredential'
import {
  isTransientArtworkStatus,
  runArtworkNetworkAttempt,
  type ArtworkNetworkAttempt
} from './artworkNetworkPolicy'
import {
  selectSteamGridDbGame,
  steamGridDbSearchKey,
  stripSteamGridDbEditionWords,
  type SteamGridDbGameSearchResult
} from './steamGridDbSearch'

/**
 * Optional fallback artwork source. Steam's own CDN occasionally 404s for a given
 * appid (delisted apps, unusual packages, etc.) — if the user has supplied a free
 * SteamGridDB API key in Settings, we ask SteamGridDB for community-sourced cover
 * art instead of showing a broken image.
 */
type SteamGridDbOrientation = Exclude<ImageOrientation, 'icon'>

const DIMENSIONS: Partial<Record<SteamGridDbOrientation, string>> = {
  vertical: '600x900',
  horizontal: '1920x620,3840x1240'
}

interface SteamGridDbAsset {
  id?: number
  url: string
  thumb?: string
  width?: number
  height?: number
  author?: {
    name?: string
  }
}

export interface SteamGridDbArtworkCandidate extends SteamGridDbArtworkOption {
  downloadUrl: string
}

interface SearchCacheEntry {
  gameId: number | null
  expiresAt: number
}

const API_TIMEOUT_MS = 7_000
const FOUND_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const MISSING_CACHE_TTL_MS = 6 * 60 * 60 * 1000
const MAX_SEARCH_CACHE_ENTRIES = 1_000
const MAX_PICKER_ASSETS = 24
const searchCache = new Map<string, SearchCacheEntry>()
const searchInFlight = new Map<string, Promise<ArtworkNetworkAttempt<number>>>()
let searchCacheGeneration = 0

export function clearSteamGridDbCache(): void {
  searchCacheGeneration++
  searchCache.clear()
  searchInFlight.clear()
}

export async function getSteamGridDbTokenStatus(apiKey: string): Promise<SteamGridDbTokenStatus> {
  const token = apiKey.trim()
  if (!token) return { state: 'not-configured' }

  const checkedAt = Date.now()
  const expiresAt = steamGridDbTokenExpiresAt(token)
  if (expiresAt !== undefined && expiresAt <= checkedAt) {
    return { state: 'expired', checkedAt, expiresAt }
  }

  try {
    const response = await fetchWithElectronNet(
      'https://www.steamgriddb.com/api/v2/search/autocomplete/Portal',
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(API_TIMEOUT_MS)
      }
    )
    const status = response.status
    await response.body?.cancel().catch(() => undefined)
    if (response.ok) return { state: 'valid', checkedAt, expiresAt }
    if (status === 401 || status === 403) {
      return { state: 'invalid', checkedAt, expiresAt }
    }
    return { state: 'unavailable', checkedAt, expiresAt }
  } catch {
    return { state: 'unavailable', checkedAt, expiresAt }
  }
}

function cacheSearchResult(cacheKey: string, entry: SearchCacheEntry): void {
  searchCache.delete(cacheKey)
  searchCache.set(cacheKey, entry)
  while (searchCache.size > MAX_SEARCH_CACHE_ENTRIES) {
    const oldestKey = searchCache.keys().next().value
    if (oldestKey === undefined) break
    searchCache.delete(oldestKey)
  }
}

function credentialTag(apiKey: string): string {
  let hash = 0
  for (let index = 0; index < apiKey.length; index++) {
    hash = (hash * 31 + apiKey.charCodeAt(index)) >>> 0
  }
  return hash.toString(16)
}

async function fetchJson<T>(
  url: string,
  apiKey: string
): Promise<ArtworkNetworkAttempt<T>> {
  return runArtworkNetworkAttempt<T>(`steamgriddb-api:${credentialTag(apiKey)}`, async () => {
    const response = await fetchWithElectronNet(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(API_TIMEOUT_MS)
    })
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      return { state: isTransientArtworkStatus(response.status) ? 'unavailable' : 'missing' }
    }
    return { state: 'success', value: (await response.json()) as T }
  })
}

async function searchGameId(
  gameName: string,
  apiKey: string
): Promise<ArtworkNetworkAttempt<number>> {
  const normalized = steamGridDbSearchKey(gameName)
  const cacheKey = `${normalized}:${credentialTag(apiKey)}`
  const cached = searchCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    cacheSearchResult(cacheKey, cached)
    return cached.gameId === null
      ? { state: 'missing' }
      : { state: 'success', value: cached.gameId }
  }
  if (cached) searchCache.delete(cacheKey)
  const pending = searchInFlight.get(cacheKey)
  if (pending) return pending

  const generation = searchCacheGeneration
  const request = (async (): Promise<ArtworkNetworkAttempt<number>> => {
    const queries = [...new Set([gameName.trim(), stripSteamGridDbEditionWords(gameName)])].filter(Boolean)
    for (const query of queries) {
      const url = `https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(query)}`
      const result = await fetchJson<{ success: boolean; data?: SteamGridDbGameSearchResult[] }>(url, apiKey)
      if (result.state === 'unavailable') return result
      if (result.state === 'missing' || !result.value.success || !result.value.data?.length) continue

      const match = selectSteamGridDbGame(gameName, result.value.data)
      if (match) {
        const gameId = match.id
        if (generation === searchCacheGeneration) {
          cacheSearchResult(cacheKey, { gameId, expiresAt: Date.now() + FOUND_CACHE_TTL_MS })
        }
        return { state: 'success', value: gameId }
      }
    }
    if (generation === searchCacheGeneration) {
      cacheSearchResult(cacheKey, {
        gameId: null,
        expiresAt: Date.now() + MISSING_CACHE_TTL_MS
      })
    }
    return { state: 'missing' }
  })()

  searchInFlight.set(cacheKey, request)
  return request.finally(() => {
    if (searchInFlight.get(cacheKey) === request) searchInFlight.delete(cacheKey)
  })
}

async function fetchAssets(
  target: `steam/${number}` | `game/${number}`,
  apiKey: string,
  orientation: SteamGridDbOrientation
): Promise<ArtworkNetworkAttempt<SteamGridDbAsset[]>> {
  const assetType = orientation === 'vertical' ? 'grids' : orientation === 'horizontal' ? 'heroes' : 'logos'
  const query = new URLSearchParams({ types: 'static', nsfw: 'false' })
  const dimensions = DIMENSIONS[orientation]
  if (dimensions) query.set('dimensions', dimensions)
  const url = `https://www.steamgriddb.com/api/v2/${assetType}/${target}?${query}`
  const result = await fetchJson<{ success: boolean; data?: SteamGridDbAsset[] }>(url, apiKey)
  if (result.state !== 'success') return result
  if (!result.value.success) return { state: 'missing' }
  return { state: 'success', value: result.value.data ?? [] }
}

export type SteamGridDbImageResult = ArtworkNetworkAttempt<string>

export function isSteamGridDbAssetUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return false
    if (url.username || url.password || (url.port && url.port !== '443')) return false
    const host = url.hostname.toLowerCase()
    if (host === 'cdn.steamgriddb.com' || host === 'cdn2.steamgriddb.com') return true
    if (host === 'steamgriddb.s3.amazonaws.com') return true
    return host === 's3.amazonaws.com' && url.pathname.startsWith('/steamgriddb/')
  } catch {
    return false
  }
}

function toArtworkCandidates(assets: SteamGridDbAsset[]): SteamGridDbArtworkCandidate[] {
  const seen = new Set<number>()
  const candidates: SteamGridDbArtworkCandidate[] = []
  for (const asset of assets) {
    if (
      !Number.isSafeInteger(asset.id) ||
      (asset.id ?? 0) <= 0 ||
      seen.has(asset.id as number) ||
      !isSteamGridDbAssetUrl(asset.url)
    ) {
      continue
    }
    const previewUrl =
      asset.thumb && isSteamGridDbAssetUrl(asset.thumb) ? asset.thumb : asset.url
    seen.add(asset.id as number)
    candidates.push({
      id: asset.id as number,
      previewUrl,
      downloadUrl: asset.url,
      width: asset.width,
      height: asset.height,
      authorName: asset.author?.name?.trim().slice(0, 80) || undefined
    })
    if (candidates.length >= MAX_PICKER_ASSETS) break
  }
  return candidates
}

export async function fetchSteamGridDbArtworkCandidates(
  appId: number | undefined,
  apiKey: string,
  gameName?: string,
  orientation: SteamGridDbOrientation = 'vertical'
): Promise<ArtworkNetworkAttempt<SteamGridDbArtworkCandidate[]>> {
  if (appId) {
    const directAssets = await fetchAssets(`steam/${appId}`, apiKey, orientation)
    if (directAssets.state === 'unavailable') return directAssets
    if (directAssets.state === 'success') {
      const candidates = toArtworkCandidates(directAssets.value)
      if (candidates.length > 0) return { state: 'success', value: candidates }
    }
  }

  if (!gameName?.trim()) return { state: 'missing' }
  const gameId = await searchGameId(gameName, apiKey)
  if (gameId.state !== 'success') return gameId
  const nameAssets = await fetchAssets(`game/${gameId.value}`, apiKey, orientation)
  if (nameAssets.state !== 'success') return nameAssets
  const candidates = toArtworkCandidates(nameAssets.value)
  return candidates.length > 0
    ? { state: 'success', value: candidates }
    : { state: 'missing' }
}

export async function fetchSteamGridDbImage(
  appId: number | undefined,
  apiKey: string,
  orientation: SteamGridDbOrientation,
  gameName?: string
): Promise<SteamGridDbImageResult> {
  if (orientation === 'vertical') {
    const candidates = await fetchSteamGridDbArtworkCandidates(appId, apiKey, gameName)
    if (candidates.state !== 'success') return candidates
    return candidates.value[0]
      ? { state: 'success', value: candidates.value[0].downloadUrl }
      : { state: 'missing' }
  }

  if (appId) {
    const directAssets = await fetchAssets(`steam/${appId}`, apiKey, orientation)
    if (directAssets.state === 'unavailable') return directAssets
    if (directAssets.state === 'success' && directAssets.value.length > 0) {
      return { state: 'success', value: directAssets.value[0].url }
    }
  }

  // Brand-new Steam app IDs often reach SteamGridDB later than the game name.
  // Search by title (and a conservative edition-stripped alias) before giving up.
  if (!gameName?.trim()) return { state: 'missing' }
  const gameId = await searchGameId(gameName, apiKey)
  if (gameId.state !== 'success') return gameId
  const nameAssets = await fetchAssets(`game/${gameId.value}`, apiKey, orientation)
  if (nameAssets.state !== 'success') return nameAssets
  return nameAssets.value[0]
    ? { state: 'success', value: nameAssets.value[0].url }
    : { state: 'missing' }
}
