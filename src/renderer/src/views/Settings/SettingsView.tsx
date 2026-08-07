import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AppWindow,
  Check,
  AudioLines,
  Globe2,
  Eye,
  ImageIcon,
  Layers3,
  LayoutTemplate,
  LibraryBig,
  Loader2,
  LogOut,
  Palette,
  RotateCcw,
  SlidersHorizontal,
  Trophy
} from 'lucide-react'
import { useAutoFocus } from '@renderer/hooks/useAutoFocus'
import {
  usePreferencesStore,
  THEME_OPTIONS,
  HOME_LAYOUT_OPTIONS,
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
import { useT } from '@renderer/i18n/useT'
import { focusElement } from '@renderer/lib/spatialNavigation'
import type { TranslationKey } from '@renderer/i18n/translations'
import type { AudioPreset, OrbitSettings, StoreRegionId, UiDensity } from '@shared/ipc'

const themeSwatch: Record<string, string> = {
  midnight: 'from-[#3fd0ff] to-[#8b5cf6]',
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

const DENSITY_OPTIONS: {
  id: UiDensity
  labelKey: 'settings.density.standard' | 'settings.density.compact'
}[] = [
  { id: 'standard', labelKey: 'settings.density.standard' },
  { id: 'compact', labelKey: 'settings.density.compact' }
]

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
  icon: typeof Palette
}[] = [
  { id: 'interface', labelKey: 'settings.page.interface', icon: Palette },
  { id: 'libraries', labelKey: 'settings.page.libraries', icon: LibraryBig },
  { id: 'advanced', labelKey: 'settings.page.advanced', icon: SlidersHorizontal }
]

const pageVariants = {
  enter: (direction: 1 | -1) => ({ x: direction * 72, opacity: 0, scale: 0.985 }),
  center: { x: 0, opacity: 1, scale: 1 },
  exit: (direction: 1 | -1) => ({ x: direction * -52, opacity: 0, scale: 0.99 })
}

export function SettingsView(): JSX.Element {
  const containerRef = useAutoFocus<HTMLDivElement>()
  const t = useT()
  const setPhase = useNavigationStore((s) => s.setPhase)
  const setOnboardingStep = useNavigationStore((s) => s.setOnboardingStep)
  const {
    theme,
    homeLayout,
    uiDensity,
    language,
    audioPreset,
    showStoreTab,
    showHomeBanners,
    showAchievements,
    closeLaunchersAfterGame,
    setTheme,
    setHomeLayout,
    setDensity,
    setLanguage,
    setAudioPreset,
    setShowStoreTab,
    setShowHomeBanners,
    setShowAchievements,
    setCloseLaunchersAfterGame
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
  const xboxGameCount = useLibraryStore(
    (s) => s.snapshot.providerGames.filter((game) => game.provider === 'xbox').length
  )
  const xboxInstalledCount = useLibraryStore(
    (s) => s.snapshot.providerGames.filter((game) => game.provider === 'xbox' && game.installed).length
  )
  const accountSignature = `${account?.steamId ?? ''}:${epicAccount?.accountId ?? ''}`
  const previousAccountSignature = useRef(accountSignature)
  const [version, setVersion] = useState('')
  const [settings, setSettings] = useState<OrbitSettings | null>(null)

  useEffect(() => {
    void window.api.app.getVersion().then(setVersion)
    void window.api.settings.get().then(setSettings)
  }, [])

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

  return (
    <div ref={containerRef} className="flex h-full flex-col gap-5 overflow-hidden px-8 pb-8 pt-[6.5rem]">
      <div className="flex shrink-0 items-center justify-center">
        <div
          className="flex items-center gap-1 rounded-full border border-white/10 bg-black/25 p-1"
          aria-label={t('settings.page.label')}
        >
          <span className="mx-1 rounded-md border border-white/15 px-1.5 py-0.5 text-[10px] font-bold text-muted">
            LT
          </span>
          {SETTINGS_PAGES.map((item) => {
            const Icon = item.icon
            const active = page === item.id
            return (
              <motion.button
                key={item.id}
                data-focusable
                data-settings-page={item.id}
                aria-pressed={active}
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
          <span className="mx-1 rounded-md border border-white/15 px-1.5 py-0.5 text-[10px] font-bold text-muted">
            RT
          </span>
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
            {page === 'interface' && (
              <div className="space-y-5">
                <SettingsSection icon={Palette} title={t('settings.theme.title')}>
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 xl:grid-cols-12">
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
                </SettingsSection>

                <SettingsSection icon={LayoutTemplate} title={t('settings.homeLayout.title')}>
                  <p className="mb-4 text-xs leading-relaxed text-muted">
                    {t('settings.homeLayout.body')}
                  </p>
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    {HOME_LAYOUT_OPTIONS.map((option) => {
                      const active = homeLayout === option.id
                      const isFloat = option.id === 'float'
                      return (
                        <motion.button
                          key={option.id}
                          data-focusable
                          type="button"
                          aria-pressed={active}
                          onClick={() => void setHomeLayout(option.id)}
                          whileHover={{ y: -2 }}
                          whileTap={{ scale: 0.985 }}
                          className={`rounded-2xl border p-3 text-left transition-colors ${
                            active
                              ? 'border-accent/70 bg-accent/12'
                              : 'border-white/[0.07] bg-black/20 hover:bg-white/[0.05]'
                          }`}
                        >
                          <div className="mb-3 flex h-24 gap-2 overflow-hidden rounded-xl border border-white/[0.07] bg-black/45 p-3">
                            {isFloat ? (
                              <>
                                <div className="flex flex-1 flex-col gap-2">
                                  <div className="h-5 rounded-md border border-white/10 bg-white/[0.06]" />
                                  <div className="flex flex-1 items-end gap-2">
                                    {[0, 1, 2, 3].map((index) => (
                                      <div
                                        key={index}
                                        className={`h-full flex-1 rounded-md bg-gradient-to-b ${
                                          index === 0
                                            ? 'from-accent/75 to-accent-2/55'
                                            : 'from-white/15 to-white/[0.04]'
                                        }`}
                                      />
                                    ))}
                                  </div>
                                </div>
                              </>
                            ) : (
                              <div className="flex flex-1 flex-col gap-2">
                                <div className="grid h-9 grid-cols-[1.3fr_0.7fr] gap-2">
                                  <div className="rounded-md bg-gradient-to-r from-accent/45 to-white/[0.05]" />
                                  <div className="rounded-md bg-white/[0.07]" />
                                </div>
                                <div className="flex flex-1 gap-2">
                                  {[0, 1, 2, 3, 4].map((index) => (
                                    <div
                                      key={index}
                                      className={`flex-1 rounded-md ${
                                        index === 0 ? 'bg-accent/70' : 'bg-white/[0.08]'
                                      }`}
                                    />
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-bold tracking-wide">{option.label}</p>
                              <p className="mt-1 text-xs leading-relaxed text-white/42">
                                {t(
                                  isFloat
                                    ? 'settings.homeLayout.floatBody'
                                    : 'settings.homeLayout.orbitBody'
                                )}
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

                <SettingsSection icon={Eye} title={t('settings.visibility.title')}>
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    <SettingsToggle
                      id="showStoreTab"
                      active={showStoreTab}
                      title={t('settings.visibility.store')}
                      description={t('settings.visibility.storeBody')}
                      defaultActive
                      onChange={(active) => void setShowStoreTab(active)}
                      t={t}
                    />
                    <SettingsToggle
                      id="showHomeBanners"
                      active={showHomeBanners}
                      title={t('settings.visibility.homeBanners')}
                      description={t(
                        homeLayout === 'float'
                          ? 'settings.visibility.homeBannersFloat'
                          : 'settings.visibility.homeBannersBody'
                      )}
                      defaultActive
                      disabled={homeLayout === 'float'}
                      onChange={(active) => void setShowHomeBanners(active)}
                      t={t}
                    />
                  </div>
                </SettingsSection>

                <SettingsSection icon={AudioLines} title={t('settings.audio.title')}>
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

                <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                  <SettingsSection icon={Layers3} title={t('settings.density.title')}>
                    <div className="flex gap-3">
                      {DENSITY_OPTIONS.map((option) => (
                        <OptionPill
                          key={option.id}
                          active={uiDensity === option.id}
                          onClick={() => void setDensity(option.id)}
                        >
                          {t(option.labelKey)}
                        </OptionPill>
                      ))}
                    </div>
                  </SettingsSection>

                  <SettingsSection icon={SlidersHorizontal} title={t('settings.language.title')}>
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
                </div>
              </div>
            )}

            {page === 'libraries' && (
              <SettingsSection icon={LibraryBig} title={t('settings.account.title')}>
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
                  <StoreAccountCard
                    store="Steam"
                    badge="S"
                    badgeClass="bg-[#1b2838]"
                    description={
                      account
                        ? t('settings.account.connectedName', { name: account.accountName })
                        : t('settings.account.notConnected')
                    }
                    connected={Boolean(account)}
                    waiting={steamStatus.state === 'waiting-for-browser'}
                    connectLabel={t('settings.account.connectSteam')}
                    signOutLabel={t('settings.account.signOut')}
                    onConnect={() => void startSteamLogin()}
                    onLogout={() => void logout()}
                  />
                  <StoreAccountCard
                    store="Epic Games"
                    badge="E"
                    badgeClass="bg-[#2a2a2a]"
                    description={
                      epicAccount
                        ? t('settings.account.connectedName', { name: epicAccount.displayName })
                        : t('settings.account.epicNotConnected')
                    }
                    connected={Boolean(epicAccount)}
                    waiting={epicStatus.state === 'waiting-for-browser'}
                    connectLabel={t('settings.account.connectEpic')}
                    signOutLabel={t('settings.account.signOut')}
                    onConnect={() => void startEpicLogin()}
                    onLogout={() => void logoutEpic()}
                  />
                  <LocalLibraryCard
                    store={t('settings.account.xboxTitle')}
                    badge="X"
                    badgeClass="bg-[#107c10]"
                    description={t('settings.account.xboxLocal', {
                      count: xboxGameCount,
                      installed: xboxInstalledCount
                    })}
                    status={t('settings.account.localDetection')}
                  />
                </div>
              </SettingsSection>
            )}

            {page === 'advanced' && (
              <div className="space-y-5">
                <SettingsSection icon={Trophy} title={t('settings.integrations.title')}>
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
                <SettingsSection icon={AppWindow} title={t('settings.launchBehavior.title')}>
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
                <SettingsSection icon={Globe2} title={t('settings.storeRegion.title')}>
                  <p className="mb-4 text-sm text-muted">{t('settings.storeRegion.body')}</p>
                  <div className="flex flex-wrap gap-3">
                    {STORE_REGION_OPTIONS.map((option) => (
                      <OptionPill
                        key={option.id}
                        active={(settings?.storeRegion ?? 'eu') === option.id}
                        onClick={() => {
                          void window.api.store.setRegion(option.id)
                          setSettings((current) =>
                            current ? { ...current, storeRegion: option.id } : current
                          )
                        }}
                      >
                        {t(option.labelKey)}
                      </OptionPill>
                    ))}
                  </div>
                </SettingsSection>

                <SettingsSection icon={ImageIcon} title={t('settings.images.title')}>
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
                    <Loader2 size={18} className="animate-spin text-muted" />
                  )}
                </SettingsSection>

                <SettingsSection icon={RotateCcw} title={t('settings.onboarding.title')}>
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

                <SettingsSection icon={SlidersHorizontal} title={t('settings.about.title')}>
                  <p className="text-sm text-muted">
                    {t('settings.about.version', { version: version || '0.0.0.3' })}
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
  icon: Icon,
  title,
  children
}: {
  icon: typeof Palette
  title: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <section className="rounded-xl2 border border-white/[0.07] bg-white/[0.035] p-5 shadow-card backdrop-blur-xl">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-muted">
        <Icon size={15} />
        {title}
      </h3>
      {children}
    </section>
  )
}

function OptionPill({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <motion.button
      data-focusable
      onClick={onClick}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      className={`flex items-center gap-2 rounded-full px-5 py-2.5 text-sm ${
        active ? 'bg-accent font-semibold text-black' : 'bg-white/5 text-muted'
      }`}
    >
      {active && <Check size={14} />}
      {children}
    </motion.button>
  )
}

function StoreAccountCard({
  store,
  badge,
  badgeClass,
  description,
  connected,
  waiting,
  connectLabel,
  signOutLabel,
  onConnect,
  onLogout
}: {
  store: string
  badge: string
  badgeClass: string
  description: string
  connected: boolean
  waiting: boolean
  connectLabel: string
  signOutLabel: string
  onConnect: () => void
  onLogout: () => void
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/[0.06] bg-black/20 p-5">
      <div className="flex min-w-0 items-center gap-3">
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${badgeClass}`}
        >
          <span className="text-sm font-bold text-white">{badge}</span>
        </div>
        <div className="min-w-0">
          <p className="font-medium">{store}</p>
          <p className="truncate text-xs text-muted">{description}</p>
        </div>
      </div>
      {connected ? (
        <FocusableButton variant="ghost" onClick={onLogout} className="shrink-0">
          <span className="flex items-center gap-2">
            <LogOut size={14} />
            {signOutLabel}
          </span>
        </FocusableButton>
      ) : (
        <FocusableButton onClick={onConnect} className="shrink-0">
          <span className="flex items-center gap-2">
            {waiting && <Loader2 size={14} className="animate-spin" />}
            {connectLabel}
          </span>
        </FocusableButton>
      )}
    </div>
  )
}

function LocalLibraryCard({
  store,
  badge,
  badgeClass,
  description,
  status
}: {
  store: string
  badge: string
  badgeClass: string
  description: string
  status: string
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/[0.06] bg-black/20 p-5">
      <div className="flex min-w-0 items-center gap-3">
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${badgeClass}`}
        >
          <span className="text-sm font-bold text-white">{badge}</span>
        </div>
        <div className="min-w-0">
          <p className="font-medium">{store}</p>
          <p className="line-clamp-2 text-xs text-muted">{description}</p>
        </div>
      </div>
      <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-[#107c10]/20 px-3 py-2 text-xs font-semibold text-[#6ee7a0]">
        <Check size={13} />
        {status}
      </span>
    </div>
  )
}
