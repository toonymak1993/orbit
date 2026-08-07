import { app, ipcMain, shell, type BrowserWindow } from 'electron'
import { spawn } from 'node:child_process'
import {
  IPC,
  type AppControlAction,
  type EpicLoginStatus,
  type ImageOrientation,
  type LibraryGame,
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

const SYSTEM_POWER_ACTIONS: readonly SystemPowerAction[] = ['sleep', 'restart', 'shutdown']
const APP_CONTROL_ACTIONS: readonly AppControlAction[] = ['relaunch', 'quit']

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
  const gameSessionManager = new GameSessionManager(mainWindow)
  libraryService.on('updated', (snapshot) => {
    mainWindow.webContents.send(IPC.libraryUpdated, snapshot)
  })
  artworkService.on('updated', (update) => {
    mainWindow.webContents.send(IPC.imageUpdated, update)
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

  ipcMain.handle(IPC.settingsSet, (_e, partial: Partial<OrbitSettings>) => {
    settingsStore.set({ ...settingsStore.store, ...partial })
    return settingsStore.store
  })

  ipcMain.handle(IPC.appVersion, () => getDisplayVersion())
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
    (_e, gameId: string, orientation: ImageOrientation): ResolvedImage | null => {
      const game = libraryService.getGame(gameId)
      if (game) return resolveImage(game, orientation)
      const product = storeService.getSnapshot().products.find((item) => item.id === gameId)
      if (!product) return null
      const provider =
        product.canonicalSource === 'epic' ||
        product.canonicalSource === 'gog' ||
        product.canonicalSource === 'xbox'
          ? product.canonicalSource
          : product.steamAppId
            ? 'steam'
            : 'local'
      const artworkGame: LibraryGame = {
        id: product.id,
        provider,
        providerGameId: product.sourceProductId ?? String(product.steamAppId ?? product.id),
        appId: product.steamAppId,
        name: product.name,
        metadata: {
          backgroundUrl: product.heroUrl,
          storeHeaderUrl: product.headerUrl,
          artwork: {
            vertical: [product.portraitUrl].filter((url): url is string => Boolean(url)),
            horizontal: [product.heroUrl, product.headerUrl].filter(
              (url): url is string => Boolean(url)
            ),
            icon: []
          }
        },
        metadataRevision: 1,
        metadataSource: 'orbit-store',
        installed: false,
        addedAt: product.updatedAt,
        updatedAt: product.updatedAt
      }
      return resolveImage(artworkGame, orientation)
    }
  )

  ipcMain.handle(IPC.openExternal, async (_e, url: string) => {
    if (url.startsWith('https://')) {
      await shell.openExternal(url)
    }
  })
}
