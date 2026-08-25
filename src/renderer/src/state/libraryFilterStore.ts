import { create } from 'zustand'
import type { GameProvider } from '@shared/ipc'

export type LibrarySource = 'all' | GameProvider

// Add new providers here once their library integration is available. Keeping
// the order in one place makes LT/RT navigation and the visible tabs agree.
export const LIBRARY_SOURCE_ORDER: LibrarySource[] = ['all', 'steam', 'epic', 'xbox', 'local']

interface LibraryFilterState {
  source: LibrarySource
  setSource: (source: LibrarySource) => void
  cycleSource: (step: 1 | -1) => void
}

export const useLibraryFilterStore = create<LibraryFilterState>((set, get) => ({
  source: 'all',
  setSource: (source) => set({ source }),
  cycleSource: (step) => {
    const index = LIBRARY_SOURCE_ORDER.indexOf(get().source)
    const nextIndex = (index + step + LIBRARY_SOURCE_ORDER.length) % LIBRARY_SOURCE_ORDER.length
    set({ source: LIBRARY_SOURCE_ORDER[nextIndex] })
  }
}))
