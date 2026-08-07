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

export const useAuthStore = create<AuthState>((set) => ({
  account: null,
  status: { state: 'idle' },
  checkedExistingSession: false,

  restore: async () => {
    const account = await window.api.steam.getAccount()
    set({ account, checkedExistingSession: true })
  },

  startLogin: async () => {
    unsubscribe?.()
    set({ status: { state: 'idle' } })
    unsubscribe = window.api.steam.onStatus((status) => {
      set({ status })
      if (status.state === 'success') {
        set({ account: status.account })
      }
    })
    await window.api.steam.startLogin()
  },

  cancelLogin: async () => {
    unsubscribe?.()
    unsubscribe = null
    set({ status: { state: 'idle' } })
    await window.api.steam.cancelLogin()
  },

  logout: async () => {
    await window.api.steam.logout()
    set({ account: null, status: { state: 'idle' } })
  }
}))
