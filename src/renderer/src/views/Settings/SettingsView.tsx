import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AppWindow,
  BellRing,
  Check,
  CheckCircle2,
  CircleAlert,
  Database,
  Download,
  DownloadCloud,
  ExternalLink,
  Film,
  AudioLines,
  Globe2,
  Grid3X3,
  Gamepad2,
  Eye,
  EyeOff,
  ImageIcon,
  Layers3,
  LayoutTemplate,
  LibraryBig,
  Loader2,
  LogOut,
  Monitor,
  Palette,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Trophy,
  Undo2,
  UserRound
} from 'lucide-react'
import { useAutoFocus } from '@renderer/hooks/useAutoFocus'
import {
  usePreferencesStore,
  THEME_OPTIONS,
  HOME_LAYOUT_OPTIONS,
  GAME_CARD_SIZE_OPTIONS,
  LIBRARY_GRID_COLUMN_OPTIONS,
  BACKDROP_INTENSITY_OPTIONS,
  HOME_BACKDROP_MODE_OPTIONS,
  HOME_BACKDROP_MOTION_OPTIONS,
  LANGUAGE_OPTIONS
} from '@renderer/state/preferencesStore'
import { useAuthStore } from '@renderer/state/authStore'
import { useEpicAuthStore } from '@renderer/state/epicAuthStore'
import { usePlayStationStore } from '@renderer/state/playstationStore'
import { useLibraryStore } from '@renderer/state/libraryStore'
import { useNavigationStore } from '@renderer/state/navigationStore'
import {
  useSettingsNavigationStore,
  type SettingsPage
} from '@renderer/state/settingsNavigationStore'
import { FocusableButton } from '@renderer/components/FocusableButton'
import { ApiKeyField } from '@renderer/components/ApiKeyField'
import {
  HardwareControlPanel,
  hardwareControlButtonLabel
} from '@renderer/components/HardwareControlPanel'
import { OrbitBackgroundServicePanel } from '@renderer/components/OrbitBackgroundServicePanel'
import { OrbitWallpaperPanel } from '@renderer/components/OrbitWallpaperPanel'
import { ControllerButtonHint } from '@renderer/components/ControllerButtonHint'
import { GameImage, preloadGameImage } from '@renderer/components/GameImage'
import {
  PROFILE_AVATAR_OPTIONS,
  ProfileAvatarPicker
} from '@renderer/components/ProfileAvatar'
import { useControllerButtonLabels } from '@renderer/state/controllerStore'
import { useT } from '@renderer/i18n/useT'
import { focusElement } from '@renderer/lib/spatialNavigation'
import { notify } from '@renderer/state/notificationStore'
import { latestLibraryActivity, normalizeLibraryTimestamp } from '@shared/libraryTime'
import { useLibraryCollectionsStore } from '@renderer/state/libraryCollectionsStore'
import { useAppUpdateStore } from '@renderer/state/appUpdateStore'
import { useSyncStore } from '@renderer/state/syncStore'
import type { TranslationKey } from '@renderer/i18n/translations'
import type {
  AudioPreset,
  AppUpdateSnapshot,
  ArtworkMaintenanceResult,
  BackdropIntensity,
  DockMotion,
  DockSize,
  DockThemeId,
  GameCardSize,
  HomeBackdropMode,
  HomeBackdropMotion,
  HomeLayoutId,
  LibraryDetectionMethod,
  LibraryGame,
  LibraryProviderConnection,
  LibraryProviderIssue,
  LibraryProviderState,
  LibraryProviderStatus,
  LibraryStatusProvider,
  GraphicsAdapterVendor,
  NotificationMotion,
  NotificationPosition,
  OrbitSettings,
  PlayStationRemotePlayPreference,
  PlayStationRemotePlayStatus,
  StoreRegionId,
  SteamGridDbTokenState,
  SteamGridDbTokenStatus,
  StartupAnimationMode,
  SystemUpdateSnapshot,
  ThemeId,
  UiDensity
} from '@shared/ipc'

const themeSwatch: Record<ThemeId, string> = {
  midnight: 'from-[#3fd0ff] to-[#8b5cf6]',
  coresense: 'from-[#08275f] via-[#4a94ff] to-[#71daff]',
  aurora: 'from-[#2dd4bf] to-[#818cf8]',
  violet: 'from-[#a78bfa] to-[#f472b6]',
  sakura: 'from-[#fb71ad] to-[#c4b5fd]',
  emerald: 'from-[#34d399] to-[#22d3ee]',
  ocean: 'from-[#22d3ee] to-[#3b82f6]',
  amber: 'from-[#fbbf24] to-[#fb7185]',
  sunset: 'from-[#fb923c] to-[#f43f5e]',
  crimson: 'from-[#fb7185] to-[#f59e0b]',
  ice: 'from-[#bae6fd] to-[#60a5fa]',
  lime: 'from-[#a3e635] to-[#2dd4bf]',
  monochrome: 'from-[#f4f4f5] to-[#71717a]'
}

const HOME_LAYOUT_BODY_KEYS: Record<HomeLayoutId, TranslationKey> = {
  orbit: 'settings.homeLayout.orbitBody',
  rolling: 'settings.homeLayout.rollingBody',
  float: 'settings.homeLayout.floatBody',
  coresense: 'settings.homeLayout.coresenseBody',
  xmode: 'settings.homeLayout.xmodeBody'
}

const DENSITY_OPTIONS: {
  id: UiDensity
  labelKey: 'settings.density.standard' | 'settings.density.compact'
}[] = [
  { id: 'standard', labelKey: 'settings.density.standard' },
  { id: 'compact', labelKey: 'settings.density.compact' }
]

const DOCK_THEME_OPTIONS: Array<{
  id: DockThemeId
  labelKey: TranslationKey
  bodyKey: TranslationKey
}> = [
  {
    id: 'standard',
    labelKey: 'settings.dock.theme.standard',
    bodyKey: 'settings.dock.theme.standardBody'
  },
  {
    id: 'glass',
    labelKey: 'settings.dock.theme.glass',
    bodyKey: 'settings.dock.theme.glassBody'
  },
  {
    id: 'neon',
    labelKey: 'settings.dock.theme.neon',
    bodyKey: 'settings.dock.theme.neonBody'
  },
  {
    id: 'minimal',
    labelKey: 'settings.dock.theme.minimal',
    bodyKey: 'settings.dock.theme.minimalBody'
  }
]

const DOCK_SIZE_OPTIONS: Array<{
  id: DockSize
  labelKey: TranslationKey
  bodyKey: TranslationKey
}> = [
  {
    id: 'compact',
    labelKey: 'settings.dock.size.compact',
    bodyKey: 'settings.dock.size.compactBody'
  },
  {
    id: 'standard',
    labelKey: 'settings.dock.size.standard',
    bodyKey: 'settings.dock.size.standardBody'
  },
  {
    id: 'large',
    labelKey: 'settings.dock.size.large',
    bodyKey: 'settings.dock.size.largeBody'
  }
]

const DOCK_MOTION_OPTIONS: Array<{
  id: DockMotion
  labelKey: TranslationKey
  bodyKey: TranslationKey
}> = [
  {
    id: 'calm',
    labelKey: 'settings.dock.motion.calm',
    bodyKey: 'settings.dock.motion.calmBody'
  },
  {
    id: 'standard',
    labelKey: 'settings.dock.motion.standard',
    bodyKey: 'settings.dock.motion.standardBody'
  },
  {
    id: 'lively',
    labelKey: 'settings.dock.motion.lively',
    bodyKey: 'settings.dock.motion.livelyBody'
  }
]

const STARTUP_ANIMATION_OPTIONS: Array<{
  id: StartupAnimationMode
  labelKey: TranslationKey
  bodyKey: TranslationKey
}> = [
  {
    id: 'orbit',
    labelKey: 'settings.startup.orbit',
    bodyKey: 'settings.startup.orbitBody'
  },
  {
    id: 'custom',
    labelKey: 'settings.startup.custom',
    bodyKey: 'settings.startup.customBody'
  },
  {
    id: 'off',
    labelKey: 'settings.startup.off',
    bodyKey: 'settings.startup.offBody'
  }
]

const GAME_CARD_SIZE_COPY: Record<
  GameCardSize,
  { labelKey: TranslationKey; bodyKey: TranslationKey }
> = {
  compact: {
    labelKey: 'settings.cardSize.compact',
    bodyKey: 'settings.cardSize.compactBody'
  },
  standard: {
    labelKey: 'settings.cardSize.standard',
    bodyKey: 'settings.cardSize.standardBody'
  },
  large: {
    labelKey: 'settings.cardSize.large',
    bodyKey: 'settings.cardSize.largeBody'
  }
}

const BACKDROP_INTENSITY_COPY: Record<
  BackdropIntensity,
  { labelKey: TranslationKey; bodyKey: TranslationKey }
> = {
  subtle: {
    labelKey: 'settings.backdrop.subtle',
    bodyKey: 'settings.backdrop.subtleBody'
  },
  balanced: {
    labelKey: 'settings.backdrop.balanced',
    bodyKey: 'settings.backdrop.balancedBody'
  },
  vivid: {
    labelKey: 'settings.backdrop.vivid',
    bodyKey: 'settings.backdrop.vividBody'
  }
}

const HOME_BACKDROP_MODE_COPY: Record<
  HomeBackdropMode,
  { labelKey: TranslationKey; bodyKey: TranslationKey }
> = {
  focus: {
    labelKey: 'settings.backdrop.mode.focus',
    bodyKey: 'settings.backdrop.mode.focusBody'
  },
  pinned: {
    labelKey: 'settings.backdrop.mode.pinned',
    bodyKey: 'settings.backdrop.mode.pinnedBody'
  },
  slideshow: {
    labelKey: 'settings.backdrop.mode.slideshow',
    bodyKey: 'settings.backdrop.mode.slideshowBody'
  },
  custom: {
    labelKey: 'settings.backdrop.mode.custom',
    bodyKey: 'settings.backdrop.mode.customBody'
  }
}

const HOME_BACKDROP_MOTION_COPY: Record<
  HomeBackdropMotion,
  { labelKey: TranslationKey; bodyKey: TranslationKey }
> = {
  still: {
    labelKey: 'settings.backdrop.motion.still',
    bodyKey: 'settings.backdrop.motion.stillBody'
  },
  drift: {
    labelKey: 'settings.backdrop.motion.drift',
    bodyKey: 'settings.backdrop.motion.driftBody'
  },
  cinematic: {
    labelKey: 'settings.backdrop.motion.cinematic',
    bodyKey: 'settings.backdrop.motion.cinematicBody'
  }
}

const AUDIO_PRESET_OPTIONS: Array<{
  id: AudioPreset
  labelKey: TranslationKey
  bodyKey: TranslationKey
}> = [
  {
    id: 'orbit',
    labelKey: 'settings.audio.orbit',
    bodyKey: 'settings.audio.orbitBody'
  },
  { id: 'soft', labelKey: 'settings.audio.soft', bodyKey: 'settings.audio.softBody' },
  { id: 'deep', labelKey: 'settings.audio.deep', bodyKey: 'settings.audio.deepBody' },
  {
    id: 'minimal',
    labelKey: 'settings.audio.minimal',
    bodyKey: 'settings.audio.minimalBody'
  },
  { id: 'steam', labelKey: 'settings.audio.steam', bodyKey: 'settings.audio.steamBody' },
  { id: 'xbox', labelKey: 'settings.audio.xbox', bodyKey: 'settings.audio.xboxBody' },
  {
    id: 'playstation',
    labelKey: 'settings.audio.playstation',
    bodyKey: 'settings.audio.playstationBody'
  },
  { id: 'off', labelKey: 'settings.audio.off', bodyKey: 'settings.audio.offBody' }
]

const STORE_REGION_OPTIONS: Array<{ id: StoreRegionId; labelKey: TranslationKey }> = [
  { id: 'eu', labelKey: 'store.region.eu' },
  { id: 'us', labelKey: 'store.region.us' },
  { id: 'gb', labelKey: 'store.region.gb' },
  { id: 'ca', labelKey: 'store.region.ca' },
  { id: 'au', labelKey: 'store.region.au' }
]

const SETTINGS_PAGES: {
  id: SettingsPage
  labelKey: TranslationKey
  bodyKey: TranslationKey
  icon: typeof Palette
}[] = [
  {
    id: 'appearance',
    labelKey: 'settings.page.appearance',
    bodyKey: 'settings.page.appearanceBody',
    icon: Palette
  },
  {
    id: 'experience',
    labelKey: 'settings.page.experience',
    bodyKey: 'settings.page.experienceBody',
    icon: SlidersHorizontal
  },
  {
    id: 'libraries',
    labelKey: 'settings.page.libraries',
    bodyKey: 'settings.page.librariesBody',
    icon: LibraryBig
  },
  {
    id: 'hardware',
    labelKey: 'settings.page.hardware',
    bodyKey: 'settings.page.hardwareBody',
    icon: Gamepad2
  },
  {
    id: 'updates',
    labelKey: 'settings.page.updates',
    bodyKey: 'settings.page.updatesBody',
    icon: Download
  },
  {
    id: 'system',
    labelKey: 'settings.page.system',
    bodyKey: 'settings.page.systemBody',
    icon: AppWindow
  }
]

const NOTIFICATION_POSITION_OPTIONS: Array<{
  id: NotificationPosition
  labelKey: TranslationKey
}> = [
  { id: 'top-right', labelKey: 'settings.notifications.position.topRight' },
  { id: 'top-center', labelKey: 'settings.notifications.position.topCenter' },
  { id: 'bottom-right', labelKey: 'settings.notifications.position.bottomRight' }
]

const NOTIFICATION_MOTION_OPTIONS: Array<{
  id: NotificationMotion
  labelKey: TranslationKey
}> = [
  { id: 'slide', labelKey: 'settings.notifications.motion.slide' },
  { id: 'lift', labelKey: 'settings.notifications.motion.lift' },
  { id: 'scale', labelKey: 'settings.notifications.motion.scale' }
]

const LIBRARY_STATE_KEYS: Record<LibraryProviderState, TranslationKey> = {
  idle: 'settings.libraryStatus.state.idle',
  scanning: 'settings.libraryStatus.state.scanning',
  ready: 'settings.libraryStatus.state.ready',
  partial: 'settings.libraryStatus.state.partial',
  'local-only': 'settings.libraryStatus.state.localOnly',
  error: 'settings.libraryStatus.state.error'
}

const STEAM_GRID_DB_TOKEN_STATE_KEYS: Record<SteamGridDbTokenState, TranslationKey> = {
  'not-configured': 'settings.images.token.notConfigured',
  valid: 'settings.images.token.valid',
  expired: 'settings.images.token.expired',
  invalid: 'settings.images.token.invalid',
  unavailable: 'settings.images.token.unavailable'
}

const LIBRARY_METHOD_KEYS: Record<LibraryDetectionMethod, TranslationKey> = {
  'local-manifests': 'settings.libraryStatus.method.localManifests',
  'account-api': 'settings.libraryStatus.method.accountApi',
  'community-profile': 'settings.libraryStatus.method.communityProfile',
  'launcher-session': 'settings.libraryStatus.method.launcherSession',
  'epic-catalog': 'settings.libraryStatus.method.epicCatalog',
  'xbox-app-cache': 'settings.libraryStatus.method.xboxAppCache',
  'xbox-display-catalog': 'settings.libraryStatus.method.xboxDisplayCatalog',
  'windows-packages': 'settings.libraryStatus.method.windowsPackages',
  'psn-purchased-library': 'settings.libraryStatus.method.psnPurchased',
  'psn-play-history': 'settings.libraryStatus.method.psnPlayed',
  'remote-play-apps': 'settings.libraryStatus.method.remotePlayApps',
  'windows-registry': 'settings.libraryStatus.method.windowsRegistry',
  'launcher-cache': 'settings.libraryStatus.method.launcherCache',
  'rom-folders': 'settings.libraryStatus.method.romFolders',
  'emulator-installations': 'settings.libraryStatus.method.emulatorInstallations',
  'retroachievements-hash': 'settings.libraryStatus.method.retroAchievementsHash',
  'cached-data': 'settings.libraryStatus.method.cachedData'
}

const LIBRARY_ISSUE_KEYS: Record<LibraryProviderIssue, TranslationKey> = {
  'not-connected': 'settings.libraryStatus.issue.notConnected',
  'online-library-unavailable': 'settings.libraryStatus.issue.onlineUnavailable',
  'metadata-pending': 'settings.libraryStatus.issue.metadataPending',
  'source-unavailable': 'settings.libraryStatus.issue.sourceUnavailable',
  'authentication-failed': 'settings.libraryStatus.issue.authenticationFailed',
  'remote-play-app-unavailable': 'settings.libraryStatus.issue.remotePlayUnavailable',
  'emulator-missing': 'settings.libraryStatus.issue.emulatorMissing',
  'rom-source-unavailable': 'settings.libraryStatus.issue.romSourceUnavailable',
  'no-games-found': 'settings.libraryStatus.issue.noGames'
}

const GRAPHICS_VENDOR_KEYS: Record<GraphicsAdapterVendor, TranslationKey> = {
  nvidia: 'settings.updates.vendor.nvidia',
  amd: 'settings.updates.vendor.amd',
  intel: 'settings.updates.vendor.intel',
  other: 'settings.updates.vendor.other'
}

const GRAPHICS_VENDOR_URLS: Partial<Record<GraphicsAdapterVendor, string>> = {
  nvidia: 'https://www.nvidia.com/Download/index.aspx',
  amd: 'https://www.amd.com/en/support/download/drivers.html',
  intel: 'https://www.intel.com/content/www/us/en/support/detect.html'
}

const pageVariants = {
  enter: (direction: 1 | -1) => ({ x: direction * 72, opacity: 0, scale: 0.985 }),
  center: { x: 0, opacity: 1, scale: 1 },
  exit: (direction: 1 | -1) => ({ x: direction * -52, opacity: 0, scale: 0.99 })
}

