import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Gamepad2,
  Globe2,
  ImageIcon,
  LayoutTemplate,
  LibraryBig,
  Loader2,
  Palette,
  Play,
  Sparkles,
  Trophy,
  Volume2
} from 'lucide-react'
import type {
  AudioPreset,
  HomeLayoutId,
  LibraryGame,
  LibraryStats,
  StoreRegionId,
  SyncPipelineProgress,
  ThemeId
} from '@shared/ipc'
import { FocusableButton } from '@renderer/components/FocusableButton'
import { GameImage } from '@renderer/components/GameImage'
import { useAutoFocus } from '@renderer/hooks/useAutoFocus'
import { useBackHandler } from '@renderer/hooks/useBackHandler'
import { useT } from '@renderer/i18n/useT'
import type { TranslationKey } from '@renderer/i18n/translations'
import { focusElement } from '@renderer/lib/spatialNavigation'
import { useAuthStore } from '@renderer/state/authStore'
import { useEpicAuthStore } from '@renderer/state/epicAuthStore'
import { useLibraryStore } from '@renderer/state/libraryStore'
import {
  LANGUAGE_OPTIONS,
  HOME_LAYOUT_OPTIONS,
  THEME_OPTIONS,
  usePreferencesStore
} from '@renderer/state/preferencesStore'
import { useSyncStore } from '@renderer/state/syncStore'

type SetupPage = 'libraries' | 'personalize' | 'ready'

interface Props {
  syncBaselineStartedAt?: number
  onBack: () => void
  onFinish: () => void
}

const PAGE_ORDER: SetupPage[] = ['libraries', 'personalize', 'ready']

