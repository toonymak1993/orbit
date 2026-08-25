import { app, ipcMain, shell, type BrowserWindow } from 'electron'
import { spawn } from 'node:child_process'
import {
  HARDWARE_CONTROL_BUTTONS,
  HARDWARE_CONTROL_HOLD_SECONDS,
  IPC,
  NOTIFICATION_MOTIONS,
  NOTIFICATION_POSITIONS,
  type AppControlAction,
  type CustomGameCommitInput,
  type CustomGameImportSource,
  type CustomGameSaveSource,
  type EpicLoginStatus,
  type ImageOrientation,
  type ImageUpdate,
  type LibraryGame,
  type OrbitBackgroundServiceAction,
  type OrbitSettings,
  type ResolvedImage,
  type StoreRegionId,
  type SteamLoginStatus,
  type SystemPowerAction
} from '@shared/ipc'
import { settingsStore } from './settingsStore'
import { steamAuthManager } from './steam/steamAuth'
import { epicAuthManager } from './epic/epicAuth'
import { libraryService } from './library/libraryService'
import { GameSessionManager } from './gameSessionManager'
import { launchGame } from './gameLauncher'
import { artworkService, resolveImage } from './imageCache'
import { t } from './i18n'
import { syncCoordinator } from './sync/syncCoordinator'
import { storeService } from './store/storeService'
import { getDisplayVersion } from './releaseManifest'
import { OrbitBackgroundServiceManager } from './orbitBackgroundServiceManager'
import { customArtworkService } from './customArtwork'
import { artworkPickerService } from './artworkPickerService'

const SYSTEM_POWER_ACTIONS: readonly SystemPowerAction[] = ['sleep', 'restart', 'shutdown']
const APP_CONTROL_ACTIONS: readonly AppControlAction[] = ['relaunch', 'quit']
const BACKGROUND_SERVICE_ACTIONS: readonly OrbitBackgroundServiceAction[] = [
  'install',
  'repair',
  'restart',
  'remove'
]
const CUSTOM_GAME_IMPORT_SOURCES: readonly CustomGameImportSource[] = ['executable', 'folder']
const CUSTOM_GAME_SAVE_SOURCES: readonly CustomGameSaveSource[] = ['file', 'folder']
const IMAGE_ORIENTATIONS: readonly ImageOrientation[] = ['vertical', 'horizontal', 'icon']

function validatedShortString(value: unknown, label: string, maxLength = 512): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error(`Invalid ${label}`)
  }
  return value.trim()
}

function validateCustomGameCommit(value: unknown): CustomGameCommitInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid custom game payload')
  }
  const input = value as Record<string, unknown>
  return {
    draftId: validatedShortString(input.draftId, 'custom game draft', 80),
    name: validatedShortString(input.name, 'custom game name', 120)
  }
}

function validateSettingsPartial(value: unknown): asserts value is Partial<OrbitSettings> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid settings payload')
  }
  const partial = value as Record<string, unknown>
  if ('notificationsEnabled' in partial && typeof partial.notificationsEnabled !== 'boolean') {
    throw new Error('Invalid notification state')
  }
  if (
    'notificationPosition' in partial &&
    !NOTIFICATION_POSITIONS.includes(
      partial.notificationPosition as (typeof NOTIFICATION_POSITIONS)[number]
    )
  ) {
    throw new Error('Invalid notification position')
  }
  if (
    'notificationMotion' in partial &&
    !NOTIFICATION_MOTIONS.includes(
      partial.notificationMotion as (typeof NOTIFICATION_MOTIONS)[number]
    )
  ) {
    throw new Error('Invalid notification motion')
  }
  if (
    'hardwareControlEnabled' in partial &&
    typeof partial.hardwareControlEnabled !== 'boolean'
  ) {
    throw new Error('Invalid hardware control state')
  }
  if (
    'hardwareControlButton' in partial &&
    !HARDWARE_CONTROL_BUTTONS.includes(
      partial.hardwareControlButton as (typeof HARDWARE_CONTROL_BUTTONS)[number]
    )
  ) {
    throw new Error('Invalid hardware control button')
  }
  if (
    'hardwareControlHoldSeconds' in partial &&
    !HARDWARE_CONTROL_HOLD_SECONDS.includes(
      partial.hardwareControlHoldSeconds as (typeof HARDWARE_CONTROL_HOLD_SECONDS)[number]
    )
  ) {
    throw new Error('Invalid hardware control hold time')
  }
}

