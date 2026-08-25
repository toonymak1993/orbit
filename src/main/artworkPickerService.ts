import { createHash } from 'node:crypto'
import type {
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

const CACHE_TTL_MS = 10 * 60 * 1000
const MAX_CACHE_ENTRIES = 250
const pickerCache = new Map<string, PickerCacheEntry>()

function apiKey(): string {
  return settingsStore.get('steamGridDbApiKey')?.trim() || getBuiltinSteamGridDbKey().trim()
}

function cacheKey(game: LibraryGame, key: string): string {
  const keyTag = createHash('sha256').update(key).digest('hex').slice(0, 10)
  return `${game.id}:${game.metadataRevision}:${keyTag}`
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
  game: LibraryGame
): Promise<
  | { state: 'ready'; candidates: SteamGridDbArtworkCandidate[] }
  | { state: 'missing' | 'unavailable' | 'not-configured'; candidates: [] }
> {
  const key = apiKey()
  if (!key) return { state: 'not-configured', candidates: [] }

  const id = cacheKey(game, key)
  const cached = pickerCache.get(id)
  if (cached && cached.expiresAt > Date.now()) {
    cacheCandidates(id, cached)
    return { state: 'ready', candidates: cached.candidates }
  }
  if (cached) pickerCache.delete(id)

  const result = await fetchSteamGridDbArtworkCandidates(
    game.provider === 'steam' ? game.appId : undefined,
    key,
    game.name
  )
  if (result.state !== 'success') return { state: result.state, candidates: [] }
  cacheCandidates(id, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    candidates: result.value
  })
  return { state: 'ready', candidates: result.value }
}

class ArtworkPickerService {
  async list(game: LibraryGame): Promise<SteamGridDbArtworkOptions> {
    const result = await loadCandidates(game)
    if (result.state !== 'ready') return { state: result.state, options: [] }
    return {
      state: 'ready',
      options: result.candidates.map(({ downloadUrl: _downloadUrl, ...option }) => option)
    }
  }

  async apply(game: LibraryGame, artworkId: number): Promise<ResolvedImage> {
    const result = await loadCandidates(game)
    if (result.state !== 'ready') {
      throw new Error(`SteamGridDB artwork is ${result.state}`)
    }
    const candidate = result.candidates.find((item) => item.id === artworkId)
    if (!candidate) throw new Error('SteamGridDB artwork is no longer available')
    return customArtworkService.applySteamGridDb(game.id, candidate.downloadUrl)
  }
}

export const artworkPickerService = new ArtworkPickerService()
