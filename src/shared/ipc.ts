export type ThemeId =
  | 'midnight'
  | 'coresense'
  | 'aurora'
  | 'violet'
  | 'sakura'
  | 'emerald'
  | 'ocean'
  | 'amber'
  | 'sunset'
  | 'crimson'
  | 'ice'
  | 'lime'
  | 'monochrome'
export type UiDensity = 'standard' | 'compact'
export type HomeLayoutId = 'orbit' | 'float' | 'coresense'
export type GameCardSize = 'compact' | 'standard' | 'large'
export const LIBRARY_GRID_COLUMN_OPTIONS = [4, 5, 6, 7, 8] as const
export type LibraryGridColumns = (typeof LIBRARY_GRID_COLUMN_OPTIONS)[number]
export type BackdropIntensity = 'subtle' | 'balanced' | 'vivid'
export const PROFILE_AVATAR_IDS = [
  'orbit',
  'nova',
  'pulse',
  'drift',
  'ember',
  'pixel',
  'custom',
  'steam'
] as const
export type ProfileAvatarId = (typeof PROFILE_AVATAR_IDS)[number]
export const NOTIFICATION_POSITIONS = ['top-right', 'top-center', 'bottom-right'] as const
export type NotificationPosition = (typeof NOTIFICATION_POSITIONS)[number]
export const NOTIFICATION_MOTIONS = ['slide', 'lift', 'scale'] as const
export type NotificationMotion = (typeof NOTIFICATION_MOTIONS)[number]
export type Language = 'en' | 'de'
export type AudioPreset =
  | 'orbit'
  | 'soft'
  | 'deep'
  | 'minimal'
  | 'steam'
  | 'xbox'
  | 'playstation'
  | 'off'
export type StoreRegionId = 'eu' | 'us' | 'gb' | 'ca' | 'au'
export type SystemPowerAction = 'sleep' | 'restart' | 'shutdown'
export type SystemSettingsTarget = 'power' | 'wifi' | 'ethernet' | 'bluetooth'
export type AppControlAction = 'relaunch' | 'quit'
export type GraphicsAdapterVendor = 'nvidia' | 'amd' | 'intel' | 'other'

export type SystemStatusState = 'loading' | 'ready' | 'partial' | 'error' | 'unsupported'
export type SystemNetworkType = 'wifi' | 'ethernet' | 'offline' | 'unknown'

/** Sanitized, local-only device status for ORBIT's top-bar quick menu. */
export interface SystemStatusSnapshot {
  platform: 'windows' | 'unsupported'
  state: SystemStatusState
  checkedAt: number
  battery: {
    present: boolean
    level?: number
    charging: boolean
    powerSource: 'battery' | 'ac' | 'unknown'
  }
  network: {
    connected: boolean
    type: SystemNetworkType
    name?: string
    linkSpeed?: string
  }
  bluetooth: {
    available: boolean
    enabled: boolean
  }
}

export interface InstalledGraphicsAdapter {
  name: string
  manufacturer: string
  vendor: GraphicsAdapterVendor
  driverVersion: string
  driverDate?: string
}

export interface PendingWindowsUpdate {
  id: string
  title: string
  kbArticleIds: string[]
  severity?: string
  rebootRequired: boolean
  downloaded: boolean
}

export interface GraphicsDriverUpdate {
  id: string
  title: string
  vendor: GraphicsAdapterVendor
  driverClass: string
  manufacturer: string
  model: string
  provider: string
  driverDate?: string
  matchedAdapterNames: string[]
  rebootRequired: boolean
  downloaded: boolean
}

export interface SystemUpdateSnapshot {
  platform: 'windows' | 'unsupported'
  state: 'ready' | 'partial' | 'error' | 'unsupported'
  checkedAt: number
  windowsUpdates: PendingWindowsUpdate[]
  graphicsAdapters: InstalledGraphicsAdapter[]
  graphicsDriverUpdates: GraphicsDriverUpdate[]
  errors: {
    updateScan?: 'windows-update-unavailable'
    graphicsDetection?: 'graphics-detection-unavailable'
  }
}

