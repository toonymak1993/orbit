import { create } from 'zustand'

export type SettingsPage = 'interface' | 'libraries' | 'advanced'

export const SETTINGS_PAGE_ORDER: SettingsPage[] = ['interface', 'libraries', 'advanced']

interface SettingsNavigationState {
  page: SettingsPage
  direction: 1 | -1
  setPage: (page: SettingsPage) => void
  cyclePage: (step: 1 | -1) => void
}

export const useSettingsNavigationStore = create<SettingsNavigationState>((set, get) => ({
  page: 'interface',
  direction: 1,
  setPage: (page) => {
    const currentIndex = SETTINGS_PAGE_ORDER.indexOf(get().page)
    const nextIndex = SETTINGS_PAGE_ORDER.indexOf(page)
    set({ page, direction: nextIndex >= currentIndex ? 1 : -1 })
  },
  cyclePage: (step) => {
    const index = SETTINGS_PAGE_ORDER.indexOf(get().page)
    const nextIndex = (index + step + SETTINGS_PAGE_ORDER.length) % SETTINGS_PAGE_ORDER.length
    set({ page: SETTINGS_PAGE_ORDER[nextIndex], direction: step })
  }
}))
