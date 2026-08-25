import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Building2, ExternalLink, Heart, Play, Sparkles, Timer, Trophy } from 'lucide-react'
import { useAutoFocus } from '@renderer/hooks/useAutoFocus'
import { useLibraryStore } from '@renderer/state/libraryStore'
import { useAuthStore } from '@renderer/state/authStore'
import { useEpicAuthStore } from '@renderer/state/epicAuthStore'
import { useStoreStore } from '@renderer/state/storeStore'
import { useStoreNavigationStore } from '@renderer/state/storeNavigationStore'
import { GameImage } from '@renderer/components/GameImage'
import { GameCard } from '@renderer/components/GameCard'
import { useNavigationStore } from '@renderer/state/navigationStore'
import { useT, type TFunction } from '@renderer/i18n/useT'
import type {
  GameAchievementsSnapshot,
  GameCompletionTimes,
  LibraryGame,
  StoreProduct
} from '@shared/ipc'
import { useGameDetailStore } from '@renderer/state/gameDetailStore'
import { formatPlaytime } from '@renderer/lib/playtime'
import { usePreferencesStore } from '@renderer/state/preferencesStore'
import { focusElement, HOME_SHOW_BANNERS_EVENT } from '@renderer/lib/spatialNavigation'

const HOME_ACHIEVEMENTS_DELAY_MS = 5_000
const WISHLIST_ROTATION_MS = 15_000

function normalizedTimestamp(value?: number): number {
  if (!value) return 0
  return value < 10_000_000_000 ? value * 1000 : value
}

function lastPlayedAt(game: LibraryGame): number {
  return Math.max(
    normalizedTimestamp(game.lastStartedAt),
    normalizedTimestamp(game.lastPlayedTimestamp)
  )
}

function formatHours(minutes: number, language: 'en' | 'de'): string {
  const hours = minutes / 60
  const value = new Intl.NumberFormat(language === 'de' ? 'de-DE' : 'en-US', {
    maximumFractionDigits: hours < 10 ? 1 : 0
  }).format(hours)
  return `${value} h`
}

function completionEstimate(
  times: GameCompletionTimes | null,
  t: TFunction
): { label: string; minutes: number } | null {
  if (times?.state !== 'available') return null
  if (times.mainStoryMinutes) return { label: t('details.mainStory'), minutes: times.mainStoryMinutes }
  if (times.mainExtraMinutes) return { label: t('details.mainExtra'), minutes: times.mainExtraMinutes }
  if (times.completionistMinutes) {
    return { label: t('details.completionist'), minutes: times.completionistMinutes }
  }
  return null
}

