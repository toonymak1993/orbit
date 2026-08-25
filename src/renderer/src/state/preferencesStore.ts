import { create } from 'zustand'
import type {
  AudioPreset,
  BackdropIntensity,
  GameCardSize,
  HomeLayoutId,
  HardwareControlButton,
  HardwareControlHoldSeconds,
  NotificationMotion,
  NotificationPosition,
  ThemeId,
  UiDensity,
  Language
} from '@shared/ipc'
import { setUiAudioPreset } from '@renderer/lib/uiAudio'

interface PreferencesState {
  theme: ThemeId
  homeLayout: HomeLayoutId
  gameCardSize: GameCardSize
  backdropIntensity: BackdropIntensity
  uiDensity: UiDensity
  language: Language
  audioPreset: AudioPreset
  showStoreTab: boolean
  showHomeBanners: boolean
  showAchievements: boolean
  closeLaunchersAfterGame: boolean
  notificationsEnabled: boolean
  notificationPosition: NotificationPosition
  notificationMotion: NotificationMotion
  hardwareControlEnabled: boolean
  hardwareControlButton: HardwareControlButton
  hardwareControlHoldSeconds: HardwareControlHoldSeconds
  hydrated: boolean
  hydrate: () => Promise<void>
  setTheme: (theme: ThemeId) => Promise<void>
  setHomeLayout: (homeLayout: HomeLayoutId) => Promise<void>
  setGameCardSize: (gameCardSize: GameCardSize) => Promise<void>
  setBackdropIntensity: (backdropIntensity: BackdropIntensity) => Promise<void>
  setDensity: (density: UiDensity) => Promise<void>
  setLanguage: (language: Language) => Promise<void>
  setAudioPreset: (audioPreset: AudioPreset) => Promise<void>
  setShowStoreTab: (visible: boolean) => Promise<void>
  setShowHomeBanners: (visible: boolean) => Promise<void>
  setShowAchievements: (visible: boolean) => Promise<void>
  setCloseLaunchersAfterGame: (enabled: boolean) => Promise<void>
  setNotificationsEnabled: (enabled: boolean) => Promise<void>
  setNotificationPosition: (position: NotificationPosition) => Promise<void>
  setNotificationMotion: (motion: NotificationMotion) => Promise<void>
  setHardwareControlEnabled: (enabled: boolean) => Promise<void>
  setHardwareControlButton: (button: HardwareControlButton) => Promise<void>
  setHardwareControlHoldSeconds: (seconds: HardwareControlHoldSeconds) => Promise<void>
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

export const GAME_CARD_SIZE_OPTIONS: GameCardSize[] = ['compact', 'standard', 'large']

export const BACKDROP_INTENSITY_OPTIONS: BackdropIntensity[] = [
  'subtle',
  'balanced',
  'vivid'
]

export const LANGUAGE_OPTIONS: { id: Language; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'de', label: 'Deutsch' }
]

