import type { StoreOffer, StoreProduct, StoreRelease } from '@shared/ipc'
import { latestLibraryActivity } from '@shared/libraryTime'
import type { SteamAuthManager } from '../steam/steamAuth'
import { gameRepository } from '../library/gameRepository'
import { fetchWithElectronNet } from '../networkFetch'
import { formatStorePrice, type StoreRegionConfig } from './storeRegions'
import { fetchGogOffer } from './gogStoreProvider'
import { fetchEpicOffer } from './epicStoreProvider'
import { fetchInstantGamingOffer } from './instantGamingProvider'
import { fetchXboxOffer } from './xboxStoreProvider'
import { parseEnglishSteamDate } from './steamReleaseDate'
import {
  hasRemoteArtwork,
  type StoreSearchCandidate,
  STORE_REQUEST_TIMEOUT_MS
} from './storeProviderUtils'

const REQUEST_TIMEOUT_MS = 15_000
const RELEASE_CALENDAR_LIMIT = 18

interface SteamWishlistItem {
  appid?: number
  priority?: number
  date_added?: number
}

interface FeaturedItem {
  id?: number
  name?: string
  discount_percent?: number
  original_price?: number
  final_price?: number
  currency?: string
  large_capsule_image?: string
  header_image?: string
}

interface SteamSearchItem {
  type?: string
  name?: string
  id?: number
  tiny_image?: string
  price?: { currency?: string; initial?: number; final?: number }
}

interface SteamAppDetails {
  type?: string
  name?: string
  short_description?: string
  header_image?: string
  background?: string
  background_raw?: string
  genres?: Array<{ description?: string }>
  developers?: string[]
  publishers?: string[]
  supported_languages?: string
  release_date?: { date?: string }
  price_overview?: {
    currency?: string
    initial?: number
    final?: number
    discount_percent?: number
    final_formatted?: string
  }
  is_free?: boolean
}

const BROAD_GENRES = new Set(['action', 'adventure', 'indie', 'casual'])

function parseSupportedLanguages(value?: string): string[] {
  if (!value) return []
  return value
    .replace(/<[^>]+>/g, '')
    .split(',')
    .map((language) => language.replace(/\*/g, '').trim())
    .filter(Boolean)
}

function hasSupportedInterfaceLanguage(languages: string[]): boolean {
  if (languages.length === 0) return true
  return languages.some((language) => /^(english|german|deutsch)$/i.test(language))
}

function hasUnsupportedTitleScript(name: string): boolean {
  return /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u.test(name)
}

function productId(appId: number): string {
  return `steam:${appId}`
}

function portraitUrl(appId: number): string {
  return `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900_2x.jpg`
}

function decodeHtmlText(value: string): string {
  const namedEntities: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    quot: '"'
  }
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16))
    )
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&([a-z]+);/gi, (match, name: string) => namedEntities[name.toLowerCase()] ?? match)
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Steam's popular-upcoming search is a compact editorial source for a rolling
 * release window. One bounded request yields the official title, date and capsule; the
 * larger hero URL is resolved by ORBIT's existing artwork cache with the
 * capsule as its fallback.
 */