export function HomeView(): JSX.Element {
  const containerRef = useAutoFocus<HTMLDivElement>()
  const t = useT()
  const { games, loadedAt } = useLibraryStore((s) => s.snapshot)
  const account = useAuthStore((s) => s.account)
  const epicAccount = useEpicAuthStore((s) => s.account)
  const storeProducts = useStoreStore((s) => s.snapshot.products)
  const setMainView = useNavigationStore((s) => s.setMainView)
  const setStorePage = useStoreNavigationStore((s) => s.setPage)
  const openGame = useGameDetailStore((state) => state.openGame)
  const language = usePreferencesStore((state) => state.language)
  const homeLayout = usePreferencesStore((state) => state.homeLayout)
  const configuredShowHomeBanners = usePreferencesStore((state) => state.showHomeBanners)
  const showHomeBanners = homeLayout === 'orbit' && configuredShowHomeBanners
  const [focusedGame, setFocusedGame] = useState<LibraryGame | null>(null)
  const [focusDirection, setFocusDirection] = useState(1)
  const previousFocusedIndexRef = useRef<number | null>(null)
  const [focusedCompletionTimes, setFocusedCompletionTimes] =
    useState<GameCompletionTimes | null>(null)
  const [wishlistIndex, setWishlistIndex] = useState(0)
  const [featuredCompletionTimes, setFeaturedCompletionTimes] =
    useState<GameCompletionTimes | null>(null)
  const [backdropGame, setBackdropGame] = useState<LibraryGame | null>(null)

  const installedGames = useMemo(
    () =>
      games
        .filter((game) => game.installed)
        .sort(
          (a, b) =>
            lastPlayedAt(b) - lastPlayedAt(a) ||
            normalizedTimestamp(b.addedAt) - normalizedTimestamp(a.addedAt) ||
            a.name.localeCompare(b.name)
        ),
    [games]
  )

  const featured = installedGames[0] ?? null

  useEffect(() => {
    let active = true
    setFeaturedCompletionTimes(featured?.metadata.completionTimes ?? null)
    if (featured && !featured.metadata.completionTimes) {
      void window.api.game.resolveCompletionTimes(featured.id).then((result) => {
        if (active) setFeaturedCompletionTimes(result)
      })
    }
    return () => {
      active = false
    }
  }, [featured?.id])

  const featuredCompletionEstimate = useMemo(() => {
    return completionEstimate(featuredCompletionTimes, t)
  }, [featuredCompletionTimes, t])

  // Hiding the banners is a persistent version of the card-focus mode. Keep the
  // stage and its spacing intact so the game row never jumps toward the header.
  const stageFocusGame = focusedGame ?? (!showHomeBanners ? featured : null)
  const stageFocusCompletionTimes = focusedGame
    ? focusedCompletionTimes
    : featuredCompletionTimes

  function activateGame(game: LibraryGame | null): void {
    if (!game) {
      setFocusedGame(null)
      previousFocusedIndexRef.current = null
      return
    }
    const nextIndex = installedGames.findIndex((candidate) => candidate.id === game.id)
    const previousIndex = previousFocusedIndexRef.current
    if (previousIndex !== null && nextIndex !== previousIndex) {
      setFocusDirection(nextIndex > previousIndex ? 1 : -1)
    }
    previousFocusedIndexRef.current = nextIndex
    setFocusedGame(game)
  }

  useEffect(() => {
    function showBannersAndFocusJumpBack(): void {
      setFocusedGame(null)
      requestAnimationFrame(() => {
        focusElement(document.querySelector<HTMLElement>('[data-home-jump-back="true"]'))
      })
    }
    window.addEventListener(HOME_SHOW_BANNERS_EVENT, showBannersAndFocusJumpBack)
    return () => window.removeEventListener(HOME_SHOW_BANNERS_EVENT, showBannersAndFocusJumpBack)
  }, [])

  useEffect(() => {
    let active = true
    setFocusedCompletionTimes(focusedGame?.metadata.completionTimes ?? null)
    if (!focusedGame || focusedGame.metadata.completionTimes) return () => undefined
    const timer = setTimeout(() => {
      void window.api.game.resolveCompletionTimes(focusedGame.id).then((result) => {
        if (active) setFocusedCompletionTimes(result)
      })
    }, 180)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [focusedGame?.id])

  const wishlistProducts = useMemo(
    () =>
      storeProducts
        .filter((product) => product.steamWishlisted || product.orbitWishlisted)
        .sort(
          (a, b) =>
            (b.steamWishlistAddedAt ?? 0) - (a.steamWishlistAddedAt ?? 0) ||
            a.name.localeCompare(b.name)
        ),
    [storeProducts]
  )

  const wishlistSignature = wishlistProducts.map((product) => product.id).join('|')

  useEffect(() => {
    setWishlistIndex(0)
  }, [wishlistSignature])

  useEffect(() => {
    if (!showHomeBanners || wishlistProducts.length <= 1) return
    const timer = setInterval(() => {
      setWishlistIndex((current) => (current + 1) % wishlistProducts.length)
    }, WISHLIST_ROTATION_MS)
    return () => clearInterval(timer)
  }, [showHomeBanners, wishlistProducts.length, wishlistSignature])

  const wishlistOffer = wishlistProducts[wishlistIndex % Math.max(wishlistProducts.length, 1)] ?? null

  // The information panel follows focus immediately. The full-screen artwork is
  // deliberately settled a beat later so holding the stick never starts several
  // large image decodes per second.
  useEffect(() => {
    const target = focusedGame ?? featured
    const timer = setTimeout(() => setBackdropGame(target), 160)
    return () => clearTimeout(timer)
  }, [featured?.id, focusedGame?.id])

  function showWishlist(): void {
    setStorePage('wishlist')
    setMainView('store')
  }

  function openWishlistOffer(product: StoreProduct): void {
    if (product.bestOffer?.url) {
      void window.api.app.openExternal(product.bestOffer.url)
      return
    }
    showWishlist()
  }

  if (!account && !epicAccount && games.length === 0 && loadedAt > 0) {
    return (
      <div
        ref={containerRef}
        className="flex h-full flex-col items-center justify-center gap-3 text-center"
      >
        <Sparkles size={32} className="text-accent" />
        <p className="text-lg font-medium">{t('home.noAccount.title')}</p>
        <p className="max-w-sm text-sm text-muted">{t('home.noAccount.body')}</p>
        <button
          data-focusable
          onClick={() => setMainView('settings')}
          className="mt-2 rounded-full bg-accent px-6 py-3 text-sm font-semibold text-black"
        >
          {t('home.noAccount.cta')}
        </button>
      </div>
    )
  }

  return (
    <div
      data-home-stage-mode={showHomeBanners ? 'banners' : 'game-focus'}
      data-home-layout={homeLayout}
      className="home-layout relative flex h-full flex-col overflow-hidden"
    >
      <div className="absolute inset-0">
        <div className="home-backdrop-art absolute inset-0">
          <HomeBackdrop game={backdropGame} />
        </div>
        <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/38 to-black/15" />
        <div className="home-backdrop-dim absolute inset-0" />
      </div>

      <div
        ref={containerRef}
        className="scrollbar-none relative z-10 flex h-full flex-col overflow-y-auto px-8 pb-10 pt-[calc(5rem+1.75rem)]"
      >
        {(stageFocusGame || (showHomeBanners && (featured || wishlistOffer))) && (
        <div className="home-stage relative shrink-0">
        <AnimatePresence initial={false} mode="sync" custom={focusDirection}>
          {stageFocusGame ? (
            <GameFocusSummary
              key={`focus:${stageFocusGame.id}`}
              game={stageFocusGame}
              completionTimes={stageFocusCompletionTimes}
              language={language}
              direction={focusDirection}
              flat={homeLayout === 'float'}
              t={t}
            />
          ) : showHomeBanners && (featured || wishlistOffer) ? (
          <motion.div
            key="home-banners"
            initial={{ opacity: 0, y: -8, filter: 'blur(5px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -8, filter: 'blur(5px)' }}
            transition={{ duration: 0.46, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-0 grid grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.85fr)] gap-[clamp(1rem,2vw,1.5rem)]"
          >
            {featured && (
              <motion.button
                data-focusable
                data-game-card="true"
                data-game-id={featured.id}
                data-home-jump-back="true"
                onClick={() => openGame(featured.id)}
                whileHover={{ scale: 1.012 }}
                whileFocus={{ scale: 1.012 }}
                transition={{ type: 'spring', stiffness: 360, damping: 30 }}
                className="group relative h-full min-w-0 overflow-hidden rounded-xl2 border border-white/10 bg-black/30 text-left shadow-card"
              >
                <div className="absolute inset-0 transition-transform duration-700 group-hover:scale-[1.025] group-data-[focused=true]:scale-[1.025]">
                  <GameImage
                    gameId={featured.id}
                    name={featured.name}
                    orientation="horizontal"
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/55 to-black/10" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/10" />
                <div className="relative z-10 flex h-full flex-col justify-between p-[clamp(1rem,2vw,1.5rem)]">
                  <div>
                    <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-accent">
                      <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_12px_currentColor]" />
                      {t('home.jumpBack')}
                    </p>
                    {featured.metadata.genres && (
                      <p className="mt-1 line-clamp-1 text-xs text-white/55">
                        {featured.metadata.genres.join(' · ')}
                      </p>
                    )}
                  </div>
                  <div className="flex items-end justify-between gap-4">
                    <div className="flex min-w-0 items-end gap-[clamp(0.75rem,1.4vw,1.1rem)]">
                      <div className="h-[clamp(3.25rem,5vw,4.75rem)] w-[clamp(3.25rem,5vw,4.75rem)] shrink-0 overflow-hidden rounded-[24%] border border-white/15 bg-black/40 shadow-xl backdrop-blur-md">
                        <GameImage
                          gameId={featured.id}
                          name={featured.name}
                          orientation="icon"
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <div className="min-w-0 pb-0.5">
                        <h2 className="truncate text-[clamp(1.25rem,2.2vw,1.8rem)] font-bold text-white drop-shadow-lg">
                          {featured.name}
                        </h2>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/35 px-2.5 py-1 text-[11px] font-medium text-white/75 backdrop-blur-md">
                            <Timer size={12} className="text-accent" />
                            {t('details.yourPlaytime')}: {formatPlaytime(featured.playtimeMinutes, t) ?? t('details.notPlayed')}
                          </span>
                          {featuredCompletionEstimate && (
                              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/35 px-2.5 py-1 text-[11px] font-medium text-white/75 backdrop-blur-md">
                                <Sparkles size={12} className="text-accent" />
                                HowLongToBeat · {featuredCompletionEstimate.label}:{' '}
                                {formatHours(featuredCompletionEstimate.minutes, language)}
                              </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-black shadow-[0_8px_30px_rgba(0,0,0,0.3)]">
                      <Play size={15} fill="currentColor" />
                    </div>
                  </div>
                </div>
              </motion.button>
            )}

            {wishlistOffer ? (
              <WishlistOfferBanner
                product={wishlistOffer}
                index={wishlistIndex % wishlistProducts.length}
                total={wishlistProducts.length}
                onOpen={() => openWishlistOffer(wishlistOffer)}
                t={t}
              />
            ) : (
              <button
                data-focusable
                data-home-wishlist-offer="empty"
                onClick={showWishlist}
                className={`${featured ? '' : 'col-span-2'} flex h-full min-w-0 flex-col items-center justify-center rounded-xl2 border border-dashed border-white/15 bg-black/30 px-6 text-center`}
              >
                <Heart size={22} className="mb-2 text-accent" />
                <p className="text-sm font-semibold">{t('home.wishlistEmpty')}</p>
                <p className="mt-1 text-xs text-muted">{t('home.wishlistEmptyBody')}</p>
              </button>
            )}
          </motion.div>
          ) : null}
        </AnimatePresence>
        </div>
        )}

        {installedGames.length > 0 && (
          <div
            data-home-game-row="true"
            data-navigation-grid
            data-grid-columns={installedGames.length}
            className="home-game-row scrollbar-none flex gap-[var(--tile-gap)] overflow-x-auto overflow-y-hidden px-8 pb-8"
          >
            {installedGames.map((game, index) => (
              <div
                key={game.id}
                className="home-game-tile shrink-0"
              >
                <GameCard
                  game={game}
                  navigationIndex={index}
                  variant={homeLayout === 'float' ? 'float' : 'home'}
                  onActiveChange={(active) => activateGame(active ? game : null)}
                />
              </div>
            ))}
          </div>
        )}

        {games.length === 0 && <p className="text-sm text-muted">{t('home.libraryLoading')}</p>}
        {games.length > 0 && installedGames.length === 0 && (
          <p className="text-sm text-muted">{t('home.noInstalledGames')}</p>
        )}
      </div>
    </div>
  )
}

function HomeBackdrop({ game }: { game: LibraryGame | null }): JSX.Element {
  const [current, setCurrent] = useState<LibraryGame | null>(game)
  const [outgoing, setOutgoing] = useState<LibraryGame | null>(null)

  useEffect(() => {
    if (game?.id === current?.id) return undefined
    setOutgoing(current)
    setCurrent(game)
    const timer = setTimeout(() => setOutgoing(null), 220)
    return () => clearTimeout(timer)
    // `current` is intentionally captured from the render that received the new game.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.id])

  return (
    <>
      {outgoing && (
        <motion.div
          key={`out:${outgoing.id}`}
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="absolute inset-0"
          style={{ willChange: 'opacity' }}
        >
          <GameImage
            gameId={outgoing.id}
            name={outgoing.name}
            orientation="horizontal"
            className="h-full w-full object-cover"
          />
        </motion.div>
      )}
      {current && (
        <motion.div
          key={`current:${current.id}`}
          initial={{ opacity: outgoing ? 0.2 : 1 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="absolute inset-0"
          style={{ willChange: 'opacity' }}
        >
          <GameImage
            gameId={current.id}
            name={current.name}
            orientation="horizontal"
            className="h-full w-full object-cover"
          />
        </motion.div>
      )}
    </>
  )
}

function GameFocusSummary({
  game,
  completionTimes,
  language,
  direction,
  flat,
  t
}: {
  game: LibraryGame
  completionTimes: GameCompletionTimes | null
  language: 'en' | 'de'
  direction: number
  flat: boolean
  t: TFunction
}): JSX.Element {
  const showAchievements = usePreferencesStore((state) => state.showAchievements)
  const reduceMotion = useReducedMotion()
  const [achievements, setAchievements] = useState<GameAchievementsSnapshot | null>(null)
  const [showAchievementView, setShowAchievementView] = useState(false)
  const publishers = game.metadata.publishers?.filter(Boolean).slice(0, 2) ?? []
  const completionAvailable = completionTimes?.state === 'available'

  useEffect(() => {
    let active = true
    let delayElapsed = false
    let availableSnapshot: GameAchievementsSnapshot | null = null

    setAchievements(null)
    setShowAchievementView(false)
    if (!showAchievements) return () => undefined

    const revealWhenReady = (): void => {
      if (active && delayElapsed && availableSnapshot) setShowAchievementView(true)
    }

    const timer = window.setTimeout(() => {
      delayElapsed = true
      revealWhenReady()
    }, HOME_ACHIEVEMENTS_DELAY_MS)

    void window.api.game
      .resolveAchievements(game.id)
      .then((result) => {
        if (!active || !result || result.state !== 'available' || result.achievements.length === 0) {
          return
        }
        availableSnapshot = result
        setAchievements(result)
        revealWhenReady()
      })
      .catch(() => undefined)

    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [game.id, showAchievements])

  const viewTransition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.32, ease: [0.22, 1, 0.36, 1] as const }

  return (
    <motion.section
      custom={direction}
      variants={{
        initial: (slideDirection: number) => ({
          opacity: 0,
          x: slideDirection * 24
        }),
        animate: { opacity: 1, x: 0 },
        exit: (slideDirection: number) => ({
          opacity: 0,
          x: slideDirection * -20
        })
      }}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
      className="absolute inset-0 flex items-start"
    >
      <motion.div
        layout={!reduceMotion}
        aria-live="polite"
        transition={{ layout: viewTransition }}
        className={`home-focus-card relative w-[min(48rem,76vw)] overflow-hidden rounded-[clamp(1.25rem,2vw,2rem)] border border-white/10 bg-black/55 p-[clamp(1.1rem,2.2vw,2rem)] shadow-[0_24px_70px_rgba(0,0,0,0.25)] ${flat ? 'home-focus-card-float' : ''}`}
      >
        <AnimatePresence initial={false} mode="popLayout">
          {showAchievementView && achievements ? (
            <motion.div
              key="achievements"
              initial={{ opacity: 0, y: reduceMotion ? 0 : 8, filter: 'blur(5px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: reduceMotion ? 0 : -8, filter: 'blur(5px)' }}
              transition={viewTransition}
              className="home-focus-view"
            >
              <HomeAchievementSummary
                game={game}
                snapshot={achievements}
                progressDuration={reduceMotion ? 0 : 0.7}
                t={t}
              />
            </motion.div>
          ) : (
            <motion.div
              key="information"
              initial={{ opacity: 0, y: reduceMotion ? 0 : 8, filter: 'blur(5px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: reduceMotion ? 0 : -8, filter: 'blur(5px)' }}
              transition={viewTransition}
              className="home-focus-view"
            >
              <div className="home-focus-identity flex min-w-0 items-center gap-[clamp(0.9rem,1.8vw,1.4rem)]">
                <div className="home-focus-icon h-[clamp(4.5rem,7vw,6.5rem)] w-[clamp(4.5rem,7vw,6.5rem)] shrink-0 overflow-hidden rounded-[25%] border border-white/15 bg-black/40 shadow-2xl">
                  <GameImage
                    gameId={game.id}
                    name={game.name}
                    orientation="icon"
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-accent">
                    {game.provider}
                  </p>
                  <h2 className="mt-1 line-clamp-2 text-[clamp(1.45rem,2.8vw,2.6rem)] font-bold leading-tight tracking-[-0.025em] text-white">
                    {game.name}
                  </h2>
                  {publishers.length > 0 && (
                    <div className="mt-2 flex items-center gap-2 text-xs text-white/55">
                      <Building2 size={13} className="shrink-0 text-accent" />
                      <span className="truncate">{publishers.join(' · ')}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="home-focus-stats mt-[clamp(1rem,2.5vh,1.6rem)] flex flex-wrap gap-2.5">
                <FocusStat
                  icon={<Timer size={14} />}
                  label={t('details.yourPlaytime')}
                  value={formatPlaytime(game.playtimeMinutes, t) ?? t('details.notPlayed')}
                />
                {completionAvailable && completionTimes.mainStoryMinutes && (
                  <FocusStat
                    icon={<Sparkles size={14} />}
                    label={`HLTB · ${t('details.mainStory')}`}
                    value={formatHours(completionTimes.mainStoryMinutes, language)}
                  />
                )}
                {completionAvailable && completionTimes.mainExtraMinutes && (
                  <FocusStat
                    icon={<Sparkles size={14} />}
                    label={`HLTB · ${t('details.mainExtra')}`}
                    value={formatHours(completionTimes.mainExtraMinutes, language)}
                  />
                )}
                {completionAvailable && completionTimes.completionistMinutes && (
                  <FocusStat
                    icon={<Sparkles size={14} />}
                    label={`HLTB · ${t('details.completionist')}`}
                    value={formatHours(completionTimes.completionistMinutes, language)}
                  />
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.section>
  )
}

function HomeAchievementSummary({
  game,
  snapshot,
  progressDuration,
  t
}: {
  game: LibraryGame
  snapshot: GameAchievementsSnapshot
  progressDuration: number
  t: TFunction
}): JSX.Element {
  const achievements = [...snapshot.achievements]
    .sort(
      (a, b) =>
        Number(b.unlocked) - Number(a.unlocked) || (b.unlockedAt ?? 0) - (a.unlockedAt ?? 0)
    )
    .slice(0, 3)
  const percent = snapshot.total ? Math.round((snapshot.unlocked / snapshot.total) * 100) : 0

  return (
    <>
      <div className="home-focus-identity flex min-w-0 items-center gap-[clamp(0.9rem,1.8vw,1.4rem)]">
        <div className="home-focus-icon flex h-[clamp(4.5rem,7vw,6.5rem)] w-[clamp(4.5rem,7vw,6.5rem)] shrink-0 items-center justify-center rounded-[25%] border border-accent/25 bg-accent/10 text-accent shadow-2xl">
          <Trophy size={34} strokeWidth={1.8} />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-accent">
            {t('achievements.title')}
          </p>
          <h2 className="mt-1 line-clamp-1 text-[clamp(1.2rem,2.25vw,2rem)] font-bold leading-tight tracking-[-0.025em] text-white">
            {game.name}
          </h2>
          <p className="mt-2 text-xs font-semibold text-white/60">
            {t('achievements.progress', {
              unlocked: snapshot.unlocked,
              total: snapshot.total
            })}
          </p>
        </div>
      </div>

      <div className="home-focus-stats mt-[clamp(1rem,2.5vh,1.6rem)] flex flex-wrap gap-2.5">
        <div className="home-achievement-progress home-focus-stat min-w-[8.5rem] rounded-xl2 border border-accent/20 bg-accent/[0.08] px-3.5 py-3 backdrop-blur-md">
          <p className="flex items-center gap-1.5 text-[10px] font-medium text-white/50">
            <Trophy size={14} className="text-accent" />
            {t('achievements.title')}
          </p>
          <p className="mt-1 text-lg font-bold text-white">{percent}%</p>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${percent}%` }}
              transition={{
                duration: progressDuration,
                ease: [0.22, 1, 0.36, 1]
              }}
              className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2"
            />
          </div>
        </div>
        {achievements.map((achievement) => (
          <HomeAchievementCard key={achievement.id} achievement={achievement} t={t} />
        ))}
      </div>
    </>
  )
}

function HomeAchievementCard({
  achievement,
  t
}: {
  achievement: GameAchievementsSnapshot['achievements'][number]
  t: TFunction
}): JSX.Element {
  const imageUrl = achievement.unlocked ? achievement.iconUrl : achievement.lockedIconUrl

  return (
    <div
      className={`home-achievement-card home-focus-stat flex min-w-[10.5rem] items-center gap-2.5 rounded-xl2 border px-2.5 py-3 backdrop-blur-md ${
        achievement.unlocked
          ? 'border-accent/20 bg-accent/[0.08]'
          : 'border-white/[0.07] bg-black/30 opacity-60'
      }`}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-black/40 text-white/30">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className={`h-full w-full object-cover ${achievement.unlocked ? '' : 'grayscale'}`}
          />
        ) : (
          <Trophy size={18} />
        )}
      </div>
      <div className="min-w-0">
        <p className="line-clamp-2 text-xs font-semibold leading-snug text-white/90">
          {achievement.name}
        </p>
        <p className="mt-1 text-[10px] text-white/45">
          {achievement.unlocked ? t('achievements.unlocked') : t('achievements.locked')}
        </p>
      </div>
    </div>
  )
}

function FocusStat({
  icon,
  label,
  value
}: {
  icon: ReactNode
  label: string
  value: string
}): JSX.Element {
  return (
    <div className="home-focus-stat min-w-[8.5rem] rounded-xl2 border border-white/10 bg-black/30 px-3.5 py-3 backdrop-blur-md">
      <p className="flex items-center gap-1.5 text-[10px] font-medium text-white/50">
        <span className="text-accent">{icon}</span>
        {label}
      </p>
      <p className="mt-1.5 text-base font-semibold text-white">{value}</p>
    </div>
  )
}

function WishlistOfferBanner({
  product,
  index,
  total,
  onOpen,
  t
}: {
  product: StoreProduct
  index: number
  total: number
  onOpen: () => void
  t: ReturnType<typeof useT>
}): JSX.Element {
  const offer = product.bestOffer
  const progressRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const progress = progressRef.current
    if (!progress || total <= 1) return undefined
    const startedAt = performance.now()
    progress.style.transform = 'scaleX(0)'
    const timer = window.setInterval(() => {
      const ratio = Math.min(1, (performance.now() - startedAt) / WISHLIST_ROTATION_MS)
      progress.style.transform = `scaleX(${ratio})`
    }, 250)
    return () => clearInterval(timer)
  }, [product.id, total])

  return (
    <motion.button
      data-focusable
      data-home-wishlist-offer={product.id}
      onClick={onOpen}
      aria-label={`${t('home.wishlistOffer')}: ${product.name}, ${offer?.formattedPrice ?? t('store.checkPrice')}`}
      whileHover={{ scale: 1.012 }}
      whileFocus={{ scale: 1.012 }}
      transition={{ type: 'spring', stiffness: 360, damping: 30 }}
      className="group relative h-full min-w-0 overflow-hidden rounded-xl2 border border-white/10 bg-black/35 text-left shadow-card"
    >
      <AnimatePresence initial={false} mode="wait">
        <motion.div
          key={product.id}
          initial={{ opacity: 0, x: 26 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -26 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="absolute inset-0"
        >
          <WishlistArtwork product={product} />
          <div className="absolute inset-x-0 bottom-0 h-[44%] bg-gradient-to-t from-black/90 via-black/50 to-transparent" />
          <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/45 to-transparent" />
          <div className="relative z-10 flex h-full flex-col justify-between p-[clamp(1rem,2vw,1.5rem)]">
            <div className="flex items-start justify-between gap-3">
              <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-accent">
                <Heart size={12} fill="currentColor" />
                {t('home.wishlistOffer')}
              </p>
              <span className="rounded-full bg-black/35 px-2 py-1 text-[10px] text-white/60">
                {index + 1}/{total}
              </span>
            </div>

            <div>
              {(offer?.discountPercent ?? 0) > 0 && (
                <span className="mb-2 inline-flex rounded-lg bg-emerald-400 px-2 py-1 text-[10px] font-black text-black">
                  -{offer?.discountPercent}%
                </span>
              )}
              <h2 className="line-clamp-1 text-[clamp(1.05rem,1.8vw,1.45rem)] font-bold text-white">
                {product.name}
              </h2>
              <div className="mt-2 flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[10px] uppercase tracking-wider text-white/45">
                    {offer?.sourceLabel ?? t('store.bestPrice')}
                  </p>
                  <p className="text-xl font-black text-white">
                    {offer?.formattedPrice ?? t('store.checkPrice')}
                  </p>
                </div>
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-black">
                  <ExternalLink size={14} />
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
      {total > 1 && (
        <div className="pointer-events-none absolute bottom-3 right-14 z-20 h-1 w-16 overflow-hidden rounded-full bg-white/20">
          <div
            ref={progressRef}
            className="h-full origin-left scale-x-0 rounded-full bg-white/85"
          />
        </div>
      )}
    </motion.button>
  )
}

function WishlistArtwork({ product }: { product: StoreProduct }): JSX.Element {
  const sources = useMemo(
    () =>
      [...new Set([product.heroUrl, product.headerUrl, product.portraitUrl])].filter(
        (source): source is string => Boolean(source)
      ),
    [product.heroUrl, product.headerUrl, product.portraitUrl]
  )
  const [sourceIndex, setSourceIndex] = useState(0)

  useEffect(() => setSourceIndex(0), [product.id])

  const source = sources[sourceIndex]

  if (!source) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-accent/30 via-surface-2 to-black text-4xl font-black text-white/25">
        {product.name.charAt(0)}
      </div>
    )
  }

  return (
    <div className="absolute inset-0 overflow-hidden bg-surface-2">
      <img
        src={source}
        alt=""
        loading="eager"
        decoding="async"
        onError={() => setSourceIndex((current) => current + 1)}
        className="absolute inset-0 h-full w-full object-cover object-center transition-transform duration-700 group-hover:scale-[1.025] group-data-[focused=true]:scale-[1.025]"
      />
    </div>
  )
}
