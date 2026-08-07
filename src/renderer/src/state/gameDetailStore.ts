import { create } from 'zustand'

interface GameDetailState {
  gameId: string | null
  openGame: (gameId: string) => void
  closeGame: () => void
}

export const useGameDetailStore = create<GameDetailState>((set) => ({
  gameId: null,
  openGame: (gameId) => set({ gameId }),
  closeGame: () => set({ gameId: null })
}))