export async function fetchUpcomingSteamReleases(
  region: StoreRegionConfig,
  now = new Date()
): Promise<StoreRelease[]> {
  const url = new URL('https://store.steampowered.com/search/results/')
  url.searchParams.set('query', '')
  url.searchParams.set('start', '0')
  url.searchParams.set('count', '100')
  url.searchParams.set('filter', 'popularcomingsoon')
  url.searchParams.set('category1', '998')
  url.searchParams.set('supportedlang', 'english,german')
  url.searchParams.set('infinite', '1')
  url.searchParams.set('cc', region.countryCode)
  url.searchParams.set('l', 'english')

  const response = await fetchWithElectronNet(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  if (!response.ok) throw new Error(`Steam release calendar returned ${response.status}`)
  const json = (await response.json()) as { results_html?: string }
  const html = json.results_html ?? ''
  const rows = html.matchAll(
    /<a\b(?=[^>]*\bdata-ds-appid="(\d+)")(?=[^>]*\bclass="[^"]*\bsearch_result_row\b[^"]*")([^>]*)>([\s\S]*?)<\/a>/gi
  )
  const ranked: Array<StoreRelease & { rank: number }> = []
  const seen = new Set<number>()
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 12)

  for (const row of rows) {
    const appId = Number(row[1])
    if (!Number.isInteger(appId) || appId <= 0 || seen.has(appId)) continue
    const body = row[3]
    const title = /<span\b[^>]*class="[^"]*\btitle\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(body)?.[1]
    const dateText = /<div\b[^>]*class="[^"]*\bsearch_released\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(body)?.[1]
    const capsule = /<div\b[^>]*class="[^"]*\bsearch_capsule\b[^"]*"[^>]*>[\s\S]*?<img\b[^>]*src="([^"]+)"/i.exec(body)?.[1]
    if (!title || !dateText || !capsule) continue
    const decodedTitle = decodeHtmlText(title)
    if (decodedTitle.length > 72 || hasUnsupportedTitleScript(decodedTitle)) continue
    const release = parseEnglishSteamDate(decodeHtmlText(dateText))
    if (!release || release.timestamp < today) continue

    seen.add(appId)
    ranked.push({
      id: productId(appId),
      source: 'steam',
      sourceProductId: String(appId),
      steamAppId: appId,
      name: decodedTitle,
      releaseDate: release.timestamp,
      capsuleUrl: decodeHtmlText(capsule),
      heroUrl: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/library_hero.jpg`,
      storeUrl: `https://store.steampowered.com/app/${appId}/?cc=${region.countryCode}`,
      featured: false,
      orbitWishlisted: false,
      rank: ranked.length
    })
  }

  if (ranked.length === 0) {
    throw new Error('Steam release calendar contained no usable upcoming releases')
  }

  const selected = ranked.slice(0, RELEASE_CALENDAR_LIMIT)
  if (selected[0]) selected[0].featured = true
  return selected
    .sort((left, right) => left.releaseDate - right.releaseDate || left.rank - right.rank)
    .map(({ rank: _rank, ...release }) => release)
}

const GENRE_TAG_IDS: Record<string, number> = {
  action: 19,
  adventure: 21,
  rpg: 122,
  strategy: 9,
  simulation: 599,
  indie: 492,
  casual: 597,
  racing: 699,
  sports: 701,
  puzzle: 1664,
  horror: 1667,
  'open world': 1695,
  shooter: 1773
}

export async function searchSteamProducts(
  query: string,
  region: StoreRegionConfig
): Promise<StoreSearchCandidate[]> {
  const url = new URL('https://store.steampowered.com/api/storesearch/')
  url.searchParams.set('term', query)
  url.searchParams.set('l', region.steamLanguage)
  url.searchParams.set('cc', region.countryCode)
  const response = await fetchWithElectronNet(url, {
    signal: AbortSignal.timeout(STORE_REQUEST_TIMEOUT_MS)
  })
  if (!response.ok) return []
  const json = (await response.json()) as { items?: SteamSearchItem[] }
  const checkedAt = Date.now()
  const candidates = (json.items ?? [])
    .filter(
      (item): item is SteamSearchItem & { id: number; name: string } =>
        item.type === 'app' && Number.isInteger(item.id) && Boolean(item.name?.trim())
    )
    .slice(0, 16)
  const artworkChecks = await Promise.all(
    candidates.map((item) => hasRemoteArtwork(portraitUrl(item.id)))
  )
  return candidates.flatMap((item, index) => {
    if (!artworkChecks[index]) return []
    const offer = steamOffer(
      item.id,
      region,
      {
        final: item.price?.final,
        initial: item.price?.initial,
        currency: item.price?.currency
      },
      checkedAt
    )
    return [{
      source: 'steam',
      sourceProductId: String(item.id),
      steamAppId: item.id,
      name: item.name.trim(),
      portraitUrl: portraitUrl(item.id),
      headerUrl: item.tiny_image,
      heroUrl: item.tiny_image,
      offer
    }]
  })
}

