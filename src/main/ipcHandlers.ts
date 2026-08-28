import { app, ipcMain, shell, type BrowserWindow } from 'electron'
import { spawn } from 'node:child_process'
import {
  HARDWARE_CONTROL_BUTTONS,
  HARDWARE_CONTROL_HOLD_SECONDS,
  FRIENDS_PROVIDERS,
  IPC,
  LIBRARY_GRID_COLUMN_OPTIONS,
  NOTIFICATION_MOTIONS,
  NOTIFICATION_POSITIONS,
  PROFILE_AVATAR_IDS,
  type AppControlAction,
  type CustomGameCommitInput,
  type CustomGameImportSource,
  type CustomGameLaunchArgumentsInput,
  type CustomGameSaveSource,
  type EpicLoginStatus,
  type FriendsProvider,
  type ImageOrientation,
  type ImageUpdate,
  type LibraryGame,
  type OrbitBackgroundServiceAction,
  type OrbitSettings,
  type ResolvedImage,
  type StoreRegionId,
  type SteamAccount,
  type SteamLoginStatus,
  type SystemPowerAction,
  type SystemSettingsTarget,
  type SystemStatusSnapshot
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
import { profileAvatarService } from './profileAvatarService'
import { systemUpdateService } from './systemUpdateService'
import { SystemStatusService } from './systemStatusService'
import { launcherDownloadMonitor } from './downloads/launcherDownloadMonitor'
import { AppUpdateService, launcherHasActiveDownload } from './appUpdateService'
import { friendsService } from './friendsService'
import {
  normalizeCustomLaunchArguments,
  parseCustomLaunchArguments
} from './customLaunchArguments'

const SYSTEM_POWER_ACTIONS: readonly SystemPowerAction[] = ['sleep', 'restart', 'shutdown']
const SYSTEM_SETTINGS_TARGETS: Record<SystemSettingsTarget, string> = {
  power: 'ms-settings:batterysaver',
  wifi: 'ms-settings:network-wifi',
  ethernet: 'ms-settings:network-ethernet',
  bluetooth: 'ms-settings:bluetooth'
}
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
    name: validatedShortString(input.name, 'custom game name', 120),
    launchArguments: normalizeCustomLaunchArguments(input.launchArguments)
  }
}

function validateCustomGameLaunchArguments(value: unknown): CustomGameLaunchArgumentsInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid custom game launch arguments payload')
  }
  const input = value as Record<string, unknown>
  return {
    gameId: validatedShortString(input.gameId, 'custom game ID'),
    launchArguments: normalizeCustomLaunchArguments(input.launchArguments)
  }
}

