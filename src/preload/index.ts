import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import {
  IPC,
  type AppControlAction,
  type ApplicationLaunchResult,
  type AppUpdateSnapshot,
  type ArtworkMaintenanceResult,
  type ArtworkSearchOptions,
  type CustomGameCommitInput,
  type CustomGameDraft,
  type CustomGameImportSource,
  type CustomGameLaunchArgumentsInput,
  type CustomGameSaveSource,
  type CustomApplicationCommitInput,
  type CustomApplicationDraft,
  type CustomApplicationUpdateInput,
  type DiscordChatEvent,
  type DiscordChatHistory,
  type DiscordChatInbox,
  type DiscordChatSendResult,
  type DiscordServerList,
  type EpicLoginStatus,
  type FriendsProvider,
  type FriendsSnapshot,
  type GameCompletionTimes,
  type GameAchievementsSnapshot,
  type GameLaunchStatus,
  type HardwareControlStatus,
  type ImageOrientation,
  type ImageUpdate,
  type LibrarySnapshot,
  type LibraryStats,
  type MediaKeyboardOpenPayload,
  type MediaKeyboardShortcut,
  type MediaKeyboardUpdatePayload,
  type MediaOverlayHintPayload,
  type LauncherDownloadSnapshot,
  type LocalGameBackupResult,
  type OrbitBackgroundServiceAction,
  type OrbitBackgroundServiceStatus,
  type OrbitApplicationSnapshot,
  type OrbitSettings,
  type OrbitWallpaperApplyResult,
  type PlayStationAccount,
  type PlayStationLoginStatus,
  type PlayStationRemotePlayStatus,
  type ResolvedImage,
  type RetroEmulatorDownloadInput,
  type RetroEmulatorDownloadResult,
  type RetroEmulatorInstallInput,
  type RetroEmulatorInstallProgress,
  type RetroEmulatorInstallResult,
  type RetroAchievementsCredentialStatus,
  type RetroLibraryResult,
  type RetroLibraryStatus,
  type RetroGameLaunchArgumentsInput,
  type RetroSystemDirectoryResult,
  type RetroSystemId,
  type SteamAccount,
  type SteamGridDbTokenStatus,
  type SteamWebApiCredentialStatus,
  type SteamLoginStatus,
  type StoreRegionId,
  type StoreSearchResponse,
  type StoreSnapshot,
  type SystemPowerAction,
  type SystemSettingsTarget,
  type SystemStatusSnapshot,
  type SystemUpdateSnapshot,
  type SystemSyncStatus
} from '@shared/ipc'

