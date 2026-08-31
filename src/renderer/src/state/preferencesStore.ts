import { create } from 'zustand'
import {
  LIBRARY_GRID_COLUMN_OPTIONS,
  type AudioPreset,
  type BackdropIntensity,
  type DockMotion,
  type DockSize,
  type DockThemeId,
  type GameCardSize,
  type HomeLayoutId,
  type HardwareControlButton,
  type HardwareControlHoldSeconds,
  type LibraryGridColumns,
  type NotificationMotion,
  type NotificationPosition,
  type ProfileAvatarId,
  type StartupAnimationMode,
  type ThemeId,
  type UiDensity,
  type Language
} from '@shared/ipc'
import { setUiAudioPreset } from '@renderer/lib/uiAudio'
import {
  cacheStartupAnimationMode,
  cacheStartupVideoUrl,
  hasCustomStartupVideoFailed,
  readCachedStartupAnimationMode
} from '@renderer/lib/startupAnimationPreference'

interface PreferencesState {
  theme: ThemeId
  profileAvatar: ProfileAvatarId
  customAvatarUrl?: string
  homeLayout: HomeLayoutId
  gameCardSize: GameCardSize
  libraryGridColumns: LibraryGridColumns
  backdropIntensity: BackdropIntensity
  homeCardBubbleEffect: boolean
  startupAnimationMode: StartupAnimationMode
  customStartupVideoUrl?: string
  dockTheme: DockThemeId
  dockSize: DockSize
  dockMotion: DockMotion
  uiDensity: UiDensity
  language: Language
  audioPreset: AudioPreset
  showStoreTab: boolean
  showFriendsHub: boolean
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
  setProfileAvatar: (profileAvatar: ProfileAvatarId) => Promise<void>
  selectCustomAvatar: () => Promise<boolean>
  setHomeLayout: (homeLayout: HomeLayoutId) => Promise<void>
  setGameCardSize: (gameCardSize: GameCardSize) => Promise<void>
  setLibraryGridColumns: (libraryGridColumns: LibraryGridColumns) => Promise<void>
  setBackdropIntensity: (backdropIntensity: BackdropIntensity) => Promise<void>
  setHomeCardBubbleEffect: (enabled: boolean) => Promise<void>
  setStartupAnimationMode: (mode: StartupAnimationMode) => Promise<boolean>
  selectCustomStartupVideo: () => Promise<boolean>
  setDockTheme: (dockTheme: DockThemeId) => Promise<void>
  setDockSize: (dockSize: DockSize) => Promise<void>
  setDockMotion: (dockMotion: DockMotion) => Promise<void>
  setDensity: (density: UiDensity) => Promise<void>
  setLanguage: (language: Language) => Promise<void>
  setAudioPreset: (audioPreset: AudioPreset) => Promise<void>
  setShowStoreTab: (visible: boolean) => Promise<void>
  setShowFriendsHub: (visible: boolean) => Promise<void>
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
  { id: 'coresense', label: 'CoreSense' },
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
  { id: 'float', label: 'FLOAT' },
  { id: 'coresense', label: 'CoreSense' },
  { id: 'xmode', label: 'XMODE' }
]

export const GAME_CARD_SIZE_OPTIONS: GameCardSize[] = ['compact', 'standard', 'large']
export { LIBRARY_GRID_COLUMN_OPTIONS }

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