export type AppUpdateInstallMode = 'appx' | 'nsis' | 'development' | 'unsupported'
export type AppUpdateStage =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'verifying'
  | 'ready'
  | 'installing'
  | 'error'
export type AppUpdateError =
  | 'release-unavailable'
  | 'release-invalid'
  | 'download-failed'
  | 'verification-failed'
  | 'install-failed'
export type AppUpdateBlockedReason = 'game-active' | 'not-downloaded'
export type AppUpdateDownloadPauseReason = 'game-active' | 'launcher-download-active'
export type AppUpdateVerification = 'pending' | 'verifying' | 'verified' | 'installer-managed'

/** Sanitized application-update state. Download URLs, local paths and raw
 * installer errors intentionally never cross into the renderer. */
export interface AppUpdateSnapshot {
  stage: AppUpdateStage
  installMode: AppUpdateInstallMode
  currentVersion: string
  targetVersion?: string
  releaseName?: string
  releaseNotes?: string
  releasePageUrl?: string
  checkedAt?: number
  downloadedAt?: number
  installedVersion?: string
  transferredBytes?: number
  totalBytes?: number
  percent?: number
  bytesPerSecond?: number
  channel: 'stable' | 'beta'
  automaticChecksEnabled: boolean
  autoDownloadEnabled: boolean
  checkIntervalHours: number
  nextCheckAt?: number
  verification: AppUpdateVerification
  downloadPausedReason?: AppUpdateDownloadPauseReason
  canInstall: boolean
  blockedReason?: AppUpdateBlockedReason
  installScheduled: boolean
  installCountdownEndsAt?: number
  error?: AppUpdateError
}
export const HARDWARE_CONTROL_BUTTONS = [
  'menu',
  'view',
  'guide',
  'playstation',
  'a',
  'b',
  'x',
  'y',
  'dpad-up',
  'dpad-down',
  'dpad-left',
  'dpad-right',
  'left-trigger',
  'right-trigger',
  'left-bumper',
  'right-bumper',
  'left-stick',
  'right-stick'
] as const
export type HardwareControlButton = (typeof HARDWARE_CONTROL_BUTTONS)[number]
export const HARDWARE_CONTROL_HOLD_SECONDS = [1, 1.5, 2, 3] as const
export type HardwareControlHoldSeconds = (typeof HARDWARE_CONTROL_HOLD_SECONDS)[number]

/** A user-owned, provider-neutral game collection. Games remain referenced by
 * their durable `<provider>:<providerGameId>` library identity. */
export interface GameCollection {
  id: string
  name: string
  gameIds: string[]
  createdAt: number
}

export interface HardwareControlStatus {
  state: 'disabled' | 'starting' | 'ready' | 'unavailable'
  connectedControllers: number
  reason?: 'unsupported-platform' | 'monitor-failed' | 'service-not-running'
  lastInputAt?: number
  lastTriggerAt?: number
  lastPressDurationMs?: number
  lastAnyInputAt?: number
  lastRawButtonMask?: number
}

export type OrbitBackgroundServiceAction = 'install' | 'repair' | 'restart' | 'remove'

export interface OrbitBackgroundServiceStatus {
  installation: 'not-installed' | 'installed' | 'repair-needed' | 'unsupported'
  runtime: 'stopped' | 'starting' | 'running'
  hardwareControl: HardwareControlStatus
  lastActivationAt?: number
  lastActivationResult?: 'focused' | 'launched' | 'failed'
  reason?:
    | 'unsupported-platform'
    | 'login-item-disabled'
    | 'configuration-mismatch'
    | 'agent-unreachable'
}

