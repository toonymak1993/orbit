import { create } from 'zustand'
import type { LibrarySnapshot } from '@shared/ipc'

interface LibraryState {
  snapshot: LibrarySnapshot
  isRefreshing: boolean
  init: () => Promise<void>
  refresh: () => Promise<void>
  applySnapshot: (snapshot: LibrarySnapshot) => void
}

let listening = false
let initialized = false

export const useLibraryStore = create<LibraryState>((set, get) => ({
  snapshot: {
    games: [],
    providerGames: [],
    excludedGames: [],
    recentGameIds: [],
    loadedAt: 0,
    isLoadingMetadata: false
  },
  isRefreshing: false,
  applySnapshot: (snapshot) => set({ snapshot }),

  init: async () => {
    if (initialized) return
    initialized = true
    if (!listening) {
      listening = true
      window.api.library.onUpdated((snapshot) => set({ snapshot }))
    }
    // Show whatever we have cached on disk instantly, then reconcile every store
    // in the background — a failed/rate-limited refresh should never blank a
    // library we already loaded successfully before.
    try {
      const snapshot = await window.api.library.get()
      set({ snapshot })
    } catch (err) {
      console.error('Cached library hydration failed, attempting a fresh sync', err)
    }
    void get().refresh()
  },

  refresh: async () => {
    set({ isRefreshing: true })
    try {
      const snapshot = await window.api.library.refresh()
      set({ snapshot })
    } catch (err) {
      console.error('Library refresh failed, keeping cached snapshot', err)
    } finally {
      set({ isRefreshing: false })
    }
  }
}))
