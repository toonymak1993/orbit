import type { StoreOffer } from '@shared/ipc'
import { formatStorePrice, type StoreRegionConfig } from './storeRegions'
import { fetchWithElectronNet } from '../networkFetch'
import {
  hasRemoteArtwork,
  normalizeStoreTitle,
  type StoreSearchCandidate,
  STORE_REQUEST_TIMEOUT_MS,
  storeHeaders
} from './storeProviderUtils'

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function visit(value: unknown, callback: (object: JsonObject) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) visit(item, callback)
    return
  }
  if (!isObject(value)) return
  callback(value)
  for (const child of Object.values(value)) visit(child, callback)
}

function slugify(value: string): string {
  return normalizeStoreTitle(value).replace(/\s+/g, '-')
}

async function queryXboxState(name: string, region: StoreRegionConfig): Promise<unknown | null> {
  const url = `https://www.xbox.com/${region.locale}/search/results?q=${encodeURIComponent(name)}`
  const response = await fetchWithElectronNet(url, {
    headers: storeHeaders(region),
    signal: AbortSignal.timeout(STORE_REQUEST_TIMEOUT_MS)
  })
  if (!response.ok) return null
  const html = await response.text()
  const encoded = html.match(/window\.__PRELOADED_STATE__\s*=\s*(\{[\s\S]*?\})\s*;[\s\S]*?<\/script>/)?.[1]
  return encoded ? (JSON.parse(encoded) as unknown) : null
}

function imageUrls(value: unknown): string[] {
  const urls = new Set<string>()
  const collect = (candidate: unknown): void => {
    if (typeof candidate !== 'string' || !candidate.startsWith('https://')) return
    try {
      const url = new URL(candidate)
      const looksLikeImage =
        /\.(?:jpe?g|png|webp)(?:\?|$)/i.test(candidate) ||
        /(^|\.)(store-images\.s-microsoft\.com|images-\d+\.xboxlive\.com|compass-ssl\.xbox\.com)$/i.test(
          url.hostname
        ) ||
        /(?:image|artwork|poster|hero|boxart|screenshot|logo)/i.test(`${url.pathname}${url.search}`)
      if (looksLikeImage) urls.add(candidate)
    } catch {
      return
    }
  }
  const walk = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      for (const item of candidate) walk(item)
    } else if (isObject(candidate)) {
      for (const item of Object.values(candidate)) walk(item)
    } else collect(candidate)
  }
  walk(value)
  return [...urls]
}

export async function searchXboxProducts(
  query: string,
  region: StoreRegionConfig
): Promise<StoreSearchCandidate[]> {
  const state = await queryXboxState(query, region)
  if (!state) return []
  const normalizedQuery = normalizeStoreTitle(query)
  const documents = new Map<string, { title: string; object: JsonObject }>()
  visit(state, (object) => {
    if (
      typeof object.title === 'string' &&
      normalizeStoreTitle(object.title).includes(normalizedQuery) &&
      typeof object.productId === 'string' &&
      !documents.has(object.productId)
    ) documents.set(object.productId, { title: object.title, object })
  })
  const prices = new Map<string, { listPrice: number; msrp: number; currency: string; platform: 'pc' | 'xbox' }>()
  visit(state, (object) => {
    if (typeof object.productId !== 'string' || !documents.has(object.productId)) return
    const price = isObject(object.price) ? object.price : object
    if (typeof price.listPrice !== 'number' || price.currency !== region.currency) return
    const serialized = JSON.stringify(documents.get(object.productId)?.object ?? object).toLocaleLowerCase('en')
    const candidate = {
      listPrice: price.listPrice,
      msrp: typeof price.msrp === 'number' ? price.msrp : price.listPrice,
      currency: price.currency,
      platform: (serialized.includes('windows.desktop') || serialized.includes('pcgame') ? 'pc' : 'xbox') as 'pc' | 'xbox'
    }
    const previous = prices.get(object.productId)
    if (!previous || candidate.listPrice < previous.listPrice) prices.set(object.productId, candidate)
  })
  const checkedAt = Date.now()
  const results = await Promise.all(
    [...documents.entries()].slice(0, 12).map(async ([productId, document]): Promise<StoreSearchCandidate | null> => {
      const price = prices.get(productId)
      if (!price) return null
      const urls = imageUrls(document.object)
      const portrait = urls.find((url) => /portrait|poster|boxart/i.test(url)) ?? urls[0]
      const artworkValid = portrait ? await hasRemoteArtwork(portrait) : false
      const priceMinor = Math.round(price.listPrice * 100)
      const originalPriceMinor = Math.round(price.msrp * 100)
      return {
        source: 'xbox',
        sourceProductId: productId,
        name: document.title,
        portraitUrl: artworkValid ? portrait : undefined,
        heroUrl: artworkValid ? urls[1] ?? portrait : undefined,
        headerUrl: artworkValid ? urls[1] ?? portrait : undefined,
        offer: {
          id: `xbox:${productId}:${region.id}`,
          source: 'xbox',
          sourceLabel: price.platform === 'pc' ? 'Xbox / Microsoft Store' : 'Xbox',
          kind: 'official',
          url: `https://www.xbox.com/${region.locale}/games/store/${slugify(document.title)}/${productId}`,
          available: true,
          exactMatch: true,
          priceMinor,
          originalPriceMinor,
          currency: price.currency,
          formattedPrice: formatStorePrice(priceMinor, region),
          discountPercent:
            originalPriceMinor > priceMinor
              ? Math.round(((originalPriceMinor - priceMinor) / originalPriceMinor) * 100)
              : 0,
          checkedAt,
          platform: price.platform
        }
      }
    })
  )
  return results.filter((candidate): candidate is StoreSearchCandidate => Boolean(candidate))
}

