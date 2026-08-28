import { create } from 'zustand'
import type { FriendsProvider, FriendsSnapshot } from '@shared/ipc'

export type FriendsFilter = 'all' | FriendsProvider

const FILTER_ORDER: FriendsFilter[] = ['all', 'steam', 'discord', 'epic']

const initialSnapshot: FriendsSnapshot = {
  friends: [],
  providers: {
    steam: {
      provider: 'steam',
      state: 'not-connected',
      friendCount: 0,
      onlineCount: 0
    },
    discord: {
      provider: 'discord',
      state: 'not-connected',
      friendCount: 0,
      onlineCount: 0
    },
    epic: {
      provider: 'epic',
      state: 'not-connected',
      friendCount: 0,
      onlineCount: 0
    }
  },
  updatedAt: 0,
  isRefreshing: false
}

interface FriendsState {
  snapshot: FriendsSnapshot
  initialized: boolean
  filter: FriendsFilter
  init: () => Promise<void>
  refresh: () => Promise<void>
  setFilter: (filter: FriendsFilter) => void
  cycleFilter: (step: 1 | -1) => void
  connect: (provider: FriendsProvider) => Promise<void>
  disconnect: (provider: FriendsProvider) => Promise<void>
  openProvider: (provider: FriendsProvider) => Promise<void>
}

let listening = false

function commitSnapshot(snapshot: FriendsSnapshot): void {
  useFriendsStore.setState({ snapshot })
}

export const useFriendsStore = create<FriendsState>((set, get) => ({
  snapshot: initialSnapshot,
  initialized: false,
  filter: 'all',

  init: async () => {
    if (!listening) {
      listening = true
      window.api.friends.onUpdated(commitSnapshot)
    }
    commitSnapshot(await window.api.friends.get())
    set({ initialized: true })
    void get().refresh().catch(() => undefined)
  },

  refresh: async () => {
    commitSnapshot(await window.api.friends.refresh())
  },

  setFilter: (filter) => set({ filter }),

  cycleFilter: (step) =>
    set((state) => {
      const index = FILTER_ORDER.indexOf(state.filter)
      return {
        filter: FILTER_ORDER[(index + step + FILTER_ORDER.length) % FILTER_ORDER.length]
      }
    }),

  connect: async (provider) => {
    commitSnapshot(await window.api.friends.connect(provider))
  },

  disconnect: async (provider) => {
    commitSnapshot(await window.api.friends.disconnect(provider))
  },

  openProvider: (provider) => window.api.friends.openProvider(provider)
}))
