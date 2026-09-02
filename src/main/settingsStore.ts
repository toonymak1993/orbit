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
  excludedGameIds: [],
  backdropIntensity: 'balanced',
  homeBackdropMode: 'focus',
  homeBackdropMotion: 'drift',
  homeCardBubbleEffect: true,
  startupAnimationMode: 'orbit',
  dockTheme: 'standard',
  dockSize: 'standard',
  dockMotion: 'standard',
  uiDensity: 'standard',
  language: 'en',
  audioPreset: 'orbit',
  hasCompletedOnboarding: false,
  storeRegion: 'eu',
  showStoreTab: true,
  showFriendsHub: true,
  showHomeBanners: true,
  showAchievements: true,
  closeLaunchersAfterGame: false,
  notificationsEnabled: true,
  notificationPosition: 'top-right',
  notificationMotion: 'slide',
  appUpdateAutoDownload: true,
  retroRomDirectories: [],
  retroSystemEmulators: {},
  playstationRemotePlayPreference: 'auto',
  hardwareControlEnabled: false,
  hardwareControlButton: 'menu',
  hardwareControlHoldSeconds: 2
}

export const settingsStore = new Store<OrbitSettings>({
  name: 'orbit-settings',
  defaults,
  watch: true
})

const LEGACY_RETRO_ACHIEVEMENTS_API_KEY = 'retroAchievementsWebApiKey'
const LEGACY_STEAM_GRID_DB_TOKEN = 'steamGridDbApiKey'
const LEGACY_STEAM_WEB_API_KEY = 'steamWebApiKey'
const legacySettingsStore = settingsStore as unknown as Store<Record<string, unknown>>

/**
 * Renderer-facing settings must never inherit credentials left by an older
 * ORBIT build. The vault migrates this legacy value once OS encryption is
 * available; until then it remains main-process-only.
 */
export function publicSettingsSnapshot(): OrbitSettings {
  const snapshot = { ...legacySettingsStore.store }
  delete snapshot[LEGACY_RETRO_ACHIEVEMENTS_API_KEY]
  delete snapshot[LEGACY_STEAM_GRID_DB_TOKEN]
  delete snapshot[LEGACY_STEAM_WEB_API_KEY]
  return snapshot as unknown as OrbitSettings
}

export function readLegacyRetroAchievementsApiKey(): unknown {
  return legacySettingsStore.get(LEGACY_RETRO_ACHIEVEMENTS_API_KEY)
}

export function clearLegacyRetroAchievementsApiKey(): void {
  legacySettingsStore.delete(LEGACY_RETRO_ACHIEVEMENTS_API_KEY)
}

export function readLegacySteamGridDbToken(): unknown {
  return legacySettingsStore.get(LEGACY_STEAM_GRID_DB_TOKEN)
}

export function clearLegacySteamGridDbToken(): void {
  legacySettingsStore.delete(LEGACY_STEAM_GRID_DB_TOKEN)
}

export function readLegacySteamWebApiKey(): unknown {
  return legacySettingsStore.get(LEGACY_STEAM_WEB_API_KEY)
}

export function clearLegacySteamWebApiKey(): void {
  legacySettingsStore.delete(LEGACY_STEAM_WEB_API_KEY)
}
