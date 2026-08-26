import { createHash } from 'node:crypto'
import type {
  ImageOrientation,
  LibraryGame,
  ResolvedImage,
  SteamGridDbArtworkOptions
} from '@shared/ipc'
import { getBuiltinSteamGridDbKey } from './builtinKeys'
import { customArtworkService } from './customArtwork'
import { settingsStore } from './settingsStore'
import {
  fetchSteamGridDbArtworkCandidates,
  type SteamGridDbArtworkCandidate
} from './steamGridDb'

interface PickerCacheEntry {
  expiresAt: number
  candidates: SteamGridDbArtworkCandidate[]
}

type ArtworkPickerOrientation = Exclude<ImageOrientation, 'icon'>
type CandidateLoadResult =
  | { state: 'ready'; candidates: SteamGridDbArtworkCandidate[] }
  | { state: 'missing' | 'unavailable' | 'not-configured'; candidates: [] }

const CACHE_TTL_MS = 10 * 60 * 1000
const MAX_CACHE_ENTRIES = 250
const MAX_QUERY_LENGTH = 120
const pickerCache = new Map<string, PickerCacheEntry>()
const pickerInFlight = new Map<string, Promise<CandidateLoadResult>>()

function apiKey(): string {
  return settingsStore.get('steamGridDbApiKey')?.trim() || getBuiltinSteamGridDbKey().trim()
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
  const keyTag = createHash('sha256').update(key).digest('hex').slice(0, 10)
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
  if (!key) return { state: 'not-configured', candidates: [] }

  const normalizedQuery = normalizeQuery(query)
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

  const request = fetchSteamGridDbArtworkCandidates(
    steamAppId,
    key,
    normalizedQuery || game.name,
    orientation
  ).then((result): CandidateLoadResult => {
    if (result.state !== 'success') return { state: result.state, candidates: [] }
    cacheCandidates(id, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      candidates: result.value
    })
    return { state: 'ready', candidates: result.value }
  })
  pickerInFlight.set(id, request)
  const clearRequest = (): void => {
    if (pickerInFlight.get(id) === request) pickerInFlight.delete(id)
  }
  void request.then(clearRequest, clearRequest)
  return request
}

class ArtworkPickerService {
  async list(
    game: LibraryGame,
    orientation: ArtworkPickerOrientation = 'vertical',
    query?: string
  ): Promise<SteamGridDbArtworkOptions> {
    const result = await loadCandidates(game, orientation, query)
    if (result.state !== 'ready') return { state: result.state, options: [] }
    return {
      state: 'ready',
      options: result.candidates.map(({ downloadUrl: _downloadUrl, ...option }) => option)
    }
  }

  async apply(
    game: LibraryGame,
    artworkId: number,
    orientation: ArtworkPickerOrientation = 'vertical',
    query?: string
  ): Promise<ResolvedImage> {
    const result = await loadCandidates(game, orientation, query)
    if (result.state !== 'ready') {
      throw new Error(`SteamGridDB artwork is ${result.state}`)
    }
    const candidate = result.candidates.find((item) => item.id === artworkId)
    if (!candidate) throw new Error('SteamGridDB artwork is no longer available')
    return customArtworkService.applySteamGridDb(game.id, candidate.downloadUrl, orientation)
  }
}

export const artworkPickerService = new ArtworkPickerService()