function validateSettingsPartial(value: unknown): asserts value is Partial<OrbitSettings> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid settings payload')
  }
  const partial = value as Record<string, unknown>
  if (
    'steamWebApiKey' in partial &&
    partial.steamWebApiKey !== undefined &&
    (typeof partial.steamWebApiKey !== 'string' ||
      !/^[a-f\d]{32}$/i.test(partial.steamWebApiKey.trim()))
  ) {
    throw new Error('Invalid Steam Web API key')
  }
  if (
    'libraryGridColumns' in partial &&
    !LIBRARY_GRID_COLUMN_OPTIONS.includes(
      partial.libraryGridColumns as (typeof LIBRARY_GRID_COLUMN_OPTIONS)[number]
    )
  ) {
    throw new Error('Invalid library grid column count')
  }
  if ('favoriteGameIds' in partial) {
    if (
      !Array.isArray(partial.favoriteGameIds) ||
      partial.favoriteGameIds.length > 10_000 ||
      partial.favoriteGameIds.some(
        (gameId) => typeof gameId !== 'string' || !gameId.trim() || gameId.length > 512
      )
    ) {
      throw new Error('Invalid favorite game IDs')
    }
  }
  if ('customLibraries' in partial) {
    if (!Array.isArray(partial.customLibraries) || partial.customLibraries.length > 50) {
      throw new Error('Invalid custom libraries')
    }
    for (const candidate of partial.customLibraries) {
      if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
        throw new Error('Invalid custom library')
      }
      const collection = candidate as Record<string, unknown>
      if (
        typeof collection.id !== 'string' ||
        !/^[a-zA-Z0-9-]{1,80}$/.test(collection.id) ||
        typeof collection.name !== 'string' ||
        !collection.name.trim() ||
        collection.name.length > 40 ||
        typeof collection.createdAt !== 'number' ||
        !Number.isFinite(collection.createdAt) ||
        !Array.isArray(collection.gameIds) ||
        collection.gameIds.length > 10_000 ||
        collection.gameIds.some(
          (gameId) => typeof gameId !== 'string' || !gameId.trim() || gameId.length > 512
        )
      ) {
        throw new Error('Invalid custom library')
      }
    }
  }
  if (
    'profileAvatar' in partial &&
    !PROFILE_AVATAR_IDS.includes(partial.profileAvatar as (typeof PROFILE_AVATAR_IDS)[number])
  ) {
    throw new Error('Invalid profile avatar')
  }
  if ('notificationsEnabled' in partial && typeof partial.notificationsEnabled !== 'boolean') {
    throw new Error('Invalid notification state')
  }
  if ('appUpdateAutoDownload' in partial && typeof partial.appUpdateAutoDownload !== 'boolean') {
    throw new Error('Invalid app update download preference')
  }
  if (
    'homeCardBubbleEffect' in partial &&
    typeof partial.homeCardBubbleEffect !== 'boolean'
  ) {
    throw new Error('Invalid Home card bubble effect state')
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

function validatedSteamGridDbOrientation(value: unknown): Exclude<ImageOrientation, 'icon'> {
  const orientation = validatedImageOrientation(value)
  if (orientation === 'icon') throw new Error('Invalid SteamGridDB artwork orientation')
  return orientation
}

function validatedArtworkQuery(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new Error('Invalid SteamGridDB artwork query')
  const query = value.normalize('NFKC').trim()
  if (!query || query.length > 120 || /[\u0000-\u001f\u007f]/.test(query)) {
    throw new Error('Invalid SteamGridDB artwork query')
  }
  return query
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
  const sendSteamAccountUpdate = (account: SteamAccount): void => {
    if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
    mainWindow.webContents.send(IPC.steamAccountUpdated, account)
  }
  steamAuthManager.on('account', sendSteamAccountUpdate)
  mainWindow.once('closed', () => steamAuthManager.off('account', sendSteamAccountUpdate))
  const sendFriendsUpdate = (): void => {
    if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
    mainWindow.webContents.send(IPC.friendsUpdated, friendsService.getSnapshot())
  }
  friendsService.on('updated', sendFriendsUpdate)
  mainWindow.once('closed', () => friendsService.off('updated', sendFriendsUpdate))
  app.once('before-quit', () => friendsService.dispose())
  // Warm the provider-neutral cache while the renderer is loading so opening
  // the Friends Hub never becomes the trigger for its first network request.
  void friendsService.refresh()
  const gameSessionManager = new GameSessionManager(mainWindow, {
    onGameConfirmed: (game, detectedAt) => libraryService.markGameStarted(game.id, detectedAt),
    onSessionCompleted: (game, session) =>
      libraryService.recordGameSession(game.id, session.durationSeconds, session.endedAt),
    onGameEnded: (game) => libraryService.backupCustomGame(game.id)
  })
  let gameSessionDisposed = false
  const disposeGameSession = (): void => {
    if (gameSessionDisposed) return
    gameSessionDisposed = true
    const completed = gameSessionManager.finalizeForShutdown()
    if (completed) {
      libraryService.recordGameSession(
        completed.gameId,
        completed.durationSeconds,
        completed.endedAt
      )
    }
  }
  app.once('before-quit', disposeGameSession)
  mainWindow.once('closed', disposeGameSession)
  const backgroundServiceManager = new OrbitBackgroundServiceManager(
    mainWindow,
    () => settingsStore.store.hardwareControlEnabled
  )
  backgroundServiceManager.start()
  const disposeBackgroundService = (): void => backgroundServiceManager.dispose()
  app.once('before-quit', disposeBackgroundService)
  mainWindow.once('closed', disposeBackgroundService)
  const appUpdateService = new AppUpdateService(mainWindow, {
    getGameLaunchPhase: () => gameSessionManager.getStatus().phase,
    hasActiveLauncherDownload: () =>
      launcherHasActiveDownload(
        launcherDownloadMonitor.getSnapshot().activities.map((activity) => activity.phase)
      ),
    prepareForInstall: () => backgroundServiceManager.prepareForAppUpdate(),
    recoverFromFailedInstall: () => backgroundServiceManager.recoverFromFailedAppUpdate(),
    getAutoDownloadEnabled: () => settingsStore.store.appUpdateAutoDownload
  })
  appUpdateService.start()
  let appUpdateDisposed = false
  const disposeAppUpdate = (): void => {
    if (appUpdateDisposed) return
    appUpdateDisposed = true
    appUpdateService.dispose()
  }
  mainWindow.once('closed', disposeAppUpdate)
  const systemStatusService = new SystemStatusService()
  const sendSystemStatus = (snapshot: SystemStatusSnapshot): void => {
    if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
    mainWindow.webContents.send(IPC.systemStatusUpdated, snapshot)
  }
  systemStatusService.on('updated', sendSystemStatus)
  systemStatusService.start()
  let systemStatusDisposed = false
  const disposeSystemStatus = (): void => {
    if (systemStatusDisposed) return
    systemStatusDisposed = true
    systemStatusService.off('updated', sendSystemStatus)
    systemStatusService.dispose()
  }
  app.once('before-quit', disposeSystemStatus)
  mainWindow.once('closed', disposeSystemStatus)
  const sendLauncherDownloads = (): void => {
    if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
    mainWindow.webContents.send(
      IPC.launcherDownloadsUpdated,
      launcherDownloadMonitor.getSnapshot()
    )
    appUpdateService.refreshBlockers()
  }
  launcherDownloadMonitor.on('updated', sendLauncherDownloads)
  launcherDownloadMonitor.start()
  let launcherDownloadsDisposed = false
  const disposeLauncherDownloads = (): void => {
    if (launcherDownloadsDisposed) return
    launcherDownloadsDisposed = true
    launcherDownloadMonitor.off('updated', sendLauncherDownloads)
    launcherDownloadMonitor.stop()
  }
  mainWindow.once('closed', disposeLauncherDownloads)
  libraryService.on('updated', (snapshot) => {
    if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
    mainWindow.webContents.send(IPC.libraryUpdated, snapshot)
  })
  artworkService.on('updated', (update) => {
    const customArtwork = customArtworkService.resolve(update.gameId, update.orientation)
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
    appUpdateService.refreshBlockers()
  })

  ipcMain.handle(IPC.launcherDownloadsGet, () => launcherDownloadMonitor.getSnapshot())
  ipcMain.handle(IPC.settingsGet, (): OrbitSettings => settingsStore.store)

  ipcMain.handle(IPC.profileAvatarGetCustom, () => profileAvatarService.resolve())
  ipcMain.handle(IPC.profileAvatarSelectCustom, () => profileAvatarService.select(mainWindow))

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
    if ('steamWebApiKey' in partial) {
      void friendsService.refresh()
    }
    if ('appUpdateAutoDownload' in partial) {
      appUpdateService.refreshPreferences()
    }
    return next
  })

  ipcMain.handle(IPC.appVersion, () => getDisplayVersion())
  ipcMain.handle(IPC.appUpdateGet, () => appUpdateService.getSnapshot())
  ipcMain.handle(IPC.appUpdateCheck, () => appUpdateService.check(true))
  ipcMain.handle(IPC.appUpdateDownload, () => appUpdateService.download())
  ipcMain.handle(IPC.appUpdateInstall, () => appUpdateService.install())
  ipcMain.handle(IPC.appUpdateDefer, () => appUpdateService.defer())
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
  ipcMain.handle(IPC.systemUpdatesCheck, () => systemUpdateService.check())
  ipcMain.handle(IPC.systemOpenUpdateSettings, () => shell.openExternal('ms-settings:windowsupdate'))
  ipcMain.handle(IPC.systemStatusGet, () => systemStatusService.getSnapshot())
  ipcMain.handle(IPC.systemStatusRefresh, () => systemStatusService.refresh())
  ipcMain.handle(IPC.systemOpenSettings, (_e, target: unknown) => {
    if (typeof target !== 'string' || !Object.hasOwn(SYSTEM_SETTINGS_TARGETS, target)) {
      throw new Error('Invalid system settings target')
    }
    if (process.platform !== 'win32') {
      throw new Error('System settings are currently available on Windows only')
    }
    return shell.openExternal(SYSTEM_SETTINGS_TARGETS[target as SystemSettingsTarget])
  })
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
      void friendsService.refresh()
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

  ipcMain.handle(IPC.steamLogout, async () => {
    await steamAuthManager.logout()
    await friendsService.refresh()
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
      void friendsService.refresh()
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

  ipcMain.handle(IPC.epicLogout, async () => {
    await epicAuthManager.logout()
    await friendsService.refresh()
  })

  ipcMain.handle(IPC.friendsGet, () => friendsService.getSnapshot())
  ipcMain.handle(IPC.friendsRefresh, () => friendsService.refresh())
  ipcMain.handle(IPC.friendsConnect, (_e, provider: unknown) => {
    if (provider !== 'discord') throw new Error('Unsupported friends provider connection')
    return friendsService.connectProvider(provider)
  })
  ipcMain.handle(IPC.friendsDisconnect, (_e, provider: unknown) => {
    if (provider !== 'discord') throw new Error('Unsupported friends provider disconnection')
    return friendsService.disconnectProvider(provider)
  })
  ipcMain.handle(IPC.friendsOpenProvider, (_e, provider: unknown) => {
    if (!FRIENDS_PROVIDERS.includes(provider as FriendsProvider)) {
      throw new Error('Invalid friends provider')
    }
    return friendsService.openProvider(provider as FriendsProvider)
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

  ipcMain.handle(IPC.customGameSetLaunchArguments, (_e, value: unknown) => {
    const input = validateCustomGameLaunchArguments(value)
    return libraryService.updateCustomGameLaunchArguments(
      input.gameId,
      parseCustomLaunchArguments(input.launchArguments)
    )
  })

  ipcMain.handle(IPC.customGameCancel, (_e, draftId: unknown) => {
    libraryService.cancelCustomGameImport(validatedShortString(draftId, 'custom game draft', 80))
  })

  ipcMain.handle(IPC.customGameRemove, async (_e, gameIdValue: unknown) => {
    const gameId = validatedShortString(gameIdValue, 'custom game ID')
    const snapshot = await libraryService.removeCustomGame(gameId)
    for (const orientation of ['vertical', 'horizontal'] as const) {
      mainWindow.webContents.send(IPC.imageUpdated, {
        gameId,
        orientation,
        image: null
      } satisfies ImageUpdate)
    }
    return snapshot
  })

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
  })

  ipcMain.handle(IPC.gameLaunchCancel, () => gameSessionManager.cancelPendingLaunch())
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

  ipcMain.handle(IPC.imageSteamGridDbList, (
    _e,
    gameIdValue: unknown,
    orientationValue: unknown,
    queryValue: unknown
  ) => {
    const gameId = validatedShortString(gameIdValue, 'SteamGridDB artwork game ID')
    const orientation = validatedSteamGridDbOrientation(orientationValue)
    const query = validatedArtworkQuery(queryValue)
    const game = libraryService.getGame(gameId)
    if (!game) throw new Error('Game is not available')
    return artworkPickerService.list(game, orientation, query)
  })

  ipcMain.handle(
    IPC.imageSteamGridDbApply,
    async (
      _e,
      gameIdValue: unknown,
      artworkIdValue: unknown,
      orientationValue: unknown,
      queryValue: unknown
    ): Promise<boolean> => {
      const gameId = validatedShortString(gameIdValue, 'SteamGridDB artwork game ID')
      const orientation = validatedSteamGridDbOrientation(orientationValue)
      const query = validatedArtworkQuery(queryValue)
      if (
        typeof artworkIdValue !== 'number' ||
        !Number.isSafeInteger(artworkIdValue) ||
        artworkIdValue <= 0
      ) {
        throw new Error('Invalid SteamGridDB artwork ID')
      }
      const game = libraryService.getGame(gameId)
      if (!game) throw new Error('Game is not available')
      const image = await artworkPickerService.apply(game, artworkIdValue, orientation, query)
      mainWindow.webContents.send(IPC.imageUpdated, {
        gameId,
        orientation,
        image
      } satisfies ImageUpdate)
      return true
    }
  )

  ipcMain.handle(IPC.imageSelectCustom, async (
    _e,
    gameIdValue: unknown,
    orientationValue: unknown
  ): Promise<boolean> => {
    const gameId = validatedShortString(gameIdValue, 'custom artwork game ID')
    const orientation = validatedImageOrientation(orientationValue)
    const game = libraryService.getGame(gameId)
    if (!game) throw new Error('Game is not available')
    const image = await customArtworkService.select(mainWindow, gameId, orientation)
    if (!image) return false
    mainWindow.webContents.send(IPC.imageUpdated, {
      gameId,
      orientation,
      image
    } satisfies ImageUpdate)
    return true
  })

  ipcMain.handle(IPC.imagePasteCustom, async (
    _e,
    gameIdValue: unknown,
    orientationValue: unknown
  ): Promise<boolean> => {
    const gameId = validatedShortString(gameIdValue, 'clipboard artwork game ID')
    const orientation = validatedImageOrientation(orientationValue)
    const game = libraryService.getGame(gameId)
    if (!game) throw new Error('Game is not available')
    const image = await customArtworkService.paste(gameId, orientation)
    if (!image) return false
    mainWindow.webContents.send(IPC.imageUpdated, {
      gameId,
      orientation,
      image
    } satisfies ImageUpdate)
    return true
  })

  ipcMain.handle(IPC.imageResetCustom, async (
    _e,
    gameIdValue: unknown,
    orientationValue: unknown
  ): Promise<boolean> => {
    const gameId = validatedShortString(gameIdValue, 'custom artwork game ID')
    const orientation = validatedImageOrientation(orientationValue)
    const game = libraryService.getGame(gameId)
    if (!game) throw new Error('Game is not available')
    const removed = await customArtworkService.reset(gameId, orientation)
    if (!removed) return false
    mainWindow.webContents.send(IPC.imageUpdated, {
      gameId,
      orientation,
      image: artworkService.resolve(game, orientation)
    } satisfies ImageUpdate)
    return true
  })

  ipcMain.handle(IPC.imageHasCustom, (
    _e,
    gameIdValue: unknown,
    orientationValue: unknown
  ): boolean => {
    const gameId = validatedShortString(gameIdValue, 'custom artwork game ID')
    const orientation = validatedImageOrientation(orientationValue)
    return Boolean(libraryService.getGame(gameId) && customArtworkService.has(gameId, orientation))
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
      if (await customArtworkService.reset(gameId, orientation, revisionValue)) {
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