export async function fetchXboxOffer(
  name: string,
  region: StoreRegionConfig,
  checkedAt: number
): Promise<StoreOffer | null> {
  const state = await queryXboxState(name, region)
  if (!state) return null
  const normalized = normalizeStoreTitle(name)
  const productIds = new Set<string>()
  const productDocuments: JsonObject[] = []
  visit(state, (object) => {
    if (
      typeof object.title === 'string' &&
      normalizeStoreTitle(object.title) === normalized &&
      typeof object.productId === 'string'
    ) {
      productIds.add(object.productId)
      productDocuments.push(object)
    }
  })
  if (productIds.size === 0) return null

  let selected:
    | { productId: string; listPrice: number; msrp: number; currency: string; platform: 'pc' | 'xbox' }
    | undefined
  visit(state, (object) => {
    if (typeof object.productId !== 'string' || !productIds.has(object.productId)) return
    const candidates: JsonObject[] = []
    if (isObject(object.price)) candidates.push(object.price)
    candidates.push(object)
    for (const price of candidates) {
      if (
        typeof price.listPrice !== 'number' ||
        typeof price.currency !== 'string' ||
        price.currency !== region.currency
      ) continue
      const document = productDocuments.find((item) => item.productId === object.productId)
      const serialized = JSON.stringify(document ?? object).toLocaleLowerCase('en')
      const platform: 'pc' | 'xbox' =
        serialized.includes('windows.desktop') || serialized.includes('pcgame') ? 'pc' : 'xbox'
      const candidate = {
        productId: object.productId,
        listPrice: price.listPrice,
        msrp: typeof price.msrp === 'number' ? price.msrp : price.listPrice,
        currency: price.currency,
        platform
      }
      if (!selected || candidate.listPrice < selected.listPrice) selected = candidate
    }
  })
  if (!selected) return null
  const priceMinor = Math.round(selected.listPrice * 100)
  const originalPriceMinor = Math.round(selected.msrp * 100)
  return {
    id: `xbox:${selected.productId}:${region.id}`,
    source: 'xbox',
    sourceLabel: selected.platform === 'pc' ? 'Xbox / Microsoft Store' : 'Xbox',
    kind: 'official',
    url: `https://www.xbox.com/${region.locale}/games/store/${slugify(name)}/${selected.productId}`,
    available: true,
    exactMatch: true,
    priceMinor,
    originalPriceMinor,
    currency: selected.currency,
    formattedPrice: formatStorePrice(priceMinor, region),
    discountPercent:
      originalPriceMinor > priceMinor
        ? Math.round(((originalPriceMinor - priceMinor) / originalPriceMinor) * 100)
        : 0,
    checkedAt,
    platform: selected.platform
  }
}