export function SettingsView(): JSX.Element {
  const containerRef = useAutoFocus<HTMLDivElement>()
  const controllerLabels = useControllerButtonLabels()
  const t = useT()
  const setPhase = useNavigationStore((s) => s.setPhase)
  const setOnboardingStep = useNavigationStore((s) => s.setOnboardingStep)
  const {
    theme,
    profileAvatar,
    customAvatarUrl,
    homeLayout,
    gameCardSize,
    libraryGridColumns,
    backdropIntensity,
    homeBackdropMode,
    homeBackdropMotion,
    pinnedBackdropGameId,
    customHomeWallpaperUrl,
    homeCardBubbleEffect,
    startupAnimationMode,
    customStartupVideoUrl,
    dockTheme,
    dockSize,
    dockMotion,
    uiDensity,
    language,
    audioPreset,
    showStoreTab,
    showFriendsHub,
    showHomeBanners,
    showAchievements,
    closeLaunchersAfterGame,
    notificationsEnabled,
    notificationPosition,
    notificationMotion,
    hardwareControlEnabled,
    hardwareControlButton,
    hardwareControlHoldSeconds,
    setTheme,
    setProfileAvatar,
    selectCustomAvatar,
    setHomeLayout,
    setGameCardSize,
    setLibraryGridColumns,
    setBackdropIntensity,
    setHomeBackdropMode,
    setHomeBackdropMotion,
    setPinnedBackdropGameId,
    selectCustomHomeWallpaper,
    clearCustomHomeWallpaper,
    setHomeCardBubbleEffect,
    setStartupAnimationMode,
    selectCustomStartupVideo,
    setDockTheme,
    setDockSize,
    setDockMotion,
    setDensity,
    setLanguage,
    setAudioPreset,
    setShowStoreTab,
    setShowFriendsHub,
    setShowHomeBanners,
    setShowAchievements,
    setCloseLaunchersAfterGame,
    setNotificationsEnabled,
    setNotificationPosition,
    setNotificationMotion
  } = usePreferencesStore()
  const customLibraryCount = useLibraryCollectionsStore((s) => s.collections.length)
  const page = useSettingsNavigationStore((s) => s.page)
  const direction = useSettingsNavigationStore((s) => s.direction)
  const setPage = useSettingsNavigationStore((s) => s.setPage)
  const account = useAuthStore((s) => s.account)
  const steamStatus = useAuthStore((s) => s.status)
  const startSteamLogin = useAuthStore((s) => s.startLogin)
  const logout = useAuthStore((s) => s.logout)
  const epicAccount = useEpicAuthStore((s) => s.account)
  const epicStatus = useEpicAuthStore((s) => s.status)
  const startEpicLogin = useEpicAuthStore((s) => s.startLogin)
  const logoutEpic = useEpicAuthStore((s) => s.logout)
  const playStationAccount = usePlayStationStore((s) => s.account)
  const playStationStatus = usePlayStationStore((s) => s.status)
  const remotePlayStatus = usePlayStationStore((s) => s.remotePlay)
  const startPlayStationLogin = usePlayStationStore((s) => s.startLogin)
  const logoutPlayStation = usePlayStationStore((s) => s.logout)
  const refreshRemotePlay = usePlayStationStore((s) => s.refreshRemotePlay)
  const refreshLibrary = useLibraryStore((s) => s.refresh)
  const librarySnapshot = useLibraryStore((s) => s.snapshot)
  const isRefreshingLibrary = useLibraryStore((s) => s.isRefreshing)
  const achievementSync = useSyncStore((s) => s.status.pipelines.achievements)
  const artworkSync = useSyncStore((s) => s.status.pipelines.artwork)
  const steamLibraryStatus = providerStatusOrFallback(
    librarySnapshot.providerStatuses,
    librarySnapshot.providerGames,
    'steam',
    account ? 'connected' : 'not-connected'
  )
  const epicLibraryStatus = providerStatusOrFallback(
    librarySnapshot.providerStatuses,
    librarySnapshot.providerGames,
    'epic',
    epicAccount ? 'connected' : 'not-connected'
  )
  const gogLibraryStatus = providerStatusOrFallback(
    librarySnapshot.providerStatuses,
    librarySnapshot.providerGames,
    'gog',
    'automatic'
  )
  const xboxLibraryStatus = providerStatusOrFallback(
    librarySnapshot.providerStatuses,
    librarySnapshot.providerGames,
    'xbox',
    'automatic'
  )
  const playStationLibraryStatus = providerStatusOrFallback(
    librarySnapshot.providerStatuses,
    librarySnapshot.providerGames,
    'playstation',
    playStationAccount ? 'connected' : 'not-connected'
  )
  const eaLibraryStatus = providerStatusOrFallback(
    librarySnapshot.providerStatuses,
    librarySnapshot.providerGames,
    'ea',
    'automatic'
  )
  const ubisoftLibraryStatus = providerStatusOrFallback(
    librarySnapshot.providerStatuses,
    librarySnapshot.providerGames,
    'ubisoft',
    'automatic'
  )
  const retroLibraryStatus = providerStatusOrFallback(
    librarySnapshot.providerStatuses,
    librarySnapshot.providerGames,
    'retro',
    'automatic'
  )
  const readyLibraryCount = [
    steamLibraryStatus,
    epicLibraryStatus,
    gogLibraryStatus,
    xboxLibraryStatus,
    playStationLibraryStatus,
    eaLibraryStatus,
    ubisoftLibraryStatus,
    retroLibraryStatus
  ].filter((status) => status.state === 'ready').length
  const accountSignature = `${account?.steamId ?? ''}:${epicAccount?.accountId ?? ''}:${playStationAccount?.accountId ?? ''}`
  const previousAccountSignature = useRef(accountSignature)
  const [version, setVersion] = useState('')
  const [settings, setSettings] = useState<OrbitSettings | null>(null)
  const [achievementSyncError, setAchievementSyncError] = useState(false)
  const [retroAchievementsUsername, setRetroAchievementsUsername] = useState('')
  const [retroAchievementsSaveState, setRetroAchievementsSaveState] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle')
  const [retroAchievementsApiKeyConfigured, setRetroAchievementsApiKeyConfigured] =
    useState(false)
  const [steamWebApiKeyConfigured, setSteamWebApiKeyConfigured] = useState(false)
  const [steamGridDbTokenStatus, setSteamGridDbTokenStatus] =
    useState<SteamGridDbTokenStatus | null>(null)
  const [steamGridDbTokenChecking, setSteamGridDbTokenChecking] = useState(false)
  const [artworkMaintenanceAction, setArtworkMaintenanceAction] = useState<
    'clear' | 'reload' | null
  >(null)
  const [artworkMaintenanceResult, setArtworkMaintenanceResult] =
    useState<ArtworkMaintenanceResult | null>(null)
  const [artworkMaintenanceError, setArtworkMaintenanceError] = useState(false)
  const [remotePlaySaving, setRemotePlaySaving] = useState(false)
  const [startupVideoBusy, setStartupVideoBusy] = useState(false)
  const [startupVideoError, setStartupVideoError] = useState(false)
  const [homeWallpaperBusy, setHomeWallpaperBusy] = useState(false)
  const [homeWallpaperError, setHomeWallpaperError] = useState(false)
  const [regionSaveState, setRegionSaveState] = useState<'idle' | 'saving' | 'error'>('idle')
  const [restoringGameId, setRestoringGameId] = useState<string | null>(null)
  const [restoreErrorGameId, setRestoreErrorGameId] = useState<string | null>(null)
  const [excludedRenderLimit, setExcludedRenderLimit] = useState(40)
  const [updateSnapshot, setUpdateSnapshot] = useState<SystemUpdateSnapshot | null>(null)
  const [updateCheckState, setUpdateCheckState] = useState<'idle' | 'checking' | 'error'>('idle')
  const appUpdateSnapshot = useAppUpdateStore((state) => state.snapshot)
  const checkAppUpdate = useAppUpdateStore((state) => state.check)
  const downloadAppUpdate = useAppUpdateStore((state) => state.download)
  const installAppUpdate = useAppUpdateStore((state) => state.install)
  const deferAppUpdate = useAppUpdateStore((state) => state.defer)
  const updateCheckInFlight = useRef(false)
  const pendingUpdateCount =
    (updateSnapshot?.windowsUpdates.length ?? 0) +
    (updateSnapshot?.graphicsDriverUpdates.length ?? 0)
  const activePage = SETTINGS_PAGES.find((item) => item.id === page) ?? SETTINGS_PAGES[0]
  const activePageIndex = SETTINGS_PAGES.indexOf(activePage)
  const excludedGames = useMemo(
    () =>
      [...(librarySnapshot.excludedGames ?? [])].sort((left, right) =>
        left.name.localeCompare(right.name, language === 'de' ? 'de-DE' : 'en-US')
      ),
    [language, librarySnapshot.excludedGames]
  )
  const visibleExcludedGames = excludedGames.slice(0, excludedRenderLimit)
  const pinnedBackdropGames = useMemo(() => {
    const sorted = librarySnapshot.games
      .filter((game) => game.installed)
      .sort(
        (left, right) =>
          latestLibraryActivity(right) - latestLibraryActivity(left) ||
          normalizeLibraryTimestamp(right.addedAt) - normalizeLibraryTimestamp(left.addedAt) ||
          left.name.localeCompare(right.name, language === 'de' ? 'de-DE' : 'en-US')
      )
    const recent = sorted.slice(0, 12)
    const selected = pinnedBackdropGameId
      ? sorted.find((game) => game.id === pinnedBackdropGameId)
      : undefined
    if (!selected || recent.some((game) => game.id === selected.id)) return recent
    return [selected, ...recent.slice(0, 11)]
  }, [language, librarySnapshot.games, pinnedBackdropGameId])
  const { steamAchievementGameCount, retroAchievementGameCount } = useMemo(
    () =>
      librarySnapshot.games.reduce(
        (counts, game) => {
          if (game.provider === 'steam' && (game.metadata.achievementCount ?? 0) > 0) {
            counts.steamAchievementGameCount += 1
          } else if (
            game.provider === 'retro' &&
            Boolean(game.retro?.retroAchievementsGameId)
          ) {
            counts.retroAchievementGameCount += 1
          }
          return counts
        },
        { steamAchievementGameCount: 0, retroAchievementGameCount: 0 }
      ),
    [librarySnapshot.games]
  )
  const retroAchievementsConfigured = Boolean(
    settings?.retroAchievementsUsername?.trim() &&
      retroAchievementsApiKeyConfigured
  )
  const achievementEligibleGameCount =
    (account ? steamAchievementGameCount : 0) +
    (retroAchievementsConfigured ? retroAchievementGameCount : 0)
  const pageHighlights =
    page === 'appearance'
      ? [
          {
            label: t('settings.avatar.title'),
            value:
              t(
                PROFILE_AVATAR_OPTIONS.find((item) => item.id === profileAvatar)?.labelKey ??
                  'settings.avatar.orbit'
              )
          },
          {
            label: t('settings.summary.theme'),
            value: THEME_OPTIONS.find((item) => item.id === theme)?.label ?? theme
          },
          {
            label: t('settings.dock.title'),
            value: t(
              DOCK_THEME_OPTIONS.find((item) => item.id === dockTheme)?.labelKey ??
                'settings.dock.theme.standard'
            )
          },
          { label: t('settings.summary.home'), value: homeLayout.toUpperCase() }
        ]
      : page === 'experience'
        ? [
            {
              label: t('settings.summary.sound'),
              value:
                t(
                  AUDIO_PRESET_OPTIONS.find((item) => item.id === audioPreset)?.labelKey ??
                    'settings.audio.orbit'
                )
            },
            {
              label: t('settings.summary.language'),
              value: LANGUAGE_OPTIONS.find((item) => item.id === language)?.label ?? language
            },
            {
              label: t('settings.summary.notifications'),
              value: t(notificationsEnabled ? 'settings.summary.on' : 'settings.summary.off')
            }
          ]
        : page === 'libraries'
          ? [
              {
                label: t('settings.summary.libraryGrid'),
                value: t('settings.libraryGrid.columns', { count: libraryGridColumns })
              },
              {
                label: t('settings.summary.sources'),
                value: t('settings.summary.sourcesValue', {
                  count: readyLibraryCount,
                  total: 8
                })
              },
              {
                label: t('settings.summary.customLibraries'),
                value: t('settings.summary.customLibrariesValue', { count: customLibraryCount })
              }
            ]
          : page === 'hardware'
            ? [
                {
                  label: t('settings.summary.hardwareControl'),
                  value: t(
                    hardwareControlEnabled ? 'settings.summary.on' : 'settings.summary.off'
                  )
                },
                {
                  label: t('settings.summary.trigger'),
                  value: hardwareControlButtonLabel(
                    hardwareControlButton,
                    t,
                    controllerLabels
                  )
                },
                {
                  label: t('settings.summary.hold'),
                  value: t('settings.hardwareControl.seconds', {
                    seconds: hardwareControlHoldSeconds
                  })
                }
              ]
            : page === 'updates'
              ? [
                  {
                    label: t('appUpdate.settings.orbit'),
                    value: t(appUpdateStatusKey(appUpdateSnapshot))
                  },
                  {
                    label: t('settings.summary.pending'),
                    value: updateSnapshot
                      ? pendingUpdateCount > 0
                        ? t('settings.summary.updateCount', { count: pendingUpdateCount })
                        : t('settings.summary.upToDate')
                      : t('settings.summary.notChecked')
                  },
                  {
                    label: t('settings.summary.lastCheck'),
                    value: appUpdateSnapshot.checkedAt
                      ? formatUpdateDate(appUpdateSnapshot.checkedAt, language)
                      : t('settings.summary.notChecked')
                  }
                ]
            : [
              {
                label: t('settings.summary.version'),
                value: version || '—'
              },
              {
                label: t('settings.summary.setup'),
                value: t('settings.summary.available')
              }
            ]

  useEffect(() => {
    void window.api.app.getVersion().then(setVersion)
    void Promise.all([
      window.api.settings.get(),
      window.api.retroAchievements.credentials.get(),
      window.api.steam.credentials.get()
    ]).then(([value, credentialStatus, steamCredentialStatus]) => {
      setSettings(value)
      setRetroAchievementsUsername(value.retroAchievementsUsername ?? '')
      setRetroAchievementsApiKeyConfigured(credentialStatus.configured)
      setSteamWebApiKeyConfigured(steamCredentialStatus.configured)
    })
  }, [])

  useEffect(() => {
    if (page !== 'updates' || updateSnapshot || updateCheckInFlight.current) return
    void checkSystemUpdates()
  }, [page, updateSnapshot])

  useEffect(() => {
    if (previousAccountSignature.current === accountSignature) return
    previousAccountSignature.current = accountSignature
    void refreshLibrary()
  }, [accountSignature, refreshLibrary])

  useEffect(() => {
    if (page === 'libraries' && !remotePlayStatus) void refreshRemotePlay()
  }, [page, refreshRemotePlay, remotePlayStatus])

  useEffect(() => {
    if (page !== 'libraries' || steamGridDbTokenStatus || steamGridDbTokenChecking) return
    void refreshSteamGridDbTokenStatus()
  }, [page, steamGridDbTokenChecking, steamGridDbTokenStatus])

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const activeTab = containerRef.current?.querySelector<HTMLElement>(
        `[data-settings-page="${page}"]`
      )
      focusElement(activeTab ?? null)
    })
    return () => cancelAnimationFrame(frame)
  }, [containerRef, page])

  async function updateStoreRegion(storeRegion: StoreRegionId): Promise<void> {
    if (regionSaveState === 'saving' || settings?.storeRegion === storeRegion) return
    setRegionSaveState('saving')
    try {
      const snapshot = await window.api.store.setRegion(storeRegion)
      setSettings((current) =>
        current ? { ...current, storeRegion: snapshot.region } : current
      )
      setRegionSaveState('idle')
    } catch {
      setRegionSaveState('error')
    }
  }

  async function saveRetroAchievementsUsername(): Promise<void> {
    if (!settings || retroAchievementsSaveState === 'saving') return
    setRetroAchievementsSaveState('saving')
    try {
      const username = retroAchievementsUsername.trim() || undefined
      const next = await window.api.settings.set({ retroAchievementsUsername: username })
      setSettings(next)
      setRetroAchievementsUsername(next.retroAchievementsUsername ?? '')
      setRetroAchievementsSaveState('saved')
    } catch {
      setRetroAchievementsSaveState('error')
    }
  }

  async function syncAchievementsNow(): Promise<void> {
    if (achievementSync.state === 'running') return
    setAchievementSyncError(false)
    try {
      await window.api.game.syncAchievements()
    } catch {
      setAchievementSyncError(true)
    }
  }

  async function refreshSteamGridDbTokenStatus(): Promise<void> {
    if (steamGridDbTokenChecking) return
    setSteamGridDbTokenChecking(true)
    try {
      setSteamGridDbTokenStatus(await window.api.image.getTokenStatus())
    } catch {
      setSteamGridDbTokenStatus({ state: 'unavailable', checkedAt: Date.now() })
    } finally {
      setSteamGridDbTokenChecking(false)
    }
  }

  async function maintainArtwork(action: 'clear' | 'reload'): Promise<void> {
    if (artworkMaintenanceAction) return
    setArtworkMaintenanceAction(action)
    setArtworkMaintenanceResult(null)
    setArtworkMaintenanceError(false)
    try {
      const result =
        action === 'clear'
          ? await window.api.image.clearCache()
          : await window.api.image.reloadAll()
      setArtworkMaintenanceResult(result)
    } catch {
      setArtworkMaintenanceError(true)
    } finally {
      setArtworkMaintenanceAction(null)
    }
  }

  async function updateRemotePlayPreference(
    preference: PlayStationRemotePlayPreference
  ): Promise<void> {
    if (
      remotePlaySaving ||
      !settings ||
      settings.playstationRemotePlayPreference === preference
    ) {
      return
    }
    setRemotePlaySaving(true)
    try {
      const next = await window.api.settings.set({
        playstationRemotePlayPreference: preference
      })
      setSettings(next)
      await refreshRemotePlay()
    } finally {
      setRemotePlaySaving(false)
    }
  }

  async function chooseStartupAnimationMode(mode: StartupAnimationMode): Promise<void> {
    if (startupVideoBusy || mode === startupAnimationMode) return
    const opensPicker = mode === 'custom' && !customStartupVideoUrl
    if (opensPicker) setStartupVideoBusy(true)
    setStartupVideoError(false)
    try {
      await setStartupAnimationMode(mode)
    } catch {
      setStartupVideoError(true)
    } finally {
      if (opensPicker) setStartupVideoBusy(false)
    }
  }

  async function chooseCustomStartupVideo(): Promise<void> {
    if (startupVideoBusy) return
    setStartupVideoBusy(true)
    setStartupVideoError(false)
    try {
      await selectCustomStartupVideo()
    } catch {
      setStartupVideoError(true)
    } finally {
      setStartupVideoBusy(false)
    }
  }

  async function restoreExcludedGame(game: LibraryGame): Promise<void> {
    if (restoringGameId) return
    const buttons = Array.from(
      containerRef.current?.querySelectorAll<HTMLElement>('[data-excluded-game-restore]') ?? []
    )
    const origin = buttons.find((button) => button.dataset.excludedGameRestore === game.id) ?? null
    const currentIndex = origin ? buttons.indexOf(origin) : -1
    const focusTarget =
      currentIndex >= 0
        ? (buttons[currentIndex + 1] ?? buttons[currentIndex - 1] ?? null)
        : null
    const libraryTab = containerRef.current?.querySelector<HTMLElement>(
      '[data-settings-page="libraries"]'
    )

    setRestoringGameId(game.id)
    setRestoreErrorGameId(null)
    try {
      const snapshot = await window.api.library.restore(game.id)
      useLibraryStore.getState().applySnapshot(snapshot)
      notify({
        tone: 'success',
        titleKey: 'notification.libraryRestored.title',
        messageKey: 'notification.libraryRestored.body',
        vars: { game: game.name },
        force: true,
        replace: true
      })
      requestAnimationFrame(() => {
        focusElement(focusTarget?.isConnected ? focusTarget : (libraryTab ?? null))
      })
    } catch {
      setRestoreErrorGameId(game.id)
      requestAnimationFrame(() => focusElement(origin))
    } finally {
      setRestoringGameId(null)
    }
  }

  async function checkSystemUpdates(): Promise<void> {
    if (updateCheckInFlight.current) return
    updateCheckInFlight.current = true
    setUpdateCheckState('checking')
    try {
      const snapshot = await window.api.system.checkUpdates()
      setUpdateSnapshot(snapshot)
      setUpdateCheckState('idle')
    } catch {
      setUpdateCheckState('error')
    } finally {
      updateCheckInFlight.current = false
    }
  }

  async function chooseHomeBackdropMode(mode: HomeBackdropMode): Promise<void> {
    if (mode === 'custom') {
      if (customHomeWallpaperUrl) {
        await setHomeBackdropMode('custom')
      } else {
        await chooseCustomHomeWallpaper()
      }
      return
    }
    if (mode === 'pinned' && !pinnedBackdropGameId && pinnedBackdropGames[0]) {
      await setPinnedBackdropGameId(pinnedBackdropGames[0].id)
    }
    if (mode === 'slideshow' && pinnedBackdropGames.length > 0) {
      const first = pinnedBackdropGames[1] ?? pinnedBackdropGames[0]
      const following = pinnedBackdropGames[2] ?? pinnedBackdropGames[0]
      void preloadGameImage(first.id, 'horizontal')
      if (following.id !== first.id) void preloadGameImage(following.id, 'horizontal')
    }
    await setHomeBackdropMode(mode)
  }

  async function chooseCustomHomeWallpaper(): Promise<void> {
    if (homeWallpaperBusy) return
    setHomeWallpaperBusy(true)
    setHomeWallpaperError(false)
    try {
      await selectCustomHomeWallpaper()
    } catch {
      setHomeWallpaperError(true)
    } finally {
      setHomeWallpaperBusy(false)
    }
  }

  async function removeCustomHomeWallpaper(): Promise<void> {
    if (homeWallpaperBusy) return
    setHomeWallpaperBusy(true)
    setHomeWallpaperError(false)
    try {
      await clearCustomHomeWallpaper()
    } catch {
      setHomeWallpaperError(true)
    } finally {
      setHomeWallpaperBusy(false)
    }
  }

  return (
    <div ref={containerRef} className="flex h-full flex-col gap-5 overflow-hidden px-8 pb-8 pt-[6.5rem]">
      <div className="flex shrink-0 items-center justify-center">
        <div
          data-navigation-layer="secondary"
          className="flex items-center gap-1 rounded-full border border-white/10 bg-black/25 p-1"
          aria-label={t('settings.page.label')}
        >
          <ControllerButtonHint
            button="leftTrigger"
            className="mx-1 rounded-md border border-white/15 px-1.5 py-0.5 text-[10px] font-bold text-muted"
          />
          {SETTINGS_PAGES.map((item) => {
            const Icon = item.icon
            const active = page === item.id
            return (
              <motion.button
                key={item.id}
                data-focusable
                data-settings-page={item.id}
                aria-pressed={active}
                aria-current={active ? 'page' : undefined}
                onClick={() => setPage(item.id)}
                animate={{ scale: active ? 1.025 : 1 }}
                whileHover={{ scale: 1.025 }}
                whileTap={{ scale: 0.97 }}
                className={`relative flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition-colors ${
                  active ? 'text-black' : 'text-muted hover:bg-white/10 hover:text-white'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="settings-page-active"
                    className="absolute inset-0 rounded-full bg-accent"
                    transition={{ type: 'spring', stiffness: 440, damping: 34 }}
                  />
                )}
                <Icon size={14} className="relative z-10" />
                <span className="relative z-10">{t(item.labelKey)}</span>
              </motion.button>
            )
          })}
          <ControllerButtonHint
            button="rightTrigger"
            className="mx-1 rounded-md border border-white/15 px-1.5 py-0.5 text-[10px] font-bold text-muted"
          />
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <AnimatePresence initial={false} mode="wait" custom={direction}>
          <motion.div
            key={page}
            custom={direction}
            variants={pageVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ type: 'spring', stiffness: 360, damping: 34, mass: 0.8 }}
            data-settings-scroll
            className="scrollbar-none absolute inset-0 overflow-y-auto overscroll-contain pb-[clamp(3rem,8vh,5rem)] pt-2"
            style={{ scrollPaddingBlock: 'clamp(1.5rem, 6vh, 4rem)' }}
          >
            <SettingsPageLead
              icon={activePage.icon}
              title={t(activePage.labelKey)}
              description={t(activePage.bodyKey)}
              index={activePageIndex + 1}
              total={SETTINGS_PAGES.length}
              highlights={pageHighlights}
              autoSaveLabel={t(
                page === 'updates' ? 'settings.updates.localCheck' : 'settings.autoSave'
              )}
            />

            {page === 'appearance' && (
              <div className="mt-5 space-y-5">
                <SettingsSection index="01" icon={UserRound} title={t('settings.avatar.title')}>
                  <ProfileAvatarPicker
                    selected={profileAvatar}
                    steamAvatarUrl={account?.avatarUrl}
                    customAvatarUrl={customAvatarUrl}
                    onChange={(value) => void setProfileAvatar(value)}
                    onSelectCustom={selectCustomAvatar}
                  />
                </SettingsSection>

                <SettingsSection index="02" icon={Palette} title={t('settings.theme.title')}>
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-7 xl:grid-cols-[repeat(13,minmax(0,1fr))]">
                    {THEME_OPTIONS.map((option) => (
                      <motion.button
                        key={option.id}
                        data-focusable
                        data-theme-choice
                        data-theme-option={option.id}
                        onClick={() => void setTheme(option.id)}
                        whileHover={{ y: -2, scale: 1.04 }}
                        whileTap={{ scale: 0.95 }}
                        aria-pressed={theme === option.id}
                        className="group flex min-w-0 flex-col items-center gap-1.5 rounded-2xl px-1 py-1.5 text-center"
                      >
                        <div
                          className={`theme-swatch-orb relative h-12 w-12 shrink-0 overflow-hidden rounded-full border bg-gradient-to-br transition-[border-color,box-shadow] ${themeSwatch[option.id]} ${
                            theme === option.id
                              ? 'border-white/80 shadow-[0_0_0_3px_rgb(var(--color-accent)/0.35),0_8px_24px_rgb(var(--color-accent)/0.25)]'
                              : 'border-white/15 shadow-[0_6px_18px_rgba(0,0,0,0.32)]'
                          }`}
                        >
                          <div className="absolute inset-[5px] rounded-full border border-white/15 bg-black/25 backdrop-blur-md" />
                          <div className="absolute bottom-2 left-2 h-2.5 w-5 rounded-full bg-white/20" />
                          <div className="absolute right-2 top-2 h-3 w-3 rounded-full bg-white/35" />
                          {theme === option.id && (
                            <div className="absolute inset-0 flex items-center justify-center text-white drop-shadow-lg">
                              <Check size={18} strokeWidth={3} />
                            </div>
                          )}
                        </div>
                        <span className={`w-full truncate text-[10px] font-semibold ${theme === option.id ? 'text-white' : 'text-white/60'}`}>
                          {option.label}
                        </span>
                        {option.id === 'midnight' && (
                          <span className="text-[8px] uppercase tracking-wider text-white/35">
                            {t('settings.default')}
                          </span>
                        )}
                      </motion.button>
                    ))}
                  </div>
                  <div className="mt-4 border-t border-white/[0.07] pt-4">
                    <SettingsToggle
                      id="homeCardBubbleEffect"
                      active={homeCardBubbleEffect}
                      title={t('settings.theme.bubbleCards')}
                      description={t('settings.theme.bubbleCardsBody')}
                      defaultActive
                      onChange={(active) => void setHomeCardBubbleEffect(active)}
                      t={t}
                    />
                  </div>
                </SettingsSection>

                <SettingsSection index="03" icon={ImageIcon} title={t('settings.wallpaper.title')}>
                  <OrbitWallpaperPanel />
                </SettingsSection>

                <SettingsSection index="04" icon={Film} title={t('settings.startup.title')}>
                  <p className="mb-4 max-w-3xl text-xs leading-relaxed text-muted">
                    {t('settings.startup.body')}
                  </p>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {STARTUP_ANIMATION_OPTIONS.map((option) => (
                      <PresentationChoice
                        key={option.id}
                        active={startupAnimationMode === option.id}
                        title={t(option.labelKey)}
                        description={t(option.bodyKey)}
                        onClick={() => void chooseStartupAnimationMode(option.id)}
                        preview={
                          option.id === 'orbit' ? (
                            <span className="relative h-9 w-12">
                              <span className="absolute inset-x-0 top-2 h-5 rounded-[50%] border border-accent/75 [transform:rotate(-12deg)]" />
                              <span className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-[0_0_12px_rgb(var(--color-accent)/0.8)]" />
                              <span className="absolute right-0 top-3 h-1.5 w-1.5 rounded-full bg-accent-2" />
                            </span>
                          ) : option.id === 'custom' ? (
                            <Film size={24} className="text-accent" />
                          ) : (
                            <EyeOff size={24} className="text-white/35" />
                          )
                        }
                      />
                    ))}
                  </div>

                  <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-white/[0.07] bg-black/20 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-white/80">
                        {t(
                          customStartupVideoUrl
                            ? 'settings.startup.customReady'
                            : 'settings.startup.customMissing'
                        )}
                      </p>
                      <p className="mt-1 text-[11px] leading-relaxed text-white/40">
                        {startupVideoError
                          ? t('settings.startup.error')
                          : t('settings.startup.customHint')}
                      </p>
                    </div>
                    <FocusableButton
                      variant="ghost"
                      disabled={startupVideoBusy}
                      aria-busy={startupVideoBusy}
                      onClick={() => void chooseCustomStartupVideo()}
                      className="shrink-0 disabled:cursor-wait disabled:opacity-50"
                    >
                      {startupVideoBusy
                        ? t('settings.startup.selecting')
                        : t(
                            customStartupVideoUrl
                              ? 'settings.startup.replace'
                              : 'settings.startup.choose'
                          )}
                    </FocusableButton>
                  </div>
                </SettingsSection>

                <SettingsSection index="05" icon={AppWindow} title={t('settings.dock.title')}>
                  <p className="mb-4 max-w-3xl text-xs leading-relaxed text-muted">
                    {t('settings.dock.body')}
                  </p>
                  <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
                    <PresentationGroup
                      eyebrow={t('settings.dock.theme.title')}
                      description={t('settings.dock.theme.body')}
                    >
                      {DOCK_THEME_OPTIONS.map((option) => (
                        <PresentationChoice
                          key={option.id}
                          active={dockTheme === option.id}
                          title={t(option.labelKey)}
                          description={t(option.bodyKey)}
                          badge={option.id === 'standard' ? t('settings.default') : undefined}
                          onClick={() => void setDockTheme(option.id)}
                          preview={<DockThemePreview theme={option.id} />}
                        />
                      ))}
                    </PresentationGroup>

                    <PresentationGroup
                      eyebrow={t('settings.dock.size.title')}
                      description={t('settings.dock.size.body')}
                    >
                      {DOCK_SIZE_OPTIONS.map((option) => (
                        <PresentationChoice
                          key={option.id}
                          active={dockSize === option.id}
                          title={t(option.labelKey)}
                          description={t(option.bodyKey)}
                          badge={option.id === 'standard' ? t('settings.default') : undefined}
                          onClick={() => void setDockSize(option.id)}
                          preview={<DockSizePreview size={option.id} />}
                        />
                      ))}
                    </PresentationGroup>

                    <PresentationGroup
                      eyebrow={t('settings.dock.motion.title')}
                      description={t('settings.dock.motion.body')}
                    >
                      {DOCK_MOTION_OPTIONS.map((option) => (
                        <PresentationChoice
                          key={option.id}
                          active={dockMotion === option.id}
                          title={t(option.labelKey)}
                          description={t(option.bodyKey)}
                          badge={option.id === 'standard' ? t('settings.default') : undefined}
                          onClick={() => void setDockMotion(option.id)}
                          preview={<DockMotionPreview motionMode={option.id} />}
                        />
                      ))}
                    </PresentationGroup>
                  </div>
                  <p className="mt-3 text-[10px] leading-relaxed text-white/35">
                    {t('settings.dock.reducedMotionHint')}
                  </p>
                </SettingsSection>

                <SettingsSection index="06" icon={Layers3} title={t('settings.presentation.title')}>
                  <p className="mb-4 max-w-3xl text-xs leading-relaxed text-muted">
                    {t('settings.presentation.body')}
                  </p>
                  <div className="grid grid-cols-1 gap-3 xl:grid-cols-2 2xl:grid-cols-3">
                    <PresentationGroup
                      eyebrow={t('settings.cardSize.title')}
                      description={t('settings.cardSize.body')}
                    >
                      {GAME_CARD_SIZE_OPTIONS.map((option) => (
                        <PresentationChoice
                          key={option}
                          active={gameCardSize === option}
                          title={t(GAME_CARD_SIZE_COPY[option].labelKey)}
                          description={t(GAME_CARD_SIZE_COPY[option].bodyKey)}
                          onClick={() => void setGameCardSize(option)}
                          preview={<CardSizePreview size={option} />}
                        />
                      ))}
                    </PresentationGroup>

                    <PresentationGroup
                      eyebrow={t('settings.backdrop.mode.title')}
                      description={t('settings.backdrop.mode.body')}
                    >
                      {HOME_BACKDROP_MODE_OPTIONS.map((option) => (
                        <PresentationChoice
                          key={option}
                          active={homeBackdropMode === option}
                          title={t(HOME_BACKDROP_MODE_COPY[option].labelKey)}
                          description={t(HOME_BACKDROP_MODE_COPY[option].bodyKey)}
                          onClick={() => void chooseHomeBackdropMode(option)}
                          preview={<BackdropModePreview mode={option} />}
                        />
                      ))}
                    </PresentationGroup>

                    <PresentationGroup
                      eyebrow={t('settings.backdrop.motion.title')}
                      description={t('settings.backdrop.motion.body')}
                    >
                      {HOME_BACKDROP_MOTION_OPTIONS.map((option) => (
                        <PresentationChoice
                          key={option}
                          active={homeBackdropMotion === option}
                          title={t(HOME_BACKDROP_MOTION_COPY[option].labelKey)}
                          description={t(HOME_BACKDROP_MOTION_COPY[option].bodyKey)}
                          onClick={() => void setHomeBackdropMotion(option)}
                          preview={<BackdropMotionPreview motionMode={option} />}
                        />
                      ))}
                    </PresentationGroup>

                    <PresentationGroup
                      eyebrow={t('settings.backdrop.title')}
                      description={t('settings.backdrop.body')}
                    >
                      {BACKDROP_INTENSITY_OPTIONS.map((option) => (
                        <PresentationChoice
                          key={option}
                          active={backdropIntensity === option}
                          title={t(BACKDROP_INTENSITY_COPY[option].labelKey)}
                          description={t(BACKDROP_INTENSITY_COPY[option].bodyKey)}
                          onClick={() => void setBackdropIntensity(option)}
                          preview={<BackdropPreview intensity={option} />}
                        />
                      ))}
                    </PresentationGroup>

                    <PresentationGroup
                      eyebrow={t('settings.density.title')}
                      description={t('settings.density.body')}
                    >
                      {DENSITY_OPTIONS.map((option) => (
                        <PresentationChoice
                          key={option.id}
                          active={uiDensity === option.id}
                          title={t(option.labelKey)}
                          description={t(
                            option.id === 'compact'
                              ? 'settings.density.compactBody'
                              : 'settings.density.standardBody'
                          )}
                          onClick={() => void setDensity(option.id)}
                          preview={<DensityPreview density={option.id} />}
                        />
                      ))}
                    </PresentationGroup>
                  </div>

                  <AnimatePresence initial={false}>
                    {homeBackdropMode === 'pinned' && (
                      <motion.div
                        key="pinned-backdrop-picker"
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                        className="mt-3 rounded-2xl border border-white/[0.07] bg-black/20 p-3"
                      >
                        <div className="mb-3 px-1">
                          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-accent">
                            {t('settings.backdrop.pinned.title')}
                          </p>
                          <p className="mt-1 text-[11px] leading-relaxed text-white/42">
                            {t('settings.backdrop.pinned.body')}
                          </p>
                        </div>

                        {pinnedBackdropGames.length > 0 ? (
                          <div className="scrollbar-none flex gap-2 overflow-x-auto px-1 pb-2 pt-1">
                            {pinnedBackdropGames.map((game) => {
                              const active = pinnedBackdropGameId === game.id
                              return (
                                <motion.button
                                  key={game.id}
                                  data-focusable
                                  data-pinned-backdrop-game={game.id}
                                  type="button"
                                  aria-pressed={active}
                                  aria-label={t('settings.backdrop.pinned.select', { name: game.name })}
                                  onClick={() => void setPinnedBackdropGameId(game.id)}
                                  whileHover={{ y: -2 }}
                                  whileFocus={{ y: -2 }}
                                  whileTap={{ scale: 0.985 }}
                                  className={`group relative h-24 w-44 shrink-0 overflow-hidden rounded-xl border text-left outline-none transition-colors ${
                                    active
                                      ? 'border-accent/80 shadow-[0_0_0_2px_rgb(var(--color-accent)/0.18)]'
                                      : 'border-white/10 hover:border-white/30'
                                  }`}
                                >
                                  <GameImage
                                    gameId={game.id}
                                    name={game.name}
                                    orientation="horizontal"
                                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.035] group-data-[focused=true]:scale-[1.035] motion-reduce:transition-none"
                                  />
                                  <span className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/12 to-black/10" />
                                  <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-2.5">
                                    <span className="min-w-0 truncate text-xs font-bold text-white">
                                      {game.name}
                                    </span>
                                    <span
                                      className={`h-2.5 w-2.5 shrink-0 rounded-full border ${
                                        active
                                          ? 'border-accent bg-accent shadow-[0_0_10px_rgb(var(--color-accent)/0.7)]'
                                          : 'border-white/35 bg-black/30'
                                      }`}
                                    />
                                  </span>
                                </motion.button>
                              )
                            })}
                          </div>
                        ) : (
                          <p className="rounded-xl border border-dashed border-white/10 px-4 py-5 text-sm text-muted">
                            {t('settings.backdrop.pinned.empty')}
                          </p>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <AnimatePresence initial={false}>
                    {homeBackdropMode === 'custom' && customHomeWallpaperUrl && (
                      <motion.div
                        key="custom-home-wallpaper-picker"
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                        className="mt-3 flex flex-col gap-3 rounded-2xl border border-white/[0.07] bg-black/20 p-3 md:flex-row md:items-center"
                      >
                        <div className="relative h-28 overflow-hidden rounded-xl border border-white/10 md:w-52 md:shrink-0">
                          <img
                            src={customHomeWallpaperUrl}
                            alt={t('settings.backdrop.custom.alt')}
                            draggable={false}
                            className="h-full w-full object-cover"
                          />
                          <span className="absolute inset-0 bg-gradient-to-t from-black/55 to-transparent" />
                          <ImageIcon
                            size={15}
                            className="absolute bottom-2.5 left-2.5 text-white/75"
                          />
                        </div>
                        <div className="min-w-0 flex-1 px-1">
                          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-accent">
                            {t('settings.backdrop.custom.title')}
                          </p>
                          <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-white/42">
                            {homeWallpaperError
                              ? t('settings.backdrop.custom.error')
                              : t('settings.backdrop.custom.body')}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <FocusableButton
                              type="button"
                              disabled={homeWallpaperBusy}
                              aria-busy={homeWallpaperBusy}
                              onClick={() => void chooseCustomHomeWallpaper()}
                              className="px-4 py-2 text-xs"
                            >
                              {homeWallpaperBusy
                                ? t('settings.backdrop.custom.preparing')
                                : t('settings.backdrop.custom.replace')}
                            </FocusableButton>
                            <FocusableButton
                              type="button"
                              variant="ghost"
                              disabled={homeWallpaperBusy}
                              onClick={() => void removeCustomHomeWallpaper()}
                              className="px-4 py-2 text-xs"
                            >
                              {t('settings.backdrop.custom.remove')}
                            </FocusableButton>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </SettingsSection>

                <SettingsSection index="07" icon={LayoutTemplate} title={t('settings.homeLayout.title')}>
                  <p className="mb-4 text-xs leading-relaxed text-muted">
                    {t('settings.homeLayout.body')}
                  </p>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
                    {HOME_LAYOUT_OPTIONS.map((option) => {
                      const active = homeLayout === option.id
                      return (
                        <motion.button
                          key={option.id}
                          data-focusable
                          type="button"
                          aria-pressed={active}
                          onClick={() => void setHomeLayout(option.id)}
                          whileHover={{ y: -2 }}
                          whileTap={{ scale: 0.985 }}
                          data-home-style-option={option.id}
                          className={`rounded-2xl border p-3 text-left transition-colors ${
                            active
                              ? 'border-accent/70 bg-accent/12'
                              : 'border-white/[0.07] bg-black/20 hover:bg-white/[0.05]'
                          }`}
                        >
                          <div className="mb-3 flex h-24 gap-2 overflow-hidden rounded-xl border border-white/[0.07] bg-black/45 p-3">
                            <HomeLayoutPreview layout={option.id} />
                          </div>
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-bold tracking-wide">{option.label}</p>
                              <p className="mt-1 text-xs leading-relaxed text-white/42">
                                {t(HOME_LAYOUT_BODY_KEYS[option.id])}
                              </p>
                            </div>
                            {option.id === 'orbit' && (
                              <span className="rounded-full bg-white/[0.07] px-2 py-1 text-[8px] font-bold uppercase tracking-wider text-white/40">
                                {t('settings.default')}
                              </span>
                            )}
                          </div>
                        </motion.button>
                      )
                    })}
                  </div>
                </SettingsSection>

              </div>
            )}

            {page === 'experience' && (
              <div className="mt-5 space-y-5">
                <SettingsSection index="01" icon={Eye} title={t('settings.visibility.title')}>
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    <SettingsToggle
                      id="showStoreTab"
                      active={showStoreTab}
                      title={t('settings.visibility.store')}
                      description={t('settings.visibility.storeBody', {
                        previous: controllerLabels.leftBumper,
                        next: controllerLabels.rightBumper
                      })}
                      defaultActive
                      onChange={(active) => void setShowStoreTab(active)}
                      t={t}
                    />
                    <SettingsToggle
                      id="showFriendsHub"
                      active={showFriendsHub}
                      title={t('settings.visibility.friends')}
                      description={t('settings.visibility.friendsBody', {
                        previous: controllerLabels.leftBumper,
                        next: controllerLabels.rightBumper
                      })}
                      defaultActive
                      onChange={(active) => void setShowFriendsHub(active)}
                      t={t}
                    />
                    <SettingsToggle
                      id="showHomeBanners"
                      active={showHomeBanners}
                      title={t('settings.visibility.homeBanners')}
                      description={t(
                        homeLayout !== 'orbit'
                          ? 'settings.visibility.homeBannersAlternative'
                          : 'settings.visibility.homeBannersBody'
                      )}
                      defaultActive
                      disabled={homeLayout !== 'orbit'}
                      onChange={(active) => void setShowHomeBanners(active)}
                      t={t}
                    />
                  </div>
                </SettingsSection>

                <SettingsSection index="02" icon={AudioLines} title={t('settings.audio.title')}>
                  <p className="mb-3 text-xs text-muted">{t('settings.audio.body')}</p>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-8">
                    {AUDIO_PRESET_OPTIONS.map((option, index) => {
                      const active = audioPreset === option.id
                      return (
                        <motion.button
                          key={option.id}
                          data-focusable
                          data-ui-sound-skip
                          type="button"
                          aria-pressed={active}
                          onClick={() => void setAudioPreset(option.id)}
                          whileHover={{ y: -2 }}
                          whileTap={{ scale: 0.97 }}
                          className={`min-w-0 rounded-2xl border p-3 text-left transition-colors ${
                            active
                              ? 'border-accent/70 bg-accent/15 text-white'
                              : 'border-white/[0.07] bg-white/[0.04] text-white/70 hover:bg-white/[0.07]'
                          }`}
                        >
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <span
                              className={`flex h-8 w-8 items-center justify-center rounded-full ${
                                active ? 'bg-accent text-black' : 'bg-white/[0.07] text-white/55'
                              }`}
                            >
                              <AudioLines size={15} />
                            </span>
                            {index === 0 && (
                              <span className="text-[8px] font-bold uppercase tracking-wider text-white/35">
                                {t('settings.default')}
                              </span>
                            )}
                          </div>
                          <span className="block truncate text-sm font-semibold">
                            {t(option.labelKey)}
                          </span>
                          <span className="mt-1 block line-clamp-2 text-[10px] leading-snug text-white/42">
                            {t(option.bodyKey)}
                          </span>
                        </motion.button>
                      )
                    })}
                  </div>
                </SettingsSection>

                <SettingsSection index="03" icon={BellRing} title={t('settings.notifications.title')}>
                  <div className="space-y-4">
                    <SettingsToggle
                      id="notificationsEnabled"
                      active={notificationsEnabled}
                      title={t('settings.notifications.enabled')}
                      description={t('settings.notifications.enabledBody')}
                      defaultActive
                      onChange={(active) => void setNotificationsEnabled(active)}
                      t={t}
                    />

                    <div className="grid gap-4 rounded-2xl border border-white/[0.06] bg-black/15 p-4 xl:grid-cols-2">
                      <div>
                        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-white/38">
                          {t('settings.notifications.position')}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {NOTIFICATION_POSITION_OPTIONS.map((option) => (
                            <OptionPill
                              key={option.id}
                              active={notificationPosition === option.id}
                              onClick={() => void setNotificationPosition(option.id)}
                            >
                              {t(option.labelKey)}
                            </OptionPill>
                          ))}
                        </div>
                      </div>

                      <div>
                        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-white/38">
                          {t('settings.notifications.motion')}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {NOTIFICATION_MOTION_OPTIONS.map((option) => (
                            <OptionPill
                              key={option.id}
                              active={notificationMotion === option.id}
                              onClick={() => void setNotificationMotion(option.id)}
                            >
                              {t(option.labelKey)}
                            </OptionPill>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="max-w-2xl text-xs leading-relaxed text-muted">
                        {t('settings.notifications.testBody')}
                      </p>
                      <FocusableButton
                        variant="ghost"
                        onClick={() =>
                          notify({
                            tone: 'price',
                            titleKey: 'notification.test.title',
                            messageKey: 'notification.test.body',
                            force: true,
                            replace: true
                          })
                        }
                        className="shrink-0"
                      >
                        <span className="flex items-center gap-2">
                          <BellRing size={14} />
                          {t('settings.notifications.test')}
                        </span>
                      </FocusableButton>
                    </div>
                  </div>
                </SettingsSection>

                <SettingsSection index="04" icon={SlidersHorizontal} title={t('settings.language.title')}>
                  <div className="flex gap-3">
                    {LANGUAGE_OPTIONS.map((option) => (
                      <OptionPill
                        key={option.id}
                        active={language === option.id}
                        onClick={() => void setLanguage(option.id)}
                      >
                        {option.label}
                      </OptionPill>
                    ))}
                  </div>
                </SettingsSection>

                <SettingsSection index="05" icon={Trophy} title={t('settings.integrations.title')}>
                  <div className="space-y-4">
                    <SettingsToggle
                      id="showAchievements"
                      active={showAchievements}
                      title={t('settings.integrations.achievements')}
                      description={t('settings.integrations.achievementsBody')}
                      defaultActive
                      onChange={(active) => void setShowAchievements(active)}
                      t={t}
                    />

                    <div>
                      <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-white/38">
                        {t('settings.integrations.syncMap')}
                      </p>
                      <div className="grid gap-2 lg:grid-cols-3">
                        <div className="rounded-2xl border border-emerald-300/15 bg-emerald-300/[0.055] p-3.5">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold text-white">Steam</p>
                            <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${account ? 'bg-emerald-300/10 text-emerald-200' : 'bg-white/[0.06] text-white/45'}`}>
                              {t(
                                account
                                  ? 'settings.integrations.automatic'
                                  : 'settings.integrations.notConnected'
                              )}
                            </span>
                          </div>
                          <p className="mt-2 text-xs leading-relaxed text-white/52">
                            {t('settings.integrations.steamBody', {
                              count: steamAchievementGameCount
                            })}
                          </p>
                        </div>

                        <div className="rounded-2xl border border-accent/15 bg-accent/[0.045] p-3.5">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold text-white">RetroAchievements</p>
                            <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${retroAchievementsConfigured ? 'bg-accent/10 text-accent' : 'bg-white/[0.06] text-white/45'}`}>
                              {t(
                                retroAchievementsConfigured
                                  ? 'settings.integrations.configured'
                                  : 'settings.integrations.notConfigured'
                              )}
                            </span>
                          </div>
                          <p className="mt-2 text-xs leading-relaxed text-white/52">
                            {t('settings.integrations.retroBody', {
                              count: retroAchievementGameCount
                            })}
                          </p>
                        </div>

                        <div className="rounded-2xl border border-white/[0.07] bg-black/15 p-3.5">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold text-white">
                              {t('settings.integrations.otherProviders')}
                            </p>
                            <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white/45">
                              {t('settings.integrations.notAvailable')}
                            </span>
                          </div>
                          <p className="mt-2 text-xs leading-relaxed text-white/52">
                            {t('settings.integrations.otherBody')}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-4 rounded-2xl border border-white/[0.07] bg-black/15 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                      <div className="min-w-0">
                        <p className="text-xs leading-relaxed text-white/55">
                          {t('settings.integrations.steamKeyBody')}
                        </p>
                        {settings ? (
                          <div className="mt-3">
                            <ApiKeyField
                              label={t('settings.integrations.steamApiKey')}
                              value=""
                              placeholder={t('settings.integrations.steamApiKeyPlaceholder')}
                              getKeyLabel={t('settings.integrations.getSteamApiKey')}
                              getKeyUrl="https://steamcommunity.com/dev/apikey"
                              configured={steamWebApiKeyConfigured}
                              configuredLabel={t('settings.integrations.steamApiKeyConfigured')}
                              notConfiguredLabel={t('settings.integrations.notConfigured')}
                              clearLabel={t('settings.integrations.clearSteamApiKey')}
                              onSave={async (value) => {
                                const status = await window.api.steam.credentials.set(value)
                                setSteamWebApiKeyConfigured(status.configured)
                              }}
                              onClear={async () => {
                                const status = await window.api.steam.credentials.clear()
                                setSteamWebApiKeyConfigured(status.configured)
                              }}
                            />
                          </div>
                        ) : (
                          <div className="mt-3 flex items-center gap-2 text-sm text-muted">
                            <Loader2 size={16} className="animate-spin" />
                            {t('settings.loading')}
                          </div>
                        )}
                      </div>

                      <div className="flex min-w-[12rem] flex-col items-stretch gap-2 lg:items-end">
                        <FocusableButton
                          variant="ghost"
                          disabled={
                            !showAchievements ||
                            achievementEligibleGameCount === 0 ||
                            achievementSync.state === 'running'
                          }
                          data-disabled={
                            !showAchievements ||
                            achievementEligibleGameCount === 0 ||
                            achievementSync.state === 'running'
                              ? 'true'
                              : undefined
                          }
                          onClick={() => void syncAchievementsNow()}
                        >
                          <span className="flex items-center gap-2">
                            <RefreshCw
                              size={14}
                              className={achievementSync.state === 'running' ? 'animate-spin' : ''}
                            />
                            {t(
                              achievementSync.state === 'running'
                                ? 'settings.integrations.syncing'
                                : 'settings.integrations.syncNow',
                              {
                                completed: achievementSync.completed,
                                total: achievementSync.total
                              }
                            )}
                          </span>
                        </FocusableButton>
                        <p className="max-w-xs text-right text-[10px] leading-relaxed text-white/38">
                          {achievementSyncError
                            ? t('settings.integrations.syncError')
                            : achievementSync.state === 'complete' && achievementSync.total > 0
                              ? t('settings.integrations.lastSync', {
                                  count: achievementSync.total
                                })
                              : t('settings.integrations.syncHint')}
                        </p>
                      </div>
                    </div>

                    <p className="flex items-start gap-2 text-xs leading-relaxed text-white/42">
                      <ShieldCheck size={14} className="mt-0.5 shrink-0 text-accent" />
                      {t('settings.integrations.privacy')}
                    </p>
                  </div>
                </SettingsSection>

                <SettingsSection index="06" icon={AppWindow} title={t('settings.launchBehavior.title')}>
                  <SettingsToggle
                    id="closeLaunchersAfterGame"
                    active={closeLaunchersAfterGame}
                    title={t('settings.launchBehavior.closeLaunchers')}
                    description={t('settings.launchBehavior.closeLaunchersBody')}
                    defaultInactive
                    onChange={(active) => void setCloseLaunchersAfterGame(active)}
                    t={t}
                  />
                </SettingsSection>
              </div>
            )}

            {page === 'libraries' && (
              <div className="mt-5 space-y-5">
                <SettingsSection index="01" icon={Grid3X3} title={t('settings.libraryGrid.title')}>
                  <p className="mb-4 max-w-3xl text-sm leading-relaxed text-muted">
                    {t('settings.libraryGrid.body')}
                  </p>
                  <div className="flex flex-wrap gap-3">
                    {LIBRARY_GRID_COLUMN_OPTIONS.map((columns) => (
                      <OptionPill
                        key={columns}
                        active={libraryGridColumns === columns}
                        onClick={() => void setLibraryGridColumns(columns)}
                      >
                        <span className="flex items-center gap-3">
                          <span className="flex gap-0.5" aria-hidden="true">
                            {Array.from({ length: columns }).map((_, index) => (
                              <span
                                key={index}
                                className="h-4 w-2 rounded-[2px] border border-current/20 bg-current/20"
                              />
                            ))}
                          </span>
                          {t('settings.libraryGrid.columns', { count: columns })}
                        </span>
                      </OptionPill>
                    ))}
                  </div>
                </SettingsSection>

                <SettingsSection index="02" icon={EyeOff} title={t('settings.excludedGames.title')}>
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <p className="max-w-3xl text-sm leading-relaxed text-muted">
                      {t('settings.excludedGames.body')}
                    </p>
                    <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-semibold text-white/55">
                      {t('settings.excludedGames.count', { count: excludedGames.length })}
                    </span>
                  </div>

                  {excludedGames.length === 0 ? (
                    <div
                      role="status"
                      className="flex min-h-24 items-center gap-3 rounded-xl2 border border-dashed border-white/10 bg-black/15 px-4 py-5 text-sm text-muted"
                    >
                      <EyeOff size={18} className="shrink-0 text-white/35" />
                      {t('settings.excludedGames.empty')}
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                        {visibleExcludedGames.map((game) => {
                          const restoring = restoringGameId === game.id
                          const failed = restoreErrorGameId === game.id
                          return (
                            <div
                              key={game.id}
                              className="flex min-w-0 items-center gap-3 rounded-xl2 border border-white/10 bg-black/20 p-2.5"
                            >
                              <div className="h-16 w-24 shrink-0 overflow-hidden rounded-xl bg-black/30">
                                <GameImage
                                  gameId={game.id}
                                  name={game.name}
                                  orientation="horizontal"
                                  className="h-full w-full object-cover"
                                />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold text-white/90">
                                  {game.name}
                                </p>
                                <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/35">
                                  {game.provider}
                                </p>
                              </div>
                              <FocusableButton
                                variant="ghost"
                                data-excluded-game-restore={game.id}
                                aria-disabled={restoring}
                                data-disabled={restoring ? 'true' : undefined}
                                aria-label={t('settings.excludedGames.restoreNamed', {
                                  name: game.name
                                })}
                                onClick={() => void restoreExcludedGame(game)}
                                className={`shrink-0 px-4 py-2 text-xs ${
                                  failed ? 'border-amber-200/25 text-amber-100' : ''
                                }`}
                              >
                                <span className="flex items-center gap-2" aria-live="polite">
                                  {restoring ? (
                                    <Loader2 size={14} className="animate-spin" />
                                  ) : (
                                    <Undo2 size={14} />
                                  )}
                                  {t(
                                    restoring
                                      ? 'settings.excludedGames.restoring'
                                      : failed
                                        ? 'settings.excludedGames.retry'
                                        : 'settings.excludedGames.restore'
                                  )}
                                </span>
                              </FocusableButton>
                            </div>
                          )
                        })}
                      </div>

                      {visibleExcludedGames.length < excludedGames.length && (
                        <div className="mt-4 flex justify-center">
                          <FocusableButton
                            variant="ghost"
                            onClick={() => setExcludedRenderLimit((current) => current + 40)}
                            className="px-5 py-2 text-xs"
                          >
                            {t('settings.excludedGames.showMore', {
                              count: Math.min(40, excludedGames.length - visibleExcludedGames.length)
                            })}
                          </FocusableButton>
                        </div>
                      )}
                    </>
                  )}
                </SettingsSection>

                <SettingsSection index="03" icon={LibraryBig} title={t('settings.account.title')}>
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
                    <p className="max-w-3xl text-xs leading-relaxed text-muted">
                      {t('settings.libraryStatus.body')}
                    </p>
                    <FocusableButton
                      variant="ghost"
                      aria-disabled={isRefreshingLibrary}
                      data-disabled={isRefreshingLibrary ? 'true' : undefined}
                      onClick={() => {
                        if (!isRefreshingLibrary) void refreshLibrary()
                      }}
                      className={`shrink-0 ${
                        isRefreshingLibrary ? 'cursor-wait opacity-50' : ''
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <RefreshCw
                          size={14}
                          className={isRefreshingLibrary ? 'animate-spin' : ''}
                        />
                        {t(
                          isRefreshingLibrary
                            ? 'settings.libraryStatus.refreshing'
                            : 'settings.libraryStatus.refresh'
                        )}
                      </span>
                    </FocusableButton>
                  </div>
                  <div className="grid grid-cols-1 gap-3 xl:grid-cols-2 2xl:grid-cols-3">
                    <LibraryProviderCard
                      store="Steam"
                      badge="S"
                      badgeClass="bg-[#1b2838]"
                      status={steamLibraryStatus}
                      description={
                        account
                          ? t('settings.account.connectedName', { name: account.accountName })
                          : steamStatus.state === 'error'
                            ? t('settings.account.connectionFailed')
                            : t('settings.account.notConnected')
                      }
                      connected={Boolean(account)}
                      waiting={steamStatus.state === 'waiting-for-browser'}
                      error={steamStatus.state === 'error'}
                      connectLabel={t(
                        steamStatus.state === 'waiting-for-browser'
                          ? 'settings.account.connecting'
                          : steamStatus.state === 'error'
                            ? 'settings.account.retry'
                            : 'settings.account.connectSteam'
                      )}
                      signOutLabel={t('settings.account.signOut')}
                      onConnect={() => void startSteamLogin()}
                      onLogout={() => void logout()}
                      language={language}
                      t={t}
                    />
                    <LibraryProviderCard
                      store="Epic Games"
                      badge="E"
                      badgeClass="bg-[#2a2a2a]"
                      status={epicLibraryStatus}
                      description={
                        epicAccount
                          ? t('settings.account.connectedName', { name: epicAccount.displayName })
                          : epicStatus.state === 'error'
                            ? t('settings.account.connectionFailed')
                            : t('settings.account.epicNotConnected')
                      }
                      connected={Boolean(epicAccount)}
                      waiting={epicStatus.state === 'waiting-for-browser'}
                      error={epicStatus.state === 'error'}
                      connectLabel={t(
                        epicStatus.state === 'waiting-for-browser'
                          ? 'settings.account.connecting'
                          : epicStatus.state === 'error'
                            ? 'settings.account.retry'
                            : 'settings.account.connectEpic'
                      )}
                      signOutLabel={t('settings.account.signOut')}
                      onConnect={() => void startEpicLogin()}
                      onLogout={() => void logoutEpic()}
                      language={language}
                      t={t}
                    />
                    <LibraryProviderCard
                      store={t('settings.account.xboxTitle')}
                      badge="X"
                      badgeClass="bg-[#107c10]"
                      status={xboxLibraryStatus}
                      description={t('settings.libraryStatus.xboxAutomatic')}
                      connected
                      automatic
                      waiting={false}
                      error={false}
                      connectLabel=""
                      signOutLabel=""
                      language={language}
                      t={t}
                    />
                    <LibraryProviderCard
                      store="GOG"
                      badge="G"
                      badgeClass="bg-gradient-to-br from-[#8637d5] to-[#4d1d91]"
                      status={gogLibraryStatus}
                      description={t('settings.libraryStatus.gogAutomatic')}
                      connected
                      automatic
                      waiting={false}
                      error={gogLibraryStatus.state === 'error'}
                      connectLabel=""
                      signOutLabel=""
                      language={language}
                      t={t}
                    />
                    <LibraryProviderCard
                      store="PlayStation"
                      badge="P"
                      badgeClass="bg-[#006fcd]"
                      status={playStationLibraryStatus}
                      description={
                        playStationAccount
                          ? t('settings.account.connectedName', {
                              name: playStationAccount.onlineId
                            })
                          : playStationStatus.state === 'error'
                            ? t('settings.account.playstationConnectionFailed')
                            : t('settings.account.playstationNotConnected')
                      }
                      connected={Boolean(playStationAccount)}
                      waiting={playStationStatus.state === 'waiting-for-browser'}
                      error={playStationStatus.state === 'error'}
                      connectLabel={t(
                        playStationStatus.state === 'waiting-for-browser'
                          ? 'settings.account.connecting'
                          : playStationStatus.state === 'error'
                            ? 'settings.account.retry'
                            : 'settings.account.connectPlayStation'
                      )}
                      signOutLabel={t('settings.account.signOut')}
                      onConnect={() => void startPlayStationLogin()}
                      onLogout={() => void logoutPlayStation()}
                      language={language}
                      t={t}
                    />
                    <LibraryProviderCard
                      store="EA app"
                      badge="EA"
                      badgeClass="bg-[#ff4747]"
                      status={eaLibraryStatus}
                      description={t('settings.libraryStatus.eaAutomatic')}
                      connected
                      automatic
                      waiting={false}
                      error={eaLibraryStatus.state === 'error'}
                      connectLabel=""
                      signOutLabel=""
                      language={language}
                      t={t}
                    />
                    <LibraryProviderCard
                      store="Ubisoft Connect"
                      badge="U"
                      badgeClass="bg-gradient-to-br from-[#008de5] to-[#0050a5]"
                      status={ubisoftLibraryStatus}
                      description={t('settings.libraryStatus.ubisoftAutomatic')}
                      connected
                      automatic
                      waiting={false}
                      error={ubisoftLibraryStatus.state === 'error'}
                      connectLabel=""
                      signOutLabel=""
                      language={language}
                      t={t}
                    />
                    <LibraryProviderCard
                      store="Retro"
                      badge="R"
                      badgeClass="bg-gradient-to-br from-[#ff7a18] to-[#af002d]"
                      status={retroLibraryStatus}
                      description={t('settings.libraryStatus.retroAutomatic')}
                      connected
                      automatic
                      waiting={false}
                      error={retroLibraryStatus.state === 'error'}
                      connectLabel=""
                      signOutLabel=""
                      language={language}
                      t={t}
                    />
                  </div>
                  <PlayStationRemotePlayPanel
                    remotePlay={remotePlayStatus}
                    preference={settings?.playstationRemotePlayPreference ?? 'auto'}
                    saving={remotePlaySaving}
                    onPreference={(preference) => void updateRemotePlayPreference(preference)}
                    onRefresh={() => void refreshRemotePlay()}
                    t={t}
                  />
                </SettingsSection>

                <SettingsSection
                  index="04"
                  icon={Trophy}
                  title={t('settings.retroAchievements.title')}
                >
                  <p className="mb-4 max-w-4xl text-sm leading-relaxed text-muted">
                    {t('settings.retroAchievements.body')}
                  </p>
                  {settings ? (
                    <div className="space-y-4">
                      <label className="block max-w-2xl">
                        <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-muted">
                          {t('settings.retroAchievements.username')}
                        </span>
                        <div className="flex flex-col gap-3 sm:flex-row">
                          <input
                            data-focusable="true"
                            value={retroAchievementsUsername}
                            onChange={(event) => {
                              setRetroAchievementsUsername(event.target.value)
                              setRetroAchievementsSaveState('idle')
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') void saveRetroAchievementsUsername()
                            }}
                            placeholder={t('settings.retroAchievements.usernamePlaceholder')}
                            autoComplete="username"
                            className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition focus:border-accent/60 focus:ring-2 focus:ring-accent/20"
                          />
                          <FocusableButton
                            variant="ghost"
                            aria-disabled={retroAchievementsSaveState === 'saving'}
                            data-disabled={
                              retroAchievementsSaveState === 'saving' ? 'true' : undefined
                            }
                            onClick={() => void saveRetroAchievementsUsername()}
                          >
                            <span className="flex items-center gap-2">
                              {retroAchievementsSaveState === 'saving' ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : retroAchievementsSaveState === 'saved' ? (
                                <Check size={14} />
                              ) : retroAchievementsSaveState === 'error' ? (
                                <CircleAlert size={14} />
                              ) : null}
                              {t(
                                retroAchievementsSaveState === 'saving'
                                  ? 'settings.saving'
                                  : retroAchievementsSaveState === 'saved'
                                    ? 'settings.images.saved'
                                    : retroAchievementsSaveState === 'error'
                                      ? 'settings.saveFailed'
                                      : 'settings.retroAchievements.save'
                              )}
                            </span>
                          </FocusableButton>
                        </div>
                      </label>
                      <ApiKeyField
                        label={t('settings.retroAchievements.apiKeyLabel')}
                        value=""
                        placeholder={t('settings.retroAchievements.apiKeyPlaceholder')}
                        getKeyLabel={t('settings.retroAchievements.getKey')}
                        getKeyUrl="https://retroachievements.org/controlpanel.php"
                        configured={retroAchievementsApiKeyConfigured}
                        configuredLabel={t('settings.retroAchievements.apiKeyConfigured')}
                        notConfiguredLabel={t('settings.retroAchievements.apiKeyNotConfigured')}
                        clearLabel={t('settings.retroAchievements.clearApiKey')}
                        onSave={async (value) => {
                          const status = await window.api.retroAchievements.credentials.set(value)
                          setRetroAchievementsApiKeyConfigured(status.configured)
                        }}
                        onClear={async () => {
                          const status = await window.api.retroAchievements.credentials.clear()
                          setRetroAchievementsApiKeyConfigured(status.configured)
                        }}
                      />
                      <div className="flex items-start gap-3 rounded-2xl border border-amber-300/15 bg-amber-300/[0.05] px-4 py-3 text-xs leading-relaxed text-amber-100/80">
                        <CircleAlert size={15} className="mt-0.5 shrink-0" />
                        <span>{t('settings.retroAchievements.emulatorNote')}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-muted">
                      <Loader2 size={16} className="animate-spin" />
                      {t('settings.loading')}
                    </div>
                  )}
                </SettingsSection>

                <SettingsSection index="05" icon={Globe2} title={t('settings.storeRegion.title')}>
                  <p className="mb-4 text-sm text-muted">{t('settings.storeRegion.body')}</p>
                  <div className="flex flex-wrap gap-3">
                    {STORE_REGION_OPTIONS.map((option) => (
                      <OptionPill
                        key={option.id}
                        active={(settings?.storeRegion ?? 'eu') === option.id}
                        disabled={!settings || regionSaveState === 'saving'}
                        onClick={() => void updateStoreRegion(option.id)}
                      >
                        {t(option.labelKey)}
                      </OptionPill>
                    ))}
                    {regionSaveState === 'saving' && (
                      <span className="flex items-center gap-2 px-2 text-xs text-muted">
                        <Loader2 size={13} className="animate-spin" />
                        {t('settings.saving')}
                      </span>
                    )}
                    {regionSaveState === 'error' && (
                      <span className="flex items-center gap-2 px-2 text-xs text-amber-300">
                        <CircleAlert size={13} />
                        {t('settings.saveFailed')}
                      </span>
                    )}
                  </div>
                </SettingsSection>

                <SettingsSection index="06" icon={ImageIcon} title={t('settings.images.title')}>
                  <p className="mb-4 max-w-4xl text-sm leading-relaxed text-muted">
                    {t('settings.images.body')}
                  </p>
                  {settings ? (
                    <>
                      <ApiKeyField
                        label={t('settings.images.apiKeyLabel')}
                        value=""
                        placeholder={t('settings.images.apiKeyPlaceholder')}
                        getKeyLabel={t('settings.images.getKey')}
                        getKeyUrl="https://www.steamgriddb.com/profile/preferences/api"
                        configured={
                          steamGridDbTokenStatus
                            ? steamGridDbTokenStatus.state !== 'not-configured'
                            : undefined
                        }
                        configuredLabel={t('settings.images.apiKeyConfigured')}
                        notConfiguredLabel={t('settings.images.token.notConfigured')}
                        clearLabel={t('settings.images.clearApiKey')}
                        onSave={async (value) => {
                          setSteamGridDbTokenStatus(await window.api.image.setToken(value))
                        }}
                        onClear={async () => {
                          setSteamGridDbTokenStatus(await window.api.image.clearToken())
                        }}
                      />
                      <div className="mt-5 grid grid-cols-1 gap-3 xl:grid-cols-2">
                        <div className="rounded-2xl border border-white/[0.07] bg-black/25 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-white/70">
                                <ShieldCheck size={14} className="text-accent" />
                                {t('settings.images.token.title')}
                              </p>
                              <p
                                className={`mt-2 flex items-center gap-2 text-sm font-semibold ${steamGridDbTokenClass(
                                  steamGridDbTokenStatus?.state,
                                  steamGridDbTokenChecking
                                )}`}
                                role="status"
                                aria-live="polite"
                              >
                                {steamGridDbTokenChecking && (
                                  <Loader2 size={14} className="animate-spin" />
                                )}
                                {steamGridDbTokenChecking
                                  ? t('settings.images.token.checking')
                                  : t(
                                      STEAM_GRID_DB_TOKEN_STATE_KEYS[
                                        steamGridDbTokenStatus?.state ?? 'not-configured'
                                      ]
                                    )}
                              </p>
                            </div>
                            <FocusableButton
                              variant="ghost"
                              disabled={steamGridDbTokenChecking}
                              data-disabled={steamGridDbTokenChecking ? 'true' : undefined}
                              onClick={() => void refreshSteamGridDbTokenStatus()}
                              className="shrink-0 px-3 py-2 text-[11px] disabled:opacity-45"
                            >
                              <span className="flex items-center gap-2">
                                <RefreshCw
                                  size={13}
                                  className={steamGridDbTokenChecking ? 'animate-spin' : ''}
                                />
                                {t('settings.images.token.check')}
                              </span>
                            </FocusableButton>
                          </div>
                          {steamGridDbTokenStatus?.state !== 'not-configured' &&
                            steamGridDbTokenStatus && (
                              <div className="mt-3 space-y-1 border-t border-white/[0.06] pt-3 text-[11px] text-white/45">
                                <p>
                                  {steamGridDbTokenStatus.expiresAt
                                    ? t('settings.images.token.expiresAt', {
                                        date: formatArtworkTimestamp(
                                          steamGridDbTokenStatus.expiresAt,
                                          language
                                        )
                                      })
                                    : t('settings.images.token.noExpiry')}
                                </p>
                                {steamGridDbTokenStatus.checkedAt && (
                                  <p>
                                    {t('settings.images.token.checkedAt', {
                                      date: formatArtworkTimestamp(
                                        steamGridDbTokenStatus.checkedAt,
                                        language
                                      )
                                    })}
                                  </p>
                                )}
                              </div>
                            )}
                        </div>

                        <div className="rounded-2xl border border-white/[0.07] bg-black/25 p-4">
                          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-white/70">
                            <Database size={14} className="text-accent" />
                            {t('settings.images.maintenance.title')}
                          </p>
                          <p className="mt-2 text-xs leading-relaxed text-muted">
                            {t('settings.images.maintenance.body')}
                          </p>
                          <div className="mt-4 flex flex-wrap gap-3">
                            <FocusableButton
                              variant="ghost"
                              disabled={artworkMaintenanceAction !== null}
                              data-disabled={
                                artworkMaintenanceAction !== null ? 'true' : undefined
                              }
                              onClick={() => void maintainArtwork('clear')}
                              className="disabled:opacity-45"
                            >
                              <span className="flex items-center gap-2">
                                {artworkMaintenanceAction === 'clear' ? (
                                  <Loader2 size={14} className="animate-spin" />
                                ) : (
                                  <Trash2 size={14} />
                                )}
                                {t(
                                  artworkMaintenanceAction === 'clear'
                                    ? 'settings.images.maintenance.clearing'
                                    : 'settings.images.maintenance.clear'
                                )}
                              </span>
                            </FocusableButton>
                            <FocusableButton
                              disabled={artworkMaintenanceAction !== null}
                              data-disabled={
                                artworkMaintenanceAction !== null ? 'true' : undefined
                              }
                              onClick={() => void maintainArtwork('reload')}
                              className="disabled:opacity-45"
                            >
                              <span className="flex items-center gap-2">
                                <RefreshCw
                                  size={14}
                                  className={
                                    artworkMaintenanceAction === 'reload' ||
                                    artworkSync.state === 'running'
                                      ? 'animate-spin'
                                      : ''
                                  }
                                />
                                {t(
                                  artworkMaintenanceAction === 'reload'
                                    ? 'settings.images.maintenance.reloading'
                                    : 'settings.images.maintenance.reload'
                                )}
                              </span>
                            </FocusableButton>
                          </div>
                          <div className="mt-3 text-[11px] leading-relaxed" aria-live="polite">
                            {artworkSync.state === 'running' && artworkSync.total > 0 ? (
                              <p className="text-accent">
                                {t('settings.images.maintenance.progress', {
                                  completed: artworkSync.completed,
                                  total: artworkSync.total
                                })}
                              </p>
                            ) : artworkMaintenanceError ? (
                              <p className="flex items-center gap-2 text-amber-300">
                                <CircleAlert size={12} />
                                {t('settings.images.maintenance.error')}
                              </p>
                            ) : artworkMaintenanceResult ? (
                              <p className="flex items-center gap-2 text-emerald-300">
                                <Check size={12} />
                                {t(
                                  artworkMaintenanceResult.queuedAssets > 0
                                    ? 'settings.images.maintenance.reloadResult'
                                    : 'settings.images.maintenance.clearResult',
                                  {
                                    count: artworkMaintenanceResult.clearedFiles,
                                    size: formatArtworkCacheSize(
                                      artworkMaintenanceResult.freedBytes,
                                      language
                                    ),
                                    total: artworkMaintenanceResult.queuedAssets
                                  }
                                )}
                              </p>
                            ) : (
                              <p className="text-white/40">
                                {t('settings.images.maintenance.preserve')}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-muted">
                      <Loader2 size={16} className="animate-spin" />
                      {t('settings.loading')}
                    </div>
                  )}
                </SettingsSection>
              </div>
            )}

            {page === 'hardware' && (
              <div className="mt-5 space-y-5">
                <SettingsSection
                  index="01"
                  icon={ShieldCheck}
                  title={t('settings.backgroundService.title')}
                >
                  <OrbitBackgroundServicePanel />
                </SettingsSection>
                <SettingsSection
                  index="02"
                  icon={Gamepad2}
                  title={t('settings.hardwareControl.title')}
                >
                  <HardwareControlPanel />
                </SettingsSection>
              </div>
            )}

            {page === 'updates' && (
              <div className="mt-5 space-y-5">
                <OrbitUpdatesPanel
                  snapshot={appUpdateSnapshot}
                  language={language}
                  onCheck={() => void checkAppUpdate()}
                  onDownload={() => void downloadAppUpdate()}
                  onInstall={() => void installAppUpdate()}
                  onDefer={() => void deferAppUpdate()}
                  onAutoDownloadChange={(active) => {
                    void window.api.settings.set({ appUpdateAutoDownload: active }).then(setSettings)
                  }}
                />
                <SystemUpdatesPanel
                  snapshot={updateSnapshot}
                  checkState={updateCheckState}
                  language={language}
                  onCheck={() => void checkSystemUpdates()}
                />
              </div>
            )}

            {page === 'system' && (
              <div className="mt-5 space-y-5">
                <SettingsSection index="01" icon={RotateCcw} title={t('settings.onboarding.title')}>
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <p className="max-w-3xl text-sm leading-relaxed text-muted">
                      {t('settings.onboarding.body')}
                    </p>
                    <FocusableButton
                      variant="ghost"
                      onClick={() => {
                        void window.api.settings
                          .set({ hasCompletedOnboarding: false })
                          .then(() => {
                            setOnboardingStep('welcome')
                            setPhase('onboarding')
                          })
                      }}
                      className="shrink-0"
                    >
                      <span className="flex items-center gap-2">
                        <RotateCcw size={14} />
                        {t('settings.onboarding.action')}
                      </span>
                    </FocusableButton>
                  </div>
                </SettingsSection>

                <SettingsSection index="02" icon={AppWindow} title={t('settings.about.title')}>
                  <p className="text-sm text-muted">
                    {t('settings.about.version', { version: version || '—' })}
                  </p>
                </SettingsSection>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

function appUpdateStatusKey(snapshot: AppUpdateSnapshot): TranslationKey {
  if (snapshot.installScheduled) return 'appUpdate.status.scheduled'
  const keys: Record<AppUpdateSnapshot['stage'], TranslationKey> = {
    unsupported: 'appUpdate.status.unsupported',
    idle: 'appUpdate.status.idle',
    checking: 'appUpdate.status.checking',
    'up-to-date': 'appUpdate.status.upToDate',
    available: 'appUpdate.status.available',
    downloading: 'appUpdate.status.downloadingShort',
    verifying: 'appUpdate.status.verifying',
    ready: 'appUpdate.status.readyShort',
    installing: 'appUpdate.status.installing',
    error: 'appUpdate.status.error'
  }
  return keys[snapshot.stage]
}

function OrbitUpdatesPanel({
  snapshot,
  language,
  onCheck,
  onDownload,
  onInstall,
  onDefer,
  onAutoDownloadChange
}: {
  snapshot: AppUpdateSnapshot
  language: 'en' | 'de'
  onCheck: () => void
  onDownload: () => void
  onInstall: () => void
  onDefer: () => void
  onAutoDownloadChange: (active: boolean) => void
}): JSX.Element {
  const t = useT()
  const checking = snapshot.stage === 'checking'
  const available = snapshot.stage === 'available'
  const downloading = snapshot.stage === 'downloading'
  const verifying = snapshot.stage === 'verifying'
  const ready = snapshot.stage === 'ready'
  const unsupported = snapshot.stage === 'unsupported'
  const canCheck =
    !checking &&
    !available &&
    !downloading &&
    !verifying &&
    !ready &&
    snapshot.stage !== 'installing' &&
    !unsupported
  let statusText: string
  if (snapshot.installedVersion) {
    statusText = t('appUpdate.settings.installed', { version: snapshot.installedVersion })
  } else if (snapshot.stage === 'error') {
    statusText = t(`appUpdate.error.${snapshot.error ?? 'download-failed'}` as TranslationKey)
  } else if (ready && snapshot.installScheduled) {
    statusText = t(
      snapshot.installCountdownEndsAt
        ? 'appUpdate.settings.installStarting'
        : 'appUpdate.settings.installScheduled'
    )
  } else if (ready && snapshot.blockedReason === 'game-active') {
    statusText = t('appUpdate.settings.readyDuringGame')
  } else if (ready) {
    statusText = t('appUpdate.settings.ready', { version: snapshot.targetVersion ?? '' })
  } else if (verifying) {
    statusText = t('appUpdate.settings.verifying')
  } else if (downloading && snapshot.downloadPausedReason === 'game-active') {
    statusText = t('appUpdate.settings.pausedForGame')
  } else if (downloading && snapshot.downloadPausedReason === 'launcher-download-active') {
    statusText = t('appUpdate.settings.pausedForLauncher')
  } else if (downloading) {
    statusText = t('appUpdate.settings.preparing', {
      version: snapshot.targetVersion ?? '',
      percent: Math.round(snapshot.percent ?? 0)
    })
  } else if (available) {
    statusText = t('appUpdate.settings.available', { version: snapshot.targetVersion ?? '' })
  } else {
    statusText = t(appUpdateStatusKey(snapshot))
  }

  return (
    <SettingsSection index="01" icon={DownloadCloud} title={t('appUpdate.settings.title')}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <p className="text-sm leading-relaxed text-muted">{t('appUpdate.settings.body')}</p>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white/35">
            <span>
              {t('appUpdate.settings.currentVersion', { version: snapshot.currentVersion })}
            </span>
            {snapshot.targetVersion && (
              <span className="text-accent/80">
                {t('appUpdate.settings.targetVersion', { version: snapshot.targetVersion })}
              </span>
            )}
            <span>
              {snapshot.checkedAt
                ? t('appUpdate.settings.lastChecked', {
                    date: formatUpdateDate(snapshot.checkedAt, language, true)
                  })
                : t('appUpdate.settings.neverChecked')}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {snapshot.releasePageUrl && (
            <FocusableButton
              variant="ghost"
              onClick={() => void window.api.app.openExternal(snapshot.releasePageUrl!)}
              className="shrink-0"
            >
              <span className="flex items-center gap-2">
                <ExternalLink size={14} />
                {t('appUpdate.action.details')}
              </span>
            </FocusableButton>
          )}
          <FocusableButton
            variant="ghost"
            disabled={!canCheck}
            onClick={onCheck}
            className="shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="flex items-center gap-2">
              <RefreshCw size={14} className={checking ? 'animate-spin' : ''} />
              {t(checking ? 'appUpdate.action.checking' : 'appUpdate.action.check')}
            </span>
          </FocusableButton>
          {ready && snapshot.installScheduled && (
            <FocusableButton variant="ghost" onClick={onDefer} className="shrink-0">
              {t('appUpdate.action.cancel')}
            </FocusableButton>
          )}
          {available && (
            <FocusableButton onClick={onDownload} className="shrink-0">
              <span className="flex items-center gap-2">
                <Download size={14} />
                {t('appUpdate.action.download')}
              </span>
            </FocusableButton>
          )}
          {ready && !snapshot.installScheduled && (
            <FocusableButton onClick={onInstall} className="shrink-0">
              <span className="flex items-center gap-2">
                <Download size={14} />
                {t(
                  snapshot.blockedReason === 'game-active'
                    ? 'appUpdate.action.afterGame'
                    : 'appUpdate.action.install'
                )}
              </span>
            </FocusableButton>
          )}
        </div>
      </div>

      <div className="mt-4">
        <UpdateMessage
          icon={
            checking || downloading || verifying
              ? 'loading'
              : snapshot.stage === 'error'
                ? 'error'
                : snapshot.stage === 'up-to-date' || ready || Boolean(snapshot.installedVersion)
                  ? 'success'
                  : 'idle'
          }
          text={statusText}
        />
      </div>

      {downloading && (
        <div className="mt-3 rounded-xl border border-white/[0.07] bg-black/20 px-4 py-3">
          <div className="mb-2 flex items-center justify-between gap-4 text-[10px] font-bold uppercase tracking-wide text-white/42">
            <span>{t('appUpdate.settings.backgroundDownload')}</span>
            <span>{Math.round(snapshot.percent ?? 0)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
            <motion.div
              initial={false}
              animate={{ width: `${Math.max(1, snapshot.percent ?? 0)}%` }}
              className="h-full rounded-full bg-accent shadow-[0_0_14px_rgb(var(--color-accent)/0.45)]"
            />
          </div>
        </div>
      )}

      <div className="mt-4 border-t border-white/[0.06] pt-4">
        <SettingsToggle
          id="appUpdateAutoDownload"
          active={snapshot.autoDownloadEnabled}
          title={t('appUpdate.settings.autoDownloadTitle')}
          description={t('appUpdate.settings.autoDownloadBody')}
          defaultActive
          disabled={unsupported}
          onChange={onAutoDownloadChange}
          t={t}
        />
      </div>

      <details className="mt-4 rounded-xl border border-white/[0.07] bg-black/15 px-4 py-3 text-xs text-white/45">
        <summary data-focusable className="cursor-pointer font-semibold text-white/65">
          {t('appUpdate.settings.technicalDetails')}
        </summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <span>{t('appUpdate.settings.source')}</span>
          <span>
            {t('appUpdate.settings.channel', {
              channel: t(`appUpdate.channel.${snapshot.channel}` as TranslationKey)
            })}
          </span>
          <span>
            {snapshot.automaticChecksEnabled
              ? t('appUpdate.settings.interval', { hours: snapshot.checkIntervalHours })
              : t('appUpdate.settings.automaticChecksInactive')}
          </span>
          <span>
            {snapshot.automaticChecksEnabled && snapshot.nextCheckAt
              ? t('appUpdate.settings.nextCheck', {
                  date: formatUpdateDate(snapshot.nextCheckAt, language, true)
                })
              : snapshot.automaticChecksEnabled
                ? t('appUpdate.settings.nextCheckPending')
                : t('appUpdate.settings.releaseOnly')}
          </span>
          <span>{t(`appUpdate.verification.${snapshot.verification}` as TranslationKey)}</span>
          <span>{t(`appUpdate.mode.${snapshot.installMode}` as TranslationKey)}</span>
        </div>
        {snapshot.releaseNotes && (
          <p className="mt-3 whitespace-pre-line border-t border-white/[0.06] pt-3 leading-relaxed">
            {snapshot.releaseNotes}
          </p>
        )}
      </details>

      <div className="mt-4 flex items-start gap-3 text-xs leading-relaxed text-white/38">
        <ShieldCheck size={15} className="mt-0.5 shrink-0 text-emerald-300/70" />
        <span>{t('appUpdate.settings.security')}</span>
      </div>
    </SettingsSection>
  )
}

function SystemUpdatesPanel({
  snapshot,
  checkState,
  language,
  onCheck
}: {
  snapshot: SystemUpdateSnapshot | null
  checkState: 'idle' | 'checking' | 'error'
  language: 'en' | 'de'
  onCheck: () => void
}): JSX.Element {
  const t = useT()
  const checking = checkState === 'checking'
  const requestFailed = checkState === 'error'
  const scanUnavailable = Boolean(snapshot?.errors.updateScan)
  const vendorLinks = Array.from(
    new Set(
      (snapshot?.graphicsAdapters ?? [])
        .map((adapter) => adapter.vendor)
        .filter((vendor) => Boolean(GRAPHICS_VENDOR_URLS[vendor]))
    )
  )

  return (
    <div className="space-y-5">
      {snapshot?.platform === 'unsupported' && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-300/20 bg-amber-300/[0.07] px-4 py-3 text-sm text-amber-100">
          <CircleAlert size={17} className="shrink-0" />
          {t('settings.updates.unsupported')}
        </div>
      )}

      {snapshot?.state === 'partial' && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-300/20 bg-amber-300/[0.07] px-4 py-3 text-sm text-amber-100">
          <CircleAlert size={17} className="shrink-0" />
          {t('settings.updates.partial')}
        </div>
      )}

      {requestFailed && (
        <div className="flex items-center gap-3 rounded-xl border border-rose-300/20 bg-rose-300/[0.07] px-4 py-3 text-sm text-rose-100">
          <CircleAlert size={17} className="shrink-0" />
          {t('settings.updates.checkFailed')}
        </div>
      )}

      <SettingsSection index="02" icon={Download} title={t('settings.updates.windowsTitle')}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <p className="max-w-3xl text-sm leading-relaxed text-muted">
            {t('settings.updates.windowsBody')}
          </p>
          <div className="flex flex-wrap gap-2">
            <FocusableButton
              variant="ghost"
              disabled={checking || snapshot?.platform === 'unsupported'}
              onClick={onCheck}
              className="shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="flex items-center gap-2">
                <RefreshCw size={14} className={checking ? 'animate-spin' : ''} />
                {checking
                  ? t('settings.updates.checking')
                  : t(snapshot ? 'settings.updates.checkAgain' : 'settings.updates.check')}
              </span>
            </FocusableButton>
            <FocusableButton
              variant="ghost"
              onClick={() => void window.api.system.openUpdateSettings()}
              className="shrink-0"
            >
              <span className="flex items-center gap-2">
                <ExternalLink size={14} />
                {t('settings.updates.openWindows')}
              </span>
            </FocusableButton>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {checking && !snapshot && (
            <UpdateMessage icon="loading" text={t('settings.updates.checking')} />
          )}
          {!checking && !snapshot && !requestFailed && (
            <UpdateMessage icon="idle" text={t('settings.updates.notChecked')} />
          )}
          {scanUnavailable && (
            <UpdateMessage icon="error" text={t('settings.updates.scanError')} />
          )}
          {snapshot && !snapshot.errors.updateScan && snapshot.windowsUpdates.length === 0 && (
            <UpdateMessage icon="success" text={t('settings.updates.noneWindows')} />
          )}
          {snapshot?.windowsUpdates.map((update) => (
            <article
              key={update.id}
              className="rounded-xl border border-white/[0.07] bg-black/20 px-4 py-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold leading-snug text-white/85">{update.title}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-semibold uppercase tracking-wide text-white/42">
                    {update.kbArticleIds.length > 0 && (
                      <span>
                        {t('settings.updates.kb', { ids: update.kbArticleIds.join(', KB') })}
                      </span>
                    )}
                    {update.severity && <span>{update.severity}</span>}
                    {update.downloaded && <span>{t('settings.updates.downloaded')}</span>}
                    {update.rebootRequired && (
                      <span className="text-amber-200/80">{t('settings.updates.reboot')}</span>
                    )}
                  </div>
                </div>
                <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-100">
                  {t('settings.updates.pending', { count: 1 })}
                </span>
              </div>
            </article>
          ))}
        </div>

        {snapshot && (
          <p className="mt-3 text-[10px] font-medium uppercase tracking-[0.12em] text-white/30">
            {t('settings.updates.lastChecked', {
              date: formatUpdateDate(snapshot.checkedAt, language, true)
            })}
          </p>
        )}
      </SettingsSection>

      <SettingsSection index="03" icon={Monitor} title={t('settings.updates.graphicsTitle')}>
        <p className="max-w-4xl text-sm leading-relaxed text-muted">
          {t('settings.updates.graphicsBody')}
        </p>

        {snapshot?.errors.graphicsDetection && (
          <div className="mt-4">
            <UpdateMessage icon="error" text={t('settings.updates.graphicsError')} />
          </div>
        )}

        {snapshot &&
          !snapshot.errors.graphicsDetection &&
          snapshot.graphicsAdapters.length === 0 && (
            <div className="mt-4">
              <UpdateMessage icon="idle" text={t('settings.updates.noAdapters')} />
            </div>
          )}

        {snapshot && snapshot.graphicsAdapters.length > 0 && (
          <div className="mt-5">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-white/35">
              {t('settings.updates.detectedAdapters')}
            </p>
            <div className="grid gap-2 lg:grid-cols-2">
              {snapshot.graphicsAdapters.map((adapter) => (
                <article
                  key={`${adapter.name}:${adapter.driverVersion}`}
                  className="rounded-xl border border-white/[0.07] bg-black/20 px-4 py-3"
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-accent">
                      <Monitor size={15} />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-white/85">{adapter.name}</p>
                        <VendorBadge vendor={adapter.vendor} />
                      </div>
                      <p className="mt-1 text-xs text-white/45">
                        {t('settings.updates.installedDriver', {
                          version: adapter.driverVersion || '—'
                        })}
                      </p>
                      {adapter.driverDate && (
                        <p className="mt-0.5 text-[10px] text-white/30">
                          {t('settings.updates.driverDate', {
                            date: formatUpdateDate(adapter.driverDate, language)
                          })}
                        </p>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}

        {snapshot && !snapshot.errors.updateScan && (
          <div className="mt-5">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-white/35">
              {t('settings.updates.availableDrivers')}
            </p>
            <div className="space-y-2">
              {snapshot.graphicsDriverUpdates.length === 0 ? (
                <UpdateMessage icon="success" text={t('settings.updates.noneDrivers')} />
              ) : (
                snapshot.graphicsDriverUpdates.map((update) => (
                  <article
                    key={update.id}
                    className="rounded-xl border border-accent/15 bg-accent/[0.055] px-4 py-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold leading-snug text-white/90">
                            {update.title}
                          </p>
                          <VendorBadge vendor={update.vendor} />
                        </div>
                        {update.matchedAdapterNames.length > 0 && (
                          <p className="mt-1 text-xs text-white/45">
                            {t('settings.updates.matchedDevice', {
                              device: update.matchedAdapterNames.join(', ')
                            })}
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-semibold uppercase tracking-wide text-white/38">
                          {update.provider && <span>{update.provider}</span>}
                          {update.driverDate && (
                            <span>{formatUpdateDate(update.driverDate, language)}</span>
                          )}
                          {update.downloaded && <span>{t('settings.updates.downloaded')}</span>}
                          {update.rebootRequired && (
                            <span className="text-amber-200/80">{t('settings.updates.reboot')}</span>
                          )}
                        </div>
                      </div>
                      <span className="rounded-full border border-accent/25 bg-accent/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-accent">
                        {t('settings.updates.pending', { count: 1 })}
                      </span>
                    </div>
                  </article>
                ))
              )}
            </div>
          </div>
        )}

        {vendorLinks.length > 0 && (
          <div className="mt-5 border-t border-white/[0.06] pt-4">
            <p className="mb-3 text-xs leading-relaxed text-white/38">
              {t('settings.updates.vendorHint')}
            </p>
            <div className="flex flex-wrap gap-2">
              {vendorLinks.map((vendor) => (
                <FocusableButton
                  key={vendor}
                  variant="ghost"
                  onClick={() => void window.api.app.openExternal(GRAPHICS_VENDOR_URLS[vendor]!)}
                  className="px-4 py-2 text-xs"
                >
                  <span className="flex items-center gap-2">
                    <ExternalLink size={13} />
                    {t('settings.updates.vendorPage', {
                      vendor: t(GRAPHICS_VENDOR_KEYS[vendor])
                    })}
                  </span>
                </FocusableButton>
              ))}
            </div>
          </div>
        )}
      </SettingsSection>
    </div>
  )
}

function UpdateMessage({
  icon,
  text
}: {
  icon: 'loading' | 'idle' | 'success' | 'error'
  text: string
}): JSX.Element {
  const Icon =
    icon === 'loading'
      ? Loader2
      : icon === 'success'
        ? CheckCircle2
        : icon === 'error'
          ? CircleAlert
          : RefreshCw
  const colorClass =
    icon === 'success'
      ? 'border-emerald-300/15 bg-emerald-300/[0.06] text-emerald-100'
      : icon === 'error'
        ? 'border-rose-300/15 bg-rose-300/[0.06] text-rose-100'
        : 'border-white/[0.07] bg-black/20 text-muted'

  return (
    <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm ${colorClass}`}>
      <Icon size={16} className={`shrink-0 ${icon === 'loading' ? 'animate-spin' : ''}`} />
      <span>{text}</span>
    </div>
  )
}

function VendorBadge({ vendor }: { vendor: GraphicsAdapterVendor }): JSX.Element {
  const t = useT()
  return (
    <span className="rounded-full border border-white/10 bg-white/[0.055] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-white/48">
      {t(GRAPHICS_VENDOR_KEYS[vendor])}
    </span>
  )
}

function formatUpdateDate(
  value: number | string,
  language: 'en' | 'de',
  includeTime = false
): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(language === 'de' ? 'de-DE' : 'en-US', {
    dateStyle: 'medium',
    ...(includeTime ? { timeStyle: 'short' as const } : {})
  }).format(date)
}

function SettingsPageLead({
  icon: Icon,
  title,
  description,
  index,
  total,
  highlights,
  autoSaveLabel
}: {
  icon: typeof Palette
  title: string
  description: string
  index: number
  total: number
  highlights: Array<{ label: string; value: string }>
  autoSaveLabel: string
}): JSX.Element {
  return (
    <section className="settings-page-lead relative overflow-hidden border-y border-white/[0.08] bg-[linear-gradient(90deg,rgb(var(--color-accent)/0.08),transparent_42%)] px-5 py-4">
      <div className="absolute inset-y-0 left-0 w-px bg-accent/75" />
      <div className="grid gap-4 lg:grid-cols-[minmax(18rem,1fr)_auto] lg:items-end">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.2em] text-accent">
            <Icon size={13} />
            <span>
              SET / {String(index).padStart(2, '0')} — {String(total).padStart(2, '0')}
            </span>
          </div>
          <h1 className="text-[clamp(1.55rem,2.4vw,2.3rem)] font-bold leading-none tracking-tight text-white">
            {title}
          </h1>
          <p className="mt-2 max-w-3xl text-xs leading-relaxed text-white/48">{description}</p>
        </div>

        <div className="flex flex-wrap items-stretch gap-2 lg:justify-end">
          {highlights.map((item) => (
            <div
              key={item.label}
              className="min-w-[7.5rem] border-l border-white/10 bg-black/20 px-3 py-2"
            >
              <p className="text-[8px] font-bold uppercase tracking-[0.15em] text-white/28">
                {item.label}
              </p>
              <p className="mt-1 max-w-40 truncate text-xs font-semibold text-white/78">
                {item.value}
              </p>
            </div>
          ))}
          <div className="flex items-center gap-2 px-2 text-[10px] font-medium text-white/40">
            <CheckCircle2 size={13} className="text-emerald-400" />
            {autoSaveLabel}
          </div>
        </div>
      </div>
    </section>
  )
}

function PresentationGroup({
  eyebrow,
  description,
  children
}: {
  eyebrow: string
  description: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-black/20 p-3">
      <div className="mb-3 px-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-accent">
          {eyebrow}
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-white/42">{description}</p>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function PresentationChoice({
  active,
  title,
  description,
  badge,
  preview,
  onClick
}: {
  active: boolean
  title: string
  description: string
  badge?: string
  preview: React.ReactNode
  onClick: () => void
}): JSX.Element {
  return (
    <motion.button
      data-focusable
      type="button"
      aria-pressed={active}
      onClick={onClick}
      whileHover={{ x: 2 }}
      whileTap={{ scale: 0.985 }}
      className={`flex min-h-[4.65rem] w-full items-center gap-3 rounded-xl border p-2.5 text-left transition-colors ${
        active
          ? 'border-accent/65 bg-accent/12'
          : 'border-white/[0.06] bg-white/[0.025] hover:bg-white/[0.05]'
      }`}
    >
      <span className="flex h-12 w-[4.25rem] shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/[0.07] bg-black/35">
        {preview}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className={`text-xs font-bold ${active ? 'text-white' : 'text-white/70'}`}>
            {title}
          </span>
          {badge && (
            <span className="rounded-full bg-white/[0.07] px-1.5 py-0.5 text-[7px] font-bold uppercase tracking-wider text-white/35">
              {badge}
            </span>
          )}
        </span>
        <span className="mt-1 block text-[10px] leading-snug text-white/38">{description}</span>
      </span>
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
          active ? 'border-accent bg-accent text-black' : 'border-white/15 text-transparent'
        }`}
      >
        <Check size={11} strokeWidth={3} />
      </span>
    </motion.button>
  )
}

function DockThemePreview({ theme }: { theme: DockThemeId }): JSX.Element {
  const shellClass =
    theme === 'glass'
      ? 'border-white/25 bg-gradient-to-br from-white/20 via-white/[0.07] to-accent/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]'
      : theme === 'neon'
        ? 'border-accent/55 bg-black/70 shadow-[0_0_12px_rgb(var(--color-accent)/0.32)]'
        : theme === 'minimal'
          ? 'border-transparent bg-transparent'
          : 'border-white/10 bg-black/35 shadow-[0_6px_14px_rgba(0,0,0,0.28)]'

  return (
    <span
      aria-hidden="true"
      className={`flex h-6 w-14 items-center justify-center gap-1 rounded-full border ${shellClass}`}
    >
      {[0, 1, 2, 3].map((index) => (
        <span
          key={index}
          className={`block rounded-full ${
            index === 1
              ? `h-3 w-3 bg-accent/25 shadow-[0_0_8px_rgb(var(--color-accent)/0.35)] ${
                  theme === 'neon' ? 'border border-accent/65' : 'border border-white/10'
                }`
              : 'h-1.5 w-1.5 bg-white/30'
          }`}
        />
      ))}
    </span>
  )
}

function DockSizePreview({ size }: { size: DockSize }): JSX.Element {
  const shellSize =
    size === 'compact' ? 'h-4 w-10' : size === 'large' ? 'h-7 w-[3.75rem]' : 'h-5 w-12'
  const dotSize = size === 'large' ? 'h-2.5 w-2.5' : size === 'compact' ? 'h-1.5 w-1.5' : 'h-2 w-2'

  return (
    <span
      aria-hidden="true"
      className={`flex items-center justify-center gap-1 rounded-full border border-white/12 bg-black/40 ${shellSize}`}
    >
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className={`${dotSize} rounded-full ${index === 1 ? 'bg-accent/80' : 'bg-white/25'}`}
        />
      ))}
    </span>
  )
}

function DockMotionPreview({ motionMode }: { motionMode: DockMotion }): JSX.Element {
  const offsets =
    motionMode === 'lively' ? [-5, 0, 5] : motionMode === 'standard' ? [-2, 0, 2] : [0, 0, 0]

  return (
    <span aria-hidden="true" className="relative flex h-8 w-14 items-center justify-center gap-1.5">
      {motionMode === 'lively' && (
        <span className="absolute inset-x-1 top-1/2 h-px bg-gradient-to-r from-transparent via-accent/45 to-transparent" />
      )}
      {offsets.map((offset, index) => (
        <span
          key={index}
          className={`relative block rounded-full ${
            index === 1
              ? 'h-3 w-3 bg-accent shadow-[0_0_10px_rgb(var(--color-accent)/0.48)]'
              : 'h-2 w-2 bg-white/30'
          }`}
          style={{ transform: `translateY(${offset}px)` }}
        />
      ))}
    </span>
  )
}

function HomeLayoutPreview({ layout }: { layout: HomeLayoutId }): JSX.Element {
  if (layout === 'rolling') {
    return (
      <span className="relative flex w-full flex-col justify-end gap-2 overflow-hidden">
        <span className="absolute right-0 top-0 flex gap-1">
          {[0, 1, 2, 3].map((index) => (
            <span key={index} className="h-1.5 w-1.5 rounded-full bg-white/35" />
          ))}
        </span>
        <span className="flex h-12 items-stretch gap-1.5">
          <span className="w-[58%] rounded-[5px] border border-accent/70 bg-gradient-to-br from-accent/70 via-accent-2/35 to-black/30" />
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              className="aspect-[2/3] rounded-[4px] border border-white/10 bg-white/10"
            />
          ))}
        </span>
        <span className="h-1.5 w-2/5 rounded-full bg-white/25" />
      </span>
    )
  }

  if (layout === 'xmode') {
    return (
      <span className="flex w-full flex-col gap-1.5">
        <span className="mx-auto h-2.5 w-2/3 rounded-full border border-white/10 bg-white/10" />
        <span className="grid grid-cols-[repeat(6,minmax(0,1fr))_1.35fr] gap-1">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <span
              key={index}
              className={`aspect-square rounded-[3px] border ${
                index === 0
                  ? 'border-accent/80 bg-gradient-to-br from-accent/85 to-accent-2/55'
                  : 'border-white/10 bg-white/10'
              }`}
            />
          ))}
          <span className="rounded-[3px] border border-white/10 bg-white/[0.07]" />
        </span>
        <span className="grid flex-1 grid-cols-2 gap-1.5">
          <span className="rounded-[4px] bg-gradient-to-r from-accent/35 to-white/[0.07]" />
          <span className="rounded-[4px] bg-gradient-to-r from-white/[0.07] to-accent-2/25" />
        </span>
      </span>
    )
  }

  if (layout === 'coresense') {
    return (
      <span className="flex w-full flex-col justify-between gap-2">
        <span className="flex items-start gap-1.5">
          {[0, 1, 2, 3, 4].map((index) => (
            <span
              key={index}
              className={`block rounded-[4px] border ${
                index === 0
                  ? 'h-8 w-8 border-accent/80 bg-gradient-to-br from-accent/85 to-accent-2/55'
                  : 'h-6 w-6 border-white/10 bg-white/10'
              }`}
            />
          ))}
        </span>
        <span className="flex items-end justify-between gap-3">
          <span className="flex items-center gap-1.5">
            <span className="h-5 w-5 rounded-[5px] bg-accent/70" />
            <span className="h-1.5 w-12 rounded-full bg-white/30" />
          </span>
          <span className="flex gap-1">
            {[0, 1, 2].map((index) => (
              <span key={index} className="h-3.5 w-7 rounded-[3px] bg-white/10" />
            ))}
          </span>
        </span>
      </span>
    )
  }

  if (layout === 'float') {
    return (
      <span className="flex flex-1 flex-col gap-2">
        <span className="h-5 rounded-md border border-white/10 bg-white/[0.06]" />
        <span className="flex flex-1 items-end gap-2">
          {[0, 1, 2, 3].map((index) => (
            <span
              key={index}
              className={`h-full flex-1 rounded-md bg-gradient-to-b ${
                index === 0
                  ? 'from-accent/75 to-accent-2/55'
                  : 'from-white/15 to-white/[0.04]'
              }`}
            />
          ))}
        </span>
      </span>
    )
  }

  return (
    <span className="flex flex-1 flex-col gap-2">
      <span className="grid h-9 grid-cols-[1.3fr_0.7fr] gap-2">
        <span className="rounded-md bg-gradient-to-r from-accent/45 to-white/[0.05]" />
        <span className="rounded-md bg-white/[0.07]" />
      </span>
      <span className="flex flex-1 gap-2">
        {[0, 1, 2, 3, 4].map((index) => (
          <span
            key={index}
            className={`flex-1 rounded-md ${index === 0 ? 'bg-accent/70' : 'bg-white/[0.08]'}`}
          />
        ))}
      </span>
    </span>
  )
}

function CardSizePreview({ size }: { size: GameCardSize }): JSX.Element {
  const cardWidth = size === 'compact' ? 'w-2.5' : size === 'large' ? 'w-4' : 'w-3'
  const cardCount = size === 'compact' ? 4 : size === 'large' ? 2 : 3
  return (
    <span className="flex h-9 items-end justify-center gap-1">
      {Array.from({ length: cardCount }, (_, index) => (
        <span
          key={index}
          className={`${cardWidth} block h-full rounded-[3px] border ${
            index === 0
              ? 'border-accent/75 bg-gradient-to-b from-accent/80 to-accent-2/45'
              : 'border-white/10 bg-white/10'
          }`}
        />
      ))}
    </span>
  )
}

function BackdropPreview({ intensity }: { intensity: BackdropIntensity }): JSX.Element {
  const opacity =
    intensity === 'subtle'
      ? 'opacity-35'
      : intensity === 'vivid'
        ? 'opacity-100'
        : 'opacity-65'
  return (
    <span className="relative block h-full w-full overflow-hidden">
      <span
        className={`absolute inset-0 bg-[radial-gradient(circle_at_25%_25%,rgb(var(--color-accent)/0.95),transparent_48%),linear-gradient(135deg,rgb(var(--color-accent-2)/0.7),transparent_70%)] ${opacity}`}
      />
      <span className="absolute inset-x-0 bottom-0 h-7 bg-gradient-to-t from-black/90 to-transparent" />
      <span className="absolute bottom-1.5 left-2 h-1.5 w-7 rounded-full bg-white/70" />
    </span>
  )
}

function BackdropModePreview({ mode }: { mode: HomeBackdropMode }): JSX.Element {
  return (
    <span className="relative block h-full w-full overflow-hidden">
      <span className="absolute inset-0 bg-[linear-gradient(135deg,rgb(var(--color-accent)/0.55),rgb(var(--color-accent-2)/0.22),rgba(0,0,0,0.7))]" />
      {mode === 'focus' && (
        <>
          <span className="absolute bottom-1.5 left-2 h-2 w-4 rounded-sm border border-white/35 bg-white/15" />
          <span className="absolute bottom-1.5 left-7 h-2 w-4 rounded-sm border border-accent/70 bg-accent/30" />
        </>
      )}
      {mode === 'pinned' && (
        <>
          <span className="absolute inset-2 rounded border border-accent/55 bg-black/15" />
          <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-accent shadow-[0_0_8px_rgb(var(--color-accent)/0.65)]" />
        </>
      )}
      {mode === 'slideshow' && (
        <>
          <span className="absolute bottom-2 left-2 top-2 w-7 rounded border border-white/18 bg-white/10" />
          <span className="absolute bottom-2 left-7 top-2 w-7 rounded border border-accent/55 bg-accent/18" />
          <span className="absolute bottom-2 left-12 top-2 w-7 rounded border border-white/18 bg-white/10" />
        </>
      )}
      {mode === 'custom' && (
        <>
          <span className="absolute inset-2 rounded border border-white/25 bg-[radial-gradient(circle_at_70%_30%,rgba(255,255,255,0.34),transparent_28%),linear-gradient(145deg,rgb(var(--color-accent)/0.45),rgb(var(--color-accent-2)/0.18))]" />
          <span className="absolute bottom-3 left-3 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[10px] font-black text-black">
            +
          </span>
        </>
      )}
    </span>
  )
}

function BackdropMotionPreview({
  motionMode
}: {
  motionMode: HomeBackdropMotion
}): JSX.Element {
  return (
    <span
      aria-hidden="true"
      data-backdrop-motion-preview={motionMode}
      className="relative block h-full w-full overflow-hidden"
    >
      <span className="backdrop-motion-preview-art absolute -inset-1 bg-[radial-gradient(circle_at_28%_34%,rgb(var(--color-accent)/0.92),transparent_38%),linear-gradient(135deg,rgb(var(--color-accent-2)/0.65),rgba(0,0,0,0.72))]" />
      <span className="absolute inset-x-0 bottom-0 h-5 bg-gradient-to-t from-black/80 to-transparent" />
    </span>
  )
}

function DensityPreview({ density }: { density: UiDensity }): JSX.Element {
  const gap = density === 'compact' ? 'gap-1' : 'gap-1.5'
  return (
    <span className={`flex w-12 flex-col ${gap}`}>
      {[0, 1, 2].map((index) => (
        <span key={index} className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-accent/75" />
          <span className={`h-1 rounded-full bg-white/25 ${index === 1 ? 'w-7' : 'w-9'}`} />
        </span>
      ))}
    </span>
  )
}

function SettingsToggle({
  id,
  active,
  title,
  description,
  defaultActive,
  defaultInactive,
  disabled = false,
  onChange,
  t
}: {
  id: string
  active: boolean
  title: string
  description: string
  defaultActive?: boolean
  defaultInactive?: boolean
  disabled?: boolean
  onChange: (active: boolean) => void
  t: ReturnType<typeof useT>
}): JSX.Element {
  return (
    <motion.button
      data-focusable
      type="button"
      data-disabled={disabled ? 'true' : undefined}
      disabled={disabled}
      data-setting-toggle={id}
      aria-pressed={active}
      onClick={() => {
        if (!disabled) onChange(!active)
      }}
      whileHover={{ y: -2 }}
      className={`flex items-center justify-between gap-5 rounded-2xl border border-white/[0.07] bg-black/20 p-4 text-left ${
        disabled ? 'opacity-45' : ''
      }`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-white/85">{title}</p>
          {defaultActive && (
            <span className="rounded-full bg-white/[0.07] px-2 py-0.5 text-[9px] uppercase tracking-wider text-white/40">
              {t('settings.defaultOn')}
            </span>
          )}
          {defaultInactive && (
            <span className="rounded-full bg-white/[0.07] px-2 py-0.5 text-[9px] uppercase tracking-wider text-white/40">
              {t('settings.defaultOff')}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted">{description}</p>
      </div>
      <span
        className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors ${
          active ? 'border-accent/60 bg-accent' : 'border-white/10 bg-white/10'
        }`}
      >
        <motion.span
          animate={{ x: active ? 22 : 3 }}
          transition={{ type: 'spring', stiffness: 500, damping: 32 }}
          className={`absolute top-1 h-5 w-5 rounded-full ${active ? 'bg-black' : 'bg-white/60'}`}
        />
      </span>
    </motion.button>
  )
}

function SettingsSection({
  index,
  icon: Icon,
  title,
  children
}: {
  index: string
  icon: typeof Palette
  title: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <section className="settings-section relative overflow-hidden rounded-xl2 border border-white/[0.07] bg-[linear-gradient(135deg,rgb(255_255_255/0.045),rgb(255_255_255/0.018))] p-5 shadow-card backdrop-blur-xl">
      <div className="pointer-events-none absolute left-0 top-5 h-8 w-px bg-accent/80" />
      <h3 className="mb-4 flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.07] bg-black/25 text-accent">
          <Icon size={15} />
        </span>
        <span className="text-sm font-semibold text-white/78">{title}</span>
        <span className="ml-auto text-[9px] font-bold tracking-[0.18em] text-white/22">
          {index}
        </span>
      </h3>
      {children}
    </section>
  )
}

function OptionPill({
  active,
  disabled = false,
  onClick,
  children
}: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <motion.button
      data-focusable
      type="button"
      aria-pressed={active}
      data-disabled={disabled ? 'true' : undefined}
      disabled={disabled}
      onClick={onClick}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      className={`flex items-center gap-2 rounded-full px-5 py-2.5 text-sm ${
        active ? 'bg-accent font-semibold text-black' : 'bg-white/5 text-muted'
      } ${
        disabled ? 'cursor-not-allowed opacity-45' : ''
      }`}
    >
      {active && <Check size={14} />}
      {children}
    </motion.button>
  )
}

function PlayStationRemotePlayPanel({
  remotePlay,
  preference,
  saving,
  onPreference,
  onRefresh,
  t
}: {
  remotePlay: PlayStationRemotePlayStatus | null
  preference: PlayStationRemotePlayPreference
  saving: boolean
  onPreference: (preference: PlayStationRemotePlayPreference) => void
  onRefresh: () => void
  t: ReturnType<typeof useT>
}): JSX.Element {
  const choices: Array<{
    id: PlayStationRemotePlayPreference
    title: string
    description: string
  }> = [
    {
      id: 'auto',
      title: t('settings.playstation.remotePlay.auto'),
      description: t('settings.playstation.remotePlay.autoBody')
    },
    {
      id: 'chiaki',
      title: 'Chiaki-ng',
      description: t('settings.playstation.remotePlay.chiakiBody')
    },
    {
      id: 'ps-remote-play',
      title: 'PS Remote Play',
      description: t('settings.playstation.remotePlay.officialBody')
    }
  ]
  const installed = new Set(remotePlay?.apps.filter((app) => app.installed).map((app) => app.id))
  const selectedName = remotePlay?.apps.find((app) => app.id === remotePlay.selectedApp)?.name

  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-[#1788ff]/20 bg-[linear-gradient(135deg,rgba(0,77,168,0.16),rgba(0,0,0,0.28)_55%)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] px-4 py-3">
        <div>
          <p className="text-sm font-bold text-white">{t('settings.playstation.remotePlay.title')}</p>
          <p className="mt-0.5 text-[11px] text-white/45">
            {selectedName
              ? t('settings.playstation.remotePlay.selected', { app: selectedName })
              : t('settings.playstation.remotePlay.noneDetected')}
          </p>
        </div>
        <FocusableButton variant="ghost" onClick={onRefresh} className="shrink-0">
          <span className="flex items-center gap-2">
            <RefreshCw size={13} />
            {t('settings.playstation.remotePlay.detectAgain')}
          </span>
        </FocusableButton>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-2 p-4">
        {choices.map((choice) => {
          const isInstalled =
            choice.id === 'auto' ? installed.size > 0 : installed.has(choice.id)
          return (
            <motion.button
              key={choice.id}
              data-focusable
              type="button"
              aria-pressed={preference === choice.id}
              disabled={saving}
              onClick={() => onPreference(choice.id)}
              whileTap={{ scale: 0.985 }}
              className={`flex min-w-0 items-start gap-3 rounded-xl border p-3 text-left transition-colors ${
                preference === choice.id
                  ? 'border-[#238cff]/60 bg-[#0878e8]/15'
                  : 'border-white/[0.07] bg-black/20 hover:bg-white/[0.045]'
              } disabled:opacity-50`}
            >
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                  preference === choice.id
                    ? 'border-[#3b9dff] bg-[#1687f5] text-white'
                    : 'border-white/20 text-transparent'
                }`}
              >
                <Check size={11} strokeWidth={3} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 text-xs font-bold text-white/88">
                  {choice.title}
                  <span
                    className={`rounded-full px-2 py-0.5 text-[8px] uppercase tracking-wider ${
                      isInstalled
                        ? 'bg-emerald-400/10 text-emerald-300'
                        : 'bg-white/[0.06] text-white/35'
                    }`}
                  >
                    {t(
                      isInstalled
                        ? 'settings.playstation.remotePlay.detected'
                        : 'settings.playstation.remotePlay.notDetected'
                    )}
                  </span>
                </span>
                <span className="mt-1.5 block text-[10px] leading-relaxed text-white/42">
                  {choice.description}
                </span>
              </span>
            </motion.button>
          )
        })}
      </div>

    </div>
  )
}

function providerStatusOrFallback(
  statuses: LibraryProviderStatus[] | undefined,
  games: LibraryGame[],
  provider: LibraryStatusProvider,
  connection: LibraryProviderConnection
): LibraryProviderStatus {
  const status = statuses?.find((candidate) => candidate.provider === provider)
  if (status) return status
  const providerGames = games.filter((game) => game.provider === provider)
  return {
    provider,
    state: 'idle',
    connection,
    methods: [],
    gameCount: providerGames.length,
    installedCount: providerGames.filter((game) => game.installed).length,
    installableCount: 0
  }
}

function libraryStateClass(state: LibraryProviderState): string {
  if (state === 'ready') return 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300'
  if (state === 'partial' || state === 'local-only') {
    return 'border-amber-300/25 bg-amber-300/10 text-amber-200'
  }
  if (state === 'error') return 'border-rose-300/25 bg-rose-300/10 text-rose-200'
  if (state === 'scanning') return 'border-accent/25 bg-accent/10 text-accent'
  return 'border-white/10 bg-white/[0.05] text-muted'
}

function formatLibraryCheck(
  timestamp: number | undefined,
  language: OrbitSettings['language'],
  t: ReturnType<typeof useT>
): string {
  if (!timestamp) return t('settings.libraryStatus.neverChecked')
  return new Intl.DateTimeFormat(language === 'de' ? 'de-DE' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(timestamp)
}

function formatArtworkTimestamp(
  timestamp: number,
  language: OrbitSettings['language']
): string {
  return new Intl.DateTimeFormat(language === 'de' ? 'de-DE' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(timestamp)
}

function formatArtworkCacheSize(bytes: number, language: OrbitSettings['language']): string {
  const locale = language === 'de' ? 'de-DE' : 'en-US'
  const size = bytes >= 1024 * 1024 ? bytes / (1024 * 1024) : bytes / 1024
  const unit = bytes >= 1024 * 1024 ? 'MB' : 'KB'
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(size)} ${unit}`
}

function steamGridDbTokenClass(
  state: SteamGridDbTokenState | undefined,
  checking: boolean
): string {
  if (checking) return 'text-accent'
  if (state === 'valid') return 'text-emerald-300'
  if (state === 'invalid' || state === 'expired') return 'text-rose-300'
  if (state === 'unavailable') return 'text-amber-300'
  return 'text-white/50'
}

function LibraryProviderCard({
  store,
  badge,
  badgeClass,
  status,
  description,
  connected,
  automatic = false,
  waiting,
  error,
  connectLabel,
  signOutLabel,
  onConnect,
  onLogout,
  language,
  t
}: {
  store: string
  badge: string
  badgeClass: string
  status: LibraryProviderStatus
  description: string
  connected: boolean
  automatic?: boolean
  waiting: boolean
  error: boolean
  connectLabel: string
  signOutLabel: string
  onConnect?: () => void
  onLogout?: () => void
  language: OrbitSettings['language']
  t: ReturnType<typeof useT>
}): JSX.Element {
  const methods = status.methods.map((method) => t(LIBRARY_METHOD_KEYS[method]))
  const issue = status.issue
    ? t(LIBRARY_ISSUE_KEYS[status.issue], { count: status.pendingCount ?? 0 })
    : undefined
  const stateIsBusy = status.state === 'scanning'

  return (
    <article className="flex min-h-full flex-col rounded-2xl border border-white/[0.07] bg-black/25 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${badgeClass}`}
          >
            <span className="text-sm font-bold text-white">{badge}</span>
          </div>
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-semibold text-white/90">
              {store}
              {error && <CircleAlert size={13} className="text-amber-300" />}
            </p>
            <p className={`truncate text-xs ${error ? 'text-amber-200/75' : 'text-muted'}`}>
              {description}
            </p>
          </div>
        </div>
        <div
          className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider ${libraryStateClass(status.state)}`}
          role="status"
        >
          {stateIsBusy ? (
            <Loader2 size={11} className="animate-spin" />
          ) : status.state === 'ready' ? (
            <CheckCircle2 size={11} />
          ) : (
            <CircleAlert size={11} />
          )}
          {t(LIBRARY_STATE_KEYS[status.state])}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 divide-x divide-white/[0.06] border-y border-white/[0.06] py-3">
        {[
          [t('settings.libraryStatus.recognized'), status.gameCount],
          [t('settings.libraryStatus.installed'), status.installedCount],
          [t('settings.libraryStatus.installable'), status.installableCount]
        ].map(([label, value]) => (
          <div key={String(label)} className="px-2 first:pl-0 last:pr-0">
            <p className="text-lg font-bold leading-none text-white">{value}</p>
            <p className="mt-1 text-[9px] uppercase tracking-wider text-white/32">{label}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 flex-1 rounded-xl border border-white/[0.05] bg-white/[0.025] p-3">
        <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-white/30">
          {t('settings.libraryStatus.detection')}
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-white/68">
          {methods.length > 0 ? methods.join(' + ') : t('settings.libraryStatus.method.pending')}
        </p>
        {status.pendingCount ? (
          <p className="mt-2 text-[10px] text-accent">
            {t('settings.libraryStatus.pending', { count: status.pendingCount })}
          </p>
        ) : null}
      </div>

      {issue && (
        <p
          className={`mt-3 flex items-start gap-2 text-[10px] leading-relaxed ${
            status.state === 'error' ? 'text-rose-200/80' : 'text-amber-200/75'
          }`}
        >
          <CircleAlert size={12} className="mt-0.5 shrink-0" />
          {issue}
        </p>
      )}

      <div className="mt-4 flex min-h-9 items-center justify-between gap-3 border-t border-white/[0.06] pt-3">
        <p className="text-[10px] text-white/32">
          {t('settings.libraryStatus.lastChecked')}{' '}
          <span className="text-white/55">
            {formatLibraryCheck(status.lastCheckedAt, language, t)}
          </span>
        </p>
        {automatic ? (
          <span className="rounded-full bg-[#107c10]/15 px-2.5 py-1 text-[9px] font-semibold text-[#6ee7a0]">
            {t('settings.libraryStatus.automatic')}
          </span>
        ) : connected && onLogout ? (
          <FocusableButton variant="ghost" onClick={onLogout} className="shrink-0">
            <span className="flex items-center gap-2">
              <LogOut size={14} />
              {signOutLabel}
            </span>
          </FocusableButton>
        ) : onConnect ? (
          <FocusableButton
            data-disabled={waiting ? 'true' : undefined}
            disabled={waiting}
            onClick={onConnect}
            className="shrink-0 disabled:cursor-wait disabled:opacity-50"
          >
            <span className="flex items-center gap-2">
              {waiting && <Loader2 size={14} className="animate-spin" />}
              {connectLabel}
            </span>
          </FocusableButton>
        ) : null}
      </div>
    </article>
  )
}
