import type { StoreOffer, StoreOfferSource } from '@shared/ipc'
import type { StoreRegionConfig } from './storeRegions'

export const STORE_REQUEST_TIMEOUT_MS = 15_000
export const STORE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36 ORBIT/0.1'

export interface StoreSearchCandidate {
  source: StoreOfferSource
  sourceProductId: string
  name: string
  summary?: string
  genres?: string[]
  portraitUrl?: string
  heroUrl?: string
  headerUrl?: string
  steamAppId?: number
  offer: StoreOffer
}

export function normalizeStoreTitle(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[™®©]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLocaleLowerCase('en')
}

export function storeHeaders(region: StoreRegionConfig): HeadersInit {
  return {
    'User-Agent': STORE_USER_AGENT,
    'Accept-Language': `${region.locale},${region.locale.split('-')[0]};q=0.9,en;q=0.7`
  }
}

export async function hasRemoteArtwork(url?: string): Promise<boolean> {
  if (!url?.startsWith('https://')) return false
  for (const method of ['HEAD', 'GET'] as const) {
    try {
      const response = await fetch(url, {
        method,
        headers: {
          'User-Agent': STORE_USER_AGENT,
          ...(method === 'GET' ? { Range: 'bytes=0-0' } : {})
        },
        signal: AbortSignal.timeout(6_000)
      })
      const isImage = response.ok && (response.headers.get('content-type') ?? '').startsWith('image/')
      if (response.body) await response.body.cancel().catch(() => undefined)
      if (isImage) return true
    } catch {
      // Some Microsoft image CDNs reject HEAD while serving the same URL via
      // GET, so the second bounded attempt is intentional.
    }
  }
  return false
}
