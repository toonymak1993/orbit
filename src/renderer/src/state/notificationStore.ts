import { create } from 'zustand'
import type { TranslationKey } from '@renderer/i18n/translations'
import { usePreferencesStore } from './preferencesStore'

export type NotificationTone = 'info' | 'success' | 'price' | 'error'

export interface OrbitNotificationInput {
  tone?: NotificationTone
  titleKey: TranslationKey
  messageKey: TranslationKey
  vars?: Record<string, string | number>
  durationMs?: number
  force?: boolean
  replace?: boolean
}

export interface OrbitNotification extends OrbitNotificationInput {
  id: string
  tone: NotificationTone
  durationMs: number
}

interface NotificationState {
  items: OrbitNotification[]
  push: (input: OrbitNotificationInput) => void
  dismiss: (id: string) => void
}

let notificationSequence = 0

export const useNotificationStore = create<NotificationState>((set) => ({
  items: [],
  push: (input) => {
    if (!input.force && !usePreferencesStore.getState().notificationsEnabled) return

    const notification: OrbitNotification = {
      ...input,
      id: `orbit-notification-${Date.now()}-${++notificationSequence}`,
      tone: input.tone ?? 'info',
      durationMs: input.durationMs ?? 5200
    }
    set((state) => ({
      items: input.replace
        ? [notification]
        : [
            ...(state.items.length < 4
              ? state.items
              : [state.items[0], ...state.items.slice(-2)]),
            notification
          ]
    }))
  },
  dismiss: (id) => {
    set((state) => ({ items: state.items.filter((item) => item.id !== id) }))
  }
}))

export function notify(input: OrbitNotificationInput): void {
  useNotificationStore.getState().push(input)
}
