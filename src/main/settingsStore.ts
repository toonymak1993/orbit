import Store from 'electron-store'
import type { OrbitSettings } from '@shared/ipc'

const defaults: OrbitSettings = {
  theme: 'midnight',
  profileAvatar: 'orbit',
  homeLayout: 'orbit',
  gameCardSize: 'standard',
  libraryGridColumns: 6,
  favoriteGameIds: [],
  customLibraries: [],
  backdropIntensity: 'balanced',
  homeCardBubbleEffect: true,
  uiDensity: 'standard',
  language: 'en',
  audioPreset: 'orbit',
  hasCompletedOnboarding: false,
  storeRegion: 'eu',
  showStoreTab: true,
  showHomeBanners: true,
  showAchievements: true,
  closeLaunchersAfterGame: false,
  notificationsEnabled: true,
  notificationPosition: 'top-right',
  notificationMotion: 'slide',
  appUpdateAutoDownload: true,
  hardwareControlEnabled: false,
  hardwareControlButton: 'menu',
  hardwareControlHoldSeconds: 2
}

export const settingsStore = new Store<OrbitSettings>({
  name: 'orbit-settings',
  defaults,
  watch: true
})
