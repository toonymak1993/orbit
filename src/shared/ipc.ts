export type ThemeId =
  | 'midnight'
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
export type HomeLayoutId = 'orbit' | 'float'
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
export type AppControlAction = 'relaunch' | 'quit'

export interface OrbitSettings {
  theme: ThemeId
  homeLayout: HomeLayoutId
  uiDensity: UiDensity
  language: Language
  audioPreset: AudioPreset
  hasCompletedOnboarding: boolean
  steamGridDbApiKey?: string
  storeRegion: StoreRegionId
  showStoreTab: boolean
  showHomeBanners: boolean
  showAchievements: boolean
  closeLaunchersAfterGame: boolean
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

export type GameProvider = 'steam' | 'epic' | 'gog' | 'xbox' | 'ea' | 'ubisoft' | 'local'

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
  playtimeMinutes?: number
  lastPlayedTimestamp?: number
  lastStartedAt?: number
  installed: boolean
  installDir?: string
  addedAt: number
  updatedAt: number
}

export interface LibrarySnapshot {
  /** Cross-store canonical games used by Home and the combined library. */
  games: LibraryGame[]
  /** Complete provider records used by Steam/Epic/Xbox-specific tabs. */
  providerGames: LibraryGame[]
  recentGameIds: string[]
  loadedAt: number
  isLoadingMetadata: boolean
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

export interface GameLaunchStatus {
  phase: GameLaunchPhase
  gameId?: string
  gameName?: string
  provider?: GameProvider
  startedAt?: number
  detectedAt?: number
  endedAt?: number
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
  steamLogout: 'steam:logout',
  steamGetAccount: 'steam:get-account',
  epicLoginStart: 'epic:login:start',
  epicLoginCancel: 'epic:login:cancel',
  epicLoginStatus: 'epic:login:status',
  epicLogout: 'epic:logout',
  epicGetAccount: 'epic:get-account',
  libraryGet: 'library:get',
  libraryStatsGet: 'library:stats:get',
  libraryRefresh: 'library:refresh',
  libraryUpdated: 'library:updated',
  gameLaunch: 'game:launch',
  gameLaunchGet: 'game:launch:get',
  gameLaunchRevealLauncher: 'game:launch:reveal-launcher',
  gameLaunchStatus: 'game:launch:status',
  gameCompletionTimesResolve: 'game:completion-times:resolve',
  gameAchievementsResolve: 'game:achievements:resolve',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  appVersion: 'app:version',
  imageResolve: 'image:resolve',
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
  systemPower: 'system:power',
  appControl: 'app:control',
  openExternal: 'shell:open-external'
} as const