const orbitApi = {
  settings: {
    get: (): Promise<OrbitSettings> => ipcRenderer.invoke(IPC.settingsGet),
    set: (partial: Partial<OrbitSettings>): Promise<OrbitSettings> =>
      ipcRenderer.invoke(IPC.settingsSet, partial)
  },
  profileAvatar: {
    getCustom: (): Promise<string | null> => ipcRenderer.invoke(IPC.profileAvatarGetCustom),
    selectCustom: (): Promise<string | null> => ipcRenderer.invoke(IPC.profileAvatarSelectCustom)
  },
  homeWallpaper: {
    get: (): Promise<string | null> => ipcRenderer.invoke(IPC.homeWallpaperGet),
    select: (): Promise<string | null> => ipcRenderer.invoke(IPC.homeWallpaperSelect),
    clear: (): Promise<void> => ipcRenderer.invoke(IPC.homeWallpaperClear)
  },
  retroAchievements: {
    credentials: {
      get: (): Promise<RetroAchievementsCredentialStatus> =>
        ipcRenderer.invoke(IPC.retroAchievementsCredentialGet),
      set: (apiKey: string): Promise<RetroAchievementsCredentialStatus> =>
        ipcRenderer.invoke(IPC.retroAchievementsCredentialSet, apiKey),
      clear: (): Promise<RetroAchievementsCredentialStatus> =>
        ipcRenderer.invoke(IPC.retroAchievementsCredentialClear)
    }
  },
  startupVideo: {
    get: (): Promise<string | null> => ipcRenderer.invoke(IPC.startupVideoGet),
    select: (): Promise<string | null> => ipcRenderer.invoke(IPC.startupVideoSelect)
  },
  applications: {
    get: (): Promise<OrbitApplicationSnapshot> => ipcRenderer.invoke(IPC.applicationsGet),
    refresh: (): Promise<OrbitApplicationSnapshot> =>
      ipcRenderer.invoke(IPC.applicationsRefresh),
    launch: (applicationId: string): Promise<ApplicationLaunchResult> =>
      ipcRenderer.invoke(IPC.applicationsLaunch, applicationId),
    custom: {
      select: (): Promise<CustomApplicationDraft | null> =>
        ipcRenderer.invoke(IPC.customApplicationSelect),
      commit: (input: CustomApplicationCommitInput): Promise<OrbitApplicationSnapshot> =>
        ipcRenderer.invoke(IPC.customApplicationCommit, input),
      update: (input: CustomApplicationUpdateInput): Promise<OrbitApplicationSnapshot> =>
        ipcRenderer.invoke(IPC.customApplicationUpdate, input),
      remove: (applicationId: string): Promise<OrbitApplicationSnapshot> =>
        ipcRenderer.invoke(IPC.customApplicationRemove, applicationId),
      cancel: (draftId: string): Promise<void> =>
        ipcRenderer.invoke(IPC.customApplicationCancel, draftId)
    }
  },
  mediaKeyboard: {
    onOpen: (callback: (payload: MediaKeyboardOpenPayload) => void): (() => void) => {
      const listener = (
        _e: Electron.IpcRendererEvent,
        payload: MediaKeyboardOpenPayload
      ): void => callback(payload)
      ipcRenderer.on(IPC.mediaKeyboardOpen, listener)
      return () => ipcRenderer.removeListener(IPC.mediaKeyboardOpen, listener)
    },
    onShortcut: (callback: (shortcut: MediaKeyboardShortcut) => void): (() => void) => {
      const listener = (
        _e: Electron.IpcRendererEvent,
        shortcut: MediaKeyboardShortcut
      ): void => callback(shortcut)
      ipcRenderer.on(IPC.mediaKeyboardShortcut, listener)
      return () => ipcRenderer.removeListener(IPC.mediaKeyboardShortcut, listener)
    },
    onHintOpen: (callback: (payload: MediaOverlayHintPayload) => void): (() => void) => {
      const listener = (
        _e: Electron.IpcRendererEvent,
        payload: MediaOverlayHintPayload
      ): void => callback(payload)
      ipcRenderer.on(IPC.mediaOverlayHintOpen, listener)
      return () => ipcRenderer.removeListener(IPC.mediaOverlayHintOpen, listener)
    },
    onHintDismiss: (callback: (hintId: string) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, hintId: string): void => callback(hintId)
      ipcRenderer.on(IPC.mediaOverlayHintDismiss, listener)
      return () => ipcRenderer.removeListener(IPC.mediaOverlayHintDismiss, listener)
    },
    update: (payload: MediaKeyboardUpdatePayload): void =>
      ipcRenderer.send(IPC.mediaKeyboardUpdate, payload),
    complete: (payload: MediaKeyboardUpdatePayload): void =>
      ipcRenderer.send(IPC.mediaKeyboardComplete, payload),
    close: (requestId: string): void => ipcRenderer.send(IPC.mediaKeyboardClose, requestId)
  },
  backgroundService: {
    getStatus: (): Promise<OrbitBackgroundServiceStatus> =>
      ipcRenderer.invoke(IPC.backgroundServiceGetStatus),
    control: (action: OrbitBackgroundServiceAction): Promise<OrbitBackgroundServiceStatus> =>
      ipcRenderer.invoke(IPC.backgroundServiceControl, action),
    onStatus: (callback: (status: OrbitBackgroundServiceStatus) => void): (() => void) => {
      const listener = (
        _e: Electron.IpcRendererEvent,
        status: OrbitBackgroundServiceStatus
      ): void => callback(status)
      ipcRenderer.on(IPC.backgroundServiceStatus, listener)
      return () => ipcRenderer.removeListener(IPC.backgroundServiceStatus, listener)
    }
  },
  hardwareControl: {
    getStatus: (): Promise<HardwareControlStatus> =>
      ipcRenderer.invoke(IPC.hardwareControlGetStatus),
    onStatus: (callback: (status: HardwareControlStatus) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, status: HardwareControlStatus): void =>
        callback(status)
      ipcRenderer.on(IPC.hardwareControlStatus, listener)
      return () => ipcRenderer.removeListener(IPC.hardwareControlStatus, listener)
    }
  },
  steam: {
    getAccount: () => ipcRenderer.invoke(IPC.steamGetAccount),
    startLogin: (): Promise<void> => ipcRenderer.invoke(IPC.steamLoginStart),
    cancelLogin: (): Promise<void> => ipcRenderer.invoke(IPC.steamLoginCancel),
    logout: (): Promise<void> => ipcRenderer.invoke(IPC.steamLogout),
    credentials: {
      get: (): Promise<SteamWebApiCredentialStatus> =>
        ipcRenderer.invoke(IPC.steamWebApiCredentialGet),
      set: (apiKey: string): Promise<SteamWebApiCredentialStatus> =>
        ipcRenderer.invoke(IPC.steamWebApiCredentialSet, apiKey),
      clear: (): Promise<SteamWebApiCredentialStatus> =>
        ipcRenderer.invoke(IPC.steamWebApiCredentialClear)
    },
    onStatus: (callback: (status: SteamLoginStatus) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, status: SteamLoginStatus): void =>
        callback(status)
      ipcRenderer.on(IPC.steamLoginStatus, listener)
      return () => ipcRenderer.removeListener(IPC.steamLoginStatus, listener)
    },
    onAccountUpdated: (callback: (account: SteamAccount) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, account: SteamAccount): void =>
        callback(account)
      ipcRenderer.on(IPC.steamAccountUpdated, listener)
      return () => ipcRenderer.removeListener(IPC.steamAccountUpdated, listener)
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
  playstation: {
    getAccount: (): Promise<PlayStationAccount | null> =>
      ipcRenderer.invoke(IPC.playstationGetAccount),
    startLogin: (): Promise<void> => ipcRenderer.invoke(IPC.playstationLoginStart),
    cancelLogin: (): Promise<void> => ipcRenderer.invoke(IPC.playstationLoginCancel),
    logout: (): Promise<void> => ipcRenderer.invoke(IPC.playstationLogout),
    getRemotePlayStatus: (): Promise<PlayStationRemotePlayStatus> =>
      ipcRenderer.invoke(IPC.playstationRemotePlayGet),
    refreshRemotePlayStatus: (): Promise<PlayStationRemotePlayStatus> =>
      ipcRenderer.invoke(IPC.playstationRemotePlayRefresh),
    onStatus: (callback: (status: PlayStationLoginStatus) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, status: PlayStationLoginStatus): void =>
        callback(status)
      ipcRenderer.on(IPC.playstationLoginStatus, listener)
      return () => ipcRenderer.removeListener(IPC.playstationLoginStatus, listener)
    }
  },
  friends: {
    get: (): Promise<FriendsSnapshot> => ipcRenderer.invoke(IPC.friendsGet),
    refresh: (): Promise<FriendsSnapshot> => ipcRenderer.invoke(IPC.friendsRefresh),
    connect: (provider: FriendsProvider): Promise<FriendsSnapshot> =>
      ipcRenderer.invoke(IPC.friendsConnect, provider),
    disconnect: (provider: FriendsProvider): Promise<FriendsSnapshot> =>
      ipcRenderer.invoke(IPC.friendsDisconnect, provider),
    openProvider: (provider: FriendsProvider): Promise<void> =>
      ipcRenderer.invoke(IPC.friendsOpenProvider, provider),
    onUpdated: (callback: (snapshot: FriendsSnapshot) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, snapshot: FriendsSnapshot): void =>
        callback(snapshot)
      ipcRenderer.on(IPC.friendsUpdated, listener)
      return () => ipcRenderer.removeListener(IPC.friendsUpdated, listener)
    }
  },
  discordChat: {
    inbox: (): Promise<DiscordChatInbox> => ipcRenderer.invoke(IPC.discordChatInbox),
    history: (userId: string, limit = 50): Promise<DiscordChatHistory> =>
      ipcRenderer.invoke(IPC.discordChatHistory, userId, limit),
    send: (userId: string, content: string): Promise<DiscordChatSendResult> =>
      ipcRenderer.invoke(IPC.discordChatSend, userId, content),
    setVisible: (showing: boolean): Promise<void> =>
      ipcRenderer.invoke(IPC.discordChatSetVisible, showing),
    onMessage: (callback: (event: DiscordChatEvent) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, event: DiscordChatEvent): void =>
        callback(event)
      ipcRenderer.on(IPC.discordChatMessage, listener)
      return () => ipcRenderer.removeListener(IPC.discordChatMessage, listener)
    }
  },
  discordServers: {
    list: (): Promise<DiscordServerList> => ipcRenderer.invoke(IPC.discordServersList),
    open: (serverId: string): Promise<void> =>
      ipcRenderer.invoke(IPC.discordServerOpen, serverId)
  },
  library: {
    get: (): Promise<LibrarySnapshot> => ipcRenderer.invoke(IPC.libraryGet),
    stats: (): Promise<LibraryStats> => ipcRenderer.invoke(IPC.libraryStatsGet),
    refresh: (): Promise<LibrarySnapshot> => ipcRenderer.invoke(IPC.libraryRefresh),
    exclude: (gameId: string): Promise<LibrarySnapshot> =>
      ipcRenderer.invoke(IPC.libraryGameExclude, gameId),
    restore: (gameId: string): Promise<LibrarySnapshot> =>
      ipcRenderer.invoke(IPC.libraryGameRestore, gameId),
    custom: {
      beginImport: (source: CustomGameImportSource): Promise<CustomGameDraft | null> =>
        ipcRenderer.invoke(IPC.customGameBeginImport, source),
      selectArtwork: (draftId: string): Promise<CustomGameDraft | null> =>
        ipcRenderer.invoke(IPC.customGameSelectArtwork, draftId),
      selectSave: (
        draftId: string,
        source: CustomGameSaveSource
      ): Promise<CustomGameDraft | null> =>
        ipcRenderer.invoke(IPC.customGameSelectSave, draftId, source),
      clearSave: (draftId: string): Promise<CustomGameDraft> =>
        ipcRenderer.invoke(IPC.customGameClearSave, draftId),
      commit: (input: CustomGameCommitInput): Promise<LibrarySnapshot> =>
        ipcRenderer.invoke(IPC.customGameCommit, input),
      setLaunchArguments: (input: CustomGameLaunchArgumentsInput): Promise<LibrarySnapshot> =>
        ipcRenderer.invoke(IPC.customGameSetLaunchArguments, input),
      cancel: (draftId: string): Promise<void> =>
        ipcRenderer.invoke(IPC.customGameCancel, draftId),
      remove: (gameId: string): Promise<LibrarySnapshot> =>
        ipcRenderer.invoke(IPC.customGameRemove, gameId),
      backup: (gameId: string): Promise<LocalGameBackupResult> =>
        ipcRenderer.invoke(IPC.customGameBackup, gameId),
      openBackups: (gameId: string): Promise<void> =>
        ipcRenderer.invoke(IPC.customGameOpenBackups, gameId)
    },
    retro: {
      getStatus: (): Promise<RetroLibraryStatus> =>
        ipcRenderer.invoke(IPC.retroLibraryStatusGet),
      refresh: (): Promise<RetroLibraryResult> =>
        ipcRenderer.invoke(IPC.retroLibraryRefresh),
      addDirectory: (): Promise<RetroLibraryResult | null> =>
        ipcRenderer.invoke(IPC.retroLibraryDirectoryAdd),
      removeDirectory: (directory: string): Promise<RetroLibraryResult> =>
        ipcRenderer.invoke(IPC.retroLibraryDirectoryRemove, directory),
      ensureSystemDirectory: (systemId: RetroSystemId): Promise<RetroSystemDirectoryResult> =>
        ipcRenderer.invoke(IPC.retroSystemDirectoryEnsure, systemId),
      openSystemDirectory: (systemId: RetroSystemId): Promise<RetroSystemDirectoryResult> =>
        ipcRenderer.invoke(IPC.retroSystemDirectoryOpen, systemId),
      openEmulatorDownload: (
        input: RetroEmulatorDownloadInput
      ): Promise<RetroEmulatorDownloadResult> =>
        ipcRenderer.invoke(IPC.retroEmulatorDownloadOpen, input),
      installEmulator: (input: RetroEmulatorInstallInput): Promise<RetroEmulatorInstallResult> =>
        ipcRenderer.invoke(IPC.retroEmulatorInstall, input),
      cancelEmulatorInstall: (): Promise<boolean> =>
        ipcRenderer.invoke(IPC.retroEmulatorInstallCancel),
      onInstallProgress: (
        callback: (progress: RetroEmulatorInstallProgress) => void
      ): (() => void) => {
        const listener = (
          _e: Electron.IpcRendererEvent,
          progress: RetroEmulatorInstallProgress
        ): void => callback(progress)
        ipcRenderer.on(IPC.retroEmulatorInstallProgress, listener)
        return () => ipcRenderer.removeListener(IPC.retroEmulatorInstallProgress, listener)
      },
      setLaunchArguments: (input: RetroGameLaunchArgumentsInput): Promise<LibrarySnapshot> =>
        ipcRenderer.invoke(IPC.retroGameSetLaunchArguments, input)
    },
    onUpdated: (callback: (snapshot: LibrarySnapshot) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, snapshot: LibrarySnapshot): void =>
        callback(snapshot)
      ipcRenderer.on(IPC.libraryUpdated, listener)
      return () => ipcRenderer.removeListener(IPC.libraryUpdated, listener)
    }
  },
  downloads: {
    get: (): Promise<LauncherDownloadSnapshot> => ipcRenderer.invoke(IPC.launcherDownloadsGet),
    onUpdated: (callback: (snapshot: LauncherDownloadSnapshot) => void): (() => void) => {
      const listener = (
        _e: Electron.IpcRendererEvent,
        snapshot: LauncherDownloadSnapshot
      ): void => callback(snapshot)
      ipcRenderer.on(IPC.launcherDownloadsUpdated, listener)
      return () => ipcRenderer.removeListener(IPC.launcherDownloadsUpdated, listener)
    }
  },
  game: {
    launch: (gameId: string): Promise<void> => ipcRenderer.invoke(IPC.gameLaunch, gameId),
    cancelLaunch: (): Promise<boolean> => ipcRenderer.invoke(IPC.gameLaunchCancel),
    stopTracking: (): Promise<boolean> => ipcRenderer.invoke(IPC.gameTrackingStop),
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
    resolveAchievements: (
      gameId: string,
      force = false
    ): Promise<GameAchievementsSnapshot | null> =>
      ipcRenderer.invoke(IPC.gameAchievementsResolve, gameId, force),
    syncAchievements: (): Promise<void> => ipcRenderer.invoke(IPC.gameAchievementsSync)
  },
  image: {
    getTokenStatus: (): Promise<SteamGridDbTokenStatus> =>
      ipcRenderer.invoke(IPC.imageTokenStatusGet),
    setToken: (token: string): Promise<SteamGridDbTokenStatus> =>
      ipcRenderer.invoke(IPC.imageTokenSet, token),
    clearToken: (): Promise<SteamGridDbTokenStatus> =>
      ipcRenderer.invoke(IPC.imageTokenClear),
    clearCache: (): Promise<ArtworkMaintenanceResult> =>
      ipcRenderer.invoke(IPC.imageCacheClear),
    reloadAll: (): Promise<ArtworkMaintenanceResult> =>
      ipcRenderer.invoke(IPC.imageArtworkReload),
    resolve: (gameId: string, orientation: ImageOrientation): Promise<ResolvedImage | null> =>
      ipcRenderer.invoke(IPC.imageResolve, gameId, orientation),
    searchArtwork: (
      gameId: string,
      orientation: Exclude<ImageOrientation, 'icon'>,
      query?: string
    ): Promise<ArtworkSearchOptions> =>
      ipcRenderer.invoke(IPC.imageArtworkSearchList, gameId, orientation, query),
    applySearchedArtwork: (
      gameId: string,
      artworkId: string,
      orientation: Exclude<ImageOrientation, 'icon'>,
      query?: string
    ): Promise<boolean> =>
      ipcRenderer.invoke(IPC.imageArtworkSearchApply, gameId, artworkId, orientation, query),
    selectCustom: (
      gameId: string,
      orientation: ImageOrientation
    ): Promise<boolean> => ipcRenderer.invoke(IPC.imageSelectCustom, gameId, orientation),
    pasteCustom: (
      gameId: string,
      orientation: ImageOrientation
    ): Promise<boolean> => ipcRenderer.invoke(IPC.imagePasteCustom, gameId, orientation),
    resetCustom: (
      gameId: string,
      orientation: ImageOrientation
    ): Promise<boolean> => ipcRenderer.invoke(IPC.imageResetCustom, gameId, orientation),
    hasCustom: (
      gameId: string,
      orientation: ImageOrientation
    ): Promise<boolean> => ipcRenderer.invoke(IPC.imageHasCustom, gameId, orientation),
    reportFailure: (
      gameId: string,
      orientation: ImageOrientation,
      revision: number
    ): Promise<void> =>
      ipcRenderer.invoke(IPC.imageReportFailure, gameId, orientation, revision),
    onUpdated: (callback: (update: ImageUpdate) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, update: ImageUpdate): void => callback(update)
      ipcRenderer.on(IPC.imageUpdated, listener)
      return () => ipcRenderer.removeListener(IPC.imageUpdated, listener)
    },
    onCacheInvalidated: (callback: () => void): (() => void) => {
      const listener = (): void => callback()
      ipcRenderer.on(IPC.imageCacheInvalidated, listener)
      return () => ipcRenderer.removeListener(IPC.imageCacheInvalidated, listener)
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
    wallpaper: {
      applyOrbit: (): Promise<OrbitWallpaperApplyResult> =>
        ipcRenderer.invoke(IPC.systemWallpaperApply)
    },
    keyboard: {
      show: (): Promise<boolean> => ipcRenderer.invoke(IPC.systemKeyboardShow)
    },
    status: {
      get: (): Promise<SystemStatusSnapshot> => ipcRenderer.invoke(IPC.systemStatusGet),
      refresh: (): Promise<SystemStatusSnapshot> => ipcRenderer.invoke(IPC.systemStatusRefresh),
      openSettings: (target: SystemSettingsTarget): Promise<void> =>
        ipcRenderer.invoke(IPC.systemOpenSettings, target),
      onUpdated: (callback: (snapshot: SystemStatusSnapshot) => void): (() => void) => {
        const listener = (
          _e: Electron.IpcRendererEvent,
          snapshot: SystemStatusSnapshot
        ): void => callback(snapshot)
        ipcRenderer.on(IPC.systemStatusUpdated, listener)
        return () => ipcRenderer.removeListener(IPC.systemStatusUpdated, listener)
      }
    },
    checkUpdates: (): Promise<SystemUpdateSnapshot> =>
      ipcRenderer.invoke(IPC.systemUpdatesCheck),
    openUpdateSettings: (): Promise<void> =>
      ipcRenderer.invoke(IPC.systemOpenUpdateSettings),
    power: (action: SystemPowerAction): Promise<void> =>
      ipcRenderer.invoke(IPC.systemPower, action)
  },
  app: {
    getVersion: (): Promise<string> => ipcRenderer.invoke(IPC.appVersion),
    updates: {
      get: (): Promise<AppUpdateSnapshot> => ipcRenderer.invoke(IPC.appUpdateGet),
      check: (): Promise<AppUpdateSnapshot> => ipcRenderer.invoke(IPC.appUpdateCheck),
      download: (): Promise<AppUpdateSnapshot> => ipcRenderer.invoke(IPC.appUpdateDownload),
      install: (): Promise<AppUpdateSnapshot> => ipcRenderer.invoke(IPC.appUpdateInstall),
      defer: (): Promise<AppUpdateSnapshot> => ipcRenderer.invoke(IPC.appUpdateDefer),
      onStatus: (callback: (snapshot: AppUpdateSnapshot) => void): (() => void) => {
        const listener = (
          _e: Electron.IpcRendererEvent,
          snapshot: AppUpdateSnapshot
        ): void => callback(snapshot)
        ipcRenderer.on(IPC.appUpdateStatus, listener)
        return () => ipcRenderer.removeListener(IPC.appUpdateStatus, listener)
      }
    },
    control: (action: AppControlAction): Promise<void> => ipcRenderer.invoke(IPC.appControl, action),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC.openExternal, url)
  }
}

export type OrbitApi = typeof orbitApi

contextBridge.exposeInMainWorld('electron', electronAPI)
contextBridge.exposeInMainWorld('api', orbitApi)