export async function fetchPersonalizedCandidateIds(
  region: StoreRegionConfig
): Promise<number[]> {
  const genreWeights = new Map<string, number>()
  for (const game of gameRepository.getSnapshot().games) {
    const weight = 1 + Math.min(Math.log2(1 + (game.playtimeMinutes ?? 0) / 60), 5)
    for (const genre of game.metadata.genres ?? []) {
      const key = genre.trim().toLocaleLowerCase('en')
      if (GENRE_TAG_IDS[key]) {
        const specificity = BROAD_GENRES.has(key) ? 0.25 : 1
        genreWeights.set(key, (genreWeights.get(key) ?? 0) + weight * specificity)
      }
    }
  }
  const topTags = [...genreWeights.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([genre]) => GENRE_TAG_IDS[genre])
  const pages = await Promise.all(
    topTags.map(async (tagId) => {
      const url = new URL('https://store.steampowered.com/search/results/')
      url.searchParams.set('query', '')
      url.searchParams.set('start', '0')
      url.searchParams.set('count', '24')
      url.searchParams.set('sort_by', 'Reviews_DESC')
      url.searchParams.set('tags', String(tagId))
      url.searchParams.set('category1', '998')
      url.searchParams.set('supportedlang', 'english,german')
      url.searchParams.set('infinite', '1')
      url.searchParams.set('cc', region.countryCode)
      url.searchParams.set('l', region.steamLanguage)
      const response = await fetchWithElectronNet(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
      if (!response.ok) return []
      const json = (await response.json()) as { results_html?: string }
      return [...(json.results_html ?? '').matchAll(/data-ds-appid="(\d+)"/g)]
        .map((match) => Number(match[1]))
        .filter(Number.isInteger)
    })
  )
  return [...new Set(pages.flat())]
}

function steamOffer(
  appId: number,
  region: StoreRegionConfig,
  price: {
    final?: number
    initial?: number
    discount?: number
    formatted?: string
    currency?: string
  },
  checkedAt: number
): StoreOffer {
  return {
    id: `steam:${appId}:${region.id}`,
    source: 'steam',
    sourceLabel: 'Steam',
    kind: 'official',
    url: `https://store.steampowered.com/app/${appId}/?cc=${region.countryCode}`,
    available: typeof price.final === 'number',
    exactMatch: true,
    priceMinor: price.final,
    originalPriceMinor: price.initial,
    currency: price.currency ?? region.currency,
    formattedPrice:
      price.formatted ??
      (typeof price.final === 'number' ? formatStorePrice(price.final, region) : undefined),
    discountPercent: price.discount,
    checkedAt,
    platform: 'pc'
  }
}

function genreAffinity(genres: string[]): { score: number; reason?: string } {
  const ownedGenres = new Map<string, number>()
  for (const game of gameRepository.getSnapshot().games) {
    const playtimeWeight = 1 + Math.min(Math.log2(1 + (game.playtimeMinutes ?? 0) / 60), 5)
    const lastActivity = latestLibraryActivity(game)
    const recentWeight = lastActivity && Date.now() - lastActivity < 180 * 86400000 ? 1.5 : 1
    for (const genre of game.metadata.genres ?? []) {
      const key = genre.toLocaleLowerCase('en')
      const specificity = BROAD_GENRES.has(key) ? 0.3 : 1
      ownedGenres.set(key, (ownedGenres.get(key) ?? 0) + playtimeWeight * recentWeight * specificity)
    }
  }
  const best = genres
    .map((genre) => ({ genre, count: ownedGenres.get(genre.toLocaleLowerCase('en')) ?? 0 }))
    .sort((left, right) => right.count - left.count)[0]
  return best?.count ? { score: 35 + Math.min(best.count * 3, 45), reason: best.genre } : { score: 15 }
}

export async function fetchSteamWishlist(
  steamId: string,
  auth: SteamAuthManager
): Promise<Array<{ appId: number; addedAt?: number }>> {
  const url = new URL('https://api.steampowered.com/IWishlistService/GetWishlist/v1/')
  url.searchParams.set('steamid', steamId)
  try {
    const response = await fetchWithElectronNet(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    if (response.ok) {
      const json = (await response.json()) as { response?: { items?: SteamWishlistItem[] } }
      const items = json.response?.items ?? []
      if (items.length > 0) {
        return items
          .filter((item): item is SteamWishlistItem & { appid: number } => Number.isInteger(item.appid))
          .sort((left, right) => (left.priority ?? Infinity) - (right.priority ?? Infinity))
          .map((item) => ({ appId: item.appid, addedAt: item.date_added ? item.date_added * 1000 : undefined }))
      }
    }
  } catch {
    // Authenticated legacy fallback below.
  }

  const collected = new Map<number, { appId: number; addedAt?: number; priority?: number }>()
  for (let page = 0; page < 100; page++) {
    const fallback = await auth.fetchAuthenticated(
      `https://store.steampowered.com/wishlist/profiles/${steamId}/wishlistdata/?p=${page}`
    )
    if (!fallback.ok) break
    const json = (await fallback.json()) as Record<string, { added?: number; priority?: number }>
    const entries = Object.entries(json)
    if (entries.length === 0) break
    for (const [rawAppId, item] of entries) {
      const appId = Number(rawAppId)
      if (!Number.isInteger(appId) || appId <= 0) continue
      collected.set(appId, {
        appId,
        addedAt: item.added ? item.added * 1000 : undefined,
        priority: item.priority
      })
    }
  }
  return [...collected.values()].sort(
    (left, right) =>
      (left.priority ?? Infinity) - (right.priority ?? Infinity) ||
      (right.addedAt ?? 0) - (left.addedAt ?? 0)
  )
}

export async function fetchFeaturedProducts(
  region: StoreRegionConfig
): Promise<StoreProduct[]> {
  const url = new URL('https://store.steampowered.com/api/featuredcategories')
  url.searchParams.set('cc', region.countryCode)
  url.searchParams.set('l', region.steamLanguage)
  const response = await fetchWithElectronNet(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  if (!response.ok) throw new Error(`Steam featured catalog failed (${response.status})`)
  const json = (await response.json()) as Record<string, { items?: FeaturedItem[] }>
  const checkedAt = Date.now()
  const products = new Map<number, StoreProduct>()
  for (const section of ['specials', 'top_sellers', 'new_releases', 'coming_soon']) {
    for (const item of json[section]?.items ?? []) {
      if (!Number.isInteger(item.id) || !item.name?.trim()) continue
      const appId = item.id as number
      const offer = steamOffer(
        appId,
        region,
        {
          final: item.final_price,
          initial: item.original_price,
          discount: item.discount_percent,
          currency: item.currency
        },
        checkedAt
      )
      products.set(appId, {
        id: productId(appId),
        steamAppId: appId,
        name: item.name.trim(),
        headerUrl: item.large_capsule_image ?? item.header_image,
        heroUrl: item.header_image ?? item.large_capsule_image,
        portraitUrl: portraitUrl(appId),
        steamWishlisted: false,
        orbitWishlisted: false,
        offers: [offer],
        bestOffer: offer.available ? offer : undefined,
        recommendationScore: section === 'specials' ? 55 + (item.discount_percent ?? 0) : 35,
        priceUpdatedAt: checkedAt,
        updatedAt: checkedAt
      })
    }
  }
  return [...products.values()]
}

export async function fetchSteamProduct(
  appId: number,
  region: StoreRegionConfig,
  existing?: StoreProduct
): Promise<StoreProduct | null> {
  const url = new URL('https://store.steampowered.com/api/appdetails')
  url.searchParams.set('appids', String(appId))
  url.searchParams.set('cc', region.countryCode)
  url.searchParams.set('l', region.steamLanguage)
  const response = await fetchWithElectronNet(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  if (!response.ok) return null
  const json = (await response.json()) as Record<string, { success?: boolean; data?: SteamAppDetails }>
  const result = json[String(appId)]
  if (!result?.success || !result.data || result.data.type?.toLowerCase() !== 'game') return null
  const data = result.data
  const checkedAt = Date.now()
  const genres = (data.genres ?? [])
    .map((genre) => genre.description?.trim())
    .filter((genre): genre is string => Boolean(genre))
  const developers = (data.developers ?? []).map((developer) => developer.trim()).filter(Boolean)
  const publishers = (data.publishers ?? []).map((publisher) => publisher.trim()).filter(Boolean)
  const affinity = genreAffinity(genres)
  const supportedLanguages = parseSupportedLanguages(data.supported_languages)
  const offer = steamOffer(
    appId,
    region,
    {
      final: data.is_free ? 0 : data.price_overview?.final,
      initial: data.is_free ? 0 : data.price_overview?.initial,
      discount: data.price_overview?.discount_percent,
      formatted: data.is_free ? 'Free' : data.price_overview?.final_formatted,
      currency: data.price_overview?.currency
    },
    checkedAt
  )
  const resolvedName = data.name ?? existing?.name ?? String(appId)
  const portrait = portraitUrl(appId)
  const [epicOffer, gogOffer, xboxOffer, instantGamingOffer, artworkAvailable] = await Promise.all([
    fetchEpicOffer(resolvedName, region, checkedAt).catch(() => null),
    fetchGogOffer(resolvedName, region, checkedAt).catch(() => null),
    fetchXboxOffer(resolvedName, region, checkedAt).catch(() => null),
    fetchInstantGamingOffer(resolvedName, region, checkedAt).catch(() => null),
    hasRemoteArtwork(portrait)
  ])
  const externalOffers = [epicOffer, gogOffer, xboxOffer, instantGamingOffer]
  const offers = [
    offer,
    ...externalOffers.filter((candidate): candidate is StoreOffer => Boolean(candidate))
  ]
  return {
    ...existing,
    id: productId(appId),
    steamAppId: appId,
    name: data.name?.trim() || existing?.name || `Steam ${appId}`,
    summary: data.short_description?.trim() || existing?.summary,
    genres: genres.length > 0 ? genres : existing?.genres,
    developers: developers.length > 0 ? developers : existing?.developers,
    publishers: publishers.length > 0 ? publishers : existing?.publishers,
    supportedLanguages:
      supportedLanguages.length > 0 ? supportedLanguages : existing?.supportedLanguages,
    discoverEligible:
      hasSupportedInterfaceLanguage(supportedLanguages) &&
      !hasUnsupportedTitleScript(data.name?.trim() || existing?.name || ''),
    releaseDateText: data.release_date?.date?.trim() || existing?.releaseDateText,
    headerUrl: data.header_image ?? existing?.headerUrl,
    heroUrl: data.background_raw ?? data.background ?? data.header_image ?? existing?.heroUrl,
    portraitUrl: artworkAvailable ? portrait : undefined,
    artworkStatus: artworkAvailable ? 'available' : 'missing',
    canonicalSource: 'steam',
    sourceProductId: String(appId),
    steamWishlisted: existing?.steamWishlisted ?? false,
    orbitWishlisted: existing?.orbitWishlisted ?? false,
    offers,
    bestOffer: offer.available ? offer : undefined,
    recommendationScore:
      affinity.score + Math.min(data.price_overview?.discount_percent ?? 0, 15),
    recommendationReason: affinity.reason,
    detailsUpdatedAt: checkedAt,
    priceUpdatedAt: checkedAt,
    providerPricesUpdatedAt: checkedAt,
    providerPipelineVersion: 5,
    updatedAt: checkedAt
  }
}
