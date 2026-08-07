import { create } from 'zustand'
import type { StoreProduct, StoreRegionId, StoreSnapshot } from '@shared/ipc'

const initialSnapshot: StoreSnapshot = {
  products: [],
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

export const useStoreStore = create<StoreState>((set) => ({
  snapshot: initialSnapshot,
  initialized: false,
  searchResults: [],
  isSearching: false,
  init: async () => {
    if (!listening) {
      listening = true
      window.api.store.onUpdated((snapshot) => set({ snapshot }))
    }
    set({ snapshot: await window.api.store.get(), initialized: true })
  },
  refresh: async () => {
    set({ snapshot: await window.api.store.refresh() })
  },
  refreshIfStale: async () => {
    const lastRefresh = useStoreStore.getState().snapshot.lastSuccessfulRefreshAt ?? 0
    if (Date.now() - lastRefresh < 30 * 60 * 1000) return
    set({ snapshot: await window.api.store.refresh() })
  },
  compareProduct: async (productId) => {
    set({ snapshot: await window.api.store.compareProduct(productId) })
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
    set({ snapshot: await window.api.store.toggleWishlist(productId) })
  },
  setPriceAlert: async (productId, targetPriceMinor) => {
    set({ snapshot: await window.api.store.setPriceAlert(productId, targetPriceMinor) })
  },
  removePriceAlert: async (productId) => {
    set({ snapshot: await window.api.store.removePriceAlert(productId) })
  },
  setRegion: async (region) => {
    const current = await window.api.store.setRegion(region)
    set({ snapshot: current })
  }
}))
