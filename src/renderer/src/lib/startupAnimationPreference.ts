import {
  CUSTOM_STARTUP_VIDEO_URL,
  STARTUP_ANIMATION_MODES,
  type StartupAnimationMode
} from '@shared/ipc'

const MODE_STORAGE_KEY = 'orbit:startup-animation-mode'
const VIDEO_URL_STORAGE_KEY = 'orbit:startup-video-url'
let customVideoFailedForSession = false

export function readCachedStartupAnimationMode(): StartupAnimationMode {
  try {
    const value = window.localStorage.getItem(MODE_STORAGE_KEY)
    return STARTUP_ANIMATION_MODES.includes(value as StartupAnimationMode)
      ? (value as StartupAnimationMode)
      : 'orbit'
  } catch {
    return 'orbit'
  }
}

export function cacheStartupAnimationMode(mode: StartupAnimationMode): void {
  try {
    window.localStorage.setItem(MODE_STORAGE_KEY, mode)
  } catch {
    // Settings still persist in the main process; this cache only removes startup flicker.
  }
}

export function readCachedStartupVideoUrl(): string {
  try {
    const value = window.localStorage.getItem(VIDEO_URL_STORAGE_KEY)
    return value?.startsWith(`${CUSTOM_STARTUP_VIDEO_URL}?version=`)
      ? value
      : CUSTOM_STARTUP_VIDEO_URL
  } catch {
    return CUSTOM_STARTUP_VIDEO_URL
  }
}

export function cacheStartupVideoUrl(url?: string): void {
  try {
    if (url?.startsWith(CUSTOM_STARTUP_VIDEO_URL)) {
      window.localStorage.setItem(VIDEO_URL_STORAGE_KEY, url)
    } else {
      window.localStorage.removeItem(VIDEO_URL_STORAGE_KEY)
    }
  } catch {
    // The fixed protocol URL remains a safe fallback when localStorage is unavailable.
  }
}

export function markCustomStartupVideoFailed(): void {
  customVideoFailedForSession = true
  cacheStartupAnimationMode('orbit')
}

export function hasCustomStartupVideoFailed(): boolean {
  return customVideoFailedForSession
}
