import Store from 'electron-store'
import { app } from 'electron'
import type {
  StorePriceAlert,
  StorePricePoint,
  StoreProduct,
  StoreRegionId,
  StoreSnapshot
} from '@shared/ipc'

const SCHEMA_VERSION = 1

interface RegionCache {
  products: Record<string, StoreProduct>
  updatedAt: number
  lastSuccessfulRefreshAt?: number
}

interface StoreDatabase {
  schemaVersion: number
  orbitWishlistIds: string[]
  steamWishlist: Record<string, number>
  regions: Partial<Record<StoreRegionId, RegionCache>>
  priceHistory: Record<string, StorePricePoint[]>
  priceAlerts: Record<string, StorePriceAlert>
}

const database = new Store<StoreDatabase>({
  name: 'orbit-store-v1',
  defaults: {
    schemaVersion: SCHEMA_VERSION,
    orbitWishlistIds: [],
    steamWishlist: {},
    regions: {},
    priceHistory: {},
    priceAlerts: {}
  }
})
const databaseState: StoreDatabase = database.store
let databasePersistTimer: ReturnType<typeof setTimeout> | undefined

function flushDatabase(): void {
  if (databasePersistTimer) clearTimeout(databasePersistTimer)
  databasePersistTimer = undefined
  database.store = databaseState
}

function scheduleDatabasePersist(): void {
  if (databasePersistTimer) return
  databasePersistTimer = setTimeout(flushDatabase, 500)
  databasePersistTimer.unref()
}

app.on('before-quit', flushDatabase)

function ensureRegion(region: StoreRegionId): RegionCache {
  const existing = databaseState.regions[region]
  if (existing) return existing
  const created: RegionCache = { products: {}, updatedAt: 0 }
  databaseState.regions[region] = created
  scheduleDatabasePersist()
  return created
}

function chooseBestOffer(product: StoreProduct): StoreProduct['bestOffer'] {
  return product.offers
    .filter(
      (offer) =>
        offer.available &&
        offer.exactMatch &&
        offer.platform !== 'xbox' &&
        typeof offer.priceMinor === 'number' &&
        offer.priceMinor >= 0
    )
    .sort((left, right) => (left.priceMinor ?? Infinity) - (right.priceMinor ?? Infinity))[0]
}

function comparableProduct(product: StoreProduct): string {
  const { updatedAt: _updatedAt, ...content } = product
  return JSON.stringify(content)
}

export class StoreRepository {
  private historyKey(region: StoreRegionId, productId: string): string {
    return `${region}:${productId}`
  }

  getProduct(region: StoreRegionId, productId: string): StoreProduct | undefined {
    return ensureRegion(region).products[productId]
  }

  getProducts(region: StoreRegionId): StoreProduct[] {
    const regionCache = ensureRegion(region)
    const orbitWishlist = new Set(databaseState.orbitWishlistIds)
    const steamWishlist = databaseState.steamWishlist
    return Object.values(regionCache.products).map((product) => {
      const hydrated = {
        ...product,
        orbitWishlisted: orbitWishlist.has(product.id),
        steamWishlisted: Object.hasOwn(steamWishlist, product.id),
        steamWishlistAddedAt: steamWishlist[product.id]
      }
      return { ...hydrated, bestOffer: chooseBestOffer(hydrated) }
    })
  }

  upsert(region: StoreRegionId, delta: StoreProduct): boolean {
    const cache = ensureRegion(region)
    const current = cache.products[delta.id]
    const orbitWishlist = databaseState.orbitWishlistIds.includes(delta.id)
    const steamWishlistAddedAt = databaseState.steamWishlist[delta.id]
    const merged: StoreProduct = {
      ...current,
      ...delta,
      orbitWishlisted: orbitWishlist,
      steamWishlisted: steamWishlistAddedAt !== undefined,
      steamWishlistAddedAt,
      offers: delta.offers,
      updatedAt: current?.updatedAt ?? delta.updatedAt
    }
    merged.bestOffer = chooseBestOffer(merged)
    const previousBest = current ? chooseBestOffer(current) : undefined
    if (
      merged.bestOffer?.priceMinor !== undefined &&
      merged.bestOffer.currency &&
      (previousBest?.priceMinor !== merged.bestOffer.priceMinor ||
        previousBest?.currency !== merged.bestOffer.currency ||
        previousBest?.source !== merged.bestOffer.source)
    ) {
      this.recordPrice(region, merged.id, {
        priceMinor: merged.bestOffer.priceMinor,
        currency: merged.bestOffer.currency,
        source: merged.bestOffer.source,
        recordedAt: merged.bestOffer.checkedAt
      })
      this.evaluateAlert(region, merged.id, merged.bestOffer.priceMinor)
    }
    if (current && comparableProduct(current) === comparableProduct(merged)) return false
    merged.updatedAt = Date.now()
    cache.products[delta.id] = merged
    cache.updatedAt = Date.now()
    scheduleDatabasePersist()
    return true
  }

