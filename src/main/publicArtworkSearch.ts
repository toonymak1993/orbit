import type { ArtworkNetworkAttempt } from './artworkNetworkPolicy'
import { isTransientArtworkStatus, runArtworkNetworkAttempt } from './artworkNetworkPolicy'
import { fetchWithElectronNet } from './networkFetch'
import { settingsStore } from './settingsStore'
import { STORE_REGIONS } from './store/storeRegions'
import {
  isPublicSteamArtworkUrl,
  parsePublicSteamSearchItems,
  publicSteamArtworkUrls,
  type PublicArtworkOrientation,
  type PublicSteamArtworkCandidate
} from './publicArtworkSearchPolicy'

const SEARCH_TIMEOUT_MS = 8_000
const IMAGE_CHECK_TIMEOUT_MS = 5_000
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024
const MAX_SEARCH_ITEMS = 12
const MAX_CANDIDATES = 18
const MAX_IMAGE_CHECK_CONCURRENCY = 4

async function discardResponse(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined)
}

async function readTextLimited(response: Response): Promise<string | null> {
  const announcedSize = Number(response.headers.get('content-length'))
  if (Number.isFinite(announcedSize) && announcedSize > MAX_RESPONSE_BYTES) {
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
      if (bytes > MAX_RESPONSE_BYTES) {
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

async function firstAvailableUrl(urls: string[]): Promise<string | undefined> {
  for (const url of urls) {
    if (!isPublicSteamArtworkUrl(url)) continue
    try {
      const response = await fetchWithElectronNet(url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(IMAGE_CHECK_TIMEOUT_MS)
      })
      const contentType = response.headers.get('content-type')?.toLowerCase()
      const finalUrl = response.url || url
      await discardResponse(response)
      if (
        response.ok &&
        isPublicSteamArtworkUrl(finalUrl) &&
        (!contentType || contentType.startsWith('image/'))
      ) {
        return finalUrl
      }
    } catch {
      // A missing image or individual CDN timeout only removes this option.
    }
  }
  return undefined
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  task: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let nextIndex = 0
  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex++
      if (index >= values.length) return
      results[index] = await task(values[index])
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker())
  )
  return results
}

export async function searchPublicSteamArtwork(
  query: string,
  orientation: PublicArtworkOrientation
): Promise<ArtworkNetworkAttempt<PublicSteamArtworkCandidate[]>> {
  return runArtworkNetworkAttempt<PublicSteamArtworkCandidate[]>(
    'artwork-picker:store.steampowered.com',
    async () => {
      const region = STORE_REGIONS[settingsStore.store.storeRegion]
      const url = new URL('https://store.steampowered.com/api/storesearch/')
      url.searchParams.set('term', query)
      url.searchParams.set('l', region.steamLanguage)
      url.searchParams.set('cc', region.countryCode)
      const response = await fetchWithElectronNet(url, {
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS)
      })
      if (!response.ok) {
        await discardResponse(response)
        return { state: isTransientArtworkStatus(response.status) ? 'unavailable' : 'missing' }
      }
      const text = await readTextLimited(response)
      if (!text) return { state: 'missing' }
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        return { state: 'missing' }
      }
      const items = parsePublicSteamSearchItems(parsed).slice(0, MAX_SEARCH_ITEMS)
      const perGame = await mapWithConcurrency(
        items,
        MAX_IMAGE_CHECK_CONCURRENCY,
        async (item): Promise<PublicSteamArtworkCandidate[]> => {
          const groups = publicSteamArtworkUrls(item.id, orientation)
          const urls: Array<string | undefined> = []
          for (const group of groups) urls.push(await firstAvailableUrl(group))
          return urls
            .filter((candidate): candidate is string => Boolean(candidate))
            .map((candidate, index) => ({
              id: `steam-store:${item.id}:${orientation}:${index}`,
              previewUrl: candidate,
              downloadUrl: candidate,
              source: 'steam-store',
              sourceTitle: item.name
            }))
        }
      )
      const candidates = perGame.flat().slice(0, MAX_CANDIDATES)
      return candidates.length > 0
        ? { state: 'success', value: candidates }
        : { state: 'missing' }
    }
  )
}
