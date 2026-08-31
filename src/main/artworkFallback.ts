import { basename, extname } from 'node:path'
import type { GameProvider, LibraryGame, RetroSystemId } from '@shared/ipc'
import { canonicalArtworkTitle, matchLibretroThumbnail } from '@shared/artworkMatching'
import { fetchWithElectronNet } from './networkFetch'
import {
  isTransientArtworkStatus,
  runArtworkNetworkAttempt,
  type ArtworkNetworkAttempt
} from './artworkNetworkPolicy'
import { settingsStore } from './settingsStore'
import { STORE_REGIONS } from './store/storeRegions'

const DISCOVERY_TIMEOUT_MS = 8_000
const MAX_DISCOVERY_BYTES = 4 * 1024 * 1024
const SUCCESS_CACHE_MS = 12 * 60 * 60 * 1000
const MISSING_CACHE_MS = 6 * 60 * 60 * 1000

const STORE_FALLBACK_PROVIDERS = new Set<GameProvider>([
  'epic',
  'gog',
  'xbox',
  'playstation',
  'ea',
  'ubisoft',
  'local'
])

const LIBRETRO_PLAYLISTS: Partial<Record<RetroSystemId, string>> = {
  nes: 'Nintendo - Nintendo Entertainment System',
  fds: 'Nintendo - Family Computer Disk System',
  snes: 'Nintendo - Super Nintendo Entertainment System',
  gb: 'Nintendo - Game Boy',
  gbc: 'Nintendo - Game Boy Color',
  gba: 'Nintendo - Game Boy Advance',
  n64: 'Nintendo - Nintendo 64',
  nds: 'Nintendo - Nintendo DS',
  gamecube: 'Nintendo - GameCube',
  wii: 'Nintendo - Wii',
  wiiu: 'Nintendo - Wii U',
  megadrive: 'Sega - Mega Drive - Genesis',
  mastersystem: 'Sega - Master System - Mark III',
  gamegear: 'Sega - Game Gear',
  sega32x: 'Sega - 32X',
  segacd: 'Sega - Mega-CD - Sega CD',
  saturn: 'Sega - Saturn',
  dreamcast: 'Sega - Dreamcast',
  ps1: 'Sony - PlayStation',
  ps2: 'Sony - PlayStation 2',
  psp: 'Sony - PlayStation Portable',
  atari2600: 'Atari - 2600',
  atari7800: 'Atari - 7800',
  atarilynx: 'Atari - Lynx',
  pce: 'NEC - PC Engine - TurboGrafx 16',
  wonderswan: 'Bandai - WonderSwan',
  wonderswancolor: 'Bandai - WonderSwan Color',
  ngp: 'SNK - Neo Geo Pocket',
  ngpc: 'SNK - Neo Geo Pocket Color',
  virtualboy: 'Nintendo - Virtual Boy',
  colecovision: 'Coleco - ColecoVision'
}

export type LibretroThumbnailFolder = 'Named_Boxarts' | 'Named_Snaps' | 'Named_Titles'

export interface DiscoveredArtwork {
  vertical: string[]
  horizontal: string[]
}

interface SteamSearchItem {
  id?: number
  type?: string
  name?: string
}

interface CachedDiscovery<T> {
  expiresAt: number
  result: ArtworkNetworkAttempt<T>
}

const storeCache = new Map<string, CachedDiscovery<DiscoveredArtwork>>()
const storeInFlight = new Map<string, Promise<ArtworkNetworkAttempt<DiscoveredArtwork>>>()
const libretroIndexCache = new Map<string, CachedDiscovery<string[]>>()
const libretroIndexInFlight = new Map<string, Promise<ArtworkNetworkAttempt<string[]>>>()

function cacheDuration<T>(result: ArtworkNetworkAttempt<T>): number {
  return result.state === 'success' ? SUCCESS_CACHE_MS : MISSING_CACHE_MS
}

async function discardResponse(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined)
}

async function readTextLimited(response: Response): Promise<string | null> {
  const announcedSize = Number(response.headers.get('content-length'))
  if (Number.isFinite(announcedSize) && announcedSize > MAX_DISCOVERY_BYTES) {
    await discardResponse(response)
    return null
  }
  if (!response.body) return null
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > MAX_DISCOVERY_BYTES) {
        await reader.cancel().catch(() => undefined)
        return null
      }
      text += decoder.decode(chunk.value, { stream: true })
    }
    return text + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}

