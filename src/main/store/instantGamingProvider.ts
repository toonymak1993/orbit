import type { StoreOffer } from '@shared/ipc'
import { formatStorePrice, type StoreRegionConfig } from './storeRegions'
import {
  normalizeStoreTitle,
  type StoreSearchCandidate,
  STORE_REQUEST_TIMEOUT_MS,
  storeHeaders
} from './storeProviderUtils'

interface InstantGamingProduct {
  prod_id?: number
  name?: string
  small_name?: string
  seo_name?: string
  edition?: string
  is_dlc?: number
  has_stock?: number
  platform_names?: string[]
  currency_prices?: Record<string, string | number>
  retail_prices?: Record<string, string | number>
  discounts?: Record<string, number>
  country_whitelist?: string[]
  country_blacklist?: string[] | null
}

async function queryInstantGaming(
  name: string,
  region: StoreRegionConfig
): Promise<InstantGamingProduct[]> {
  const url = `https://www.instant-gaming.com/en/search/?query=${encodeURIComponent(name)}`
  const response = await fetch(url, {
    headers: storeHeaders(region),
    signal: AbortSignal.timeout(STORE_REQUEST_TIMEOUT_MS)
  })
  if (!response.ok) return []
  const html = await response.text()
  const encoded = html.match(/window\.searchResults\s*=\s*(\{[\s\S]*?\});\s*<\/script>/)?.[1]
  if (!encoded) return []
  return (JSON.parse(encoded) as { hits?: InstantGamingProduct[] }).hits ?? []
}

export async function searchInstantGamingProducts(
  query: string,
  region: StoreRegionConfig
): Promise<StoreSearchCandidate[]> {
  const checkedAt = Date.now()
  return (await queryInstantGaming(query, region))
    .filter((product) => {
      const amount = Number(product.currency_prices?.[region.currency])
      const blocked = product.country_blacklist?.includes(region.countryCode.toLowerCase())
      return (
        product.prod_id &&
        product.seo_name &&
        (product.small_name ?? product.name) &&
        product.is_dlc !== 1 &&
        product.has_stock === 1 &&
        product.platform_names?.some((platform) => platform.toLocaleLowerCase('en') === 'pc') &&
        !blocked &&
        Number.isFinite(amount)
      )
    })
    .slice(0, 16)
    .map((product) => {
      const name = (product.small_name ?? product.name) as string
      const amount = Number(product.currency_prices?.[region.currency])
      const retail = Number(product.retail_prices?.[region.currency])
      const priceMinor = Math.round(amount * 100)
      const originalPriceMinor = Number.isFinite(retail) ? Math.round(retail * 100) : undefined
      return {
        source: 'instant-gaming' as const,
        sourceProductId: String(product.prod_id),
        name,
        offer: {
          id: `instant-gaming:${product.prod_id}:${region.id}`,
          source: 'instant-gaming' as const,
          sourceLabel: 'Instant Gaming',
          kind: 'keyshop' as const,
          url: `https://www.instant-gaming.com/en/${product.prod_id}-buy-${product.seo_name}/`,
          available: true,
          exactMatch: true,
          priceMinor,
          originalPriceMinor,
          currency: region.currency,
          formattedPrice: formatStorePrice(priceMinor, region),
          discountPercent:
            product.discounts?.[region.currency] ??
            (originalPriceMinor && originalPriceMinor > priceMinor
              ? Math.round(((originalPriceMinor - priceMinor) / originalPriceMinor) * 100)
              : 0),
          checkedAt,
          platform: 'pc' as const
        }
      }
    })
}

export async function fetchInstantGamingOffer(
  name: string,
  region: StoreRegionConfig,
  checkedAt: number
): Promise<StoreOffer | null> {
  const products = await queryInstantGaming(name, region)
  const normalized = normalizeStoreTitle(name)
  const match = products.find((product) => {
    const title = product.small_name ?? product.name
    const blocked = product.country_blacklist?.includes(region.countryCode.toLowerCase())
    return (
      title &&
      normalizeStoreTitle(title) === normalized &&
      product.is_dlc !== 1 &&
      product.has_stock === 1 &&
      product.platform_names?.some((platform) => platform.toLocaleLowerCase('en') === 'pc') &&
      !blocked
    )
  })
  const amount = Number(match?.currency_prices?.[region.currency])
  const retail = Number(match?.retail_prices?.[region.currency])
  if (!match?.prod_id || !match.seo_name || !Number.isFinite(amount)) return null
  const priceMinor = Math.round(amount * 100)
  const originalPriceMinor = Number.isFinite(retail) ? Math.round(retail * 100) : undefined
  return {
    id: `instant-gaming:${match.prod_id}:${region.id}`,
    source: 'instant-gaming',
    sourceLabel: 'Instant Gaming',
    kind: 'keyshop',
    url: `https://www.instant-gaming.com/en/${match.prod_id}-buy-${match.seo_name}/`,
    available: true,
    exactMatch: true,
    priceMinor,
    originalPriceMinor,
    currency: region.currency,
    formattedPrice: formatStorePrice(priceMinor, region),
    discountPercent:
      match.discounts?.[region.currency] ??
      (originalPriceMinor && originalPriceMinor > priceMinor
        ? Math.round(((originalPriceMinor - priceMinor) / originalPriceMinor) * 100)
        : 0),
    checkedAt,
    platform: 'pc'
  }
}
