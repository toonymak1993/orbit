import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AppWindow,
  BellRing,
  Check,
  CheckCircle2,
  CircleAlert,
  Download,
  ExternalLink,
  AudioLines,
  Globe2,
  Gamepad2,
  Eye,
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
  Trophy,
  UserRound
} from 'lucide-react'
import { useAutoFocus } from '@renderer/hooks/useAutoFocus'
import {
  usePreferencesStore,
  THEME_OPTIONS,
  HOME_LAYOUT_OPTIONS,
  GAME_CARD_SIZE_OPTIONS,
  BACKDROP_INTENSITY_OPTIONS,
  LANGUAGE_OPTIONS
} from '@renderer/state/preferencesStore'
import { useAuthStore } from '@renderer/state/authStore'
import { useEpicAuthStore } from '@renderer/state/epicAuthStore'
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
import { ControllerButtonHint } from '@renderer/components/ControllerButtonHint'
import {
  PROFILE_AVATAR_OPTIONS,
  ProfileAvatarPicker
} from '@renderer/components/ProfileAvatar'
import { useControllerButtonLabels } from '@renderer/state/controllerStore'
import { useT } from '@renderer/i18n/useT'
import { focusElement } from '@renderer/lib/spatialNavigation'
import { notify } from '@renderer/state/notificationStore'
import type { TranslationKey } from '@renderer/i18n/translations'
import type {
  AudioPreset,
  BackdropIntensity,
  GameCardSize,
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
  StoreRegionId,
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
  float: 'settings.homeLayout.floatBody',
  coresense: 'settings.homeLayout.coresenseBody'
}

