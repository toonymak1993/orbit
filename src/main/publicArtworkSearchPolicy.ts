import type { ArtworkSearchOption, ImageOrientation } from '@shared/ipc'

export type PublicArtworkOrientation = Exclude<ImageOrientation, 'icon'>

export interface PublicSteamSearchItem {
  id: number
  name: string
}

export interface PublicSteamArtworkCandidate extends ArtworkSearchOption {
  source: 'steam-store'
  downloadUrl: string
}

const STEAM_ARTWORK_FILE = /^(?:header|library_600x900(?:_2x)?|library_hero)\.(?:jpe?g|png|webp)$/i

export function parsePublicSteamSearchItems(value: unknown): PublicSteamSearchItem[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return []
  const items = (value as { items?: unknown }).items
  if (!Array.isArray(items)) return []
  const seen = new Set<number>()
  const result: PublicSteamSearchItem[] = []
  for (const item of items) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
    const candidate = item as { id?: unknown; type?: unknown; name?: unknown }
    if (
      candidate.type !== 'app' ||
      typeof candidate.id !== 'number' ||
      !Number.isSafeInteger(candidate.id) ||
      candidate.id <= 0 ||
      seen.has(candidate.id) ||
      typeof candidate.name !== 'string'
    ) {
      continue
    }
    const name = candidate.name.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim().slice(0, 160)
    if (!name) continue
    seen.add(candidate.id)
    result.push({ id: candidate.id, name })
  }
  return result
}

export function publicSteamArtworkUrls(
  appId: number,
  orientation: PublicArtworkOrientation
): string[][] {
  if (!Number.isSafeInteger(appId) || appId <= 0) return []
  const fastlyRoot = `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}`
  const legacyRoot = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}`
  const storePageBackground = `https://store.akamai.steamstatic.com/images/storepagebackground/app/${appId}`
  return orientation === 'vertical'
    ? [
        [
          `${fastlyRoot}/library_600x900_2x.jpg`,
          `${fastlyRoot}/library_600x900.jpg`,
          `${legacyRoot}/library_600x900.jpg`
        ]
      ]
    : [
        [
          `${fastlyRoot}/library_hero.jpg`,
          `${legacyRoot}/library_hero.jpg`
        ],
        [storePageBackground],
        [`${fastlyRoot}/header.jpg`, `${legacyRoot}/header.jpg`]
      ]
}

export function isPublicSteamArtworkUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
      return false
    }
    const host = url.hostname.toLowerCase()
    if (host === 'store.akamai.steamstatic.com') {
      return /^\/images\/storepagebackground\/app\/\d+\/?$/i.test(url.pathname)
    }
    if (host !== 'shared.fastly.steamstatic.com' && host !== 'cdn.cloudflare.steamstatic.com') {
      return false
    }
    const segments = url.pathname.split('/').filter(Boolean)
    const appsIndex = host === 'shared.fastly.steamstatic.com' ? 2 : 1
    const expectedPrefix =
      host === 'shared.fastly.steamstatic.com'
        ? ['store_item_assets', 'steam', 'apps']
        : ['steam', 'apps']
    if (
      !expectedPrefix.every((segment, index) => segments[index] === segment) ||
      !/^\d+$/.test(segments[appsIndex + 1] ?? '')
    ) {
      return false
    }
    const fileName = segments[appsIndex + 2]
    return segments.length === appsIndex + 3 && Boolean(fileName && STEAM_ARTWORK_FILE.test(fileName))
  } catch {
    return false
  }
}
