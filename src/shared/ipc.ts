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
export const DOCK_THEME_IDS = ['standard', 'glass', 'neon', 'minimal'] as const
export type DockThemeId = (typeof DOCK_THEME_IDS)[number]
export const DOCK_SIZES = ['compact', 'standard', 'large'] as const
export type DockSize = (typeof DOCK_SIZES)[number]
export const DOCK_MOTIONS = ['calm', 'standard', 'lively'] as const
export type DockMotion = (typeof DOCK_MOTIONS)[number]
export const STARTUP_ANIMATION_MODES = ['orbit', 'custom', 'off'] as const
export type StartupAnimationMode = (typeof STARTUP_ANIMATION_MODES)[number]
export const CUSTOM_STARTUP_VIDEO_URL = 'orbit-media://startup.mp4'
export type HomeLayoutId = 'orbit' | 'float' | 'coresense' | 'xmode'
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
export type OrbitWallpaperApplyState = 'applied' | 'failed' | 'unsupported'

/** Sanitized result of applying ORBIT's bundled Windows personalization asset. */
export interface OrbitWallpaperApplyResult {
  platform: 'windows' | 'unsupported'
  desktop: OrbitWallpaperApplyState
  lockScreen: OrbitWallpaperApplyState
  appliedAt: number
}

export type AppControlAction = 'relaunch' | 'quit'
export type GraphicsAdapterVendor = 'nvidia' | 'amd' | 'intel' | 'other'

export type OrbitApplicationCategory = 'media' | 'launcher' | 'standard' | 'custom'
export type OrbitApplicationTarget = 'native' | 'web' | 'orbit-media'

export interface OrbitApplication {
  id: string
  name: string
  category: OrbitApplicationCategory
  target: OrbitApplicationTarget
  available: boolean
  issue?: 'executable-missing' | 'unsupported-platform'
  /** Custom executable paths are shown for transparent editing. Built-in discovery paths stay private. */
  executablePath?: string
  launchArguments?: string
  iconDataUrl?: string
  controllerOptimized?: boolean
}

export interface OrbitApplicationSnapshot {
  applications: OrbitApplication[]
  scannedAt: number
  platform: 'windows' | 'unsupported'
}

export type MediaKeyboardShortcut =
  | 'backspace'
  | 'space'
  | 'cursor-left'
  | 'cursor-right'
  | 'shift'
  | 'layout'
  | 'done'

export interface MediaKeyboardOpenPayload {
  requestId: string
  value: string
  selectionStart: number
  selectionEnd: number
  inputType: 'email' | 'number' | 'password' | 'search' | 'tel' | 'text' | 'url'
  label?: string
  maxLength?: number
}

export interface MediaKeyboardUpdatePayload {
  requestId: string
  value: string
  selectionStart: number
  selectionEnd: number
}

export interface MediaOverlayHintPayload {
  id: string
  title: string
  message: string
}

export interface CustomApplicationDraft {
  draftId: string
  suggestedName: string
  executablePath: string
  iconDataUrl?: string
}

export interface CustomApplicationCommitInput {
  draftId: string
  name: string
  launchArguments?: string
}

export interface CustomApplicationUpdateInput {
  applicationId: string
  name: string
  launchArguments?: string
}

export interface ApplicationLaunchResult {
  applicationId: string
  applicationName: string
  controllerBridge: 'active' | 'unavailable' | 'not-needed'
}
export const PLAYSTATION_REMOTE_PLAY_PREFERENCES = [
  'auto',
  'chiaki',
  'ps-remote-play'
] as const
export type PlayStationRemotePlayPreference =
  (typeof PLAYSTATION_REMOTE_PLAY_PREFERENCES)[number]
export type PlayStationRemotePlayAppId = Exclude<PlayStationRemotePlayPreference, 'auto'>

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
  /** Games hidden from launcher surfaces by durable `<provider>:<providerGameId>` identity. */
  excludedGameIds: string[]
  backdropIntensity: BackdropIntensity
  homeCardBubbleEffect: boolean
  startupAnimationMode: StartupAnimationMode
  dockTheme: DockThemeId
  dockSize: DockSize
  dockMotion: DockMotion
  uiDensity: UiDensity
  language: Language
  audioPreset: AudioPreset
  hasCompletedOnboarding: boolean
  steamGridDbApiKey?: string
  steamWebApiKey?: string
  storeRegion: StoreRegionId
  showStoreTab: boolean
  showFriendsHub: boolean
  showHomeBanners: boolean
  showAchievements: boolean
  closeLaunchersAfterGame: boolean
  notificationsEnabled: boolean
  notificationPosition: NotificationPosition
  notificationMotion: NotificationMotion
  appUpdateAutoDownload: boolean
  retroRomDirectories: string[]
  /** Explicit emulator choice per ROM system. Missing entries use automatic detection. */
  retroSystemEmulators: Partial<Record<RetroSystemId, string>>
  retroAchievementsUsername?: string
  playstationRemotePlayPreference: PlayStationRemotePlayPreference
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

