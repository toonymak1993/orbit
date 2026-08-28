import { create } from 'zustand'
import type { GameProvider } from '@shared/ipc'

export type LibrarySource = 'favorites' | 'all' | GameProvider | `collection:${string}`

// Add new providers here once their library integration is available. Keeping
// the order in one place makes LT/RT navigation and the visible tabs agree.
export const LIBRARY_SOURCE_ORDER: LibrarySource[] = [
  'favorites',
  'all',
  'steam',
  'epic',
  'xbox',
  'local'
]

export function collectionLibrarySource(collectionId: string): LibrarySource {
  return `collection:${collectionId}`
}

export function collectionIdFromLibrarySource(source: LibrarySource): string | null {
  return source.startsWith('collection:') ? source.slice('collection:'.length) : null
}

interface LibraryFilterState {
  source: LibrarySource
  collectionIds: string[]
  setSource: (source: LibrarySource) => void
  setCollectionIds: (collectionIds: string[]) => void
  cycleSource: (step: 1 | -1) => void
}

export const useLibraryFilterStore = create<LibraryFilterState>((set, get) => ({
  source: 'all',
  collectionIds: [],
  setSource: (source) => set({ source }),
  setCollectionIds: (collectionIds) => {
    const activeCollectionId = collectionIdFromLibrarySource(get().source)
    set({
      collectionIds,
      source:
        activeCollectionId && !collectionIds.includes(activeCollectionId) ? 'all' : get().source
    })
  },
  cycleSource: (step) => {
    const order = [
      ...LIBRARY_SOURCE_ORDER,
      ...get().collectionIds.map(collectionLibrarySource)
    ]
    const index = order.indexOf(get().source)
    const nextIndex = ((index < 0 ? 0 : index) + step + order.length) % order.length
    set({ source: order[nextIndex] })
  }
}))