function validatedImageOrientation(value: unknown): ImageOrientation {
  if (!IMAGE_ORIENTATIONS.includes(value as ImageOrientation)) {
    throw new Error('Invalid image orientation')
  }
  return value as ImageOrientation
}

function findArtworkGame(gameId: string): LibraryGame | null {
  const game = libraryService.getGame(gameId)
  if (game) return game

  const storeSnapshot = storeService.getSnapshot()
  const product = storeSnapshot.products.find((item) => item.id === gameId)
  const release = storeSnapshot.monthlyReleases.find((item) => item.id === gameId)
  if (!product && !release) return null
  const provider =
    product?.canonicalSource === 'epic' ||
    product?.canonicalSource === 'gog' ||
    product?.canonicalSource === 'xbox'
      ? product.canonicalSource
      : (product?.steamAppId ?? release?.steamAppId)
        ? 'steam'
        : 'local'
  return {
    id: product?.id ?? release!.id,
    provider,
    providerGameId:
      product?.sourceProductId ?? release?.sourceProductId ?? String(product?.id ?? release!.id),
    appId: product?.steamAppId ?? release?.steamAppId,
    name: product?.name ?? release!.name,
    metadata: {
      backgroundUrl: product?.heroUrl ?? release?.heroUrl,
      storeHeaderUrl: product?.headerUrl ?? release?.capsuleUrl,
      artwork: {
        vertical: [product?.portraitUrl].filter((url): url is string => Boolean(url)),
        horizontal: [
          product?.heroUrl,
          product?.headerUrl,
          release?.heroUrl,
          release?.capsuleUrl
        ].filter((url): url is string => Boolean(url)),
        icon: []
      }
    },
    metadataRevision: 1,
    metadataSource: release ? 'orbit-release-calendar' : 'orbit-store',
    installed: false,
    addedAt: product?.updatedAt ?? release!.releaseDate,
    updatedAt: product?.updatedAt ?? release!.releaseDate
  }
}

