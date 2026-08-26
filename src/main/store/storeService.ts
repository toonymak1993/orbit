import { EventEmitter } from 'node:events'
import type {
  StoreProduct,
  StoreRegionId,
  StoreRelease,
  StoreSearchResponse,
  StoreSnapshot
} from '@shared/ipc'
import { settingsStore } from '../settingsStore'
import { steamAuthManager } from '../steam/steamAuth'
import { syncCoordinator } from '../sync/syncCoordinator'
import { gameRepository } from '../library/gameRepository'
import { STORE_REGIONS } from './storeRegions'
import { storeRepository } from './storeRepository'
import {
  fetchFeaturedProducts,
  fetchMonthlySteamReleases,
  fetchPersonalizedCandidateIds,
  fetchSteamProduct,
  fetchSteamWishlist
} from './steamStoreProvider'
import { searchAllStores } from './storeSearch'
import { normalizeStoreTitle } from './storeProviderUtils'

const PRICE_TTL_MS = 30 * 60 * 1000
const INTERACTIVE_COMPARE_FRESH_MS = 60 * 1000
const MAX_DETAIL_REFRESH_PER_SESSION = 120
const PROVIDER_PIPELINE_VERSION = 5
const REQUEST_GAP_MS = 220
const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function releaseStoreProduct(release: StoreRelease, current?: StoreProduct): StoreProduct {
  const now = Date.now()
  return {
    ...current,
    id: release.id,
    steamAppId: current?.steamAppId ?? release.steamAppId,
    canonicalSource: current?.canonicalSource ?? release.source,
    sourceProductId: current?.sourceProductId ?? release.sourceProductId,
    name: current?.name ?? release.name,
    discoverEligible: current?.discoverEligible ?? false,
    artworkStatus: 'available',
    releaseDateText:
      current?.releaseDateText ?? new Date(release.releaseDate).toISOString().slice(0, 10),
    headerUrl: current?.headerUrl ?? release.capsuleUrl,
    heroUrl: current?.heroUrl ?? release.heroUrl ?? release.capsuleUrl,
    steamWishlisted: current?.steamWishlisted ?? false,
    orbitWishlisted: current?.orbitWishlisted ?? false,
    offers: current?.offers ?? [],
    recommendationScore: current?.recommendationScore ?? 0,
    updatedAt: current?.updatedAt ?? now
  }
}

export class StoreService extends EventEmitter {
  private snapshotEmitTimer: ReturnType<typeof setTimeout> | undefined
  private isRefreshing = false
  private changedSinceLastRefresh = 0
  private refreshInFlight: Promise<StoreSnapshot> | null = null
  private productComparisons = new Map<string, Promise<StoreSnapshot>>()
  private searchCache = new Map<string, { expiresAt: number; response: StoreSearchResponse }>()
  private releaseCalendarError = false

  constructor() {
    super()
    const monitor = setInterval(() => void this.refresh(), PRICE_TTL_MS)
    monitor.unref()
  }

  getSnapshot(): StoreSnapshot {
    return storeRepository.getSnapshot(
      settingsStore.store.storeRegion,
      this.isRefreshing,
      this.changedSinceLastRefresh,
      this.releaseCalendarError
    )
  }

  async refresh(): Promise<StoreSnapshot> {
    if (this.refreshInFlight) return this.refreshInFlight
    this.refreshInFlight = this.doRefresh()
    try {
      return await this.refreshInFlight
    } finally {
      this.refreshInFlight = null
    }
  }

  async setRegion(region: StoreRegionId): Promise<StoreSnapshot> {
    settingsStore.set({ ...settingsStore.store, storeRegion: region })
    this.changedSinceLastRefresh = 0
    this.emitSnapshot()
    if (this.refreshInFlight) await this.refreshInFlight
    return this.refresh()
  }

  toggleOrbitWishlist(productId: string): StoreSnapshot {
    const region = settingsStore.store.storeRegion
    const release = this.getSnapshot().monthlyReleases.find((item) => item.id === productId)
    if (release) {
      const current = storeRepository.getProduct(region, productId)
      storeRepository.upsert(region, releaseStoreProduct(release, current))
    }
    storeRepository.toggleOrbitWishlist(productId)
    this.changedSinceLastRefresh++
    this.emitSnapshot()
    return this.getSnapshot()
  }