const THEME_SWATCH: Record<ThemeId, string> = {
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

const AUDIO_OPTIONS: Array<{ id: AudioPreset; labelKey: TranslationKey }> = [
  { id: 'orbit', labelKey: 'settings.audio.orbit' },
  { id: 'soft', labelKey: 'settings.audio.soft' },
  { id: 'deep', labelKey: 'settings.audio.deep' },
  { id: 'minimal', labelKey: 'settings.audio.minimal' },
  { id: 'steam', labelKey: 'settings.audio.steam' },
  { id: 'xbox', labelKey: 'settings.audio.xbox' },
  { id: 'playstation', labelKey: 'settings.audio.playstation' },
  { id: 'off', labelKey: 'settings.audio.off' }
]

const REGION_OPTIONS: Array<{ id: StoreRegionId; labelKey: TranslationKey }> = [
  { id: 'eu', labelKey: 'store.region.eu' },
  { id: 'us', labelKey: 'store.region.us' },
  { id: 'gb', labelKey: 'store.region.gb' },
  { id: 'ca', labelKey: 'store.region.ca' },
  { id: 'au', labelKey: 'store.region.au' }
]

const EMPTY_STATS: LibraryStats = {
  gameCount: 0,
  installedCount: 0,
  totalPlaytimeMinutes: 0,
  achievementsUnlocked: 0,
  achievementsTotal: 0
}

function previewUrl(game: LibraryGame): string | undefined {
  return (
    game.metadata.backgroundUrl ??
    game.metadata.artwork?.horizontal?.[0] ??
    game.metadata.storeHeaderUrl
  )
}

function hours(minutes: number, language: 'en' | 'de'): string {
  return new Intl.NumberFormat(language === 'de' ? 'de-DE' : 'en-US', {
    maximumFractionDigits: minutes < 600 ? 1 : 0
  }).format(minutes / 60)
}

export function OnboardingSuccess({
  syncBaselineStartedAt,
  onBack,
  onFinish
}: Props): JSX.Element {
  const containerRef = useAutoFocus<HTMLDivElement>()
  const t = useT()
  const [page, setPage] = useState<SetupPage>('libraries')
  const [region, setRegion] = useState<StoreRegionId>('eu')
  const [backgroundIndex, setBackgroundIndex] = useState(0)
  const [statIndex, setStatIndex] = useState(0)
  const [stats, setStats] = useState<LibraryStats>(EMPTY_STATS)
  const [entryUnlocked, setEntryUnlocked] = useState(false)
  const [entryUnlockedWithError, setEntryUnlockedWithError] = useState(false)

  const account = useAuthStore((state) => state.account)
  const steamStatus = useAuthStore((state) => state.status)
  const startSteamLogin = useAuthStore((state) => state.startLogin)
  const epicAccount = useEpicAuthStore((state) => state.account)
  const epicStatus = useEpicAuthStore((state) => state.status)
  const startEpicLogin = useEpicAuthStore((state) => state.startLogin)
  const snapshot = useLibraryStore((state) => state.snapshot)
  const refreshLibrary = useLibraryStore((state) => state.refresh)
  const syncStatus = useSyncStore((state) => state.status)
  const {
    theme,
    homeLayout,
    language,
    audioPreset,
    setTheme,
    setHomeLayout,
    setLanguage,
    setAudioPreset
  } = usePreferencesStore()

  const accountSignature = `${account?.steamId ?? ''}:${epicAccount?.accountId ?? ''}`
  const previousAccountSignature = useRef(accountSignature)
  const pageIndex = PAGE_ORDER.indexOf(page)
  const xboxGames = snapshot.providerGames.filter((game) => game.provider === 'xbox')
  const xboxInstalled = xboxGames.filter((game) => game.installed).length

  const backgroundGames = useMemo(
    () =>
      [...snapshot.games]
        .sort(
          (left, right) =>
            Number(right.installed) - Number(left.installed) ||
            (right.lastStartedAt ?? right.lastPlayedTimestamp ?? 0) -
              (left.lastStartedAt ?? left.lastPlayedTimestamp ?? 0) ||
            (right.playtimeMinutes ?? 0) - (left.playtimeMinutes ?? 0)
        )
        .slice(0, 16),
    [snapshot.games]
  )

  const requiredPipelines = [syncStatus.pipelines.library, syncStatus.pipelines.artwork]
  const hasCurrentSyncSession =
    syncStatus.startedAt !== undefined && syncStatus.startedAt !== syncBaselineStartedAt
  const requiredCurrentlyFinished =
    hasCurrentSyncSession &&
    requiredPipelines.every(
      (pipeline) => pipeline.state === 'complete' || pipeline.state === 'error'
    )
  const requiredCurrentlyFailed = requiredPipelines.some(
    (pipeline) => pipeline.state === 'error'
  )

  const statMessages = useMemo(() => {
    const messages: string[] = []
    if (stats.gameCount > 0) {
      messages.push(t('onboarding.setup.statGames', { count: stats.gameCount }))
    }
    if (stats.installedCount > 0) {
      messages.push(t('onboarding.setup.statInstalled', { count: stats.installedCount }))
    }
    if (stats.totalPlaytimeMinutes > 0) {
      messages.push(
        t('onboarding.setup.statPlaytime', {
          hours: hours(stats.totalPlaytimeMinutes, language)
        })
      )
    }
    if (stats.mostPlayedGameName && (stats.mostPlayedMinutes ?? 0) > 0) {
      messages.push(
        t('onboarding.setup.statFavorite', {
          game: stats.mostPlayedGameName,
          hours: hours(stats.mostPlayedMinutes ?? 0, language)
        })
      )
    }
    if (stats.achievementsUnlocked > 0) {
      messages.push(
        t('onboarding.setup.statAchievements', { count: stats.achievementsUnlocked })
      )
    }
    return messages.length > 0 ? messages : [t('onboarding.setup.statScanning')]
  }, [language, stats, t])

  useEffect(() => {
    void window.api.settings.get().then((settings) => setRegion(settings.storeRegion))
  }, [])

  useEffect(() => {
    if (!requiredCurrentlyFinished) return
    // Artwork totals can grow while another provider is still discovering
    // games. Once this onboarding run has legitimately passed the gate, later
    // deltas must never revoke the user's Continue button.
    setEntryUnlocked(true)
    if (requiredCurrentlyFailed) setEntryUnlockedWithError(true)
  }, [requiredCurrentlyFailed, requiredCurrentlyFinished])

  useEffect(() => {
    if (previousAccountSignature.current === accountSignature) return
    previousAccountSignature.current = accountSignature
    // A login may finish during an active refresh. Waiting and refreshing once
    // more guarantees the newly connected provider joins this setup session.
    const sessionBeforeLogin = useSyncStore.getState().status.startedAt
    void refreshLibrary().then(() => {
      if (useSyncStore.getState().status.startedAt === sessionBeforeLogin) {
        return refreshLibrary()
      }
      return undefined
    })
  }, [accountSignature, refreshLibrary])

  useEffect(() => {
    const timer = setTimeout(() => {
      void window.api.library.stats().then(setStats).catch(() => undefined)
    }, 180)
    return () => clearTimeout(timer)
  }, [
    snapshot.games.length,
    snapshot.loadedAt,
    syncStatus.pipelines.achievements.completed,
    syncStatus.pipelines.achievements.state
  ])

  useEffect(() => {
    if (backgroundGames.length < 2) return
    const timer = setInterval(
      () => setBackgroundIndex((current) => (current + 1) % backgroundGames.length),
      7_000
    )
    return () => clearInterval(timer)
  }, [backgroundGames.length])

  useEffect(() => {
    if (statMessages.length < 2) return
    const timer = setInterval(
      () => setStatIndex((current) => (current + 1) % statMessages.length),
      4_600
    )
    return () => clearInterval(timer)
  }, [statMessages.length])

  useEffect(() => {
    setBackgroundIndex((current) =>
      backgroundGames.length > 0 ? current % backgroundGames.length : 0
    )
  }, [backgroundGames.length])

  useEffect(() => {
    setStatIndex((current) => current % statMessages.length)
  }, [statMessages.length])

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const pageRoot = containerRef.current?.querySelector<HTMLElement>(
        `[data-onboarding-page-content="${page}"]`
      )
      const first =
        pageRoot?.querySelector<HTMLElement>('[data-onboarding-primary]') ??
        pageRoot?.querySelector<HTMLElement>('[data-focusable]:not([data-disabled="true"])') ??
        containerRef.current?.querySelector<HTMLElement>('footer [data-focusable]')
      focusElement(first ?? null)
    })
    return () => cancelAnimationFrame(frame)
  }, [containerRef, page])

  useBackHandler(() => {
    if (pageIndex > 0) setPage(PAGE_ORDER[pageIndex - 1])
    else onBack()
  })

  const activeBackground = backgroundGames[backgroundIndex]
  const displayName = account?.accountName ?? epicAccount?.displayName

  return (
    <div ref={containerRef} className="relative h-full overflow-hidden bg-base">
      <div className="pointer-events-none absolute inset-0">
        <AnimatePresence mode="sync">
          {activeBackground && (
            <motion.div
              key={activeBackground.id}
              initial={{ opacity: 0, scale: 1.035 }}
              animate={{ opacity: 0.38, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ opacity: { duration: 1.25 }, scale: { duration: 8 } }}
              className="absolute inset-0"
            >
              <GameImage
                gameId={activeBackground.id}
                name={activeBackground.name}
                orientation="horizontal"
                previewUrl={previewUrl(activeBackground)}
                fit="cover"
                className="h-full w-full object-cover"
              />
            </motion.div>
          )}
        </AnimatePresence>
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgb(var(--color-base)/0.98)_0%,rgb(var(--color-base)/0.88)_48%,rgb(var(--color-base)/0.78)_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgb(var(--color-base)/0.78)_0%,transparent_30%,rgb(var(--color-base)/0.94)_100%)]" />
        <div className="absolute inset-0" style={{ backgroundImage: 'var(--theme-ambient)' }} />
      </div>

      <div className="relative z-10 flex h-full flex-col px-[clamp(1.5rem,4vw,4.5rem)] py-[clamp(1rem,2.5vh,2rem)]">
        <header className="flex shrink-0 items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-accent-2 text-black shadow-glow">
              <Gamepad2 size={20} />
            </div>
            <div>
              <div className="text-sm font-black tracking-[0.24em]">ORBIT</div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-white/40">
                {t('onboarding.setup.eyebrow')}
              </div>
            </div>
          </div>

          <nav className="flex items-center rounded-full border border-white/10 bg-black/35 p-1.5 shadow-card">
            {PAGE_ORDER.map((item, index) => {
              const active = item === page
              const labelKey = `onboarding.setup.page.${item}` as TranslationKey
              return (
                <button
                  key={item}
                  data-focusable
                  type="button"
                  onClick={() => setPage(item)}
                  className={`relative flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition-colors ${
                    active ? 'text-black' : 'text-white/50 hover:text-white'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="onboarding-active-page"
                      className="absolute inset-0 rounded-full bg-accent"
                      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    />
                  )}
                  <span className="relative z-10 opacity-60">0{index + 1}</span>
                  <span className="relative z-10">{t(labelKey)}</span>
                </button>
              )
            })}
          </nav>

          <div className="min-w-36 text-right">
            <div className="text-xs font-semibold text-white/70">
              {displayName ?? t('onboarding.setup.player')}
            </div>
            <div className="text-[10px] text-white/35">
              {backgroundGames.length > 0
                ? t('onboarding.setup.artworkCycling', { count: backgroundGames.length })
                : t('onboarding.setup.scanning')}
            </div>
          </div>
        </header>

        <main className="scrollbar-none my-[clamp(1rem,2.5vh,2rem)] min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={page}
              data-onboarding-page-content={page}
              initial={{ opacity: 0, x: 34 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              className="mx-auto w-full max-w-[92rem] pb-3"
            >
              {page === 'libraries' && (
                <LibrariesPage
                  steamConnectedName={account?.accountName}
                  steamState={steamStatus.state}
                  epicConnectedName={epicAccount?.displayName}
                  epicState={epicStatus.state}
                  xboxGameCount={xboxGames.length}
                  xboxInstalledCount={xboxInstalled}
                  syncStatus={syncStatus.pipelines}
                  statMessage={statMessages[statIndex]}
                  gameCount={stats.gameCount}
                  installedCount={stats.installedCount}
                  achievementsUnlocked={stats.achievementsUnlocked}
                  onConnectSteam={() => void startSteamLogin()}
                  onConnectEpic={() => void startEpicLogin()}
                />
              )}

              {page === 'personalize' && (
                <PersonalizePage
                  games={backgroundGames}
                  theme={theme}
                  homeLayout={homeLayout}
                  language={language}
                  region={region}
                  audioPreset={audioPreset}
                  onTheme={(value) => void setTheme(value)}
                  onHomeLayout={(value) => void setHomeLayout(value)}
                  onLanguage={(value) => void setLanguage(value)}
                  onRegion={(value) => {
                    setRegion(value)
                    void window.api.settings.set({ storeRegion: value })
                  }}
                  onAudio={(value) => void setAudioPreset(value)}
                />
              )}

              {page === 'ready' && (
                <ReadyPage
                  displayName={displayName}
                  syncStatus={syncStatus.pipelines}
                  statMessage={statMessages[statIndex]}
                  gameCount={stats.gameCount}
                  installedCount={stats.installedCount}
                  playtime={hours(stats.totalPlaytimeMinutes, language)}
                  canFinish={entryUnlocked}
                  failed={entryUnlockedWithError}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </main>

        <footer className="flex shrink-0 items-center justify-between border-t border-white/[0.07] pt-4">
          <button
            data-focusable
            type="button"
            onClick={() => (pageIndex > 0 ? setPage(PAGE_ORDER[pageIndex - 1]) : onBack())}
            className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            <ChevronLeft size={16} />
            {t('onboarding.setup.back')}
          </button>

          <div className="hidden text-center text-xs text-white/35 md:block">
            {page === 'ready' && !entryUnlocked
              ? t('onboarding.setup.gateWaiting')
              : t('onboarding.setup.controllerHint')}
          </div>

          {page !== 'ready' ? (
            <FocusableButton
              data-onboarding-primary
              onClick={() => setPage(PAGE_ORDER[pageIndex + 1])}
              className="flex items-center gap-2 px-7"
            >
              {t('onboarding.setup.next')}
              <ChevronRight size={16} />
            </FocusableButton>
          ) : (
            <FocusableButton
              data-onboarding-primary
              disabled={!entryUnlocked}
              data-disabled={!entryUnlocked ? 'true' : undefined}
              onClick={onFinish}
              className={`flex items-center gap-2 px-8 ${
                entryUnlocked ? '' : 'cursor-not-allowed opacity-45'
              }`}
            >
              {!entryUnlocked && <Loader2 size={16} className="animate-spin" />}
              {entryUnlocked
                ? entryUnlockedWithError
                  ? t('onboarding.setup.continueAfterError')
                  : t('onboarding.success.cta')
                : t('onboarding.setup.loadingCta')}
            </FocusableButton>
          )}
        </footer>
      </div>
    </div>
  )
}

interface LibrariesPageProps {
  steamConnectedName?: string
  steamState: 'idle' | 'waiting-for-browser' | 'success' | 'error'
  epicConnectedName?: string
  epicState: 'idle' | 'waiting-for-browser' | 'success' | 'error'
  xboxGameCount: number
  xboxInstalledCount: number
  syncStatus: Record<string, SyncPipelineProgress>
  statMessage: string
  gameCount: number
  installedCount: number
  achievementsUnlocked: number
  onConnectSteam: () => void
  onConnectEpic: () => void
}

function LibrariesPage({
  steamConnectedName,
  steamState,
  epicConnectedName,
  epicState,
  xboxGameCount,
  xboxInstalledCount,
  syncStatus,
  statMessage,
  gameCount,
  installedCount,
  achievementsUnlocked,
  onConnectSteam,
  onConnectEpic
}: LibrariesPageProps): JSX.Element {
  const t = useT()
  return (
    <div className="space-y-[clamp(1rem,2.2vh,1.75rem)]">
      <div>
        <div className="text-xs font-bold uppercase tracking-[0.2em] text-accent">
          {t('onboarding.setup.libraries.eyebrow')}
        </div>
        <h1 className="mt-2 text-[clamp(2rem,4vw,3.6rem)] font-bold leading-none tracking-tight">
          {t('onboarding.setup.libraries.title')}
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-white/52">
          {t('onboarding.setup.libraries.body')}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <ProviderCard
          mark="S"
          name="Steam"
          connectedName={steamConnectedName}
          state={steamState}
          onConnect={onConnectSteam}
          primary
        />
        <ProviderCard
          mark="E"
          name="Epic Games"
          connectedName={epicConnectedName}
          state={epicState}
          onConnect={onConnectEpic}
        />
        <ProviderCard
          mark="X"
          name="Xbox"
          state="success"
          detail={
            xboxGameCount > 0
              ? t('onboarding.setup.xboxGames', {
                  count: xboxGameCount,
                  installed: xboxInstalledCount
                })
              : t('onboarding.setup.xboxScanning')
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <section className="rounded-[var(--radius-card)] border border-white/[0.08] bg-black/50 p-5 shadow-card">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="font-semibold">{t('onboarding.setup.syncTitle')}</h2>
              <p className="mt-1 text-xs text-white/40">
                {t('onboarding.setup.syncBody')}
              </p>
            </div>
            <span className="rounded-full bg-accent/12 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-accent">
              {t('onboarding.setup.live')}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <PipelineRow progress={syncStatus.library} required />
            <PipelineRow progress={syncStatus.artwork} required />
            <PipelineRow progress={syncStatus.metadata} />
            <PipelineRow progress={syncStatus.achievements} />
            <div className="sm:col-span-2">
              <PipelineRow progress={syncStatus.store} />
            </div>
          </div>
        </section>

        <section className="flex min-h-44 flex-col justify-between rounded-[var(--radius-card)] border border-white/[0.08] bg-surface/90 p-5 shadow-card">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-accent">
            <Sparkles size={15} />
            {t('onboarding.setup.yourOrbit')}
          </div>
          <AnimatePresence mode="wait">
            <motion.p
              key={statMessage}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="my-5 text-xl font-semibold leading-snug"
            >
              {statMessage}
            </motion.p>
          </AnimatePresence>
          <div className="grid grid-cols-3 gap-2">
            <MiniMetric value={gameCount} label={t('onboarding.setup.games')} />
            <MiniMetric value={installedCount} label={t('onboarding.setup.installed')} />
            <MiniMetric value={achievementsUnlocked} label={t('onboarding.setup.achievements')} />
          </div>
        </section>
      </div>
    </div>
  )
}

function ProviderCard({
  mark,
  name,
  connectedName,
  state,
  detail,
  onConnect,
  primary = false
}: {
  mark: string
  name: string
  connectedName?: string
  state: 'idle' | 'waiting-for-browser' | 'success' | 'error'
  detail?: string
  onConnect?: () => void
  primary?: boolean
}): JSX.Element {
  const t = useT()
  const connected = Boolean(connectedName) || (!onConnect && state === 'success')
  const waiting = state === 'waiting-for-browser'
  const failed = state === 'error'
  return (
    <div className="flex min-h-32 items-center gap-4 rounded-[var(--radius-card)] border border-white/[0.08] bg-surface/90 p-4 shadow-card">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/[0.07] text-lg font-black text-white/80">
        {mark}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">{name}</h3>
          {connected && <Check size={14} className="text-emerald-400" />}
        </div>
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-white/42">
          {detail ??
            (connectedName
              ? t('onboarding.setup.connectedAs', { name: connectedName })
              : waiting
                ? t('onboarding.setup.loginOpen')
                : failed
                  ? t('onboarding.setup.loginFailed')
                  : t('onboarding.setup.notConnected'))}
        </p>
      </div>
      {onConnect && !connected && (
        <button
          data-focusable
          data-onboarding-primary={primary ? true : undefined}
          data-disabled={waiting ? 'true' : undefined}
          disabled={waiting}
          type="button"
          onClick={onConnect}
          className={`shrink-0 rounded-full px-4 py-2 text-xs font-bold transition-colors ${
            waiting
              ? 'bg-white/[0.05] text-white/30'
              : 'bg-accent text-black hover:brightness-110'
          }`}
        >
          {waiting
            ? t('onboarding.setup.connecting')
            : failed
              ? t('onboarding.setup.retry')
              : t('onboarding.setup.connect')}
        </button>
      )}
    </div>
  )
}

interface PersonalizePageProps {
  games: LibraryGame[]
  theme: ThemeId
  homeLayout: HomeLayoutId
  language: 'en' | 'de'
  region: StoreRegionId
  audioPreset: AudioPreset
  onTheme: (value: ThemeId) => void
  onHomeLayout: (value: HomeLayoutId) => void
  onLanguage: (value: 'en' | 'de') => void
  onRegion: (value: StoreRegionId) => void
  onAudio: (value: AudioPreset) => void
}

function PersonalizePage({
  games,
  theme,
  homeLayout,
  language,
  region,
  audioPreset,
  onTheme,
  onHomeLayout,
  onLanguage,
  onRegion,
  onAudio
}: PersonalizePageProps): JSX.Element {
  const t = useT()
  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs font-bold uppercase tracking-[0.2em] text-accent">
          {t('onboarding.setup.personalize.eyebrow')}
        </div>
        <h1 className="mt-2 text-[clamp(2rem,3.6vw,3.25rem)] font-bold leading-none tracking-tight">
          {t('onboarding.setup.personalize.title')}
        </h1>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-4">
          <SetupPanel icon={<LayoutTemplate size={16} />} title={t('settings.homeLayout.title')}>
            <div className="grid grid-cols-2 gap-2">
              {HOME_LAYOUT_OPTIONS.map((option, index) => {
                const active = homeLayout === option.id
                return (
                  <button
                    key={option.id}
                    data-focusable
                    data-onboarding-primary={index === 0 ? true : undefined}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onHomeLayout(option.id)}
                    className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                      active
                        ? 'border-accent/70 bg-accent/14 text-white'
                        : 'border-white/[0.07] bg-white/[0.035] text-white/48'
                    }`}
                  >
                    <span className="block text-sm font-bold tracking-wide">{option.label}</span>
                    <span className="mt-1 block text-[9px] leading-snug text-white/38">
                      {t(
                        option.id === 'float'
                          ? 'settings.homeLayout.floatShort'
                          : 'settings.homeLayout.orbitShort'
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          </SetupPanel>

          <SetupPanel icon={<Palette size={16} />} title={t('settings.theme.title')}>
            <div className="grid grid-cols-6 gap-2">
              {THEME_OPTIONS.map((option) => {
                const active = theme === option.id
                return (
                  <button
                    key={option.id}
                    data-focusable
                    data-theme-choice
                    type="button"
                    title={option.label}
                    aria-label={option.label}
                    aria-pressed={active}
                    onClick={() => onTheme(option.id)}
                    className="group flex min-w-0 flex-col items-center gap-1.5 rounded-xl p-1.5"
                  >
                    <span
                      className={`theme-swatch-orb relative h-10 w-10 rounded-full border bg-gradient-to-br ${THEME_SWATCH[option.id]} ${
                        active
                          ? 'border-white/90 shadow-[0_0_0_3px_rgb(var(--color-accent)/0.28)]'
                          : 'border-white/15'
                      }`}
                    >
                      {active && (
                        <span className="absolute inset-0 flex items-center justify-center text-white drop-shadow-lg">
                          <Check size={15} strokeWidth={3} />
                        </span>
                      )}
                    </span>
                    <span className="w-full truncate text-center text-[9px] text-white/48">
                      {option.label}
                    </span>
                  </button>
                )
              })}
            </div>
          </SetupPanel>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <SetupPanel icon={<Globe2 size={16} />} title={t('settings.language.title')}>
              <div className="flex gap-2">
                {LANGUAGE_OPTIONS.map((option) => (
                  <ChoicePill
                    key={option.id}
                    active={language === option.id}
                    onClick={() => onLanguage(option.id)}
                  >
                    {option.label}
                  </ChoicePill>
                ))}
              </div>
            </SetupPanel>
            <SetupPanel icon={<Globe2 size={16} />} title={t('settings.storeRegion.title')}>
              <div className="flex flex-wrap gap-2 pb-1">
                {REGION_OPTIONS.map((option) => (
                  <ChoicePill
                    key={option.id}
                    active={region === option.id}
                    onClick={() => onRegion(option.id)}
                  >
                    {t(option.labelKey)}
                  </ChoicePill>
                ))}
              </div>
            </SetupPanel>
          </div>
        </div>

        <div className="space-y-4">
          <SetupPanel icon={<ImageIcon size={16} />} title={t('onboarding.setup.previewTitle')}>
            <HomePreview
              games={games}
              homeLayout={homeLayout}
              themeName={THEME_OPTIONS.find((item) => item.id === theme)?.label ?? theme}
            />
          </SetupPanel>

          <SetupPanel icon={<Volume2 size={16} />} title={t('settings.audio.title')}>
            <p className="mb-3 text-xs text-white/40">
              {t('onboarding.setup.audioPreviewBody')}
            </p>
            <div className="grid grid-cols-4 gap-2">
              {AUDIO_OPTIONS.map((option) => {
                const active = audioPreset === option.id
                return (
                  <button
                    key={option.id}
                    data-focusable
                    data-ui-sound-skip
                    type="button"
                    aria-pressed={active}
                    onClick={() => onAudio(option.id)}
                    className={`flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs font-semibold transition-colors ${
                      active
                        ? 'border-accent/65 bg-accent/14 text-white'
                        : 'border-white/[0.07] bg-white/[0.035] text-white/48'
                    }`}
                  >
                    <Volume2 size={13} className={active ? 'text-accent' : ''} />
                    <span className="truncate">{t(option.labelKey)}</span>
                  </button>
                )
              })}
            </div>
          </SetupPanel>
        </div>
      </div>
    </div>
  )
}

function HomePreview({
  games,
  homeLayout,
  themeName
}: {
  games: LibraryGame[]
  homeLayout: HomeLayoutId
  themeName: string
}): JSX.Element {
  const featured = games[0]
  const cards = games.slice(0, 5)
  return (
    <div className="relative aspect-video overflow-hidden rounded-[var(--radius-card)] border border-white/10 bg-base shadow-card">
      {featured && (
        <GameImage
          gameId={featured.id}
          name={featured.name}
          orientation="horizontal"
          previewUrl={previewUrl(featured)}
          fit="cover"
          className="absolute inset-0 h-full w-full object-cover opacity-45"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-base via-base/55 to-base/25" />
      <div className="absolute inset-0 p-[4%]">
        <div className="mx-auto flex w-fit items-center gap-3 rounded-full bg-black/45 px-4 py-1.5 text-[7px] text-white/50">
          <span className="rounded-full bg-accent px-2 py-0.5 font-bold text-black">Home</span>
          <span>Library</span>
          <span>Store</span>
          <span>Settings</span>
        </div>
        {homeLayout === 'float' ? (
          <div className="mt-[5%] flex h-[clamp(2.2rem,4vw,3.3rem)] items-center gap-3 rounded-[calc(var(--radius-card)*0.5)] border border-white/10 bg-surface/75 px-3">
            <span className="h-6 w-6 rounded-lg bg-accent/70" />
            <span className="min-w-0 flex-1 truncate text-[9px] font-bold">
              {featured?.name ?? 'Your latest adventure'}
            </span>
            <span className="rounded-full bg-white/[0.07] px-2 py-1 text-[6px] text-white/50">
              {themeName}
            </span>
          </div>
        ) : (
          <div className="mt-[5%] grid grid-cols-[1.15fr_0.85fr] gap-2">
            <div className="flex h-[clamp(2.7rem,7vw,5.5rem)] flex-col justify-end rounded-[calc(var(--radius-card)*0.62)] border border-white/10 bg-surface/75 p-3">
              <span className="text-[6px] font-bold uppercase tracking-widest text-accent">Jump Back</span>
              <span className="truncate text-xs font-bold">{featured?.name ?? 'Your latest adventure'}</span>
            </div>
            <div className="flex h-[clamp(2.7rem,7vw,5.5rem)] items-end rounded-[calc(var(--radius-card)*0.62)] border border-white/10 bg-surface/70 p-3 text-[8px] font-semibold">
              {themeName}
            </div>
          </div>
        )}
        <div className={`${homeLayout === 'float' ? 'mt-[4%]' : 'mt-[5%]'} grid grid-cols-5 gap-2`}>
          {Array.from({ length: 5 }, (_, index) => {
            const game = cards[index]
            return (
              <div
                key={game?.id ?? index}
                className={`${homeLayout === 'float' ? 'aspect-[2/3]' : 'aspect-[1.08]'} overflow-hidden rounded-[calc(var(--radius-card)*0.45)] border ${
                  index === 0 ? 'border-accent shadow-glow' : 'border-white/10'
                } bg-surface-2`}
              >
                {game && (
                  <GameImage
                    gameId={game.id}
                    name={game.name}
                    orientation="vertical"
                    previewUrl={game.metadata.artwork?.vertical?.[0]}
                    fit="cover"
                    className="h-full w-full object-cover object-top"
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function ReadyPage({
  displayName,
  syncStatus,
  statMessage,
  gameCount,
  installedCount,
  playtime,
  canFinish,
  failed
}: {
  displayName?: string
  syncStatus: Record<string, SyncPipelineProgress>
  statMessage: string
  gameCount: number
  installedCount: number
  playtime: string
  canFinish: boolean
  failed: boolean
}): JSX.Element {
  const t = useT()
  return (
    <div className="mx-auto flex max-w-5xl flex-col items-center text-center">
      <motion.div
        initial={{ scale: 0.86, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-accent to-accent-2 text-black shadow-glow"
      >
        {failed ? <CircleAlert size={27} /> : canFinish ? <Check size={29} /> : <Loader2 size={27} className="animate-spin" />}
      </motion.div>
      <div className="mt-5 text-xs font-bold uppercase tracking-[0.2em] text-accent">
        {canFinish
          ? failed
            ? t('onboarding.setup.readyWithIssues')
            : t('onboarding.setup.ready')
          : t('onboarding.setup.preparing')}
      </div>
      <h1 className="mt-2 text-[clamp(2.3rem,4.4vw,4.6rem)] font-bold leading-none tracking-tight">
        {displayName
          ? t('onboarding.success.titleWithName', { name: displayName })
          : t('onboarding.setup.readyTitle')}
      </h1>
      <AnimatePresence mode="wait">
        <motion.p
          key={statMessage}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          className="mt-4 min-h-7 text-base text-white/55"
        >
          {statMessage}
        </motion.p>
      </AnimatePresence>

      <div className="mt-7 grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
        <LargeMetric icon={<LibraryBig size={18} />} value={gameCount} label={t('onboarding.setup.games')} />
        <LargeMetric icon={<Play size={18} />} value={installedCount} label={t('onboarding.setup.installed')} />
        <LargeMetric icon={<Trophy size={18} />} value={playtime} label={t('onboarding.setup.hoursPlayed')} />
      </div>

      <section className="mt-5 w-full rounded-[var(--radius-card)] border border-white/[0.08] bg-black/55 p-5 text-left shadow-card">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <PipelineRow progress={syncStatus.library} required />
          <PipelineRow progress={syncStatus.artwork} required />
          <PipelineRow progress={syncStatus.metadata} />
          <PipelineRow progress={syncStatus.achievements} />
          <div className="sm:col-span-2">
            <PipelineRow progress={syncStatus.store} />
          </div>
        </div>
        <p className="mt-4 text-center text-xs text-white/42">
          {canFinish
            ? t('onboarding.setup.backgroundContinues')
            : t('onboarding.setup.requiredHint')}
        </p>
      </section>
    </div>
  )
}

function PipelineRow({
  progress,
  required = false
}: {
  progress: SyncPipelineProgress
  required?: boolean
}): JSX.Element {
  const t = useT()
  const percentage = progress.total > 0 ? Math.min(100, (progress.completed / progress.total) * 100) : progress.state === 'complete' ? 100 : 0
  const label = t(`sync.${progress.id}` as TranslationKey)
  const status =
    progress.state === 'complete'
      ? t('sync.complete')
      : progress.state === 'error'
        ? t('sync.error')
        : progress.state === 'running' && progress.total > 0
          ? `${progress.completed}/${progress.total}`
          : t('sync.waiting')
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.035] px-3 py-2.5">
      <div className="flex items-center gap-2">
        {progress.state === 'complete' ? (
          <Check size={14} className="shrink-0 text-emerald-400" />
        ) : progress.state === 'error' ? (
          <CircleAlert size={14} className="shrink-0 text-amber-400" />
        ) : (
          <Loader2
            size={14}
            className={`shrink-0 text-accent ${progress.state === 'running' ? 'animate-spin' : ''}`}
          />
        )}
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">{label}</span>
        <span className="text-[9px] font-bold uppercase tracking-wider text-white/30">
          {required ? t('onboarding.setup.required') : t('onboarding.setup.background')}
        </span>
        <span className="min-w-14 text-right text-[10px] text-white/45">{status}</span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.07]">
        <motion.div
          className={`h-full rounded-full ${progress.state === 'error' ? 'bg-amber-400' : 'bg-accent'}`}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
        />
      </div>
    </div>
  )
}

function SetupPanel({
  icon,
  title,
  children
}: {
  icon: ReactNode
  title: string
  children: ReactNode
}): JSX.Element {
  return (
    <section className="rounded-[var(--radius-card)] border border-white/[0.08] bg-black/52 p-4 shadow-card">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <span className="text-accent">{icon}</span>
        {title}
      </div>
      {children}
    </section>
  )
}

function ChoicePill({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}): JSX.Element {
  return (
    <button
      data-focusable
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`shrink-0 rounded-full border px-3 py-2 text-xs font-semibold transition-colors ${
        active
          ? 'border-accent/70 bg-accent text-black'
          : 'border-white/[0.08] bg-white/[0.04] text-white/50'
      }`}
    >
      {children}
    </button>
  )
}

function MiniMetric({ value, label }: { value: string | number; label: string }): JSX.Element {
  return (
    <div className="rounded-xl bg-black/25 px-3 py-2">
      <div className="text-lg font-bold">{value}</div>
      <div className="truncate text-[9px] uppercase tracking-wider text-white/35">{label}</div>
    </div>
  )
}

function LargeMetric({
  icon,
  value,
  label
}: {
  icon: ReactNode
  value: string | number
  label: string
}): JSX.Element {
  return (
    <div className="flex items-center gap-3 rounded-[var(--radius-card)] border border-white/[0.08] bg-surface/85 p-4 text-left shadow-card">
      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-accent/12 text-accent">
        {icon}
      </div>
      <div>
        <div className="text-xl font-bold">{value}</div>
        <div className="text-[10px] uppercase tracking-wider text-white/35">{label}</div>
      </div>
    </div>
  )
}
