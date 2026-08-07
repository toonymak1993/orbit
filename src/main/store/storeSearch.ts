import type { StoreOffer, StoreProduct } from '@shared/ipc'
import { searchEpicProducts } from './epicStoreProvider'
import { searchGogProducts } from './gogStoreProvider'
import { searchInstantGamingProducts } from './instantGamingProvider'
import { normalizeStoreTitle, type StoreSearchCandidate } from './storeProviderUtils'
import type { StoreRegionConfig } from './storeRegions'
import { searchSteamProducts } from './steamStoreProvider'
import { searchXboxProducts } from './xboxStoreProvider'

const SOURCE_PRIORITY = ['steam', 'epic', 'gog', 'xbox', 'instant-gaming'] as const

function bestOffer(offers: StoreOffer[]): StoreOffer | undefined {
  return offers
    .filter(
      (offer) =>
        offer.available &&
        offer.exactMatch &&
        offer.platform !== 'xbox' &&
        typeof offer.priceMinor === 'number'
    )
    .sort((left, right) => (left.priceMinor ?? Infinity) - (right.priceMinor ?? Infinity))[0]
}

function candidatePriority(candidate: StoreSearchCandidate): number {
  const index = SOURCE_PRIORITY.indexOf(candidate.source)
  return index === -1 ? SOURCE_PRIORITY.length : index
}

export async function searchAllStores(
  query: string,
  region: StoreRegionConfig
): Promise<StoreProduct[]> {
  const normalizedQuery = normalizeStoreTitle(query)
  if (normalizedQuery.length < 2) return []
  const providerResults = await Promise.all([
    searchSteamProducts(query, region).catch(() => []),
    searchEpicProducts(query, region).catch(() => []),
    searchGogProducts(query, region).catch(() => []),
    searchXboxProducts(query, region).catch(() => []),
    searchInstantGamingProducts(query, region).catch(() => [])
  ])
  const groups = new Map<string, StoreSearchCandidate[]>()
  for (const candidate of providerResults.flat()) {
    const key = normalizeStoreTitle(candidate.name)
    if (!key || (!key.includes(normalizedQuery) && !normalizedQuery.includes(key))) continue
    const group = groups.get(key) ?? []
    group.push(candidate)
    groups.set(key, group)
  }
  const now = Date.now()
  return [...groups.entries()]
    .flatMap(([normalizedName, candidates]): StoreProduct[] => {
      const artworkCandidates = candidates
        .filter((candidate) => Boolean(candidate.portraitUrl))
        .sort((left, right) => candidatePriority(left) - candidatePriority(right))
      const canonical = artworkCandidates[0]
      if (!canonical?.portraitUrl) return []
      const steam = candidates.find((candidate) => candidate.steamAppId)
      const offers = [...new Map(candidates.map((candidate) => [candidate.offer.id, candidate.offer])).values()]
      const recommendationScore =
        normalizedName === normalizedQuery
          ? 100
          : normalizedName.startsWith(normalizedQuery)
            ? 80
            : 60
      const id = steam?.steamAppId
        ? `steam:${steam.steamAppId}`
        : `${canonical.source}:${canonical.sourceProductId}`
      return [{
        id,
        steamAppId: steam?.steamAppId,
        canonicalSource: canonical.source,
        sourceProductId: canonical.sourceProductId,
        name: canonical.name,
        summary: candidates.find((candidate) => candidate.summary)?.summary,
        genres: candidates.find((candidate) => candidate.genres?.length)?.genres,
        portraitUrl: canonical.portraitUrl,
        heroUrl: canonical.heroUrl ?? canonical.headerUrl,
        headerUrl: canonical.headerUrl ?? canonical.heroUrl,
        artworkStatus: 'available',
        searchOnly: true,
        steamWishlisted: false,
        orbitWishlisted: false,
        offers,
        bestOffer: bestOffer(offers),
        recommendationScore,
        priceUpdatedAt: now,
        providerPricesUpdatedAt: now,
        providerPipelineVersion: 4,
        updatedAt: now
      }]
    })
    .sort(
      (left, right) =>
        right.recommendationScore - left.recommendationScore ||
        (left.bestOffer?.priceMinor ?? Infinity) - (right.bestOffer?.priceMinor ?? Infinity)
    )
    .slice(0, 30)
}