function steamArtwork(appId: number): DiscoveredArtwork {
  const root = `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}`
  return {
    vertical: [
      `${root}/library_600x900_2x.jpg`,
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`
    ],
    horizontal: [
      `${root}/library_hero.jpg`,
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_hero.jpg`,
      `https://store.akamai.steamstatic.com/images/storepagebackground/app/${appId}`,
      `${root}/header.jpg`,
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`
    ]
  }
}

/**
 * Finds artwork for non-Steam PC/console records through Steam's public store
 * search. Only an exact normalized title is accepted, so editions with similar
 * names never receive an automatic false-positive cover.
 */
export async function discoverExactStoreArtwork(
  game: LibraryGame
): Promise<ArtworkNetworkAttempt<DiscoveredArtwork>> {
  if (!STORE_FALLBACK_PROVIDERS.has(game.provider)) return { state: 'missing' }
  const normalizedName = canonicalArtworkTitle(game.name)
  if (normalizedName.length < 3) return { state: 'missing' }
  const region = STORE_REGIONS[settingsStore.store.storeRegion]
  const key = `${region.id}:${normalizedName}`
  const cached = storeCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.result
  const active = storeInFlight.get(key)
  if (active) return active

  const request = runArtworkNetworkAttempt<DiscoveredArtwork>(
    'artwork-discovery:store.steampowered.com',
    async () => {
      const url = new URL('https://store.steampowered.com/api/storesearch/')
      url.searchParams.set('term', game.name.slice(0, 120))
      url.searchParams.set('l', region.steamLanguage)
      url.searchParams.set('cc', region.countryCode)
      const response = await fetchWithElectronNet(url, {
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS)
      })
      if (!response.ok) {
        await discardResponse(response)
        return {
          state: isTransientArtworkStatus(response.status) ? 'unavailable' : 'missing'
        }
      }
      const text = await readTextLimited(response)
      if (!text) return { state: 'missing' }
      let items: SteamSearchItem[] = []
      try {
        const parsed = JSON.parse(text) as { items?: SteamSearchItem[] }
        items = Array.isArray(parsed.items) ? parsed.items : []
      } catch {
        return { state: 'missing' }
      }
      const match = items.find(
        (item) =>
          item.type === 'app' &&
          Number.isInteger(item.id) &&
          (item.id ?? 0) > 0 &&
          typeof item.name === 'string' &&
          canonicalArtworkTitle(item.name) === normalizedName
      )
      return match?.id
        ? { state: 'success', value: steamArtwork(match.id) }
        : { state: 'missing' }
    }
  )
    .then((result) => {
      if (result.state !== 'unavailable') {
        storeCache.set(key, { expiresAt: Date.now() + cacheDuration(result), result })
      }
      return result
    })
    .finally(() => storeInFlight.delete(key))
  storeInFlight.set(key, request)
  return request
}

function decodeHtmlFileName(value: string): string | undefined {
  const htmlDecoded = value
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
  let decoded: string
  try {
    decoded = decodeURIComponent(htmlDecoded)
  } catch {
    decoded = htmlDecoded
  }
  if (!decoded.toLocaleLowerCase('en-US').endsWith('.png')) return undefined
  if (decoded.includes('/') || decoded.includes('\\') || decoded.includes('..')) return undefined
  return decoded
}

function parseLibretroIndex(html: string): string[] {
  const files = new Set<string>()
  for (const match of html.matchAll(/href="([^"]+\.png)"/giu)) {
    const fileName = decodeHtmlFileName(match[1])
    if (fileName) files.add(fileName)
  }
  return [...files]
}

function romFileTitle(game: LibraryGame): string | undefined {
  if (!game.retro?.romPath) return undefined
  const fileName = basename(game.retro.romPath)
  const extension = extname(fileName)
  return extension ? fileName.slice(0, -extension.length) : fileName
}

async function fetchLibretroIndex(
  playlist: string,
  folder: LibretroThumbnailFolder
): Promise<ArtworkNetworkAttempt<string[]>> {
  const key = `${playlist}:${folder}`
  const cached = libretroIndexCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.result
  const active = libretroIndexInFlight.get(key)
  if (active) return active

  const request = runArtworkNetworkAttempt<string[]>('artwork-discovery:thumbnails.libretro.com', async () => {
    const url = `https://thumbnails.libretro.com/${encodeURIComponent(playlist)}/${folder}/`
    const response = await fetchWithElectronNet(url, {
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS)
    })
    if (!response.ok) {
      await discardResponse(response)
      return {
        state: isTransientArtworkStatus(response.status) ? 'unavailable' : 'missing'
      }
    }
    const html = await readTextLimited(response)
    if (!html) return { state: 'missing' }
    const files = parseLibretroIndex(html)
    return files.length > 0 ? { state: 'success', value: files } : { state: 'missing' }
  })
    .then((result) => {
      if (result.state !== 'unavailable') {
        libretroIndexCache.set(key, { expiresAt: Date.now() + cacheDuration(result), result })
      }
      return result
    })
    .finally(() => libretroIndexInFlight.delete(key))
  libretroIndexInFlight.set(key, request)
  return request
}

export async function discoverLibretroArtwork(
  game: LibraryGame,
  folder: LibretroThumbnailFolder
): Promise<ArtworkNetworkAttempt<string>> {
  if (game.provider !== 'retro' || !game.retro?.systemId) return { state: 'missing' }
  const playlist = LIBRETRO_PLAYLISTS[game.retro.systemId]
  if (!playlist) return { state: 'missing' }
  const index = await fetchLibretroIndex(playlist, folder)
  if (index.state !== 'success') return index
  const fileName = matchLibretroThumbnail(
    index.value,
    game.name,
    romFileTitle(game),
    settingsStore.store.language
  )
  if (!fileName) return { state: 'missing' }
  return {
    state: 'success',
    value: `https://thumbnails.libretro.com/${encodeURIComponent(playlist)}/${folder}/${encodeURIComponent(fileName)}`
  }
}
