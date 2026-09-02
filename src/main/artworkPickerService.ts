import { createHash } from 'node:crypto'
import type {
  ArtworkSearchOption,
  ArtworkSearchOptions,
  ImageOrientation,
  LibraryGame,
  ResolvedImage
} from '@shared/ipc'
import { getBuiltinSteamGridDbKey } from './builtinKeys'
import { customArtworkService } from './customArtwork'
import { steamGridDbCredentials } from './steamGridDbCredentials'
import {
  fetchSteamGridDbArtworkCandidates,
  type SteamGridDbArtworkCandidate
} from './steamGridDb'
import { searchPublicSteamArtwork } from './publicArtworkSearch'
import type { PublicSteamArtworkCandidate } from './publicArtworkSearchPolicy'

interface PickerCacheEntry {
  expiresAt: number
  candidates: ArtworkPickerCandidate[]
}

type ArtworkPickerOrientation = Exclude<ImageOrientation, 'icon'>
type ArtworkPickerCandidate =
  | PublicSteamArtworkCandidate
  | (ArtworkSearchOption & { source: 'steamgriddb'; downloadUrl: string })
type CandidateLoadResult =
  | { state: 'ready'; candidates: ArtworkPickerCandidate[] }
  | { state: 'missing' | 'unavailable'; candidates: [] }

const CACHE_TTL_MS = 10 * 60 * 1000
const MAX_CACHE_ENTRIES = 250
const MAX_QUERY_LENGTH = 120
const MAX_PICKER_OPTIONS = 30
const pickerCache = new Map<string, PickerCacheEntry>()
const pickerInFlight = new Map<string, Promise<CandidateLoadResult>>()
let pickerCacheGeneration = 0

function apiKey(): string {
  return steamGridDbCredentials.getToken() || getBuiltinSteamGridDbKey().trim()
}

function normalizeQuery(value?: string): string {
  return (value ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_QUERY_LENGTH)
    .trim()
}

function queryIdentity(value: string): string {
  return value.toLocaleLowerCase('en-US')
}

function cacheKey(
  game: LibraryGame,
  key: string,
  orientation: ArtworkPickerOrientation,
  normalizedQuery: string
): string {
  const keyTag = key
    ? createHash('sha256').update(key).digest('hex').slice(0, 10)
    : 'public-only'
  return JSON.stringify([
    game.id,
    game.metadataRevision,
    orientation,
    queryIdentity(normalizedQuery),
    keyTag
  ])
}

function cacheCandidates(key: string, entry: PickerCacheEntry): void {
  pickerCache.delete(key)
  pickerCache.set(key, entry)
  while (pickerCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = pickerCache.keys().next().value
    if (oldestKey === undefined) break
    pickerCache.delete(oldestKey)
  }
}

async function loadCandidates(
  game: LibraryGame,
  orientation: ArtworkPickerOrientation,
  query?: string
): Promise<
  CandidateLoadResult
> {
  const key = apiKey()
  const normalizedQuery = normalizeQuery(query)
  const effectiveQuery = normalizedQuery || game.name
  const id = cacheKey(game, key, orientation, normalizedQuery)
  const cached = pickerCache.get(id)
  if (cached && cached.expiresAt > Date.now()) {
    cacheCandidates(id, cached)
    return { state: 'ready', candidates: cached.candidates }
  }
  if (cached) pickerCache.delete(id)

  const matchesGameName =
    !normalizedQuery ||
    queryIdentity(normalizedQuery) === queryIdentity(normalizeQuery(game.name))
  const steamAppId =
    game.provider === 'steam' && matchesGameName ? game.appId : undefined
  const current = pickerInFlight.get(id)
  if (current) return current

  const generation = pickerCacheGeneration
  const request = Promise.all([
    searchPublicSteamArtwork(effectiveQuery, orientation),
    key
      ? fetchSteamGridDbArtworkCandidates(steamAppId, key, effectiveQuery, orientation)
      : Promise.resolve({ state: 'missing' as const })
  ]).then(([publicResult, communityResult]): CandidateLoadResult => {
    const publicCandidates = publicResult.state === 'success' ? publicResult.value : []
    const communityCandidates =
      communityResult.state === 'success'
        ? communityResult.value.map(
            (candidate: SteamGridDbArtworkCandidate): ArtworkPickerCandidate => ({
              ...candidate,
              id: `steamgriddb:${candidate.id}`,
              source: 'steamgriddb'
            })
          )
        : []
    const candidates = [...publicCandidates, ...communityCandidates].slice(0, MAX_PICKER_OPTIONS)
    if (candidates.length === 0) {
      return publicResult.state === 'unavailable' || communityResult.state === 'unavailable'
        ? { state: 'unavailable', candidates: [] }
        : { state: 'missing', candidates: [] }
    }
    if (generation === pickerCacheGeneration) {
      cacheCandidates(id, {
        expiresAt: Date.now() + CACHE_TTL_MS,
        candidates
      })
    }
    return { state: 'ready', candidates }
  })
  pickerInFlight.set(id, request)
  const clearRequest = (): void => {
    if (pickerInFlight.get(id) === request) pickerInFlight.delete(id)
  }
  void request.then(clearRequest, clearRequest)
  return request
}

class ArtworkPickerService {
  clearCache(): void {
    pickerCacheGeneration++
    pickerCache.clear()
    pickerInFlight.clear()
  }

  async list(
    game: LibraryGame,
    orientation: ArtworkPickerOrientation = 'vertical',
    query?: string
  ): Promise<ArtworkSearchOptions> {
    const result = await loadCandidates(game, orientation, query)
    if (result.state !== 'ready') return { state: result.state, options: [] }
    return {
      state: 'ready',
      options: result.candidates.map(({ downloadUrl: _downloadUrl, ...option }) => option)
    }
  }

  async apply(
    game: LibraryGame,
    artworkId: string,
    orientation: ArtworkPickerOrientation = 'vertical',
    query?: string
  ): Promise<ResolvedImage> {
    const result = await loadCandidates(game, orientation, query)
    if (result.state !== 'ready') {
      throw new Error(`Artwork search is ${result.state}`)
    }
    const candidate = result.candidates.find((item) => item.id === artworkId)
    if (!candidate) throw new Error('Artwork is no longer available')
    return candidate.source === 'steam-store'
      ? customArtworkService.applyPublicSteam(game.id, candidate.downloadUrl, orientation)
      : customArtworkService.applySteamGridDb(game.id, candidate.downloadUrl, orientation)
  }
}

export const artworkPickerService = new ArtworkPickerService()
