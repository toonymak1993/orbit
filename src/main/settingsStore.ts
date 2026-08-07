import Store from 'electron-store'
import type { OrbitSettings } from '@shared/ipc'

const defaults: OrbitSettings = {
  theme: 'midnight',
  homeLayout: 'orbit',
  uiDensity: 'standard',
  language: 'en',
  audioPreset: 'orbit',
  hasCompletedOnboarding: false,
  storeRegion: 'eu',
  showStoreTab: true,
  showHomeBanners: true,
  showAchievements: true,
  closeLaunchersAfterGame: false
}

export const settingsStore = new Store<OrbitSettings>({
  name: 'orbit-settings',
  defaults
})
