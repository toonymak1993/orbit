import { create } from 'zustand'
import type { SteamAccount, SteamLoginStatus } from '@shared/ipc'

interface AuthState {
  account: SteamAccount | null
  status: SteamLoginStatus
  checkedExistingSession: boolean
  restore: () => Promise<void>
  startLogin: () => Promise<void>
  cancelLogin: () => Promise<void>
  logout: () => Promise<void>
}

let unsubscribe: (() => void) | null = null
let unsubscribeAccountUpdates: (() => void) | null = null

export const useAuthStore = create<AuthState>((set, get) => ({
  account: null,
  status: { state: 'idle' },
  checkedExistingSession: false,

  restore: async () => {
    unsubscribeAccountUpdates ??= window.api.steam.onAccountUpdated((account) => {
      set({ account })
    })
    const account = await window.api.steam.getAccount()
    set({ account, checkedExistingSession: true })
  },

  startLogin: async () => {
    if (get().status.state === 'waiting-for-browser') return

    unsubscribeAccountUpdates ??= window.api.steam.onAccountUpdated((account) => {
      set({ account })
    })
    unsubscribe?.()
    set({ status: { state: 'waiting-for-browser' } })
    unsubscribe = window.api.steam.onStatus((status) => {
      set({ status })
      if (status.state === 'success') {
        set({ account: status.account })
      }
    })
    try {
      await window.api.steam.startLogin()
    } catch (error) {
      unsubscribe?.()
      unsubscribe = null
      set({
        status: {
          state: 'error',
          message: error instanceof Error ? error.message : 'Steam login could not be started.'
        }
      })
    }
  },

  cancelLogin: async () => {
    unsubscribe?.()
    unsubscribe = null
    set({ status: { state: 'idle' } })
    await window.api.steam.cancelLogin()
  },

  logout: async () => {
    await window.api.steam.logout()
    unsubscribeAccountUpdates?.()
    unsubscribeAccountUpdates = null
    set({ account: null, status: { state: 'idle' } })
  }
}))
