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

export const useEpicAuthStore = create<EpicAuthState>((set, get) => ({
  account: null,
  status: { state: 'idle' },
  checkedExistingSession: false,

  restore: async () => {
    const account = await window.api.epic.getAccount()
    set({ account, checkedExistingSession: true })
  },

  startLogin: async () => {
    if (get().status.state === 'waiting-for-browser') return

    unsubscribe?.()
    set({ status: { state: 'waiting-for-browser' } })
    unsubscribe = window.api.epic.onStatus((status) => {
      set({ status })
      if (status.state === 'success') set({ account: status.account })
    })
    try {
      await window.api.epic.startLogin()
    } catch (error) {
      unsubscribe?.()
      unsubscribe = null
      set({
        status: {
          state: 'error',
          message: error instanceof Error ? error.message : 'Epic login could not be started.'
        }
      })
    }
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