function runSystemPowerAction(action: SystemPowerAction): Promise<void> {
  if (process.platform !== 'win32') {
    throw new Error('System power controls are currently available on Windows only')
  }

  const command = action === 'sleep' ? 'powershell.exe' : 'shutdown.exe'
  const args =
    action === 'sleep'
      ? [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState([System.Windows.Forms.PowerState]::Suspend, $false, $false)'
        ]
      : action === 'restart'
        ? ['/r', '/t', '0']
        : ['/s', '/t', '0']

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  const gameSessionManager = new GameSessionManager(mainWindow, (game) =>
    libraryService.backupCustomGame(game.id)
  )
  const backgroundServiceManager = new OrbitBackgroundServiceManager(
    mainWindow,
    () => settingsStore.store.hardwareControlEnabled
  )
  backgroundServiceManager.start()
  const disposeBackgroundService = (): void => backgroundServiceManager.dispose()
  app.once('before-quit', disposeBackgroundService)
  mainWindow.once('closed', disposeBackgroundService)
  libraryService.on('updated', (snapshot) => {
    mainWindow.webContents.send(IPC.libraryUpdated, snapshot)
  })
  artworkService.on('updated', (update) => {
    const customArtwork =
      update.orientation === 'vertical' ? customArtworkService.resolve(update.gameId) : null
    mainWindow.webContents.send(IPC.imageUpdated, {
      ...update,
      image: customArtwork ?? update.image
    })
  })
  syncCoordinator.on('updated', (status) => {
    mainWindow.webContents.send(IPC.syncUpdated, status)
  })
  storeService.on('updated', (snapshot) => {
    mainWindow.webContents.send(IPC.storeUpdated, snapshot)
  })
  gameSessionManager.on('updated', (status) => {
    mainWindow.webContents.send(IPC.gameLaunchStatus, status)
  })

  ipcMain.handle(IPC.settingsGet, (): OrbitSettings => settingsStore.store)

  ipcMain.handle(IPC.settingsSet, (_e, partial: unknown) => {
    validateSettingsPartial(partial)
    const next = { ...settingsStore.store, ...partial }
    settingsStore.set(next)
    if (
      'hardwareControlEnabled' in partial ||
      'hardwareControlButton' in partial ||
      'hardwareControlHoldSeconds' in partial
    ) {
      void backgroundServiceManager.reloadSettings()
    }
    return next
  })

  ipcMain.handle(IPC.appVersion, () => getDisplayVersion())
  ipcMain.handle(IPC.backgroundServiceGetStatus, () => backgroundServiceManager.getStatus())
  ipcMain.handle(IPC.backgroundServiceControl, (_e, action: unknown) => {
    if (!BACKGROUND_SERVICE_ACTIONS.includes(action as OrbitBackgroundServiceAction)) {
      throw new Error('Invalid background service action')
    }
    return backgroundServiceManager.control(action as OrbitBackgroundServiceAction)
  })
  ipcMain.handle(IPC.hardwareControlGetStatus, async () => {
    const status = await backgroundServiceManager.getStatus()
    return status.hardwareControl
  })
  ipcMain.handle(IPC.appControl, (_e, action: unknown) => {
    if (!APP_CONTROL_ACTIONS.includes(action as AppControlAction)) {
      throw new Error('Invalid app control action')
    }
    setTimeout(() => {
      if (action === 'relaunch') app.relaunch()
      app.quit()
    }, 60)
  })
  ipcMain.handle(IPC.systemPower, (_e, action: unknown) => {
    if (!SYSTEM_POWER_ACTIONS.includes(action as SystemPowerAction)) {
      throw new Error('Invalid system power action')
    }
    return runSystemPowerAction(action as SystemPowerAction)
  })
  ipcMain.handle(IPC.syncGet, () => syncCoordinator.getStatus())
  ipcMain.handle(IPC.storeGet, () => storeService.getSnapshot())
  ipcMain.handle(IPC.storeRefresh, () => storeService.refresh())
  ipcMain.handle(IPC.storeCompareProduct, (_e, productId: string) =>
    storeService.compareProduct(productId)
  )
  ipcMain.handle(IPC.storeSearch, (_e, query: string) => storeService.search(query))
  ipcMain.handle(IPC.storeToggleWishlist, (_e, productId: string) =>
    storeService.toggleOrbitWishlist(productId)
  )
  ipcMain.handle(IPC.storeSetPriceAlert, (_e, productId: string, targetPriceMinor: number) =>
    storeService.setPriceAlert(productId, targetPriceMinor)
  )
  ipcMain.handle(IPC.storeRemovePriceAlert, (_e, productId: string) =>
    storeService.removePriceAlert(productId)
  )
  ipcMain.handle(IPC.storeSetRegion, (_e, region: StoreRegionId) =>
    storeService.setRegion(region)
  )

  ipcMain.handle(IPC.steamGetAccount, async () => {
    const restored = await steamAuthManager.restoreSession()
    return restored
  })

  ipcMain.handle(IPC.steamLoginStart, async () => {
    const sendStatus = (status: SteamLoginStatus): void => {
      mainWindow.webContents.send(IPC.steamLoginStatus, status)
    }
    try {
      await steamAuthManager.startLogin(sendStatus, mainWindow)
    } catch (err) {
      sendStatus({
        state: 'error',
        message: err instanceof Error ? err.message : t('loginFailed')
      })
    }
  })

  ipcMain.handle(IPC.steamLoginCancel, () => {
    steamAuthManager.cancelLogin()
  })

  ipcMain.handle(IPC.steamLogout, () => {
    steamAuthManager.logout()
  })

  ipcMain.handle(IPC.epicGetAccount, async () => {
    return epicAuthManager.restoreSession()
  })

  ipcMain.handle(IPC.epicLoginStart, async () => {
    const sendStatus = (status: EpicLoginStatus): void => {
      mainWindow.webContents.send(IPC.epicLoginStatus, status)
    }
    try {
      await epicAuthManager.startLogin(sendStatus, mainWindow)
    } catch (err) {
      sendStatus({
        state: 'error',
        message: err instanceof Error ? err.message : t('epicLoginFailed')
      })
    }
  })

  ipcMain.handle(IPC.epicLoginCancel, () => {
    epicAuthManager.cancelLogin()
  })

  ipcMain.handle(IPC.epicLogout, () => {
    return epicAuthManager.logout()
  })

  ipcMain.handle(IPC.libraryGet, () => {
    const account = steamAuthManager.getAccount()
    libraryService.hydrateFromDisk(account?.steamId)
    return libraryService.getSnapshot()
  })

  ipcMain.handle(IPC.libraryStatsGet, () => libraryService.getStats())

  ipcMain.handle(IPC.libraryRefresh, async () => {
    return libraryService.refresh()
  })

  ipcMain.handle(IPC.customGameBeginImport, (_e, source: unknown) => {
    if (!CUSTOM_GAME_IMPORT_SOURCES.includes(source as CustomGameImportSource)) {
      throw new Error('Invalid custom game import source')
    }
    return libraryService.beginCustomGameImport(mainWindow, source as CustomGameImportSource)
  })

  ipcMain.handle(IPC.customGameSelectArtwork, (_e, draftId: unknown) =>
    libraryService.selectCustomGameArtwork(
      mainWindow,
      validatedShortString(draftId, 'custom game draft', 80)
    )
  )

  ipcMain.handle(IPC.customGameSelectSave, (_e, draftId: unknown, source: unknown) => {
    if (!CUSTOM_GAME_SAVE_SOURCES.includes(source as CustomGameSaveSource)) {
      throw new Error('Invalid custom game save source')
    }
    return libraryService.selectCustomGameSave(
      mainWindow,
      validatedShortString(draftId, 'custom game draft', 80),
      source as CustomGameSaveSource
    )
  })

  ipcMain.handle(IPC.customGameClearSave, (_e, draftId: unknown) =>
    libraryService.clearCustomGameSave(validatedShortString(draftId, 'custom game draft', 80))
  )

  ipcMain.handle(IPC.customGameCommit, (_e, input: unknown) =>
    libraryService.commitCustomGame(validateCustomGameCommit(input))
  )

  ipcMain.handle(IPC.customGameCancel, (_e, draftId: unknown) => {
    libraryService.cancelCustomGameImport(validatedShortString(draftId, 'custom game draft', 80))
  })

  ipcMain.handle(IPC.customGameRemove, (_e, gameId: unknown) =>
    libraryService.removeCustomGame(validatedShortString(gameId, 'custom game ID'))
  )

  ipcMain.handle(IPC.customGameBackup, (_e, gameId: unknown) =>
    libraryService.backupCustomGame(validatedShortString(gameId, 'custom game ID'))
  )

  ipcMain.handle(IPC.customGameOpenBackups, (_e, gameId: unknown) =>
    libraryService.openCustomGameBackups(validatedShortString(gameId, 'custom game ID'))
  )

  ipcMain.handle(IPC.gameLaunch, async (_e, gameId: string) => {
    const game = libraryService.getGame(gameId)
    if (!game) throw new Error('Game is not available')
    if (!game.installed) {
      await launchGame(game)
      return
    }
    await gameSessionManager.start(game)
    libraryService.markGameStarted(gameId)
  })

  ipcMain.handle(IPC.gameLaunchGet, () => gameSessionManager.getStatus())
  ipcMain.handle(IPC.gameLaunchRevealLauncher, () => gameSessionManager.revealLauncher())

  ipcMain.handle(IPC.gameCompletionTimesResolve, async (_e, gameId: string) => {
    return libraryService.resolveCompletionTimes(gameId)
  })

  ipcMain.handle(IPC.gameAchievementsResolve, async (_e, gameId: string) => {
    return libraryService.resolveAchievements(gameId)
  })

  ipcMain.handle(
    IPC.imageResolve,
    (_e, gameIdValue: unknown, orientationValue: unknown): ResolvedImage | null => {
      const gameId = validatedShortString(gameIdValue, 'image game ID')
      const orientation = validatedImageOrientation(orientationValue)
      const game = findArtworkGame(gameId)
      return game ? resolveImage(game, orientation) : null
    }
  )

  ipcMain.handle(IPC.imageSteamGridDbList, (_e, gameIdValue: unknown) => {
    const gameId = validatedShortString(gameIdValue, 'SteamGridDB artwork game ID')
    const game = libraryService.getGame(gameId)
    if (!game) throw new Error('Game is not available')
    return artworkPickerService.list(game)
  })

  ipcMain.handle(
    IPC.imageSteamGridDbApply,
    async (_e, gameIdValue: unknown, artworkIdValue: unknown): Promise<boolean> => {
      const gameId = validatedShortString(gameIdValue, 'SteamGridDB artwork game ID')
      if (
        typeof artworkIdValue !== 'number' ||
        !Number.isSafeInteger(artworkIdValue) ||
        artworkIdValue <= 0
      ) {
        throw new Error('Invalid SteamGridDB artwork ID')
      }
      const game = libraryService.getGame(gameId)
      if (!game) throw new Error('Game is not available')
      const image = await artworkPickerService.apply(game, artworkIdValue)
      mainWindow.webContents.send(IPC.imageUpdated, {
        gameId,
        orientation: 'vertical',
        image
      } satisfies ImageUpdate)
      return true
    }
  )

  ipcMain.handle(IPC.imageSelectCustom, async (_e, gameIdValue: unknown): Promise<boolean> => {
    const gameId = validatedShortString(gameIdValue, 'custom artwork game ID')
    const game = libraryService.getGame(gameId)
    if (!game) throw new Error('Game is not available')
    const image = await customArtworkService.select(mainWindow, gameId)
    if (!image) return false
    mainWindow.webContents.send(IPC.imageUpdated, {
      gameId,
      orientation: 'vertical',
      image
    } satisfies ImageUpdate)
    return true
  })

  ipcMain.handle(IPC.imageResetCustom, async (_e, gameIdValue: unknown): Promise<boolean> => {
    const gameId = validatedShortString(gameIdValue, 'custom artwork game ID')
    const game = libraryService.getGame(gameId)
    if (!game) throw new Error('Game is not available')
    const removed = await customArtworkService.reset(gameId)
    if (!removed) return false
    mainWindow.webContents.send(IPC.imageUpdated, {
      gameId,
      orientation: 'vertical',
      image: artworkService.resolve(game, 'vertical')
    } satisfies ImageUpdate)
    return true
  })

  ipcMain.handle(IPC.imageHasCustom, (_e, gameIdValue: unknown): boolean => {
    const gameId = validatedShortString(gameIdValue, 'custom artwork game ID')
    return Boolean(libraryService.getGame(gameId) && customArtworkService.has(gameId))
  })

  ipcMain.handle(
    IPC.imageReportFailure,
    async (_e, gameIdValue: unknown, orientationValue: unknown, revisionValue: unknown): Promise<void> => {
      const gameId = validatedShortString(gameIdValue, 'image game ID')
      const orientation = validatedImageOrientation(orientationValue)
      if (
        typeof revisionValue !== 'number' ||
        !Number.isSafeInteger(revisionValue) ||
        revisionValue <= 0
      ) {
        throw new Error('Invalid image revision')
      }
      const game = findArtworkGame(gameId)
      if (!game) return
      if (
        orientation === 'vertical' &&
        (await customArtworkService.reset(gameId, revisionValue))
      ) {
        mainWindow.webContents.send(IPC.imageUpdated, {
          gameId,
          orientation,
          image: artworkService.resolve(game, orientation)
        } satisfies ImageUpdate)
        return
      }
      artworkService.reportFailure(game, orientation, revisionValue)
    }
  )

  ipcMain.handle(IPC.openExternal, async (_e, url: string) => {
    if (url.startsWith('https://')) {
      await shell.openExternal(url)
    }
  })
}
