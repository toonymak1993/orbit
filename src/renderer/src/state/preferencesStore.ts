import { create } from 'zustand'
import type { AudioPreset, HomeLayoutId, ThemeId, UiDensity, Language } from '@shared/ipc'
import { setUiAudioPreset } from '@renderer/lib/uiAudio'

interface PreferencesState {
  theme: ThemeId
  homeLayout: HomeLayoutId
  uiDensity: UiDensity
  language: Language
  audioPreset: AudioPreset
  showStoreTab: boolean
  showHomeBanners: boolean
  showAchievements: boolean
  closeLaunchersAfterGame: boolean
  hydrated: boolean
  hydrate: () => Promise<void>
  setTheme: (theme: ThemeId) => Promise<void>
  setHomeLayout: (homeLayout: HomeLayoutId) => Promise<void>
  setDensity: (density: UiDensity) => Promise<void>
  setLanguage: (language: Language) => Promise<void>
  setAudioPreset: (audioPreset: AudioPreset) => Promise<void>
  setShowStoreTab: (visible: boolean) => Promise<void>
  setShowHomeBanners: (visible: boolean) => Promise<void>
  setShowAchievements: (visible: boolean) => Promise<void>
  setCloseLaunchersAfterGame: (enabled: boolean) => Promise<void>
}

export const THEME_OPTIONS: { id: ThemeId; label: string }[] = [
  { id: 'midnight', label: 'Midnight' },
  { id: 'aurora', label: 'Aurora' },
  { id: 'violet', label: 'Violet' },
  { id: 'sakura', label: 'Sakura' },
  { id: 'emerald', label: 'Emerald' },
  { id: 'ocean', label: 'Ocean' },
  { id: 'amber', label: 'Amber' },
  { id: 'sunset', label: 'Sunset' },
  { id: 'crimson', label: 'Crimson' },
  { id: 'ice', label: 'Ice' },
  { id: 'lime', label: 'Lime' },
  { id: 'monochrome', label: 'Mono' }
]

export const HOME_LAYOUT_OPTIONS: { id: HomeLayoutId; label: string }[] = [
  { id: 'orbit', label: 'ORBIT' },
  { id: 'float', label: 'FLOAT' }
]

export const LANGUAGE_OPTIONS: { id: Language; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'de', label: 'Deutsch' }
]

function applyDomAttributes(
  theme: ThemeId,
  density: UiDensity,
  homeLayout: HomeLayoutId
): void {
  document.documentElement.setAttribute('data-theme', theme)
  document.documentElement.setAttribute('data-density', density)
  document.documentElement.setAttribute('data-home-layout', homeLayout)
}

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  theme: 'midnight',
  homeLayout: 'orbit',
  uiDensity: 'standard',
  language: 'en',
  audioPreset: 'orbit',
  showStoreTab: true,
  showHomeBanners: true,
  showAchievements: true,
  closeLaunchersAfterGame: false,
  hydrated: false,

  hydrate: async () => {
    const settings = await window.api.settings.get()
    const homeLayout = settings.homeLayout ?? 'orbit'
    applyDomAttributes(settings.theme, settings.uiDensity, homeLayout)
    setUiAudioPreset(settings.audioPreset)
    set({
      theme: settings.theme,
      homeLayout,
      uiDensity: settings.uiDensity,
      language: settings.language,
      audioPreset: settings.audioPreset,
      showStoreTab: settings.showStoreTab,
      showHomeBanners: homeLayout === 'float' ? false : settings.showHomeBanners,
      showAchievements: settings.showAchievements,
      closeLaunchersAfterGame: settings.closeLaunchersAfterGame ?? false,
      hydrated: true
    })
  },

  setTheme: async (theme) => {
    applyDomAttributes(theme, get().uiDensity, get().homeLayout)
    set({ theme })
    await window.api.settings.set({ theme })
  },

  setHomeLayout: async (homeLayout) => {
    const showHomeBanners = homeLayout === 'orbit'
    applyDomAttributes(get().theme, get().uiDensity, homeLayout)
    set({ homeLayout, showHomeBanners })
    await window.api.settings.set({ homeLayout, showHomeBanners })
  },

  setDensity: async (uiDensity) => {
    applyDomAttributes(get().theme, uiDensity, get().homeLayout)
    set({ uiDensity })
    await window.api.settings.set({ uiDensity })
  },

  setLanguage: async (language) => {
    set({ language })
    await window.api.settings.set({ language })
  },

  setAudioPreset: async (audioPreset) => {
    setUiAudioPreset(audioPreset, true)
    set({ audioPreset })
    await window.api.settings.set({ audioPreset })
  },

  setShowStoreTab: async (showStoreTab) => {
    set({ showStoreTab })
    await window.api.settings.set({ showStoreTab })
  },

  setShowHomeBanners: async (showHomeBanners) => {
    if (get().homeLayout === 'float') return
    set({ showHomeBanners })
    await window.api.settings.set({ showHomeBanners })
  },

  setShowAchievements: async (showAchievements) => {
    set({ showAchievements })
    await window.api.settings.set({ showAchievements })
  },

  setCloseLaunchersAfterGame: async (closeLaunchersAfterGame) => {
    set({ closeLaunchersAfterGame })
    await window.api.settings.set({ closeLaunchersAfterGame })
  }
}))
