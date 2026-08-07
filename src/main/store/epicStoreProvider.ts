import type { StoreOffer } from '@shared/ipc'
import { formatStorePrice, type StoreRegionConfig } from './storeRegions'
import {
  hasRemoteArtwork,
  normalizeStoreTitle,
  type StoreSearchCandidate,
  STORE_REQUEST_TIMEOUT_MS
} from './storeProviderUtils'

interface EpicSearchOffer {
  id?: string
  title?: string
  offerType?: string
  productSlug?: string
  description?: string
  keyImages?: Array<{ type?: string; url?: string }>
  tags?: Array<{ name?: string }>
  countriesBlacklist?: string[]
  countriesWhitelist?: string[] | null
  price?: {
    offerId?: string
    price?: {
      currencyCode?: string
      discount?: number
      discountPrice?: number
      originalPrice?: number
    }
  }
}

async function queryEpic(
  title: string,
  region: StoreRegionConfig,
  limit: number
): Promise<EpicSearchOffer[]> {
  const response = await fetch(
    `https://api.egdata.app/search/v2/search?country=${encodeURIComponent(region.countryCode)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'ORBIT/0.1' },
      body: JSON.stringify({ title, page: 1, limit }),
      signal: AbortSignal.timeout(STORE_REQUEST_TIMEOUT_MS)
    }
  )
  if (!response.ok) return []
  const json = (await response.json()) as { offers?: EpicSearchOffer[] }
  return json.offers ?? []
}

export async function searchEpicProducts(
  query: string,
  region: StoreRegionConfig
): Promise<StoreSearchCandidate[]> {
  const checkedAt = Date.now()
  const offers = (await queryEpic(query, region, 16))
    .filter(
      (offer) =>
        offer.title?.trim() &&
        offer.productSlug &&
        (offer.offerType === 'BASE_GAME' || offer.offerType === 'EDITION') &&
        !offer.countriesBlacklist?.includes(region.countryCode) &&
        (!offer.countriesWhitelist || offer.countriesWhitelist.includes(region.countryCode)) &&
        Number.isFinite(offer.price?.price?.discountPrice)
    )
    .slice(0, 12)
  const candidates = await Promise.all(
    offers.map(async (match): Promise<StoreSearchCandidate | null> => {
      const tall = match.keyImages?.find((image) => /tall|thumbnail/i.test(image.type ?? ''))?.url
      const wide = match.keyImages?.find((image) => /wide/i.test(image.type ?? ''))?.url
      if (!(await hasRemoteArtwork(tall))) return null
      const price = match.price?.price
      if (!match.title || !match.productSlug || !price || price.discountPrice === undefined) return null
      const offer: StoreOffer = {
        id: `epic:${match.price?.offerId ?? match.id ?? match.productSlug}:${region.id}`,
        source: 'epic',
        sourceLabel: 'Epic Games',
        kind: 'official',
        url: `https://store.epicgames.com/${region.locale.split('-')[0]}/p/${match.productSlug}`,
        available: true,
        exactMatch: true,
        priceMinor: price.discountPrice,
        originalPriceMinor: price.originalPrice,
        currency: price.currencyCode,
        formattedPrice: formatStorePrice(price.discountPrice, region),
        discountPercent:
          price.originalPrice && price.originalPrice > price.discountPrice
            ? Math.round(((price.originalPrice - price.discountPrice) / price.originalPrice) * 100)
            : price.discount ?? 0,
        checkedAt,
        platform: 'pc'
      }
      return {
        source: 'epic',
        sourceProductId: match.id ?? match.productSlug,
        name: match.title.trim(),
        summary: match.description?.trim(),
        genres: match.tags?.map((tag) => tag.name?.trim()).filter((tag): tag is string => Boolean(tag)),
        portraitUrl: tall,
        heroUrl: wide,
        headerUrl: wide,
        offer
      }
    })
  )
  return candidates.filter((candidate): candidate is StoreSearchCandidate => Boolean(candidate))
}

export async function fetchEpicOffer(
  name: string,
  region: StoreRegionConfig,
  checkedAt: number
): Promise<StoreOffer | null> {
  const offers = await queryEpic(name, region, 12)
  const normalized = normalizeStoreTitle(name)
  const match = offers.find(
    (offer) =>
      offer.title &&
      normalizeStoreTitle(offer.title) === normalized &&
      (offer.offerType === 'BASE_GAME' || offer.offerType === 'EDITION') &&
      !offer.countriesBlacklist?.includes(region.countryCode) &&
      (!offer.countriesWhitelist || offer.countriesWhitelist.includes(region.countryCode)) &&
      offer.price?.price?.currencyCode === region.currency &&
      Number.isFinite(offer.price.price.discountPrice)
  )
  const price = match?.price?.price
  if (!match || !price || price.discountPrice === undefined) return null
  return {
    id: `epic:${match.price?.offerId ?? match.id ?? match.productSlug}:${region.id}`,
    source: 'epic',
    sourceLabel: 'Epic Games',
    kind: 'official',
    url: `https://store.epicgames.com/${region.locale.split('-')[0]}/p/${match.productSlug}`,
    available: true,
    exactMatch: true,
    priceMinor: price.discountPrice,
    originalPriceMinor: price.originalPrice,
    currency: price.currencyCode,
    formattedPrice: formatStorePrice(price.discountPrice, region),
    discountPercent:
      price.originalPrice && price.originalPrice > price.discountPrice
        ? Math.round(((price.originalPrice - price.discountPrice) / price.originalPrice) * 100)
        : price.discount ?? 0,
    checkedAt,
    platform: 'pc'
  }
}
