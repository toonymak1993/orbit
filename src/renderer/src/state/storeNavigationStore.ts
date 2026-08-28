import { create } from 'zustand'

export type StorePage = 'discover' | 'releases' | 'deals' | 'wishlist' | 'alerts'

export const STORE_PAGE_ORDER: StorePage[] = [
  'discover',
  'releases',
  'deals',
  'wishlist',
  'alerts'
]

interface StoreNavigationState {
  page: StorePage
  direction: 1 | -1
  setPage: (page: StorePage) => void
  cyclePage: (step: 1 | -1) => void
}

export const useStoreNavigationStore = create<StoreNavigationState>((set, get) => ({
  page: 'discover',
  direction: 1,
  setPage: (page) => {
    const currentIndex = STORE_PAGE_ORDER.indexOf(get().page)
    const nextIndex = STORE_PAGE_ORDER.indexOf(page)
    set({ page, direction: nextIndex >= currentIndex ? 1 : -1 })
  },
  cyclePage: (step) => {
    const currentIndex = STORE_PAGE_ORDER.indexOf(get().page)
    const nextIndex = (currentIndex + step + STORE_PAGE_ORDER.length) % STORE_PAGE_ORDER.length
    set({ page: STORE_PAGE_ORDER[nextIndex], direction: step })
  }
}))