export interface RetroAchievementsCredentialStatus {
  /** True only when the main process can decrypt a stored Web API key. */
  configured: boolean
}

export type PlayStationLoginStatus =
  | { state: 'idle' }
  | { state: 'waiting-for-browser' }
  | { state: 'success'; account: PlayStationAccount }
  | { state: 'error'; message: string }

export interface PlayStationAccount {
  accountId: string
  onlineId: string
  avatarUrl?: string
}

/** Path-free local Remote Play discovery state. Executable paths never cross
 * the Electron process boundary. */
export interface PlayStationRemotePlayStatus {
  platform: 'windows' | 'unsupported'
  apps: Array<{
    id: PlayStationRemotePlayAppId
    name: string
    installed: boolean
  }>
  preference: PlayStationRemotePlayPreference
  selectedApp?: PlayStationRemotePlayAppId
  checkedAt: number
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

export type DiscordChatIssue =
  | 'not-connected'
  | 'history-unavailable'
  | 'send-failed'
  | 'provider-unavailable'

export interface DiscordChatMessage {
  id: string
  userId: string
  content: string
  sentAt: number
  editedAt?: number
  direction: 'incoming' | 'outgoing'
  unsupportedContent: boolean
}

export interface DiscordChatHistory {
  state: 'ready' | 'unavailable'
  userId: string
  messages: DiscordChatMessage[]
  issue?: DiscordChatIssue
}

export interface DiscordChatConversation {
  userId: string
  lastMessageId: string
  lastMessage?: DiscordChatMessage
}

export interface DiscordChatInbox {
  state: 'ready' | 'unavailable'
  conversations: DiscordChatConversation[]
  issue?: DiscordChatIssue
}

export interface DiscordChatSendResult {
  ok: boolean
  message?: DiscordChatMessage
  issue?: DiscordChatIssue
}

export type DiscordChatEvent =
  | { kind: 'created' | 'updated'; message: DiscordChatMessage }
  | { kind: 'deleted'; messageId: string }

export type GameProvider =
  | 'steam'
  | 'epic'
  | 'gog'
  | 'xbox'
  | 'playstation'
  | 'retro'
  | 'ea'
  | 'ubisoft'
  | 'local'

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
  reason?: 'private' | 'unsupported' | 'unavailable' | 'not-connected'
  source?: 'steam-community' | 'steam-web-api' | 'retroachievements'
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
  /** Validated provider executable used for direct launch and process identification. */
  launchExecutable?: string
  /** Provider-supplied argv parsed and validated in the main process. */
  launchArguments?: string[]
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

export type RetroSystemId =
  | 'nes'
  | 'fds'
  | 'snes'
  | 'gb'
  | 'gbc'
  | 'gba'
  | 'n64'
  | 'nds'
  | 'gamecube'
  | 'wii'
  | 'wiiu'
  | 'megadrive'
  | 'mastersystem'
  | 'gamegear'
  | 'sega32x'
  | 'segacd'
  | 'saturn'
  | 'dreamcast'
  | 'ps1'
  | 'ps2'
  | 'psp'
  | 'atari2600'
  | 'atari7800'
  | 'atarilynx'
  | 'pce'
  | 'wonderswan'
  | 'wonderswancolor'
  | 'ngp'
  | 'ngpc'
  | 'virtualboy'
  | 'colecovision'
  | 'arcade'

export type RetroAchievementMatch =
  | 'matched'
  | 'unmatched'
  | 'unavailable'
  | 'not-configured'
  | 'unsupported'

export interface RetroGameConfig {
  romPath: string
  sourceDirectory: string
  systemId: RetroSystemId
  systemName: string
  emulatorId?: string
  emulatorName?: string
  emulatorPath?: string
  corePath?: string
  /** Complete per-game argv override. ORBIT still enforces the emulator's fullscreen contract. */
  launchArguments?: string[]
  retroAchievementsHash?: string
  retroAchievementsGameId?: number
  retroAchievementsMatch: RetroAchievementMatch
}

export interface DetectedRetroEmulator {
  id: string
  name: string
  kind: 'retroarch' | 'standalone'
  supportedSystems: RetroSystemId[]
  readySystems: RetroSystemId[]
  achievementsSupported: boolean
  coreCount?: number
}

export interface RetroRomDirectoryStatus {
  path: string
  state: 'ready' | 'missing' | 'error'
  gameCount: number
  issue?: 'scan-failed' | 'scan-limit-reached'
}

export interface RetroLibraryStatus {
  state: 'idle' | 'scanning' | 'ready' | 'partial' | 'error'
  emulators: DetectedRetroEmulator[]
  directories: RetroRomDirectoryStatus[]
  gameCount: number
  matchedAchievementsCount: number
  scannedAt?: number
}

export interface RetroLibraryResult {
  snapshot: LibrarySnapshot
  status: RetroLibraryStatus
}

export interface RetroEmulatorDownloadInput {
  systemId: RetroSystemId
  /** Omit to open ORBIT's recommended emulator page for the system. */
  emulatorId?: string
}

export interface RetroEmulatorDownloadResult {
  systemId: RetroSystemId
  emulatorId: string
  emulatorName: string
  directoryPath: string
  emulatorDirectoryPath: string
  firmwareMayBeRequired: boolean
}

export interface RetroEmulatorInstallInput {
  systemId: RetroSystemId
  /** Omit to install ORBIT's recommended emulator for the system. */
  emulatorId?: string
}

export type RetroEmulatorInstallPhase =
  | 'checking'
  | 'resolving'
  | 'downloading'
  | 'extracting'
  | 'installing-core'
  | 'verifying'
  | 'complete'

export interface RetroEmulatorInstallProgress {
  systemId: RetroSystemId
  emulatorId: string
  emulatorName: string
  phase: RetroEmulatorInstallPhase
  receivedBytes?: number
  totalBytes?: number
}

export interface RetroEmulatorInstallResult extends RetroLibraryResult {
  systemId: RetroSystemId
  emulatorId: string
  emulatorName: string
  directoryPath: string
  emulatorDirectoryPath: string
  alreadyInstalled: boolean
  emulatorInstalled: boolean
  coreInstalled: boolean
  firmwareMayBeRequired: boolean
}

export interface RetroSystemDirectoryResult {
  systemId: RetroSystemId
  directoryPath: string
  created: boolean
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
  retro?: RetroGameConfig
  addedAt: number
  updatedAt: number
}

export type LibraryStatusProvider =
  | 'steam'
  | 'epic'
  | 'gog'
  | 'xbox'
  | 'playstation'
  | 'retro'
  | 'ea'
  | 'ubisoft'
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
  | 'psn-purchased-library'
  | 'psn-play-history'
  | 'remote-play-apps'
  | 'windows-registry'
  | 'launcher-cache'
  | 'rom-folders'
  | 'emulator-installations'
  | 'retroachievements-hash'
  | 'cached-data'
export type LibraryProviderIssue =
  | 'not-connected'
  | 'online-library-unavailable'
  | 'metadata-pending'
  | 'source-unavailable'
  | 'authentication-failed'
  | 'remote-play-app-unavailable'
  | 'emulator-missing'
  | 'rom-source-unavailable'
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
  /** User-facing game projection after provider-local cleanup and visibility policy. */
  games: LibraryGame[]
  /** Provider-filterable projection; durable identities remain in the main-process database. */
  providerGames: LibraryGame[]
  /** Excluded records remain available only to Settings so the choice is reversible. */
  excludedGames: LibraryGame[]
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
export const GAME_TRACKING_STOP_HOLD_MS = 3_000

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
  returnTask?: 'backing-up' | 'backup-complete' | 'backup-failed' | 'tracking-stopped'
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

export type ArtworkSearchSource = 'steam-store' | 'steamgriddb'

export interface ArtworkSearchOption {
  /** Opaque, server-validated candidate identity. Never a renderer-supplied URL. */
  id: string
  previewUrl: string
  source: ArtworkSearchSource
  sourceTitle?: string
  width?: number
  height?: number
  authorName?: string
}

export interface RetroGameLaunchArgumentsInput {
  gameId: string
  /** User-facing Windows argument string; parsed and validated in the main process. */
  launchArguments?: string
}

export interface ArtworkSearchOptions {
  state: 'ready' | 'missing' | 'unavailable'
  options: ArtworkSearchOption[]
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
  playstationLoginStart: 'playstation:login:start',
  playstationLoginCancel: 'playstation:login:cancel',
  playstationLoginStatus: 'playstation:login:status',
  playstationLogout: 'playstation:logout',
  playstationGetAccount: 'playstation:get-account',
  playstationRemotePlayGet: 'playstation:remote-play:get',
  playstationRemotePlayRefresh: 'playstation:remote-play:refresh',
  friendsGet: 'friends:get',
  friendsRefresh: 'friends:refresh',
  friendsConnect: 'friends:provider:connect',
  friendsDisconnect: 'friends:provider:disconnect',
  friendsUpdated: 'friends:updated',
  friendsOpenProvider: 'friends:provider:open',
  discordChatInbox: 'friends:discord-chat:inbox',
  discordChatHistory: 'friends:discord-chat:history',
  discordChatSend: 'friends:discord-chat:send',
  discordChatSetVisible: 'friends:discord-chat:set-visible',
  discordChatMessage: 'friends:discord-chat:message',
  libraryGet: 'library:get',
  libraryStatsGet: 'library:stats:get',
  libraryRefresh: 'library:refresh',
  libraryUpdated: 'library:updated',
  libraryGameExclude: 'library:game:exclude',
  libraryGameRestore: 'library:game:restore',
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
  retroLibraryStatusGet: 'library:retro:status:get',
  retroLibraryRefresh: 'library:retro:refresh',
  retroLibraryDirectoryAdd: 'library:retro:directory:add',
  retroLibraryDirectoryRemove: 'library:retro:directory:remove',
  retroSystemDirectoryEnsure: 'library:retro:system-directory:ensure',
  retroSystemDirectoryOpen: 'library:retro:system-directory:open',
  retroEmulatorDownloadOpen: 'library:retro:emulator-download:open',
  retroEmulatorInstall: 'library:retro:emulator:install',
  retroEmulatorInstallCancel: 'library:retro:emulator:install:cancel',
  retroEmulatorInstallProgress: 'library:retro:emulator:install-progress',
  retroGameSetLaunchArguments: 'library:retro:launch-arguments:set',
  gameLaunch: 'game:launch',
  gameLaunchCancel: 'game:launch:cancel',
  gameTrackingStop: 'game:tracking:stop',
  gameLaunchGet: 'game:launch:get',
  gameLaunchRevealLauncher: 'game:launch:reveal-launcher',
  gameLaunchStatus: 'game:launch:status',
  gameCompletionTimesResolve: 'game:completion-times:resolve',
  gameAchievementsResolve: 'game:achievements:resolve',
  gameAchievementsSync: 'game:achievements:sync',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  retroAchievementsCredentialGet: 'retro-achievements:credential:get',
  retroAchievementsCredentialSet: 'retro-achievements:credential:set',
  retroAchievementsCredentialClear: 'retro-achievements:credential:clear',
  profileAvatarGetCustom: 'profile-avatar:custom:get',
  profileAvatarSelectCustom: 'profile-avatar:custom:select',
  startupVideoGet: 'startup-video:get',
  startupVideoSelect: 'startup-video:select',
  applicationsGet: 'applications:get',
  applicationsRefresh: 'applications:refresh',
  applicationsLaunch: 'applications:launch',
  mediaKeyboardOpen: 'media-keyboard:open',
  mediaKeyboardShortcut: 'media-keyboard:shortcut',
  mediaKeyboardUpdate: 'media-keyboard:update',
  mediaKeyboardComplete: 'media-keyboard:complete',
  mediaKeyboardClose: 'media-keyboard:close',
  mediaOverlayHintOpen: 'media-overlay:hint-open',
  mediaOverlayHintDismiss: 'media-overlay:hint-dismiss',
  customApplicationSelect: 'applications:custom:select',
  customApplicationCommit: 'applications:custom:commit',
  customApplicationUpdate: 'applications:custom:update',
  customApplicationRemove: 'applications:custom:remove',
  customApplicationCancel: 'applications:custom:cancel',
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
  imageArtworkSearchList: 'image:artwork-search:list',
  imageArtworkSearchApply: 'image:artwork-search:apply',
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
  systemKeyboardShow: 'system:keyboard:show',
  systemStatusUpdated: 'system:status:updated',
  systemOpenSettings: 'system:settings:open',
  systemWallpaperApply: 'system:wallpaper:apply',
  systemPower: 'system:power',
  appControl: 'app:control',
  openExternal: 'shell:open-external'
} as const