function applyDomAttributes(
  theme: ThemeId,
  density: UiDensity,
  homeLayout: HomeLayoutId,
  gameCardSize: GameCardSize,
  backdropIntensity: BackdropIntensity
): void {
  document.documentElement.setAttribute('data-theme', theme)
  document.documentElement.setAttribute('data-density', density)
  document.documentElement.setAttribute('data-home-layout', homeLayout)
  document.documentElement.setAttribute('data-card-size', gameCardSize)
  document.documentElement.setAttribute('data-backdrop-intensity', backdropIntensity)
}

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  theme: 'midnight',
  homeLayout: 'orbit',
  gameCardSize: 'standard',
  backdropIntensity: 'balanced',
  uiDensity: 'standard',
  language: 'en',
  audioPreset: 'orbit',
  showStoreTab: true,
  showHomeBanners: true,
  showAchievements: true,
  closeLaunchersAfterGame: false,
  notificationsEnabled: true,
  notificationPosition: 'top-right',
  notificationMotion: 'slide',
  hardwareControlEnabled: false,
  hardwareControlButton: 'menu',
  hardwareControlHoldSeconds: 2,
  hydrated: false,

  hydrate: async () => {
    const settings = await window.api.settings.get()
    const homeLayout = settings.homeLayout ?? 'orbit'
    const gameCardSize = settings.gameCardSize ?? 'standard'
    const backdropIntensity = settings.backdropIntensity ?? 'balanced'
    document.documentElement.lang = settings.language
    applyDomAttributes(
      settings.theme,
      settings.uiDensity,
      homeLayout,
      gameCardSize,
      backdropIntensity
    )
    setUiAudioPreset(settings.audioPreset)
    set({
      theme: settings.theme,
      homeLayout,
      gameCardSize,
      backdropIntensity,
      uiDensity: settings.uiDensity,
      language: settings.language,
      audioPreset: settings.audioPreset,
      showStoreTab: settings.showStoreTab,
      showHomeBanners: homeLayout === 'float' ? false : settings.showHomeBanners,
      showAchievements: settings.showAchievements,
      closeLaunchersAfterGame: settings.closeLaunchersAfterGame ?? false,
      notificationsEnabled: settings.notificationsEnabled ?? true,
      notificationPosition: settings.notificationPosition ?? 'top-right',
      notificationMotion: settings.notificationMotion ?? 'slide',
      hardwareControlEnabled: settings.hardwareControlEnabled ?? false,
      hardwareControlButton: settings.hardwareControlButton ?? 'menu',
      hardwareControlHoldSeconds: settings.hardwareControlHoldSeconds ?? 2,
      hydrated: true
    })
  },

  setTheme: async (theme) => {
    applyDomAttributes(
      theme,
      get().uiDensity,
      get().homeLayout,
      get().gameCardSize,
      get().backdropIntensity
    )
    set({ theme })
    await window.api.settings.set({ theme })
  },

  setHomeLayout: async (homeLayout) => {
    const showHomeBanners = homeLayout === 'orbit'
    applyDomAttributes(
      get().theme,
      get().uiDensity,
      homeLayout,
      get().gameCardSize,
      get().backdropIntensity
    )
    set({ homeLayout, showHomeBanners })
    await window.api.settings.set({ homeLayout, showHomeBanners })
  },

  setGameCardSize: async (gameCardSize) => {
    applyDomAttributes(
      get().theme,
      get().uiDensity,
      get().homeLayout,
      gameCardSize,
      get().backdropIntensity
    )
    set({ gameCardSize })
    await window.api.settings.set({ gameCardSize })
  },

  setBackdropIntensity: async (backdropIntensity) => {
    applyDomAttributes(
      get().theme,
      get().uiDensity,
      get().homeLayout,
      get().gameCardSize,
      backdropIntensity
    )
    set({ backdropIntensity })
    await window.api.settings.set({ backdropIntensity })
  },

  setDensity: async (uiDensity) => {
    applyDomAttributes(
      get().theme,
      uiDensity,
      get().homeLayout,
      get().gameCardSize,
      get().backdropIntensity
    )
    set({ uiDensity })
    await window.api.settings.set({ uiDensity })
  },

  setLanguage: async (language) => {
    document.documentElement.lang = language
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
  },

  setNotificationsEnabled: async (notificationsEnabled) => {
    set({ notificationsEnabled })
    await window.api.settings.set({ notificationsEnabled })
  },

  setNotificationPosition: async (notificationPosition) => {
    set({ notificationPosition })
    await window.api.settings.set({ notificationPosition })
  },

  setNotificationMotion: async (notificationMotion) => {
    set({ notificationMotion })
    await window.api.settings.set({ notificationMotion })
  },

  setHardwareControlEnabled: async (hardwareControlEnabled) => {
    set({ hardwareControlEnabled })
    await window.api.settings.set({ hardwareControlEnabled })
  },

  setHardwareControlButton: async (hardwareControlButton) => {
    set({ hardwareControlButton })
    await window.api.settings.set({ hardwareControlButton })
  },

  setHardwareControlHoldSeconds: async (hardwareControlHoldSeconds) => {
    set({ hardwareControlHoldSeconds })
    await window.api.settings.set({ hardwareControlHoldSeconds })
  }
}))