  setPriceAlert(productId: string, targetPriceMinor: number): StoreSnapshot {
    storeRepository.setPriceAlert(settingsStore.store.storeRegion, productId, targetPriceMinor)
    this.emitSnapshot()
    return this.getSnapshot()
  }

  removePriceAlert(productId: string): StoreSnapshot {
    storeRepository.removePriceAlert(settingsStore.store.storeRegion, productId)
    this.emitSnapshot()
    return this.getSnapshot()
  }

  refreshIfStale(): Promise<StoreSnapshot> {
    const snapshot = this.getSnapshot()
    if (
      snapshot.lastSuccessfulRefreshAt &&
      Date.now() - snapshot.lastSuccessfulRefreshAt < PRICE_TTL_MS
    ) return Promise.resolve(snapshot)
    return this.refresh()
  }

  compareProduct(productId: string): Promise<StoreSnapshot> {
    const active = this.productComparisons.get(productId)
    if (active) return active
    const comparison = this.doCompareProduct(productId).finally(() => {
      this.productComparisons.delete(productId)
    })
    this.productComparisons.set(productId, comparison)
    return comparison
  }

  async search(rawQuery: string): Promise<StoreSearchResponse> {
    const query = rawQuery.trim().slice(0, 80)
    if (query.length < 2) return { query, products: [] }
    const regionId = settingsStore.store.storeRegion
    const cacheKey = `${regionId}:${normalizeStoreTitle(query)}`
    const cached = this.searchCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) return cached.response
    const products = await searchAllStores(query, STORE_REGIONS[regionId])
    for (const product of products) storeRepository.upsert(regionId, product)
    const hydrated = storeRepository.getProducts(regionId)
    const productIds = new Set(products.map((product) => product.id))
    const response = { query, products: hydrated.filter((product) => productIds.has(product.id)) }
    this.searchCache.set(cacheKey, { expiresAt: Date.now() + SEARCH_CACHE_TTL_MS, response })
    return response
  }

  private async doCompareProduct(productId: string): Promise<StoreSnapshot> {
    const regionId = settingsStore.store.storeRegion
    const existing = storeRepository.getProduct(regionId, productId)
    const appId = existing?.steamAppId ?? Number(productId.replace(/^steam:/, ''))
    if ((!Number.isInteger(appId) || appId <= 0) && !existing) return this.getSnapshot()
    if (
      existing?.providerPipelineVersion === PROVIDER_PIPELINE_VERSION &&
      existing.providerPricesUpdatedAt &&
      Date.now() - existing.providerPricesUpdatedAt < INTERACTIVE_COMPARE_FRESH_MS
    ) {
      return this.getSnapshot()
    }
    if (!this.isRefreshing) {
      syncCoordinator.begin(
        'store',
        1,
        0,
        existing ? `5 stores · ${existing.name}` : '5 stores',
        'orbit-store-compare'
      )
    }
    try {
      const product =
        Number.isInteger(appId) && appId > 0
          ? await fetchSteamProduct(appId, STORE_REGIONS[regionId], existing)
          : (await searchAllStores(existing?.name ?? '', STORE_REGIONS[regionId])).find(
              (candidate) =>
                normalizeStoreTitle(candidate.name) === normalizeStoreTitle(existing?.name ?? '')
            )
      if (product && product.id !== productId) product.id = productId
      if (product && storeRepository.upsert(regionId, product)) {
        this.changedSinceLastRefresh++
        this.emitSnapshot()
      }
      if (!this.isRefreshing) syncCoordinator.complete('store', existing?.name, 'orbit-store-compare')
    } catch (error) {
      if (!this.isRefreshing) {
        syncCoordinator.fail(
          'store',
          error instanceof Error ? error.message : 'Price comparison failed',
          'orbit-store-compare'
        )
      }
    }
    return this.getSnapshot()
  }

  private async doRefresh(): Promise<StoreSnapshot> {
    const regionId = settingsStore.store.storeRegion
    const region = STORE_REGIONS[regionId]
    this.isRefreshing = true
    this.changedSinceLastRefresh = 0
    this.releaseCalendarError = false
    this.emitSnapshot()

    try {
      const account = steamAuthManager.getAccount() ?? (await steamAuthManager.restoreSession())
      const ownedAppIds = new Set(
        gameRepository
          .getSnapshot()
          .games.map((game) => game.appId)
          .filter((appId): appId is number => Number.isInteger(appId))
      )
      const [wishlist, featured, personalizedIds, releaseCalendar] = await Promise.all([
        account ? fetchSteamWishlist(account.steamId, steamAuthManager).catch(() => []) : Promise.resolve([]),
        fetchFeaturedProducts(region).catch(() => []),
        fetchPersonalizedCandidateIds(region).catch(() => []),
        fetchMonthlySteamReleases(region)
          .then((releases) => ({ ok: true as const, releases }))
          .catch(() => ({ ok: false as const, releases: [] }))
      ])

      this.releaseCalendarError = !releaseCalendar.ok
      if (releaseCalendar.ok) {
        const now = new Date()
        const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
        storeRepository.replaceMonthlyReleases(regionId, month, releaseCalendar.releases)
      }

      storeRepository.replaceSteamWishlist(
        wishlist.map((item) => ({ productId: `steam:${item.appId}`, addedAt: item.addedAt }))
      )
      for (const product of featured) {
        if (ownedAppIds.has(product.steamAppId ?? -1)) continue
        if (storeRepository.upsert(regionId, product)) this.changedSinceLastRefresh++
      }
      this.emitSnapshot()

      const targetIds = [
        ...wishlist.map((item) => item.appId),
        ...personalizedIds,
        ...featured
          .map((product) => product.steamAppId)
          .filter((appId): appId is number => Number.isInteger(appId))
      ]
      const uniqueTargets = [...new Set(targetIds)]
        .filter((appId) => wishlist.some((item) => item.appId === appId) || !ownedAppIds.has(appId))
        .filter((appId) => {
          const cached = storeRepository.getProduct(regionId, `steam:${appId}`)
          return (
            cached?.providerPipelineVersion !== PROVIDER_PIPELINE_VERSION ||
            !cached.providerPricesUpdatedAt ||
            Date.now() - cached.providerPricesUpdatedAt >= PRICE_TTL_MS
          )
        })
        .slice(0, MAX_DETAIL_REFRESH_PER_SESSION)

      syncCoordinator.begin('store', uniqueTargets.length, 0, 'Store cache', 'orbit-store')
      for (let index = 0; index < uniqueTargets.length; index++) {
        const appId = uniqueTargets[index]
        const existing = storeRepository.getProduct(regionId, `steam:${appId}`)
        try {
          const product = await fetchSteamProduct(appId, region, existing)
          if (product && storeRepository.upsert(regionId, product)) {
            this.changedSinceLastRefresh++
            this.emitSnapshot()
          }
        } catch {
          // Preserve the last successful delta and continue with the queue.
        }
        syncCoordinator.progress(
          'store',
          index + 1,
          uniqueTargets.length,
          existing ? `5 stores · ${existing.name}` : '5 stores',
          'orbit-store'
        )
        if (index + 1 < uniqueTargets.length) await delay(REQUEST_GAP_MS)
      }

      storeRepository.pruneUnverifiedProducts(regionId)

      storeRepository.markRefreshComplete(regionId)
      syncCoordinator.complete('store', undefined, 'orbit-store')
    } catch (error) {
      this.releaseCalendarError = true
      syncCoordinator.fail(
        'store',
        error instanceof Error ? error.message : 'Store refresh failed',
        'orbit-store'
      )
    } finally {
      this.isRefreshing = false
      this.emitSnapshot()
    }
    return this.getSnapshot()
  }

  private emitSnapshot(): void {
    if (this.snapshotEmitTimer) return
    this.snapshotEmitTimer = setTimeout(() => {
      this.snapshotEmitTimer = undefined
      this.emit('updated', this.getSnapshot())
    }, 120)
    this.snapshotEmitTimer.unref()
  }
}

export const storeService = new StoreService()