export interface OrbitSettings {
  theme: ThemeId
  profileAvatar: ProfileAvatarId
  homeLayout: HomeLayoutId
  gameCardSize: GameCardSize
  libraryGridColumns: LibraryGridColumns
  favoriteGameIds: string[]
  customLibraries: GameCollection[]
  backdropIntensity: BackdropIntensity
  homeCardBubbleEffect: boolean
  uiDensity: UiDensity
  language: Language
  audioPreset: AudioPreset
  hasCompletedOnboarding: boolean
  steamGridDbApiKey?: string
  steamWebApiKey?: string
  storeRegion: StoreRegionId
  showStoreTab: boolean
  showHomeBanners: boolean
  showAchievements: boolean
  closeLaunchersAfterGame: boolean
  notificationsEnabled: boolean
  notificationPosition: NotificationPosition
  notificationMotion: NotificationMotion
  appUpdateAutoDownload: boolean
  hardwareControlEnabled: boolean
  hardwareControlButton: HardwareControlButton
  hardwareControlHoldSeconds: HardwareControlHoldSeconds
}

export type StoreLoginState = 'idle' | 'waiting-for-browser' | 'success' | 'error'

export type SteamLoginStatus =
  | { state: 'idle' }
  | { state: 'waiting-for-browser' }
  | { state: 'success'; account: SteamAccount }
  | { state: 'error'; message: string }

export interface SteamAccount {
  steamId: string
  accountName: string
  avatarUrl?: string
}

export type EpicLoginStatus =
  | { state: 'idle' }
  | { state: 'waiting-for-browser' }
  | { state: 'success'; account: EpicAccount }
  | { state: 'error'; message: string }

export interface EpicAccount {
  accountId: string
  displayName: string
}

export const FRIENDS_PROVIDERS = ['steam', 'discord', 'epic'] as const
export type FriendsProvider = (typeof FRIENDS_PROVIDERS)[number]
export type FriendPresence = 'online' | 'away' | 'busy' | 'offline' | 'unknown'
export type FriendsProviderState =
  | 'ready'
  | 'not-connected'
  | 'setup-required'
  | 'connecting'
  | 'external'
  | 'error'
export type FriendsProviderIssue =
  | 'api-key-required'
  | 'api-key-invalid'
  | 'private-profile'
  | 'provider-unavailable'
  | 'authentication-failed'
  | 'sdk-unavailable'
  | 'integration-required'

/** Provider-neutral social identity. Provider credentials and raw responses
 * remain in the main process and never cross this contract. */
export interface OrbitFriend {
  id: string
  provider: FriendsProvider
  providerUserId: string
  displayName: string
  avatarUrl?: string
  profileUrl?: string
  presence: FriendPresence
  activity?: string
  lastSeenAt?: number
}

export interface FriendsProviderStatus {
  provider: FriendsProvider
  state: FriendsProviderState
  friendCount: number
  onlineCount: number
  updatedAt?: number
  accountName?: string
  issue?: FriendsProviderIssue
}

export interface FriendsSnapshot {
  friends: OrbitFriend[]
  providers: Record<FriendsProvider, FriendsProviderStatus>
  updatedAt: number
  isRefreshing: boolean
}

export type GameProvider = 'steam' | 'epic' | 'gog' | 'xbox' | 'ea' | 'ubisoft' | 'local'

export type LauncherDownloadProvider = Extract<GameProvider, 'steam' | 'epic' | 'xbox'>
export type LauncherDownloadPhase =
  | 'downloading'
  | 'updating'
  | 'installing'
  | 'verifying'
  | 'paused'
  | 'completed'
  | 'error'
export type LauncherDownloadConfidence = 'exact' | 'approximate' | 'heuristic'

/** Ephemeral, path-free activity reported by a locally installed launcher. */
export interface LauncherDownloadActivity {
  id: string
  provider: LauncherDownloadProvider
  providerGameId: string
  gameId?: string
  title: string
  phase: LauncherDownloadPhase
  confidence: LauncherDownloadConfidence
  /** Normalized 0..1 progress. Omitted when the launcher exposes no reliable total. */
  progress?: number
  bytesDownloaded?: number
  bytesTotal?: number
  bytesPerSecond?: number
  etaSeconds?: number
  updatedAt: number
}

export interface LauncherDownloadSnapshot {
  revision: number
  updatedAt: number
  activities: LauncherDownloadActivity[]
}

