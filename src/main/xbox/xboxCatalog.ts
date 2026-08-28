import { fetchWithElectronNet } from '../networkFetch'
import type { StoreRegionConfig } from '../store/storeRegions'
import { parseXboxCatalogProducts, type XboxCatalogGame } from './xboxCatalogParser'

const DISPLAY_CATALOG_ENDPOINT = 'https://displaycatalog.mp.microsoft.com/v7.0/products'
const CATALOG_TIMEOUT_MS = 20_000
const CATALOG_BATCH_SIZE = 50

export async function fetchXboxCatalogProducts(
  productIds: Iterable<string>,
  region: StoreRegionConfig
): Promise<Map<string, XboxCatalogGame>> {
  const ids = [
    ...new Set(
      [...productIds]
        .map((id) => id.trim().toUpperCase())
        .filter((id) => /^[A-Z0-9]{12}$/.test(id))
    )
  ]
  const requested = new Set(ids)
  const result = new Map<string, XboxCatalogGame>()

  for (let index = 0; index < ids.length; index += CATALOG_BATCH_SIZE) {
    const url = new URL(DISPLAY_CATALOG_ENDPOINT)
    url.searchParams.set('bigIds', ids.slice(index, index + CATALOG_BATCH_SIZE).join(','))
    url.searchParams.set('market', region.countryCode)
    url.searchParams.set('languages', region.locale)
    const response = await fetchWithElectronNet(url, {
      signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS)
    })
    if (!response.ok) throw new Error(`Xbox display catalog failed (${response.status})`)
    const parsed = parseXboxCatalogProducts(await response.json(), requested)
    for (const [productId, game] of parsed) result.set(productId, game)
  }

  return result
}
