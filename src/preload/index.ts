import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import {
  IPC,
  type AppControlAction,
  type EpicLoginStatus,
  type GameCompletionTimes,
  type GameAchievementsSnapshot,
  type GameLaunchStatus,
  type ImageOrientation,
  type ImageUpdate,
  type LibrarySnapshot,
  type LibraryStats,
  type OrbitSettings,
  type ResolvedImage,
  type SteamLoginStatus,
  type StoreRegionId,
  type StoreSearchResponse,
  type StoreSnapshot,
  type SystemPowerAction,
  type SystemSyncStatus
} from '@shared/ipc'

const orbitApi = {
  settings: {
    get: (): Promise<OrbitSettings> => ipcRenderer.invoke(IPC.settingsGet),
    set: (partial: Partial<OrbitSettings>): Promise<OrbitSettings> =>
      ipcRenderer.invoke(IPC.settingsSet, partial)
  },
  steam: {
    getAccount: () => ipcRenderer.invoke(IPC.steamGetAccount),
    startLogin: (): Promise<void> => ipcRenderer.invoke(IPC.steamLoginStart),
    cancelLogin: (): Promise<void> => ipcRenderer.invoke(IPC.steamLoginCancel),
    logout: (): Promise<void> => ipcRenderer.invoke(IPC.steamLogout),
    onStatus: (callback: (status: SteamLoginStatus) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, status: SteamLoginStatus): void =>
        callback(status)
      ipcRenderer.on(IPC.steamLoginStatus, listener)
      return () => ipcRenderer.removeListener(IPC.steamLoginStatus, listener)
    }
  },
  epic: {
    getAccount: () => ipcRenderer.invoke(IPC.epicGetAccount),
    startLogin: (): Promise<void> => ipcRenderer.invoke(IPC.epicLoginStart),
    cancelLogin: (): Promise<void> => ipcRenderer.invoke(IPC.epicLoginCancel),
    logout: (): Promise<void> => ipcRenderer.invoke(IPC.epicLogout),
    onStatus: (callback: (status: EpicLoginStatus) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, status: EpicLoginStatus): void =>
        callback(status)
      ipcRenderer.on(IPC.epicLoginStatus, listener)
      return () => ipcRenderer.removeListener(IPC.epicLoginStatus, listener)
    }
  },
  library: {
    get: (): Promise<LibrarySnapshot> => ipcRenderer.invoke(IPC.libraryGet),
    stats: (): Promise<LibraryStats> => ipcRenderer.invoke(IPC.libraryStatsGet),
    refresh: (): Promise<LibrarySnapshot> => ipcRenderer.invoke(IPC.libraryRefresh),
    onUpdated: (callback: (snapshot: LibrarySnapshot) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, snapshot: LibrarySnapshot): void =>
        callback(snapshot)
      ipcRenderer.on(IPC.libraryUpdated, listener)
      return () => ipcRenderer.removeListener(IPC.libraryUpdated, listener)
    }
  },
  game: {
    launch: (gameId: string): Promise<void> => ipcRenderer.invoke(IPC.gameLaunch, gameId),
    getLaunchStatus: (): Promise<GameLaunchStatus> => ipcRenderer.invoke(IPC.gameLaunchGet),
    revealLauncher: (): Promise<void> => ipcRenderer.invoke(IPC.gameLaunchRevealLauncher),
    onLaunchStatus: (callback: (status: GameLaunchStatus) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, status: GameLaunchStatus): void =>
        callback(status)
      ipcRenderer.on(IPC.gameLaunchStatus, listener)
      return () => ipcRenderer.removeListener(IPC.gameLaunchStatus, listener)
    },
    resolveCompletionTimes: (gameId: string): Promise<GameCompletionTimes | null> =>
      ipcRenderer.invoke(IPC.gameCompletionTimesResolve, gameId),
    resolveAchievements: (gameId: string): Promise<GameAchievementsSnapshot | null> =>
      ipcRenderer.invoke(IPC.gameAchievementsResolve, gameId)
  },
  image: {
    resolve: (gameId: string, orientation: ImageOrientation): Promise<ResolvedImage | null> =>
      ipcRenderer.invoke(IPC.imageResolve, gameId, orientation),
    onUpdated: (callback: (update: ImageUpdate) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, update: ImageUpdate): void => callback(update)
      ipcRenderer.on(IPC.imageUpdated, listener)
      return () => ipcRenderer.removeListener(IPC.imageUpdated, listener)
    }
  },
  store: {
    get: (): Promise<StoreSnapshot> => ipcRenderer.invoke(IPC.storeGet),
    refresh: (): Promise<StoreSnapshot> => ipcRenderer.invoke(IPC.storeRefresh),
    compareProduct: (productId: string): Promise<StoreSnapshot> =>
      ipcRenderer.invoke(IPC.storeCompareProduct, productId),
    search: (query: string): Promise<StoreSearchResponse> =>
      ipcRenderer.invoke(IPC.storeSearch, query),
    toggleWishlist: (productId: string): Promise<StoreSnapshot> =>
      ipcRenderer.invoke(IPC.storeToggleWishlist, productId),
    setPriceAlert: (productId: string, targetPriceMinor: number): Promise<StoreSnapshot> =>
      ipcRenderer.invoke(IPC.storeSetPriceAlert, productId, targetPriceMinor),
    removePriceAlert: (productId: string): Promise<StoreSnapshot> =>
      ipcRenderer.invoke(IPC.storeRemovePriceAlert, productId),
    setRegion: (region: StoreRegionId): Promise<StoreSnapshot> =>
      ipcRenderer.invoke(IPC.storeSetRegion, region),
    onUpdated: (callback: (snapshot: StoreSnapshot) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, snapshot: StoreSnapshot): void =>
        callback(snapshot)
      ipcRenderer.on(IPC.storeUpdated, listener)
      return () => ipcRenderer.removeListener(IPC.storeUpdated, listener)
    }
  },
  sync: {
    get: (): Promise<SystemSyncStatus> => ipcRenderer.invoke(IPC.syncGet),
    onUpdated: (callback: (status: SystemSyncStatus) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, status: SystemSyncStatus): void => callback(status)
      ipcRenderer.on(IPC.syncUpdated, listener)
      return () => ipcRenderer.removeListener(IPC.syncUpdated, listener)
    }
  },
  system: {
    power: (action: SystemPowerAction): Promise<void> =>
      ipcRenderer.invoke(IPC.systemPower, action)
  },
  app: {
    getVersion: (): Promise<string> => ipcRenderer.invoke(IPC.appVersion),
    control: (action: AppControlAction): Promise<void> => ipcRenderer.invoke(IPC.appControl, action),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC.openExternal, url)
  }
}

export type OrbitApi = typeof orbitApi

contextBridge.exposeInMainWorld('electron', electronAPI)
contextBridge.exposeInMainWorld('api', orbitApi)