export type GamePlatform = 'windows' | 'macos' | 'linux'

export interface GameSystemRequirements {
  minimum?: string
  recommended?: string
}

/** Ordered, provider-supplied artwork candidates. The shared image pipeline
 * validates dimensions, caches the best file and falls back independently. */
export interface GameArtworkCandidates {
  vertical?: string[]
  horizontal?: string[]
  icon?: string[]
}

export interface GameCompletionTimes {
  state: 'available' | 'unavailable'
  provider: 'howlongtobeat'
  mainStoryMinutes?: number
  mainExtraMinutes?: number
  completionistMinutes?: number
  allStylesMinutes?: number
  sourceGameId?: number
  sourceTitle?: string
  sourceUrl?: string
  confidence?: number
  fetchedAt: number
}

export interface GameAchievement {
  id: string
  name: string
  description?: string
  iconUrl?: string
  lockedIconUrl?: string
  unlocked: boolean
  unlockedAt?: number
  progress?: number
  hidden?: boolean
}

export interface GameAchievementsSnapshot {
  gameId: string
  provider: GameProvider
  state: 'available' | 'unavailable'
  achievements: GameAchievement[]
  unlocked: number
  total: number
  fetchedAt: number
  reason?: 'private' | 'unsupported' | 'unavailable'
}

/** Rich, provider-neutral metadata persisted with each library record. */
export interface GameMetadata {
  iconUrl?: string
  summary?: string
  description?: string
  genres?: string[]
  features?: string[]
  developers?: string[]
  publishers?: string[]
  releaseDateText?: string
  comingSoon?: boolean
  criticScore?: number
  recommendationCount?: number
  requiredAge?: number
  website?: string
  storeUrl?: string
  /** Validated provider launch target, such as a Windows AppsFolder AUMID. */
  launchUri?: string
  /** Provider manifest executable hint used only to identify the launched process. */
  launchExecutable?: string
  languages?: string[]
  controllerSupport?: string
  platforms?: GamePlatform[]
  achievementCount?: number
  contentDescriptorNotes?: string
  systemRequirements?: GameSystemRequirements
  backgroundUrl?: string
  storeHeaderUrl?: string
  artwork?: GameArtworkCandidates
  completionTimes?: GameCompletionTimes
}

export type LocalGameBackupState = 'never' | 'success' | 'failed'

export interface LocalGameConfig {
  executablePath: string
  /** Parsed argv passed directly to the executable without a command shell. */
  launchArguments?: string[]
  savePath?: string
  backupEnabled: boolean
  lastBackupAt?: number
  lastBackupState?: LocalGameBackupState
}

export type CustomGameImportSource = 'executable' | 'folder'
export type CustomGameSaveSource = 'file' | 'folder'

export interface CustomGameDraft {
  id: string
  name: string
  executablePath: string
  installDir: string
  iconPreviewUrl?: string
  artworkPreviewUrl?: string
  savePath?: string
}

export interface CustomGameCommitInput {
  draftId: string
  name: string
  /** User-facing Windows argument string; parsed and validated in the main process. */
  launchArguments?: string
}

export interface CustomGameLaunchArgumentsInput {
  gameId: string
  /** User-facing Windows argument string; parsed and validated in the main process. */
  launchArguments?: string
}

export interface LocalGameBackupResult {
  state: 'success' | 'failed' | 'skipped'
  completedAt: number
  backupPath?: string
}

/**
 * Provider-neutral library record. `id` is the durable identity used by ORBIT's
 * database (`<provider>:<providerGameId>`); `appId` remains Steam-specific data
 * and must never be used as a cross-provider key.
 */
