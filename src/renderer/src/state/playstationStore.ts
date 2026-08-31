import { create } from 'zustand'
import type {
  PlayStationAccount,
  PlayStationLoginStatus,
  PlayStationRemotePlayStatus
} from '@shared/ipc'

interface PlayStationState {
  account: PlayStationAccount | null
  status: PlayStationLoginStatus
  remotePlay: PlayStationRemotePlayStatus | null
  restore: () => Promise<void>
  startLogin: () => Promise<void>
  cancelLogin: () => Promise<void>
  logout: () => Promise<void>
  refreshRemotePlay: () => Promise<void>
}

let unsubscribe: (() => void) | null = null

function listen(set: (partial: Partial<PlayStationState>) => void): void {
  unsubscribe?.()
  unsubscribe = window.api.playstation.onStatus((status) => {
    set({ status })
    if (status.state === 'success') set({ account: status.account })
  })
}

export const usePlayStationStore = create<PlayStationState>((set, get) => ({
  account: null,
  status: { state: 'idle' },
  remotePlay: null,

  restore: async () => {
    const [account, remotePlay] = await Promise.all([
      window.api.playstation.getAccount(),
      window.api.playstation.getRemotePlayStatus()
    ])
    set({ account, remotePlay })
  },

  startLogin: async () => {
    if (get().status.state === 'waiting-for-browser') return
    listen(set)
    set({ status: { state: 'waiting-for-browser' } })
    try {
      await window.api.playstation.startLogin()
    } catch (error) {
      set({
        status: {
          state: 'error',
          message: error instanceof Error ? error.message : 'PlayStation sign-in could not be started.'
        }
      })
    }
  },

  cancelLogin: async () => {
    await window.api.playstation.cancelLogin()
    set({ status: { state: 'idle' } })
  },

  logout: async () => {
    await window.api.playstation.logout()
    set({ account: null, status: { state: 'idle' } })
  },

  refreshRemotePlay: async () => {
    const remotePlay = await window.api.playstation.refreshRemotePlayStatus()
    set({ remotePlay })
  }
}))
