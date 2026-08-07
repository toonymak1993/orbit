import { create } from 'zustand'
import type { EpicAccount, EpicLoginStatus } from '@shared/ipc'

interface EpicAuthState {
  account: EpicAccount | null
  status: EpicLoginStatus
  checkedExistingSession: boolean
  restore: () => Promise<void>
  startLogin: () => Promise<void>
  cancelLogin: () => Promise<void>
  logout: () => Promise<void>
}

let unsubscribe: (() => void) | null = null

export const useEpicAuthStore = create<EpicAuthState>((set) => ({
  account: null,
  status: { state: 'idle' },
  checkedExistingSession: false,

  restore: async () => {
    const account = await window.api.epic.getAccount()
    set({ account, checkedExistingSession: true })
  },

  startLogin: async () => {
    unsubscribe?.()
    set({ status: { state: 'idle' } })
    unsubscribe = window.api.epic.onStatus((status) => {
      set({ status })
      if (status.state === 'success') set({ account: status.account })
    })
    await window.api.epic.startLogin()
  },

  cancelLogin: async () => {
    unsubscribe?.()
    unsubscribe = null
    set({ status: { state: 'idle' } })
    await window.api.epic.cancelLogin()
  },

  logout: async () => {
    await window.api.epic.logout()
    set({ account: null, status: { state: 'idle' } })
  }
}))