export interface LibraryGame {
  id: string
  provider: GameProvider
  providerGameId: string
  appId?: number
  name: string
  metadata: GameMetadata
  metadataRevision: number
  metadataUpdatedAt?: number
  metadataLocale?: string
  metadataSource?: string
  /** Canonical playtime with second precision. Provider time is preferred when available. */
  playtimeSeconds?: number
  /** Compatibility/aggregate value derived from `playtimeSeconds`. */
  playtimeMinutes?: number
  lastPlayedTimestamp?: number
  lastStartedAt?: number
  installed: boolean
  installDir?: string
  /** Locally detected provider update that has not finished downloading yet. */
  updateAvailable?: boolean
  local?: LocalGameConfig
  addedAt: number
  updatedAt: number
}

export type LibraryStatusProvider = 'steam' | 'epic' | 'xbox'
export type LibraryProviderState =
  | 'idle'
  | 'scanning'
  | 'ready'
  | 'partial'
  | 'local-only'
  | 'error'
export type LibraryProviderConnection = 'connected' | 'not-connected' | 'automatic'
export type LibraryDetectionMethod =
  | 'local-manifests'
  | 'account-api'
  | 'community-profile'
  | 'launcher-session'
  | 'epic-catalog'
  | 'xbox-app-cache'
  | 'xbox-display-catalog'
  | 'windows-packages'
  | 'cached-data'
export type LibraryProviderIssue =
  | 'not-connected'
  | 'online-library-unavailable'
  | 'metadata-pending'
  | 'source-unavailable'
  | 'no-games-found'

export interface LibraryProviderStatus {
  provider: LibraryStatusProvider
  state: LibraryProviderState
  connection: LibraryProviderConnection
  methods: LibraryDetectionMethod[]
  gameCount: number
  installedCount: number
  installableCount: number
  pendingCount?: number
  issue?: LibraryProviderIssue
  lastCheckedAt?: number
}

/** A completed game session observed by ORBIT itself. */
export interface LibrarySessionRecord {
  id: string
  gameId: string
  startedAt: number
  endedAt: number
  durationSeconds: number
}

export interface LibraryActivityWindow {
  playtimeSeconds: number
  sessionCount: number
}

export interface LibraryActivitySummary {
  /** Best installed continuation target: ORBIT session first, provider activity second. */
  continueGameId?: string
  lastSession?: LibrarySessionRecord
  sevenDays: LibraryActivityWindow
  thirtyDays: LibraryActivityWindow
  recordedSessionCount: number
}

export interface LibrarySnapshot {
  /** Lossless provider-identity records used by Home and the combined library. */
  games: LibraryGame[]
  /** Compatibility projection used by provider-specific tabs. */
  providerGames: LibraryGame[]
  recentGameIds: string[]
  loadedAt: number
  isLoadingMetadata: boolean
  /** Rolling local activity. Provider totals remain authoritative for lifetime playtime. */
  activity?: LibraryActivitySummary
  /** Safe, user-facing provider diagnostics; no tokens, paths or account IDs. */
  providerStatuses?: LibraryProviderStatus[]
}

export interface LibraryStats {
  gameCount: number
  installedCount: number
  totalPlaytimeMinutes: number
  mostPlayedGameName?: string
  mostPlayedMinutes?: number
  achievementsUnlocked: number
  achievementsTotal: number
}

export type GameLaunchPhase = 'idle' | 'launching' | 'running' | 'returning' | 'error'
export const GAME_LAUNCH_CANCEL_WINDOW_MS = 3_000

export type GameLaunchFailureReason =
  | 'launch-rejected'
  | 'not-started'
  | 'startup-ended'
  | 'monitor-unavailable'

export interface GameLaunchStatus {
  phase: GameLaunchPhase
  gameId?: string
  gameName?: string
  provider?: GameProvider
  requestedAt?: number
  cancelableUntil?: number
  startedAt?: number
  detectedAt?: number
  endedAt?: number
  sessionDurationSeconds?: number
  totalPlaytimeSeconds?: number
  returnTask?: 'backing-up' | 'backup-complete' | 'backup-failed'
  failureReason?: GameLaunchFailureReason
  message?: string
}

export type StoreOfferSource = 'steam' | 'epic' | 'gog' | 'xbox' | 'instant-gaming'
export type StoreOfferKind = 'official' | 'keyshop' | 'search'

