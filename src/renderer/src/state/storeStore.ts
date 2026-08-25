import { create } from 'zustand'
import type { StoreProduct, StoreRegionId, StoreSnapshot } from '@shared/ipc'
import { notify } from './notificationStore'

const initialSnapshot: StoreSnapshot = {
  products: [],
  monthlyReleases: [],
  releaseCalendarError: false,
  region: 'eu',
  updatedAt: 0,
  isRefreshing: false,
  changedSinceLastRefresh: 0,
  priceHistory: {},
  priceAlerts: []
}

interface StoreState {
  snapshot: StoreSnapshot
  initialized: boolean
  searchResults: StoreProduct[]
  isSearching: boolean
  init: () => Promise<void>
  refresh: () => Promise<void>
  refreshIfStale: () => Promise<void>
  compareProduct: (productId: string) => Promise<void>
  search: (query: string) => Promise<void>
  clearSearch: () => void
  toggleWishlist: (productId: string) => Promise<void>
  setPriceAlert: (productId: string, targetPriceMinor: number) => Promise<void>
  removePriceAlert: (productId: string) => Promise<void>
  setRegion: (region: StoreRegionId) => Promise<void>
}

let listening = false
let searchSequence = 0

function formatMinor(priceMinor: number, currency: string): string {
  const language = currentLanguage()
  try {
    return new Intl.NumberFormat(language === 'de' ? 'de-DE' : 'en-US', {
      style: 'currency',
      currency
    }).format(priceMinor / 100)
  } catch {
    return `${(priceMinor / 100).toFixed(2)} ${currency}`
  }
}

function currentLanguage(): 'en' | 'de' {
  return document.documentElement.lang === 'de' ? 'de' : 'en'
}

function productName(snapshot: StoreSnapshot, productId: string): string {
  return snapshot.products.find((product) => product.id === productId)?.name ?? productId
}

function notifyTriggeredPriceAlerts(previous: StoreSnapshot, next: StoreSnapshot): void {
  if (previous.region !== next.region) return
  const previousAlerts = new Map(previous.priceAlerts.map((alert) => [alert.id, alert]))
  for (const alert of next.priceAlerts) {
    if (!alert.triggeredAt || previousAlerts.get(alert.id)?.triggeredAt) continue
    const priceMinor = alert.currentPriceMinor ?? alert.targetPriceMinor
    notify({
      tone: 'price',
      titleKey: 'notification.priceAlert.triggeredTitle',
      messageKey: 'notification.priceAlert.triggeredBody',
      vars: {
        game: productName(next, alert.productId),
        price: formatMinor(priceMinor, alert.currency)
      },
      durationMs: 6800
    })
  }
}

function commitSnapshot(snapshot: StoreSnapshot, checkTriggers = true): void {
  const previous = useStoreStore.getState().snapshot
  if (checkTriggers && useStoreStore.getState().initialized) {
    notifyTriggeredPriceAlerts(previous, snapshot)
  }
  useStoreStore.setState({ snapshot })
}

export const useStoreStore = create<StoreState>((set) => ({
  snapshot: initialSnapshot,
  initialized: false,
  searchResults: [],
  isSearching: false,
  init: async () => {
    if (!listening) {
      listening = true
      window.api.store.onUpdated((snapshot) => commitSnapshot(snapshot))
    }
    commitSnapshot(await window.api.store.get(), false)
    set({ initialized: true })
  },
  refresh: async () => {
    commitSnapshot(await window.api.store.refresh())
  },
  refreshIfStale: async () => {
    const snapshot = useStoreStore.getState().snapshot
    const lastRefresh = snapshot.lastSuccessfulRefreshAt ?? 0
    const now = new Date()
    const expectedCalendarMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    if (
      Date.now() - lastRefresh < 30 * 60 * 1000 &&
      snapshot.releaseCalendarMonth === expectedCalendarMonth
    ) return
    commitSnapshot(await window.api.store.refresh())
  },
  compareProduct: async (productId) => {
    commitSnapshot(await window.api.store.compareProduct(productId))
  },
  search: async (query) => {
    const sequence = ++searchSequence
    set({ isSearching: true, searchResults: [] })
    try {
      const response = await window.api.store.search(query)
      if (sequence === searchSequence) set({ searchResults: response.products })
    } catch {
      if (sequence === searchSequence) set({ searchResults: [] })
    } finally {
      if (sequence === searchSequence) set({ isSearching: false })
    }
  },
  clearSearch: () => {
    searchSequence++
    set({ searchResults: [], isSearching: false })
  },
  toggleWishlist: async (productId) => {
    commitSnapshot(await window.api.store.toggleWishlist(productId))
  },
  setPriceAlert: async (productId, targetPriceMinor) => {
    const previous = useStoreStore.getState().snapshot
    const wasWatching = previous.priceAlerts.some((alert) => alert.productId === productId)
    try {
      const snapshot = await window.api.store.setPriceAlert(productId, targetPriceMinor)
      const alert = snapshot.priceAlerts.find((item) => item.productId === productId)
      if (!alert) throw new Error('Price alert was not stored')
      notify({
        tone: 'success',
        titleKey: wasWatching
          ? 'notification.priceAlert.updatedTitle'
          : 'notification.priceAlert.savedTitle',
        messageKey: 'notification.priceAlert.savedBody',
        vars: {
          game: productName(snapshot, productId),
          price: formatMinor(alert.targetPriceMinor, alert.currency)
        }
      })
      commitSnapshot(snapshot)
    } catch {
      notify({
        tone: 'error',
        titleKey: 'notification.priceAlert.failedTitle',
        messageKey: 'notification.priceAlert.failedBody'
      })
    }
  },
  removePriceAlert: async (productId) => {
    const previous = useStoreStore.getState().snapshot
    try {
      const snapshot = await window.api.store.removePriceAlert(productId)
      commitSnapshot(snapshot, false)
      notify({
        tone: 'info',
        titleKey: 'notification.priceAlert.removedTitle',
        messageKey: 'notification.priceAlert.removedBody',
        vars: { game: productName(previous, productId) }
      })
    } catch {
      notify({
        tone: 'error',
        titleKey: 'notification.priceAlert.failedTitle',
        messageKey: 'notification.priceAlert.failedBody'
      })
    }
  },
  setRegion: async (region) => {
    const current = await window.api.store.setRegion(region)
    commitSnapshot(current, false)
  }
}))
