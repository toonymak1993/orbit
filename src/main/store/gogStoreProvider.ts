import type { StoreOffer } from '@shared/ipc'
import type { StoreRegionConfig } from './storeRegions'
import { hasRemoteArtwork, type StoreSearchCandidate } from './storeProviderUtils'

const REQUEST_TIMEOUT_MS = 12_000

interface GogCatalogProduct {
  id?: string
  title?: string
  productType?: string
  storeLink?: string
  coverHorizontal?: string
  coverVertical?: string
  genres?: Array<{ name?: string }>
  price?: {
    final?: string
    base?: string
    finalMoney?: { amount?: string; currency?: string }
    baseMoney?: { amount?: string; currency?: string }
  }
}

async function queryGog(
  name: string,
  region: StoreRegionConfig,
  limit: number
): Promise<GogCatalogProduct[]> {
  const url = new URL('https://catalog.gog.com/v1/catalog')
  url.searchParams.set('query', name)
  url.searchParams.set('countryCode', region.countryCode)
  url.searchParams.set('locale', region.locale)
  url.searchParams.set('currencyCode', region.currency)
  url.searchParams.set('limit', String(limit))
  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  if (!response.ok) return []
  const json = (await response.json()) as { products?: GogCatalogProduct[] }
  return json.products ?? []
}

export async function searchGogProducts(
  query: string,
  region: StoreRegionConfig
): Promise<StoreSearchCandidate[]> {
  const checkedAt = Date.now()
  const products = (await queryGog(query, region, 16))
    .filter((product) => product.productType === 'game' && product.id && product.title && product.storeLink)
    .slice(0, 12)
  const candidates = await Promise.all(
    products.map(async (product): Promise<StoreSearchCandidate | null> => {
      if (!(await hasRemoteArtwork(product.coverVertical))) return null
      const amount = Number(product.price?.finalMoney?.amount)
      const base = Number(product.price?.baseMoney?.amount)
      if (!product.id || !product.title || !product.storeLink || !Number.isFinite(amount)) return null
      const priceMinor = Math.round(amount * 100)
      const originalPriceMinor = Number.isFinite(base) ? Math.round(base * 100) : priceMinor
      const offer: StoreOffer = {
        id: `gog:${product.id}:${region.id}`,
        source: 'gog',
        sourceLabel: 'GOG',
        kind: 'official',
        url: product.storeLink,
        available: true,
        exactMatch: true,
        priceMinor,
        originalPriceMinor,
        currency: product.price?.finalMoney?.currency ?? region.currency,
        formattedPrice: product.price?.final,
        discountPercent:
          originalPriceMinor > priceMinor
            ? Math.round(((originalPriceMinor - priceMinor) / originalPriceMinor) * 100)
            : 0,
        checkedAt,
        platform: 'pc'
      }
      return {
        source: 'gog',
        sourceProductId: product.id,
        name: product.title.trim(),
        genres: product.genres?.map((genre) => genre.name?.trim()).filter((genre): genre is string => Boolean(genre)),
        portraitUrl: product.coverVertical,
        heroUrl: product.coverHorizontal,
        headerUrl: product.coverHorizontal,
        offer
      }
    })
  )
  return candidates.filter((candidate): candidate is StoreSearchCandidate => Boolean(candidate))
}

function normalizeTitle(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[™®©]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLocaleLowerCase('en')
}

export async function fetchGogOffer(
  name: string,
  region: StoreRegionConfig,
  checkedAt: number
): Promise<StoreOffer | null> {
  const products = await queryGog(name, region, 10)
  const normalizedName = normalizeTitle(name)
  const match = products.find(
    (product) =>
      (product.productType === 'game' || product.productType === 'pack') &&
      product.title &&
      normalizeTitle(product.title) === normalizedName
  )
  const amount = Number(match?.price?.finalMoney?.amount)
  const base = Number(match?.price?.baseMoney?.amount)
  if (!match?.id || !match.storeLink || !Number.isFinite(amount)) return null
  const priceMinor = Math.round(amount * 100)
  const originalPriceMinor = Number.isFinite(base) ? Math.round(base * 100) : priceMinor
  return {
    id: `gog:${match.id}:${region.id}`,
    source: 'gog',
    sourceLabel: 'GOG',
    kind: 'official',
    url: match.storeLink,
    available: true,
    exactMatch: true,
    priceMinor,
    originalPriceMinor,
    currency: match.price?.finalMoney?.currency ?? region.currency,
    formattedPrice: match.price?.final,
    discountPercent:
      originalPriceMinor > priceMinor
        ? Math.round(((originalPriceMinor - priceMinor) / originalPriceMinor) * 100)
        : 0,
    checkedAt
    ,platform: 'pc'
  }
}