export interface StoreOffer {
  id: string
  source: StoreOfferSource
  sourceLabel: string
  kind: StoreOfferKind
  url: string
  available: boolean
  exactMatch: boolean
  priceMinor?: number
  originalPriceMinor?: number
  currency?: string
  formattedPrice?: string
  discountPercent?: number
  checkedAt: number
  platform?: 'pc' | 'xbox'
}

export interface StoreProduct {
  id: string
  steamAppId?: number
  canonicalSource?: StoreOfferSource
  sourceProductId?: string
  name: string
  summary?: string
  genres?: string[]
  developers?: string[]
  publishers?: string[]
  supportedLanguages?: string[]
  discoverEligible?: boolean
  artworkStatus?: 'available' | 'missing' | 'pending'
  searchOnly?: boolean
  releaseDateText?: string
  headerUrl?: string
  heroUrl?: string
  portraitUrl?: string
  steamWishlisted: boolean
  orbitWishlisted: boolean
  steamWishlistAddedAt?: number
  offers: StoreOffer[]
  bestOffer?: StoreOffer
  recommendationScore: number
  recommendationReason?: string
  detailsUpdatedAt?: number
  priceUpdatedAt?: number
  providerPricesUpdatedAt?: number
  providerPipelineVersion?: number
  updatedAt: number
}

export interface StoreRelease {
  id: string
  source: StoreOfferSource
  sourceProductId: string
  steamAppId?: number
  name: string
  releaseDate: number
  capsuleUrl: string
  heroUrl?: string
  storeUrl: string
  featured: boolean
  orbitWishlisted: boolean
}

export interface StorePricePoint {
  priceMinor: number
  currency: string
  source: StoreOfferSource
  recordedAt: number
}

export interface StorePriceAlert {
  id: string
  productId: string
  region: StoreRegionId
  targetPriceMinor: number
  currency: string
  startPriceMinor?: number
  currentPriceMinor?: number
  createdAt: number
  triggeredAt?: number
  enabled: boolean
}

export interface StoreSnapshot {
  products: StoreProduct[]
  monthlyReleases: StoreRelease[]
  releaseCalendarMonth?: string
  releaseCalendarUpdatedAt?: number
  releaseCalendarError: boolean
  catalogError: boolean
  region: StoreRegionId
  updatedAt: number
  lastSuccessfulRefreshAt?: number
  isRefreshing: boolean
  changedSinceLastRefresh: number
  priceHistory: Record<string, StorePricePoint[]>
  priceAlerts: StorePriceAlert[]
}

export interface StoreSearchResponse {
  query: string
  products: StoreProduct[]
}

export type ImageOrientation = 'vertical' | 'horizontal' | 'icon'

export interface ResolvedImage {
  url: string
  contain: boolean
  revision: number
}

export interface ImageUpdate {
  gameId: string
  orientation: ImageOrientation
  image: ResolvedImage | null
}

export interface SteamGridDbArtworkOption {
  id: number
  previewUrl: string
  width?: number
  height?: number
  authorName?: string
}

export interface SteamGridDbArtworkOptions {
  state: 'ready' | 'missing' | 'unavailable' | 'not-configured'
  options: SteamGridDbArtworkOption[]
}

export type SyncPipelineId = 'library' | 'metadata' | 'artwork' | 'achievements' | 'store'
export type SyncPipelineState = 'idle' | 'running' | 'complete' | 'error'

export interface SyncPipelineProgress {
  id: SyncPipelineId
  state: SyncPipelineState
  completed: number
  total: number
  detail?: string
  updatedAt: number
}

export interface SystemSyncStatus {
  startedAt?: number
  updatedAt: number
  pipelines: Record<SyncPipelineId, SyncPipelineProgress>
}