  replaceSteamWishlist(items: Array<{ productId: string; addedAt?: number }>): void {
    const wishlist: Record<string, number> = {}
    for (const item of items) wishlist[item.productId] = item.addedAt ?? Date.now()
    databaseState.steamWishlist = wishlist
    scheduleDatabasePersist()
  }

  toggleOrbitWishlist(productId: string): boolean {
    const wishlist = new Set(databaseState.orbitWishlistIds)
    const enabled = !wishlist.has(productId)
    if (enabled) wishlist.add(productId)
    else wishlist.delete(productId)
    databaseState.orbitWishlistIds = [...wishlist]
    scheduleDatabasePersist()
    return enabled
  }

  setPriceAlert(
    region: StoreRegionId,
    productId: string,
    targetPriceMinor: number
  ): StorePriceAlert | undefined {
    const product = this.getProduct(region, productId)
    if (!product || !Number.isFinite(targetPriceMinor) || targetPriceMinor < 0) return undefined
    const best = chooseBestOffer(product)
    const id = this.historyKey(region, productId)
    if (best?.priceMinor !== undefined && best.currency) {
      this.recordPrice(region, productId, {
        priceMinor: best.priceMinor,
        currency: best.currency,
        source: best.source,
        recordedAt: Date.now()
      })
    }
    const alert: StorePriceAlert = {
      id,
      productId,
      region,
      targetPriceMinor: Math.round(targetPriceMinor),
      currency: best?.currency ?? 'EUR',
      startPriceMinor: best?.priceMinor,
      currentPriceMinor: best?.priceMinor,
      createdAt: databaseState.priceAlerts[id]?.createdAt ?? Date.now(),
      triggeredAt:
        best?.priceMinor !== undefined && best.priceMinor <= targetPriceMinor ? Date.now() : undefined,
      enabled: true
    }
    databaseState.priceAlerts[id] = alert
    scheduleDatabasePersist()
    return alert
  }

  removePriceAlert(region: StoreRegionId, productId: string): void {
    delete databaseState.priceAlerts[this.historyKey(region, productId)]
    scheduleDatabasePersist()
  }

  pruneUnverifiedProducts(region: StoreRegionId): number {
    const cache = ensureRegion(region)
    const wishlist = databaseState.steamWishlist
    const next = Object.fromEntries(
      Object.entries(cache.products).filter(
        ([id, product]) => Boolean(product.detailsUpdatedAt) || Object.hasOwn(wishlist, id)
      )
    )
    const removed = Object.keys(cache.products).length - Object.keys(next).length
    if (removed > 0) {
      cache.products = next
      cache.updatedAt = Date.now()
      scheduleDatabasePersist()
    }
    return removed
  }

  private recordPrice(region: StoreRegionId, productId: string, point: StorePricePoint): void {
    const key = this.historyKey(region, productId)
    const history = databaseState.priceHistory[key] ?? []
    const previous = history.at(-1)
    if (
      previous?.priceMinor === point.priceMinor &&
      previous.currency === point.currency &&
      previous.source === point.source
    ) return
    databaseState.priceHistory[key] = [...history, point].slice(-180)
    scheduleDatabasePersist()
  }

  private evaluateAlert(region: StoreRegionId, productId: string, currentPriceMinor: number): void {
    const id = this.historyKey(region, productId)
    const alert = databaseState.priceAlerts[id]
    if (!alert?.enabled) return
    databaseState.priceAlerts[id] = {
      ...alert,
      currentPriceMinor,
      triggeredAt:
        currentPriceMinor <= alert.targetPriceMinor ? alert.triggeredAt ?? Date.now() : undefined
    }
    scheduleDatabasePersist()
  }

  markRefreshComplete(region: StoreRegionId): void {
    const now = Date.now()
    const cache = ensureRegion(region)
    cache.updatedAt = now
    cache.lastSuccessfulRefreshAt = now
    scheduleDatabasePersist()
  }

  getSnapshot(
    region: StoreRegionId,
    isRefreshing: boolean,
    changedSinceLastRefresh: number
  ): StoreSnapshot {
    const cache = ensureRegion(region)
    return {
      products: this.getProducts(region),
      region,
      updatedAt: cache.updatedAt,
      lastSuccessfulRefreshAt: cache.lastSuccessfulRefreshAt,
      isRefreshing,
      changedSinceLastRefresh,
      priceHistory: Object.fromEntries(
        Object.entries(databaseState.priceHistory)
          .filter(([key]) => key.startsWith(`${region}:`))
          .map(([key, points]) => [key.slice(region.length + 1), points])
      ),
      priceAlerts: Object.values(databaseState.priceAlerts).filter((alert) => alert.region === region)
    }
  }
}

export const storeRepository = new StoreRepository()