const DENSITY_OPTIONS: {
  id: UiDensity
  labelKey: 'settings.density.standard' | 'settings.density.compact'
}[] = [
  { id: 'standard', labelKey: 'settings.density.standard' },
  { id: 'compact', labelKey: 'settings.density.compact' }
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

const LIBRARY_METHOD_KEYS: Record<LibraryDetectionMethod, TranslationKey> = {
  'local-manifests': 'settings.libraryStatus.method.localManifests',
  'account-api': 'settings.libraryStatus.method.accountApi',
  'community-profile': 'settings.libraryStatus.method.communityProfile',
  'launcher-session': 'settings.libraryStatus.method.launcherSession',
  'epic-catalog': 'settings.libraryStatus.method.epicCatalog',
  'xbox-app-cache': 'settings.libraryStatus.method.xboxAppCache',
  'windows-packages': 'settings.libraryStatus.method.windowsPackages',
  'cached-data': 'settings.libraryStatus.method.cachedData'
}

const LIBRARY_ISSUE_KEYS: Record<LibraryProviderIssue, TranslationKey> = {
  'not-connected': 'settings.libraryStatus.issue.notConnected',
  'online-library-unavailable': 'settings.libraryStatus.issue.onlineUnavailable',
  'metadata-pending': 'settings.libraryStatus.issue.metadataPending',
  'source-unavailable': 'settings.libraryStatus.issue.sourceUnavailable',
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
    backdropIntensity,
    homeCardBubbleEffect,
    uiDensity,
    language,
    audioPreset,
    showStoreTab,
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
    setBackdropIntensity,
    setHomeCardBubbleEffect,
    setDensity,
    setLanguage,
    setAudioPreset,
    setShowStoreTab,
    setShowHomeBanners,
    setShowAchievements,
    setCloseLaunchersAfterGame,
    setNotificationsEnabled,
    setNotificationPosition,
    setNotificationMotion
  } = usePreferencesStore()
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
  const refreshLibrary = useLibraryStore((s) => s.refresh)
  const librarySnapshot = useLibraryStore((s) => s.snapshot)
  const isRefreshingLibrary = useLibraryStore((s) => s.isRefreshing)
  const libraryGameCount = librarySnapshot.games.length
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
  const xboxLibraryStatus = providerStatusOrFallback(
    librarySnapshot.providerStatuses,
    librarySnapshot.providerGames,
    'xbox',
    'automatic'
  )
  const readyLibraryCount = [steamLibraryStatus, epicLibraryStatus, xboxLibraryStatus].filter(
    (status) => status.state === 'ready'
  ).length
  const accountSignature = `${account?.steamId ?? ''}:${epicAccount?.accountId ?? ''}`
  const previousAccountSignature = useRef(accountSignature)
  const [version, setVersion] = useState('')
  const [settings, setSettings] = useState<OrbitSettings | null>(null)
  const [regionSaveState, setRegionSaveState] = useState<'idle' | 'saving' | 'error'>('idle')
  const [updateSnapshot, setUpdateSnapshot] = useState<SystemUpdateSnapshot | null>(null)
  const [updateCheckState, setUpdateCheckState] = useState<'idle' | 'checking' | 'error'>('idle')
  const updateCheckInFlight = useRef(false)
  const pendingUpdateCount =
    (updateSnapshot?.windowsUpdates.length ?? 0) +
    (updateSnapshot?.graphicsDriverUpdates.length ?? 0)
  const activePage = SETTINGS_PAGES.find((item) => item.id === page) ?? SETTINGS_PAGES[0]
  const activePageIndex = SETTINGS_PAGES.indexOf(activePage)
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
                label: t('settings.summary.sources'),
                value: t('settings.summary.sourcesValue', {
                  count: readyLibraryCount
                })
              },
              {
                label: t('settings.summary.games'),
                value: t('settings.summary.gamesValue', { count: libraryGameCount })
              },
              {
                label: t('settings.summary.region'),
                value: t(
                  STORE_REGION_OPTIONS.find(
                    (item) => item.id === (settings?.storeRegion ?? 'eu')
                  )?.labelKey ?? 'store.region.eu'
                )
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
                    label: t('settings.summary.pending'),
                    value: updateSnapshot
                      ? pendingUpdateCount > 0
                        ? t('settings.summary.updateCount', { count: pendingUpdateCount })
                        : t('settings.summary.upToDate')
                      : t('settings.summary.notChecked')
                  },
                  {
                    label: t('settings.summary.graphics'),
                    value: t('settings.summary.adapterCount', {
                      count: updateSnapshot?.graphicsAdapters.length ?? 0
                    })
                  },
                  {
                    label: t('settings.summary.lastCheck'),
                    value: updateSnapshot
                      ? formatUpdateDate(updateSnapshot.checkedAt, language)
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
    void window.api.settings.get().then(setSettings)
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

  return (
    <div ref={containerRef} className="flex h-full flex-col gap-5 overflow-hidden px-8 pb-8 pt-[6.5rem]">
      <div className="flex shrink-0 items-center justify-center">
        <div
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

                <SettingsSection index="03" icon={Layers3} title={t('settings.presentation.title')}>
                  <p className="mb-4 max-w-3xl text-xs leading-relaxed text-muted">
                    {t('settings.presentation.body')}
                  </p>
                  <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
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
                </SettingsSection>

                <SettingsSection index="04" icon={LayoutTemplate} title={t('settings.homeLayout.title')}>
                  <p className="mb-4 text-xs leading-relaxed text-muted">
                    {t('settings.homeLayout.body')}
                  </p>
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
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
                  <SettingsToggle
                    id="showAchievements"
                    active={showAchievements}
                    title={t('settings.integrations.achievements')}
                    description={t('settings.integrations.achievementsBody')}
                    defaultActive
                    onChange={(active) => void setShowAchievements(active)}
                    t={t}
                  />
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
                <SettingsSection index="01" icon={LibraryBig} title={t('settings.account.title')}>
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
                  <div className="grid grid-cols-1 gap-3 2xl:grid-cols-3">
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
                  </div>
                </SettingsSection>

                <SettingsSection index="02" icon={Globe2} title={t('settings.storeRegion.title')}>
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

                <SettingsSection index="03" icon={ImageIcon} title={t('settings.images.title')}>
                  <p className="mb-4 max-w-4xl text-sm leading-relaxed text-muted">
                    {t('settings.images.body')}
                  </p>
                  {settings ? (
                    <ApiKeyField
                      label={t('settings.images.apiKeyLabel')}
                      value={settings.steamGridDbApiKey ?? ''}
                      placeholder={t('settings.images.apiKeyPlaceholder')}
                      getKeyLabel={t('settings.images.getKey')}
                      getKeyUrl="https://www.steamgriddb.com/profile/preferences/api"
                      onSave={async (value) => {
                        await window.api.settings.set({ steamGridDbApiKey: value || undefined })
                        setSettings((current) =>
                          current
                            ? { ...current, steamGridDbApiKey: value || undefined }
                            : current
                        )
                      }}
                    />
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
              <SystemUpdatesPanel
                snapshot={updateSnapshot}
                checkState={updateCheckState}
                language={language}
                onCheck={() => void checkSystemUpdates()}
              />
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
    <div className="mt-5 space-y-5">
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

      <SettingsSection index="01" icon={Download} title={t('settings.updates.windowsTitle')}>
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

      <SettingsSection index="02" icon={Monitor} title={t('settings.updates.graphicsTitle')}>
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
  preview,
  onClick
}: {
  active: boolean
  title: string
  description: string
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
        <span className={`block text-xs font-bold ${active ? 'text-white' : 'text-white/70'}`}>
          {title}
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

function HomeLayoutPreview({ layout }: { layout: HomeLayoutId }): JSX.Element {
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