export const IPC = {
  steamLoginStart: 'steam:login:start',
  steamLoginCancel: 'steam:login:cancel',
  steamLoginStatus: 'steam:login:status',
  steamAccountUpdated: 'steam:account:updated',
  steamLogout: 'steam:logout',
  steamGetAccount: 'steam:get-account',
  epicLoginStart: 'epic:login:start',
  epicLoginCancel: 'epic:login:cancel',
  epicLoginStatus: 'epic:login:status',
  epicLogout: 'epic:logout',
  epicGetAccount: 'epic:get-account',
  friendsGet: 'friends:get',
  friendsRefresh: 'friends:refresh',
  friendsConnect: 'friends:provider:connect',
  friendsDisconnect: 'friends:provider:disconnect',
  friendsUpdated: 'friends:updated',
  friendsOpenProvider: 'friends:provider:open',
  libraryGet: 'library:get',
  libraryStatsGet: 'library:stats:get',
  libraryRefresh: 'library:refresh',
  libraryUpdated: 'library:updated',
  launcherDownloadsGet: 'launcher-downloads:get',
  launcherDownloadsUpdated: 'launcher-downloads:updated',
  customGameBeginImport: 'library:custom:import:begin',
  customGameSelectArtwork: 'library:custom:artwork:select',
  customGameSelectSave: 'library:custom:save:select',
  customGameClearSave: 'library:custom:save:clear',
  customGameCommit: 'library:custom:commit',
  customGameSetLaunchArguments: 'library:custom:launch-arguments:set',
  customGameCancel: 'library:custom:cancel',
  customGameRemove: 'library:custom:remove',
  customGameBackup: 'library:custom:backup',
  customGameOpenBackups: 'library:custom:backups:open',
  gameLaunch: 'game:launch',
  gameLaunchCancel: 'game:launch:cancel',
  gameLaunchGet: 'game:launch:get',
  gameLaunchRevealLauncher: 'game:launch:reveal-launcher',
  gameLaunchStatus: 'game:launch:status',
  gameCompletionTimesResolve: 'game:completion-times:resolve',
  gameAchievementsResolve: 'game:achievements:resolve',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  profileAvatarGetCustom: 'profile-avatar:custom:get',
  profileAvatarSelectCustom: 'profile-avatar:custom:select',
  appVersion: 'app:version',
  appUpdateGet: 'app:update:get',
  appUpdateCheck: 'app:update:check',
  appUpdateDownload: 'app:update:download',
  appUpdateInstall: 'app:update:install',
  appUpdateDefer: 'app:update:defer',
  appUpdateStatus: 'app:update:status',
  backgroundServiceGetStatus: 'background-service:status:get',
  backgroundServiceControl: 'background-service:control',
  backgroundServiceStatus: 'background-service:status',
  hardwareControlGetStatus: 'hardware-control:status:get',
  hardwareControlStatus: 'hardware-control:status',
  imageResolve: 'image:resolve',
  imageSteamGridDbList: 'image:steamgriddb:list',
  imageSteamGridDbApply: 'image:steamgriddb:apply',
  imageSelectCustom: 'image:custom:select',
  imagePasteCustom: 'image:custom:paste',
  imageResetCustom: 'image:custom:reset',
  imageHasCustom: 'image:custom:has',
  imageReportFailure: 'image:failure:report',
  imageUpdated: 'image:updated',
  storeGet: 'store:get',
  storeRefresh: 'store:refresh',
  storeCompareProduct: 'store:product:compare',
  storeSearch: 'store:search',
  storeUpdated: 'store:updated',
  storeToggleWishlist: 'store:wishlist:toggle',
  storeSetPriceAlert: 'store:price-alert:set',
  storeRemovePriceAlert: 'store:price-alert:remove',
  storeSetRegion: 'store:region:set',
  syncGet: 'sync:get',
  syncUpdated: 'sync:updated',
  systemUpdatesCheck: 'system:updates:check',
  systemOpenUpdateSettings: 'system:updates:open-settings',
  systemStatusGet: 'system:status:get',
  systemStatusRefresh: 'system:status:refresh',
  systemStatusUpdated: 'system:status:updated',
  systemOpenSettings: 'system:settings:open',
  systemPower: 'system:power',
  appControl: 'app:control',
  openExternal: 'shell:open-external'
} as const