function applyHomeCardBubbleEffect(enabled: boolean): void {
  document.documentElement.setAttribute('data-home-card-bubbles', enabled ? 'on' : 'off')
}

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  theme: 'midnight',
  profileAvatar: 'orbit',
  customAvatarUrl: undefined,
  homeLayout: 'orbit',
  gameCardSize: 'standard',
  libraryGridColumns: 6,
  backdropIntensity: 'balanced',
  homeCardBubbleEffect: true,
  startupAnimationMode: readCachedStartupAnimationMode(),
  customStartupVideoUrl: undefined,
  dockTheme: 'standard',
  dockSize: 'standard',
  dockMotion: 'standard',
  uiDensity: 'standard',
  language: 'en',
  audioPreset: 'orbit',
  showStoreTab: true,
  showFriendsHub: true,
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
    const [settings, customAvatarUrl, customStartupVideoUrl] = await Promise.all([
      window.api.settings.get(),
      window.api.profileAvatar.getCustom(),
      window.api.startupVideo.get()
    ])
    const homeLayout = settings.homeLayout ?? 'orbit'
    const gameCardSize = settings.gameCardSize ?? 'standard'
    const libraryGridColumns = LIBRARY_GRID_COLUMN_OPTIONS.includes(settings.libraryGridColumns)
      ? settings.libraryGridColumns
      : 6
    const backdropIntensity = settings.backdropIntensity ?? 'balanced'
    const homeCardBubbleEffect = settings.homeCardBubbleEffect ?? true
    const requestedStartupAnimationMode = settings.startupAnimationMode ?? 'orbit'
    const startupAnimationMode =
      requestedStartupAnimationMode === 'custom' &&
      (!customStartupVideoUrl || hasCustomStartupVideoFailed())
        ? 'orbit'
        : requestedStartupAnimationMode
    cacheStartupAnimationMode(startupAnimationMode)
    cacheStartupVideoUrl(customStartupVideoUrl ?? undefined)
    if (startupAnimationMode !== requestedStartupAnimationMode) {
      void window.api.settings.set({ startupAnimationMode })
    }
    document.documentElement.lang = settings.language
    applyDomAttributes(
      settings.theme,
      settings.uiDensity,
      homeLayout,
      gameCardSize,
      backdropIntensity
    )
    applyHomeCardBubbleEffect(homeCardBubbleEffect)
    setUiAudioPreset(settings.audioPreset)
    set({
      theme: settings.theme,
      profileAvatar:
        settings.profileAvatar === 'custom' && !customAvatarUrl
          ? 'orbit'
          : (settings.profileAvatar ?? 'orbit'),
      customAvatarUrl: customAvatarUrl ?? undefined,
      homeLayout,
      gameCardSize,
      libraryGridColumns,
      backdropIntensity,
      homeCardBubbleEffect,
      startupAnimationMode,
      customStartupVideoUrl: customStartupVideoUrl ?? undefined,
      dockTheme: settings.dockTheme ?? 'standard',
      dockSize: settings.dockSize ?? 'standard',
      dockMotion: settings.dockMotion ?? 'standard',
      uiDensity: settings.uiDensity,
      language: settings.language,
      audioPreset: settings.audioPreset,
      showStoreTab: settings.showStoreTab,
      showFriendsHub: settings.showFriendsHub ?? true,
      showHomeBanners: homeLayout === 'orbit' ? settings.showHomeBanners : false,
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

  setProfileAvatar: async (profileAvatar) => {
    if (profileAvatar === 'custom' && !get().customAvatarUrl) return
    set({ profileAvatar })
    await window.api.settings.set({ profileAvatar })
  },

  selectCustomAvatar: async () => {
    const customAvatarUrl = await window.api.profileAvatar.selectCustom()
    if (!customAvatarUrl) return false
    set({ customAvatarUrl, profileAvatar: 'custom' })
    await window.api.settings.set({ profileAvatar: 'custom' })
    return true
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

  setLibraryGridColumns: async (libraryGridColumns) => {
    set({ libraryGridColumns })
    await window.api.settings.set({ libraryGridColumns })
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

  setHomeCardBubbleEffect: async (homeCardBubbleEffect) => {
    applyHomeCardBubbleEffect(homeCardBubbleEffect)
    set({ homeCardBubbleEffect })
    await window.api.settings.set({ homeCardBubbleEffect })
  },

  setStartupAnimationMode: async (startupAnimationMode) => {
    if (startupAnimationMode === 'custom' && !get().customStartupVideoUrl) {
      return get().selectCustomStartupVideo()
    }
    cacheStartupAnimationMode(startupAnimationMode)
    set({ startupAnimationMode })
    await window.api.settings.set({ startupAnimationMode })
    return true
  },

  selectCustomStartupVideo: async () => {
    const customStartupVideoUrl = await window.api.startupVideo.select()
    if (!customStartupVideoUrl) return false
    cacheStartupVideoUrl(customStartupVideoUrl)
    cacheStartupAnimationMode('custom')
    set({ customStartupVideoUrl, startupAnimationMode: 'custom' })
    await window.api.settings.set({ startupAnimationMode: 'custom' })
    return true
  },

  setDockTheme: async (dockTheme) => {
    set({ dockTheme })
    await window.api.settings.set({ dockTheme })
  },

  setDockSize: async (dockSize) => {
    set({ dockSize })
    await window.api.settings.set({ dockSize })
  },

  setDockMotion: async (dockMotion) => {
    set({ dockMotion })
    await window.api.settings.set({ dockMotion })
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

  setShowFriendsHub: async (showFriendsHub) => {
    set({ showFriendsHub })
    await window.api.settings.set({ showFriendsHub })
  },

  setShowHomeBanners: async (showHomeBanners) => {
    if (get().homeLayout !== 'orbit') return
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
