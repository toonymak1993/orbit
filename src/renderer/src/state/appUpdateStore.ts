import { create } from 'zustand'
import type { AppUpdateSnapshot } from '@shared/ipc'
import { notify } from './notificationStore'

const initialSnapshot: AppUpdateSnapshot = {
  stage: 'unsupported',
  installMode: 'development',
  currentVersion: '—',
  channel: 'stable',
  automaticChecksEnabled: false,
  autoDownloadEnabled: false,
  checkIntervalHours: 24,
  verification: 'pending',
  canInstall: false,
  installScheduled: false
}

interface AppUpdateState {
  snapshot: AppUpdateSnapshot
  bannerVisible: boolean
  init: () => Promise<void>
  check: () => Promise<void>
  download: () => Promise<void>
  install: () => Promise<void>
  defer: () => Promise<void>
  showBanner: () => void
  hideBanner: () => void
}

let listening = false
let initialized = false
let previousSnapshot = initialSnapshot
let dismissedVersion: string | undefined

function announce(next: AppUpdateSnapshot): void {
  if (next.installedVersion && next.installedVersion !== previousSnapshot.installedVersion) {
    notify({
      tone: 'success',
      titleKey: 'appUpdate.notification.installedTitle',
      messageKey: 'appUpdate.notification.installedBody',
      vars: { version: next.installedVersion },
      durationMs: 7_000,
      force: true,
      replace: true
    })
  } else if (next.stage === 'available' && previousSnapshot.stage !== 'available') {
    notify({
      titleKey: 'appUpdate.notification.foundTitle',
      messageKey: next.autoDownloadEnabled
        ? 'appUpdate.notification.preparingBody'
        : 'appUpdate.notification.foundBody',
      vars: { version: next.targetVersion ?? '' },
      durationMs: 5_200,
      replace: true
    })
  } else if (
    next.stage === 'downloading' &&
    previousSnapshot.stage !== 'available' &&
    previousSnapshot.stage !== 'downloading'
  ) {
    notify({
      titleKey: 'appUpdate.notification.preparingTitle',
      messageKey: 'appUpdate.notification.preparingBody',
      vars: { version: next.targetVersion ?? '' },
      durationMs: 5_200,
      replace: true
    })
  } else if (next.stage === 'ready' && previousSnapshot.stage !== 'ready') {
    notify({
      tone: 'success',
      titleKey: 'appUpdate.notification.readyTitle',
      messageKey: 'appUpdate.notification.readyBody',
      vars: { version: next.targetVersion ?? '' },
      durationMs: 8_000,
      force: true,
      replace: true
    })
  } else if (next.stage === 'error' && previousSnapshot.error !== next.error) {
    notify({
      tone: 'error',
      titleKey: 'appUpdate.notification.failedTitle',
      messageKey: 'appUpdate.notification.failedBody',
      durationMs: 7_000,
      force: true,
      replace: true
    })
  }
  previousSnapshot = next
}

export const useAppUpdateStore = create<AppUpdateState>((set, get) => {
  const applySnapshot = (snapshot: AppUpdateSnapshot): void => {
    announce(snapshot)
    set((state) => ({
      snapshot,
      bannerVisible:
        snapshot.stage === 'ready' &&
        (snapshot.installScheduled || dismissedVersion !== snapshot.targetVersion)
          ? true
          : snapshot.stage === 'installing'
            ? true
            : state.bannerVisible && snapshot.stage === 'ready'
    }))
  }

  return {
    snapshot: initialSnapshot,
    bannerVisible: false,
    init: async () => {
      if (!listening) {
        listening = true
        window.api.app.updates.onStatus(applySnapshot)
      }
      if (initialized) return
      initialized = true
      try {
        applySnapshot(await window.api.app.updates.get())
      } catch {
        initialized = false
      }
    },
    check: async () => {
      applySnapshot(await window.api.app.updates.check())
    },
    download: async () => {
      applySnapshot(await window.api.app.updates.download())
    },
    install: async () => {
      applySnapshot(await window.api.app.updates.install())
    },
    defer: async () => {
      dismissedVersion = get().snapshot.targetVersion
      applySnapshot(await window.api.app.updates.defer())
      set({ bannerVisible: false })
    },
    showBanner: () => {
      dismissedVersion = undefined
      set({ bannerVisible: true })
    },
    hideBanner: () => {
      dismissedVersion = get().snapshot.targetVersion
      set({ bannerVisible: false })
    }
  }
})
