import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  Building2,
  CalendarDays,
  ExternalLink,
  Heart,
  LayoutGrid,
  Search,
  Shuffle,
  Sparkles,
  Timer,
  Trophy
} from 'lucide-react'
import { useAutoFocus } from '@renderer/hooks/useAutoFocus'
import { useLibraryStore } from '@renderer/state/libraryStore'
import { useAuthStore } from '@renderer/state/authStore'
import { useEpicAuthStore } from '@renderer/state/epicAuthStore'
import { usePlayStationStore } from '@renderer/state/playstationStore'
import { useStoreStore } from '@renderer/state/storeStore'
import { useStoreNavigationStore } from '@renderer/state/storeNavigationStore'
import { GameImage } from '@renderer/components/GameImage'
import { GameCard } from '@renderer/components/GameCard'
import { GameCardMenuHint } from '@renderer/components/GameCardMenuHint'
import {
  HomeCardReflection,
  resolveHomeCardReflection
} from '@renderer/components/HomeCardReflection'
import { useNavigationStore } from '@renderer/state/navigationStore'
import { useT, type TFunction } from '@renderer/i18n/useT'
import type {
  GameAchievementsSnapshot,
  GameCompletionTimes,
  LibraryActivitySummary,
  LibraryActivityWindow,
  LibraryGame,
  StoreProduct
} from '@shared/ipc'
import { latestLibraryActivity, normalizeLibraryTimestamp } from '@shared/libraryTime'
import { useLaunchGame } from '@renderer/hooks/useLaunchGame'
import { formatPlaytime } from '@renderer/lib/playtime'
import { usePreferencesStore } from '@renderer/state/preferencesStore'
import { useLibraryFilterStore } from '@renderer/state/libraryFilterStore'
import { useGameDetailStore } from '@renderer/state/gameDetailStore'
import { focusElement, HOME_SHOW_BANNERS_EVENT } from '@renderer/lib/spatialNavigation'
import { LIBRARY_SEARCH_EVENT } from '@renderer/lib/librarySearch'

const HOME_ACHIEVEMENTS_DELAY_MS = 5_000
const WISHLIST_ROTATION_MS = 15_000
const XMODE_RECOMMENDATION_ROTATION_MS = 18_000

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

function storeProductUrl(product: StoreProduct): string | undefined {
  return (
    product.bestOffer?.url ??
    product.offers.find((offer) => offer.available && offer.exactMatch)?.url
  )
}

function formatActivityDuration(seconds: number, language: 'en' | 'de'): string {
  const totalSeconds = Math.round(Math.max(0, seconds))
  if (totalSeconds < 60) return `${totalSeconds} s`
  const totalMinutes = Math.floor(totalSeconds / 60)
  if (totalMinutes < 60) return `${totalMinutes} min`
  const hours = totalMinutes / 60
  return `${new Intl.NumberFormat(language === 'de' ? 'de-DE' : 'en-US', {
    maximumFractionDigits: hours < 10 ? 1 : 0
  }).format(hours)} h`
}

export function HomeView(): JSX.Element {
  const containerRef = useAutoFocus<HTMLDivElement>()
  const t = useT()
  const { games, recentGameIds, activity, loadedAt } = useLibraryStore((s) => s.snapshot)
  const account = useAuthStore((s) => s.account)
  const epicAccount = useEpicAuthStore((s) => s.account)
  const playStationAccount = usePlayStationStore((s) => s.account)
  const storeProducts = useStoreStore((s) => s.snapshot.products)
  const setMainView = useNavigationStore((s) => s.setMainView)
  const setLibrarySource = useLibraryFilterStore((s) => s.setSource)
  const setStorePage = useStoreNavigationStore((s) => s.setPage)
  const launchGame = useLaunchGame()
  const language = usePreferencesStore((state) => state.language)
  const homeLayout = usePreferencesStore((state) => state.homeLayout)
  const configuredShowHomeBanners = usePreferencesStore((state) => state.showHomeBanners)
  const showHomeBanners = homeLayout === 'orbit' && configuredShowHomeBanners
  const detailGameId = useGameDetailStore((state) => state.gameId)
  const [focusedGame, setFocusedGame] = useState<LibraryGame | null>(null)
  const [focusDirection, setFocusDirection] = useState(1)
  const previousFocusedIndexRef = useRef<number | null>(null)
  const focusedHomeGameRef = useRef<LibraryGame | null>(null)
  const hoveredHomeGameRef = useRef<LibraryGame | null>(null)
  const homeInteractionSourceRef = useRef<'focus' | 'pointer' | null>(null)
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
            latestLibraryActivity(b) - latestLibraryActivity(a) ||
            normalizeLibraryTimestamp(b.addedAt) - normalizeLibraryTimestamp(a.addedAt) ||
            a.name.localeCompare(b.name)
        ),
    [games]
  )

  const featured = useMemo(() => {
    const installedById = new Map(installedGames.map((game) => [game.id, game]))
    for (const gameId of [activity?.continueGameId, ...recentGameIds]) {
      if (!gameId) continue
      const game = installedById.get(gameId)
      if (game) return game
    }
    return installedGames[0] ?? null
  }, [activity?.continueGameId, installedGames, recentGameIds])
  const featuredHasActivity = Boolean(featured && latestLibraryActivity(featured) > 0)
  const focusedGameIndex = focusedGame
    ? installedGames.findIndex((game) => game.id === focusedGame.id)
    : -1

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

  function updateHomeGameInteraction(
    game: LibraryGame,
    active: boolean,
    source: 'focus' | 'pointer'
  ): void {
    // Opening the detail panel deliberately moves DOM focus into the dialog. Keep
    // Home's visual selection frozen until that dialog is gone, otherwise the
    // card blur briefly restores the banners/backdrop behind the slide animation.
    if (!active && useGameDetailStore.getState().gameId) return

    const sourceGameRef =
      source === 'focus' ? focusedHomeGameRef : hoveredHomeGameRef

    if (active) {
      const alreadyActive =
        sourceGameRef.current?.id === game.id && homeInteractionSourceRef.current === source
      sourceGameRef.current = game
      if (alreadyActive) return
      homeInteractionSourceRef.current = source
      activateGame(game)
      return
    }

    if (sourceGameRef.current?.id === game.id) sourceGameRef.current = null
    if (source === 'focus') {
      homeInteractionSourceRef.current = null
      activateGame(null)
      return
    }
    if (homeInteractionSourceRef.current !== source) return

    if (focusedHomeGameRef.current) {
      homeInteractionSourceRef.current = 'focus'
      activateGame(focusedHomeGameRef.current)
      return
    }

    homeInteractionSourceRef.current = null
    activateGame(null)
  }

  useEffect(() => {
    function showBannersAndFocusJumpBack(): void {
      focusedHomeGameRef.current = null
      hoveredHomeGameRef.current = null
      homeInteractionSourceRef.current = null
      setFocusedGame(null)
      previousFocusedIndexRef.current = null
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
  const xModeDeals = useMemo(() => {
    const discountedProducts = [...storeProducts]
      .filter(
        (product) =>
          product.discoverEligible !== false &&
          (product.bestOffer?.discountPercent ?? 0) > 0 &&
          Boolean(product.headerUrl ?? product.heroUrl ?? product.portraitUrl) &&
          Boolean(storeProductUrl(product))
      )
      .sort(
        (left, right) =>
          (right.bestOffer?.discountPercent ?? 0) -
            (left.bestOffer?.discountPercent ?? 0) ||
          right.recommendationScore - left.recommendationScore
      )
    const candidates =
      wishlistProducts.length >= 2
        ? wishlistProducts
        : [...wishlistProducts, ...discountedProducts]
    const seen = new Set<string>()
    return candidates.filter((product) => {
      if (seen.has(product.id)) return false
      seen.add(product.id)
      return true
    })
  }, [storeProducts, wishlistProducts])

  // The information panel follows focus immediately. The full-screen artwork is
  // deliberately settled a beat later so holding the stick never starts several
  // large image decodes per second.
  useEffect(() => {
    // Preserve the exact frame behind the modal, including when it opens during
    // the normal 160 ms artwork debounce.
    if (detailGameId) return undefined
    const target = focusedGame ?? featured
    const timer = setTimeout(() => setBackdropGame(target), 160)
    return () => clearTimeout(timer)
  }, [detailGameId, featured?.id, focusedGame?.id])

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

  function openStoreProduct(product: StoreProduct): void {
    const url = storeProductUrl(product)
    if (url) {
      void window.api.app.openExternal(url)
      return
    }
    setStorePage('discover')
    setMainView('store')
  }

  function openLibrary(search: boolean): void {
    setLibrarySource('all')
    setMainView('library')
    if (!search) return
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent(LIBRARY_SEARCH_EVENT))
      })
    })
  }

  if (!account && !epicAccount && !playStationAccount && games.length === 0 && loadedAt > 0) {
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

  if (homeLayout === 'xmode') {
    return (
      <XModeHome
        containerRef={containerRef}
        installedGames={installedGames}
        libraryGames={games}
        backdropGame={backdropGame ?? featured}
        deals={xModeDeals}
        onSelectGame={activateGame}
        onLaunchGame={(game) => launchGame(game.id)}
        onOpenLibrary={() => openLibrary(false)}
        onOpenSearch={() => openLibrary(true)}
        onOpenDeal={openStoreProduct}
        onOpenDeals={() => {
          setStorePage(wishlistProducts.length > 0 ? 'wishlist' : 'discover')
          setMainView('store')
        }}
        t={t}
      />
    )
  }

  if (homeLayout === 'coresense') {
    return (
      <CoreSenseHome
        containerRef={containerRef}
        installedGames={installedGames}
        libraryGames={games}
        selectedGame={focusedGame ?? featured}
        backdropGame={backdropGame ?? focusedGame ?? featured}
        storeProducts={storeProducts}
        activity={activity}
        language={language}
        onSelectGame={activateGame}
        onLaunchGame={(game) => launchGame(game.id)}
        onOpenStoreProduct={openStoreProduct}
        t={t}
      />
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
                onClick={() => launchGame(featured.id)}
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
                      {featuredHasActivity ? t('home.continuePlaying') : t('home.featuredInstalled')}
                    </p>
                    {featured.metadata.genres && (
                      <p className="mt-1 line-clamp-1 text-xs text-white/55">
                        {featured.metadata.genres.join(' · ')}
                      </p>
                    )}
                  </div>
                  {activity && (
                    <div className="absolute right-[clamp(1rem,2vw,1.5rem)] top-[clamp(1rem,2vw,1.5rem)] flex gap-2">
                      <ActivityMetric
                        label={t('home.activity7Days')}
                        activity={activity.sevenDays}
                        hasHistory={activity.recordedSessionCount > 0}
                        language={language}
                        t={t}
                      />
                      <ActivityMetric
                        label={t('home.activity30Days')}
                        activity={activity.thirtyDays}
                        hasHistory={activity.recordedSessionCount > 0}
                        language={language}
                        t={t}
                      />
                    </div>
                  )}
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
                            {t('details.yourPlaytime')}: {formatPlaytime(featured, t) ?? t('details.notPlayed')}
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
                    <GameCardMenuHint
                      size="large"
                      className="shadow-[0_8px_30px_rgba(0,0,0,0.3)]"
                    />
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
            {installedGames.map((game, index) => {
              const reflection = resolveHomeCardReflection(index, focusedGameIndex)
              return (
                <div key={game.id} className="home-game-tile shrink-0">
                  <GameCard
                    game={game}
                    navigationIndex={index}
                    homeReflection={reflection}
                    variant={homeLayout === 'float' ? 'float' : 'home'}
                    onActiveChange={(active, source) =>
                      updateHomeGameInteraction(game, active, source)
                    }
                  />
                </div>
              )
            })}
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

function nextRandomIndex(current: number, length: number): number {
  if (length <= 1) return 0
  return (current + 1 + Math.floor(Math.random() * (length - 1))) % length
}

function XModeHome({
  containerRef,
  installedGames,
  libraryGames,
  backdropGame,
  deals,
  onSelectGame,
  onLaunchGame,
  onOpenLibrary,
  onOpenSearch,
  onOpenDeal,
  onOpenDeals,
  t
}: {
  containerRef: RefObject<HTMLDivElement>
  installedGames: LibraryGame[]
  libraryGames: LibraryGame[]
  backdropGame: LibraryGame | null
  deals: StoreProduct[]
  onSelectGame: (game: LibraryGame) => void
  onLaunchGame: (game: LibraryGame) => void
  onOpenLibrary: () => void
  onOpenSearch: () => void
  onOpenDeal: (product: StoreProduct) => void
  onOpenDeals: () => void
  t: TFunction
}): JSX.Element {
  const reduceMotion = Boolean(useReducedMotion())
  const launcherGames = installedGames.slice(0, 6)
  const launcherIds = useMemo(
    () => new Set(launcherGames.map((game) => game.id)),
    [launcherGames]
  )
  const remainingGames = useMemo(
    () => libraryGames.filter((game) => !launcherIds.has(game.id)),
    [launcherIds, libraryGames]
  )
  const recentlyAddedGame = useMemo(
    () =>
      [...libraryGames].sort(
        (left, right) =>
          normalizeLibraryTimestamp(right.addedAt) - normalizeLibraryTimestamp(left.addedAt) ||
          right.updatedAt - left.updatedAt ||
          left.name.localeCompare(right.name)
      )[0] ?? null,
    [libraryGames]
  )
  const baseRecommendationPool = installedGames.length > 0 ? installedGames : libraryGames
  const recommendationPool =
    recentlyAddedGame && baseRecommendationPool.length > 1
      ? baseRecommendationPool.filter((game) => game.id !== recentlyAddedGame.id)
      : baseRecommendationPool
  const libraryPreviewGames = (remainingGames.length > 0 ? remainingGames : libraryGames).slice(0, 4)

  return (
    <div
      data-home-layout="xmode"
      data-home-stage-mode="game-focus"
      className="home-layout xmode-home relative flex h-full flex-col overflow-hidden"
    >
      <div className="absolute inset-0">
        <div className="home-backdrop-art absolute inset-0">
          <HomeBackdrop game={backdropGame ?? recommendationPool[0] ?? null} />
        </div>
        <div className="xmode-backdrop-veil absolute inset-0" />
        <div className="home-backdrop-dim absolute inset-0" />
      </div>

      <div
        ref={containerRef}
        className="scrollbar-none relative z-10 flex h-full flex-col overflow-y-auto px-[clamp(1.5rem,3.6vw,4.5rem)] pb-[clamp(1rem,2.5vh,2.25rem)] pt-[calc(5rem+clamp(0.25rem,1vh,0.8rem))]"
      >
        <button
          data-focusable
          data-view-entry="true"
          type="button"
          onClick={onOpenSearch}
          aria-label={t('home.xmode.search')}
          className="xmode-search group mx-auto flex h-[clamp(2.65rem,5vh,3.35rem)] w-[min(42rem,62vw)] shrink-0 items-center gap-3 rounded-full border border-white/15 bg-black/42 px-5 text-left text-sm text-white/55 shadow-[0_16px_42px_rgba(0,0,0,0.28)] outline-none backdrop-blur-2xl transition-[background-color,border-color,color] hover:border-white/30 hover:bg-black/55 hover:text-white"
        >
          <Search size={18} className="shrink-0 text-white/65 transition-colors group-hover:text-accent group-data-[focused=true]:text-accent" />
          <span className="truncate">{t('home.xmode.search')}</span>
        </button>

        {launcherGames.length > 0 ? (
          <>
            <section className="mt-[clamp(0.8rem,2vh,1.35rem)] shrink-0">
              <h2 className="mb-[clamp(0.45rem,1vh,0.75rem)] text-[clamp(0.9rem,1.2vw,1.1rem)] font-bold tracking-wide text-white">
                {t('home.xmode.jumpBack')}
              </h2>
              <div
                data-navigation-grid
                data-grid-columns={launcherGames.length + 1}
                data-grid-exit-y="true"
                style={{
                  gridTemplateColumns: `repeat(${launcherGames.length}, minmax(0, 1fr)) minmax(0, 1.28fr)`
                }}
                className="xmode-launcher-grid grid min-w-0 items-stretch"
              >
                {launcherGames.map((game, index) => (
                  <motion.button
                    key={game.id}
                    data-focusable
                    data-game-card="true"
                    data-game-id={game.id}
                    data-grid-index={index}
                    data-xmode-launcher={game.id}
                    type="button"
                    onFocus={() => onSelectGame(game)}
                    onMouseEnter={() => onSelectGame(game)}
                    onClick={() => onLaunchGame(game)}
                    aria-label={game.name}
                    whileHover={reduceMotion ? undefined : { y: -3, scale: 1.018 }}
                    whileFocus={reduceMotion ? undefined : { y: -3, scale: 1.018 }}
                    transition={{ type: 'spring', stiffness: 410, damping: 30 }}
                    className="xmode-game-card group relative aspect-square min-w-0 overflow-hidden rounded-[clamp(0.7rem,1.15vw,1.15rem)] border border-white/12 bg-surface-2 text-left shadow-card outline-none"
                  >
                    <GameImage
                      gameId={game.id}
                      name={game.name}
                      orientation="vertical"
                      fit="cover"
                      className="h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.04] group-data-[focused=true]:scale-[1.04] motion-reduce:transition-none"
                    />
                    <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/88 via-black/5 to-white/[0.06]" />
                    <span className="pointer-events-none absolute inset-x-0 bottom-0 line-clamp-2 p-[clamp(0.45rem,0.8vw,0.75rem)] text-[clamp(0.65rem,0.82vw,0.82rem)] font-semibold leading-tight text-white drop-shadow-lg">
                      {game.name}
                    </span>
                    <GameCardMenuHint
                      size="compact"
                      className="absolute right-2 top-2 z-20 opacity-0 transition-opacity group-hover:opacity-100 group-data-[focused=true]:opacity-100"
                    />
                  </motion.button>
                ))}

                <motion.button
                  data-focusable
                  data-grid-index={launcherGames.length}
                  data-xmode-library="true"
                  type="button"
                  onClick={onOpenLibrary}
                  aria-label={`${t('home.xmode.allGames')}, ${t('home.xmode.moreGames', { count: remainingGames.length })}`}
                  whileHover={reduceMotion ? undefined : { y: -3, scale: 1.012 }}
                  whileFocus={reduceMotion ? undefined : { y: -3, scale: 1.012 }}
                  transition={{ type: 'spring', stiffness: 410, damping: 30 }}
                  className="xmode-library-tile group relative min-w-0 overflow-hidden rounded-[clamp(0.7rem,1.15vw,1.15rem)] border border-white/12 bg-black/42 text-left shadow-card outline-none backdrop-blur-xl"
                >
                  <span className="absolute inset-0 grid grid-cols-2 gap-1.5 p-[clamp(0.55rem,0.9vw,0.9rem)] opacity-70 transition-transform duration-500 group-hover:scale-[1.035] group-data-[focused=true]:scale-[1.035] motion-reduce:transition-none">
                    {libraryPreviewGames.map((game) => (
                      <span key={game.id} className="min-h-0 overflow-hidden rounded-[0.45rem] bg-white/5">
                        <GameImage
                          gameId={game.id}
                          name={game.name}
                          orientation="vertical"
                          fit="cover"
                          className="h-full w-full object-cover"
                        />
                      </span>
                    ))}
                  </span>
                  <span className="absolute inset-0 bg-gradient-to-t from-black via-black/18 to-black/5" />
                  <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-[clamp(0.55rem,0.9vw,0.9rem)]">
                    <span className="min-w-0">
                      <span className="block truncate text-[clamp(0.72rem,0.9vw,0.9rem)] font-bold text-white">
                        {t('home.xmode.allGames')}
                      </span>
                      <span className="mt-0.5 block truncate text-[clamp(0.58rem,0.72vw,0.72rem)] text-white/58">
                        {t('home.xmode.moreGames', { count: remainingGames.length })}
                      </span>
                    </span>
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/12 text-white">
                      <LayoutGrid size={14} />
                    </span>
                  </span>
                </motion.button>
              </div>
            </section>

            <section className="mt-[clamp(1.4rem,3.4vh,2.4rem)] shrink-0 pb-1">
              <h2 className="mb-[clamp(0.65rem,1.4vh,1rem)] text-[clamp(1rem,1.35vw,1.25rem)] font-bold tracking-wide text-white">
                {t('home.xmode.featured')}
              </h2>
              <div
                data-navigation-grid
                data-grid-columns={2}
                data-grid-exit-y="true"
                className="xmode-feature-grid grid grid-cols-2 gap-[clamp(0.75rem,1.2vw,1.25rem)]"
              >
                <XModeWishlistDeals
                  products={deals}
                  onOpen={onOpenDeal}
                  onOpenDeals={onOpenDeals}
                  label={t('home.xmode.deal')}
                  t={t}
                />

              {recommendationPool.length > 0 && (
                <XModeLibraryRecommendations
                  games={recommendationPool}
                  onSelectGame={onSelectGame}
                  onLaunchGame={onLaunchGame}
                  onOpenLibrary={onOpenLibrary}
                  recentGame={recentlyAddedGame}
                  label={t('home.xmode.recommendation')}
                  description={t('home.xmode.recommendationBody')}
                  t={t}
                />
              )}
              </div>
            </section>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted">
            {libraryGames.length === 0 ? t('home.libraryLoading') : t('home.noInstalledGames')}
          </div>
        )}
      </div>
    </div>
  )
}

function canonicalRecommendationGenre(value: string): string {
  const genre = value.toLocaleLowerCase().replace(/[^a-z0-9äöüß]+/g, ' ').trim()
  const aliases: Array<[RegExp, string]> = [
    [/action|aktion/, 'action'],
    [/adventure|abenteuer/, 'adventure'],
    [/role playing|rollenspiel|\brpg\b/, 'rpg'],
    [/strategy|strategie/, 'strategy'],
    [/simulation/, 'simulation'],
    [/racing|rennen/, 'racing'],
    [/sport/, 'sports'],
    [/puzzle|rätsel/, 'puzzle'],
    [/horror/, 'horror'],
    [/shooter/, 'shooter'],
    [/indie/, 'indie']
  ]
  return aliases.find(([pattern]) => pattern.test(genre))?.[1] ?? genre
}

function normalizedProductName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

type CoreSenseRelationship = 'series' | 'publisher' | 'developer' | 'genre'

interface CoreSenseRecommendation {
  product: StoreProduct
  relationship: CoreSenseRelationship
  relationshipScore: number
}

const SERIES_SUFFIX_WORDS = new Set([
  'collection',
  'complete',
  'definitive',
  'deluxe',
  'digital',
  'dlc',
  'edition',
  'enhanced',
  'game',
  'german',
  'global',
  'gold',
  'goty',
  'international',
  'pack',
  'pass',
  'pc',
  'remake',
  'remastered',
  'resynced',
  'season',
  'standard',
  'soundtrack',
  'ultimate',
  'upgrade',
  'version',
  'worldwide'
])
const SERIES_CONNECTOR_WORDS = new Set(['a', 'an', 'and', 'der', 'des', 'die', 'of', 'the', 'und'])
const GENERIC_SINGLE_SERIES_WORDS = new Set([
  'black',
  'dead',
  'fall',
  'legend',
  'new',
  'red',
  'rise',
  'story',
  'world'
])
const CORPORATE_SUFFIX_WORDS = new Set([
  'ag',
  'co',
  'company',
  'corp',
  'corporation',
  'gmbh',
  'inc',
  'incorporated',
  'limited',
  'llc',
  'ltd',
  'plc',
  'sa'
])

function normalizedWords(value: string): string[] {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .match(/[a-z0-9]+/g)
    ?.filter((word) => word !== 's') ?? []
}

function seriesWords(value: string): string[] {
  return normalizedWords(value).filter(
    (word) => !SERIES_SUFFIX_WORDS.has(word) && !SERIES_CONNECTOR_WORDS.has(word)
  )
}

function baseGameIdentity(value: string): string {
  return seriesWords(value).join('')
}

function isInstallmentNumber(value: string): boolean {
  return /^(?:\d+|[ivxlcdm]+)$/i.test(value)
}

function isSameBaseGame(leftName: string, rightName: string): boolean {
  const left = seriesWords(leftName)
  const right = seriesWords(rightName)
  if (left.length === 0 || right.length === 0) return false
  if (left.join('') === right.join('')) return true

  const shorter = left.length <= right.length ? left : right
  const longer = left.length <= right.length ? right : left
  const isPrefix = shorter.every((word, index) => word === longer[index])
  return isPrefix && shorter.length >= 2 && shorter.some(isInstallmentNumber)
}

function seriesAffinity(leftName: string, rightName: string): number {
  const left = seriesWords(leftName)
  const right = seriesWords(rightName)
  if (left.length === 0 || right.length === 0) return 0

  let sharedPrefix = 0
  while (left[sharedPrefix] && left[sharedPrefix] === right[sharedPrefix]) sharedPrefix++
  if (sharedPrefix >= 2) return 4 + sharedPrefix

  const first = left[0]
  if (
    first === right[0] &&
    (/^\d+$/.test(first) ||
      (first.length >= 6 && !GENERIC_SINGLE_SERIES_WORDS.has(first)))
  ) {
    return 3
  }

  const rightHead = new Set(right.slice(0, 4))
  const sharedHeadWords = [...new Set(left.slice(0, 4))].filter((word) => rightHead.has(word))
  return sharedHeadWords.length >= 2 ? 2 : 0
}

function seriesSearchQuery(value: string): string {
  const tokens =
    value.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)?/gu)?.filter(Boolean) ?? []
  if (tokens.length === 0) return ''

  const meaningful = tokens
    .map((token, index) => ({ token, index, words: normalizedWords(token) }))
    .filter(
      ({ words }) =>
        words.length > 0 &&
        !words.every(
          (word) => SERIES_CONNECTOR_WORDS.has(word) || SERIES_SUFFIX_WORDS.has(word)
        )
    )
  if (meaningful.length === 0) return ''

  const first = meaningful[0]
  if (/^\d+$/.test(first.words[0])) return first.token
  const second = meaningful[1]
  if (!second) return first.token
  if (/^(?:\d+|[ivxlcdm]+)$/i.test(second.words[0])) {
    return tokens.slice(0, first.index + 1).join(' ')
  }
  if (GENERIC_SINGLE_SERIES_WORDS.has(second.words[0])) {
    return tokens.slice(0, first.index + 1).join(' ')
  }
  return tokens.slice(0, second.index + 1).join(' ')
}

function normalizedStudio(value: string): string {
  return normalizedWords(value)
    .filter((word) => !CORPORATE_SUFFIX_WORDS.has(word))
    .join('')
}

function studioOverlap(left: string[], right: string[]): number {
  const leftKeys = [...new Set(left.map(normalizedStudio).filter(Boolean))]
  const rightKeys = [...new Set(right.map(normalizedStudio).filter(Boolean))]
  return leftKeys.filter((leftKey) =>
    rightKeys.some(
      (rightKey) =>
        leftKey === rightKey ||
        (Math.min(leftKey.length, rightKey.length) >= 5 &&
          (leftKey.startsWith(rightKey) || rightKey.startsWith(leftKey)))
    )
  ).length
}

function relationshipForProduct(
  game: LibraryGame,
  product: StoreProduct
): CoreSenseRecommendation | null {
  const seriesScore = seriesAffinity(game.name, product.name)
  if (seriesScore > 0) {
    return { product, relationship: 'series', relationshipScore: seriesScore }
  }

  const publisherScore = studioOverlap(game.metadata.publishers ?? [], product.publishers ?? [])
  if (publisherScore > 0) {
    return { product, relationship: 'publisher', relationshipScore: publisherScore }
  }

  const developerScore = studioOverlap(game.metadata.developers ?? [], product.developers ?? [])
  if (developerScore > 0) {
    return { product, relationship: 'developer', relationshipScore: developerScore }
  }

  const genres = new Set(
    (game.metadata.genres ?? []).map(canonicalRecommendationGenre).filter(Boolean)
  )
  const matchingGenres = (product.genres ?? []).filter((genre) =>
    genres.has(canonicalRecommendationGenre(genre))
  )
  return matchingGenres.length > 0
    ? { product, relationship: 'genre', relationshipScore: matchingGenres.length }
    : null
}

function relatedStoreProducts(
  game: LibraryGame | null,
  products: StoreProduct[],
  libraryGames: LibraryGame[]
): CoreSenseRecommendation[] {
  if (!game) return []

  const ownedSteamAppIds = new Set(
    libraryGames
      .map((candidate) => candidate.appId)
      .filter((appId): appId is number => Number.isInteger(appId))
  )
  const ownedNames = new Set(libraryGames.map((candidate) => normalizedProductName(candidate.name)))
  const productsById = new Map<string, StoreProduct>()
  for (const product of products) {
    const existing = productsById.get(product.id)
    productsById.set(
      product.id,
      existing
        ? {
            ...existing,
            ...product,
            developers: product.developers ?? existing.developers,
            publishers: product.publishers ?? existing.publishers,
            searchOnly: existing.searchOnly === false ? false : product.searchOnly
          }
        : product
    )
  }

  const relationshipPriority: Record<CoreSenseRelationship, number> = {
    series: 4,
    publisher: 3,
    developer: 2,
    genre: 1
  }

  const ranked = [...productsById.values()]
    .map((product) => relationshipForProduct(game, product))
    .filter((recommendation): recommendation is CoreSenseRecommendation => Boolean(recommendation))
    .filter(
      ({ product }) =>
        !ownedSteamAppIds.has(product.steamAppId ?? -1) &&
        !ownedNames.has(normalizedProductName(product.name)) &&
        !isSameBaseGame(product.name, game.name) &&
        product.discoverEligible !== false &&
        product.artworkStatus === 'available' &&
        Boolean(product.headerUrl ?? product.heroUrl ?? product.portraitUrl) &&
        Boolean(storeProductUrl(product))
    )
    .sort(
      (left, right) =>
        relationshipPriority[right.relationship] - relationshipPriority[left.relationship] ||
        right.relationshipScore - left.relationshipScore ||
        right.product.recommendationScore - left.product.recommendationScore ||
        (right.product.bestOffer?.discountPercent ?? 0) -
          (left.product.bestOffer?.discountPercent ?? 0)
    )

  const seenBaseGames = new Set<string>()
  return ranked
    .filter(({ product }) => {
      const identity = baseGameIdentity(product.name) || normalizedProductName(product.name)
      if (seenBaseGames.has(identity)) return false
      seenBaseGames.add(identity)
      return true
    })
    .slice(0, 6)
}

function relationshipLabel(relationship: CoreSenseRelationship, t: TFunction): string {
  if (relationship === 'series') return t('home.coresense.relation.series')
  if (relationship === 'publisher') return t('home.coresense.relation.publisher')
  if (relationship === 'developer') return t('home.coresense.relation.developer')
  return t('home.coresense.relation.genre')
}

function CoreSenseHome({
  containerRef,
  installedGames,
  libraryGames,
  selectedGame,
  backdropGame,
  storeProducts,
  activity,
  language,
  onSelectGame,
  onLaunchGame,
  onOpenStoreProduct,
  t
}: {
  containerRef: RefObject<HTMLDivElement>
  installedGames: LibraryGame[]
  libraryGames: LibraryGame[]
  selectedGame: LibraryGame | null
  backdropGame: LibraryGame | null
  storeProducts: StoreProduct[]
  activity?: LibraryActivitySummary
  language: 'en' | 'de'
  onSelectGame: (game: LibraryGame) => void
  onLaunchGame: (game: LibraryGame) => void
  onOpenStoreProduct: (product: StoreProduct) => void
  t: TFunction
}): JSX.Element {
  const reduceMotion = useReducedMotion()
  const [seriesStoreProducts, setSeriesStoreProducts] = useState<StoreProduct[]>([])
  const [launcherInteractionGameId, setLauncherInteractionGameId] = useState<string | null>(null)
  const focusedLauncherGameIdRef = useRef<string | null>(null)
  const hoveredLauncherGameIdRef = useRef<string | null>(null)
  const launcherInteractionSourceRef = useRef<'focus' | 'pointer' | null>(null)
  const relationshipQuery = useMemo(
    () => seriesSearchQuery(selectedGame?.name ?? ''),
    [selectedGame?.name]
  )

  useEffect(() => {
    let active = true
    setSeriesStoreProducts([])
    if (relationshipQuery.length < 2) return () => undefined

    const timer = window.setTimeout(() => {
      void window.api.store
        .search(relationshipQuery)
        .then((response) => {
          if (active) setSeriesStoreProducts(response.products)
        })
        .catch(() => {
          if (active) setSeriesStoreProducts([])
        })
    }, 300)

    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [relationshipQuery])

  const recommendations = useMemo(
    () =>
      relatedStoreProducts(
        selectedGame,
        [...storeProducts, ...seriesStoreProducts],
        libraryGames
      ),
    [libraryGames, selectedGame, seriesStoreProducts, storeProducts]
  )
  const launcherGames = installedGames.slice(0, 6)
  const launcherReflectionIndex = launcherInteractionGameId
    ? launcherGames.findIndex((game) => game.id === launcherInteractionGameId)
    : -1
  const providerLabel = selectedGame?.provider.toLocaleUpperCase()
  const selectedPublishers = selectedGame?.metadata.publishers?.filter(Boolean).slice(0, 2) ?? []

  function updateLauncherInteraction(
    gameId: string,
    active: boolean,
    source: 'focus' | 'pointer'
  ): void {
    const sourceGameRef =
      source === 'focus' ? focusedLauncherGameIdRef : hoveredLauncherGameIdRef

    if (active) {
      const alreadyActive =
        sourceGameRef.current === gameId && launcherInteractionSourceRef.current === source
      sourceGameRef.current = gameId
      if (alreadyActive) return
      launcherInteractionSourceRef.current = source
      setLauncherInteractionGameId(gameId)
      return
    }

    if (sourceGameRef.current === gameId) sourceGameRef.current = null
    if (source === 'focus') {
      launcherInteractionSourceRef.current = null
      setLauncherInteractionGameId(null)
      return
    }
    if (launcherInteractionSourceRef.current !== source) return

    if (focusedLauncherGameIdRef.current) {
      launcherInteractionSourceRef.current = 'focus'
      setLauncherInteractionGameId(focusedLauncherGameIdRef.current)
      return
    }

    launcherInteractionSourceRef.current = null
    setLauncherInteractionGameId(null)
  }

  return (
    <div
      data-home-layout="coresense"
      data-home-stage-mode="game-focus"
      className="home-layout coresense-home relative flex h-full flex-col overflow-hidden"
    >
      <div className="absolute inset-0">
        <div className="home-backdrop-art absolute inset-0">
          <HomeBackdrop game={backdropGame} />
        </div>
        <div className="coresense-backdrop-veil absolute inset-0" />
        <div className="home-backdrop-dim absolute inset-0" />
      </div>

      <div
        ref={containerRef}
        className="scrollbar-none relative z-10 flex h-full flex-col overflow-y-auto px-[clamp(1.5rem,4vw,5rem)] pb-[clamp(1rem,2.5vh,2.25rem)] pt-[calc(5rem+clamp(0.75rem,2vh,1.5rem))]"
      >
        {installedGames.length > 0 ? (
          <>
            <section className="coresense-launcher-section shrink-0">
              <div className="mb-[clamp(0.45rem,1vh,0.8rem)] flex items-center justify-between gap-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-white/58">
                  {installedGames.some((game) => latestLibraryActivity(game) > 0)
                    ? t('home.continuePlaying')
                    : t('home.featuredInstalled')}
                </p>
                {activity && (
                  <div className="flex items-center gap-2 text-[10px] text-white/55">
                    <ActivityInline
                      label={t('home.activity7Days')}
                      activity={activity.sevenDays}
                      hasHistory={activity.recordedSessionCount > 0}
                      language={language}
                    />
                    <ActivityInline
                      label={t('home.activity30Days')}
                      activity={activity.thirtyDays}
                      hasHistory={activity.recordedSessionCount > 0}
                      language={language}
                    />
                  </div>
                )}
              </div>
              <div
                data-navigation-grid
                data-grid-columns={launcherGames.length}
                data-grid-exit-y="true"
                style={{
                  gridTemplateColumns: `repeat(${launcherGames.length}, minmax(0, var(--coresense-launcher-size)))`
                }}
                className="coresense-launcher-grid grid w-full min-w-0 items-start overflow-visible px-1 pb-3 pt-1"
              >
                {launcherGames.map((game, index) => {
                  const active = selectedGame?.id === game.id
                  const reflection = resolveHomeCardReflection(index, launcherReflectionIndex)
                  const activeMotion =
                    !reduceMotion && reflection?.distance === 0
                      ? { y: -3, scale: 1.035 }
                      : { y: 0, scale: 1 }
                  return (
                    <motion.button
                      key={game.id}
                      data-focusable
                      data-game-card="true"
                      data-game-id={game.id}
                      data-grid-index={index}
                      data-home-game-card="true"
                      data-coresense-launcher="true"
                      data-active={active ? 'true' : undefined}
                      aria-label={game.name}
                      onFocus={() => {
                        onSelectGame(game)
                        updateLauncherInteraction(game.id, true, 'focus')
                      }}
                      onBlur={(event) => {
                        const next = event.relatedTarget
                        if (
                          next instanceof Element &&
                          next.closest('[data-coresense-launcher="true"]')
                        ) {
                          return
                        }
                        updateLauncherInteraction(game.id, false, 'focus')
                      }}
                      onMouseEnter={() => {
                        onSelectGame(game)
                        updateLauncherInteraction(game.id, true, 'pointer')
                      }}
                      onMouseMove={() => {
                        onSelectGame(game)
                        updateLauncherInteraction(game.id, true, 'pointer')
                      }}
                      onMouseLeave={(event) => {
                        const next = event.relatedTarget
                        if (
                          next instanceof Element &&
                          next.closest('[data-coresense-launcher="true"]')
                        ) {
                          return
                        }
                        updateLauncherInteraction(game.id, false, 'pointer')
                      }}
                      onClick={() => onLaunchGame(game)}
                      animate={activeMotion}
                      transition={
                        reduceMotion
                          ? { duration: 0 }
                          : { type: 'spring', stiffness: 420, damping: 30 }
                      }
                      className="coresense-launcher group relative shrink-0 scroll-m-[clamp(1rem,4vh,2.5rem)] text-left outline-none"
                    >
                      <span
                        className="coresense-launcher-art home-card-convex relative isolate block overflow-hidden border border-white/10 bg-black/35 shadow-card"
                      >
                        <GameImage
                          gameId={game.id}
                          name={game.name}
                          orientation="vertical"
                          fit="cover"
                          className="h-full w-full object-cover object-top"
                        />
                        {reflection && (
                          <HomeCardReflection reflection={reflection} />
                        )}
                        <span className="absolute inset-0 z-20 bg-gradient-to-t from-black/45 via-transparent to-white/[0.08]" />
                        <GameCardMenuHint
                          size="compact"
                          className="absolute bottom-2 right-2 z-20 opacity-0 transition-opacity group-hover:opacity-100 group-data-[focused=true]:opacity-100"
                        />
                      </span>
                      <span className="mt-2 block max-w-full truncate text-xs font-semibold text-white/72 transition-colors group-hover:text-white group-data-[focused=true]:text-white">
                        {game.name}
                      </span>
                    </motion.button>
                  )
                })}
              </div>
            </section>

            <div className="coresense-spotlight flex min-h-[5rem] flex-1 items-end py-[clamp(0.75rem,2.5vh,2.25rem)]">
              {selectedGame && (
                <motion.button
                  key={selectedGame.id}
                  data-focusable
                  data-game-card="true"
                  data-game-id={selectedGame.id}
                  data-coresense-primary="true"
                  onClick={() => onLaunchGame(selectedGame)}
                  initial={{ opacity: 0, x: -18 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                  className="coresense-identity group flex max-w-[min(48rem,82vw)] items-center gap-[clamp(0.8rem,1.6vw,1.35rem)] rounded-[clamp(0.9rem,1.4vw,1.25rem)] border border-white/10 bg-black/35 p-[clamp(0.7rem,1.3vw,1rem)] pr-[clamp(1rem,2vw,1.6rem)] text-left shadow-[0_18px_50px_rgba(0,0,0,0.28)] backdrop-blur-xl"
                >
                  <span className="coresense-identity-icon block shrink-0 overflow-hidden rounded-[24%] border border-white/15 bg-black/40 shadow-2xl">
                    <GameImage
                      gameId={selectedGame.id}
                      name={selectedGame.name}
                      orientation="icon"
                      className="h-full w-full object-cover"
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[9px] font-bold uppercase tracking-[0.24em] text-accent">
                      {providerLabel}
                    </span>
                    <span className="mt-0.5 line-clamp-2 text-[clamp(1.25rem,2.2vw,2rem)] font-bold leading-tight tracking-tight text-white drop-shadow-lg">
                      {selectedGame.name}
                    </span>
                    <span className="mt-1.5 flex min-w-0 items-center gap-2 text-[11px] text-white/58">
                      <Timer size={12} className="shrink-0 text-accent" />
                      <span className="truncate">
                        {formatPlaytime(selectedGame, t) ?? t('details.notPlayed')}
                        {selectedPublishers.length > 0 ? ` · ${selectedPublishers.join(' · ')}` : ''}
                      </span>
                    </span>
                  </span>
                  <GameCardMenuHint
                    size="large"
                    className="transition-transform group-hover:scale-105 group-data-[focused=true]:scale-105"
                  />
                </motion.button>
              )}
            </div>

            {recommendations.length > 0 && selectedGame && (
              <section className="coresense-recommendations shrink-0">
                <div className="mb-[clamp(0.45rem,1vh,0.75rem)] flex items-end justify-between gap-4">
                  <div>
                    <h2 className="text-[clamp(0.85rem,1.15vw,1.05rem)] font-semibold tracking-wide text-white">
                      {t('home.coresense.similar')}
                    </h2>
                    <p className="mt-0.5 text-[10px] text-white/48">
                      {t('home.coresense.because', { game: selectedGame.name })}
                    </p>
                  </div>
                </div>
                <div
                  data-navigation-grid
                  data-grid-columns={recommendations.length}
                  data-grid-exit-y="true"
                  style={{
                    gridTemplateColumns: `repeat(${recommendations.length}, minmax(0, 1fr))`
                  }}
                  className="coresense-recommendation-grid grid w-full min-w-0 px-1 pb-2 pt-1"
                >
                  {recommendations.map(({ product, relationship }, index) => (
                    <motion.button
                      key={product.id}
                      data-focusable
                      data-grid-index={index}
                      data-coresense-recommendation={product.id}
                      onClick={() => onOpenStoreProduct(product)}
                      whileHover={{ y: -3, scale: 1.015 }}
                      whileFocus={{ y: -3, scale: 1.015 }}
                      transition={{ type: 'spring', stiffness: 380, damping: 28 }}
                      aria-label={`${product.name}, ${relationshipLabel(relationship, t)}, ${product.bestOffer?.formattedPrice ?? t('store.openStore')}`}
                      className="coresense-store-card group relative shrink-0 overflow-hidden rounded-[clamp(0.6rem,1vw,0.9rem)] border border-white/10 bg-black/35 text-left shadow-card outline-none backdrop-blur-lg"
                    >
                      <span className="relative block aspect-[16/7.5] overflow-hidden">
                        <GameImage
                          gameId={product.id}
                          name={product.name}
                          orientation="horizontal"
                          fit="cover"
                          previewUrl={product.headerUrl ?? product.heroUrl ?? product.portraitUrl}
                          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.035] group-data-[focused=true]:scale-[1.035]"
                        />
                        <span className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/5 to-black/15" />
                        {(product.bestOffer?.discountPercent ?? 0) > 0 && (
                          <span className="absolute left-2 top-2 rounded-md bg-emerald-400 px-1.5 py-0.5 text-[9px] font-black text-black">
                            -{product.bestOffer?.discountPercent}%
                          </span>
                        )}
                      </span>
                      <span className="flex items-center justify-between gap-3 px-3 py-2.5">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-bold text-white">{product.name}</span>
                          <span className="mt-0.5 block truncate text-[9px] text-white/48">
                            {relationshipLabel(relationship, t)} ·{' '}
                            {product.bestOffer?.sourceLabel ?? t('store.openStore')}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-bold text-white">
                          {product.bestOffer?.formattedPrice ?? ''}
                          <ExternalLink size={11} className="text-accent" />
                        </span>
                      </span>
                    </motion.button>
                  ))}
                </div>
              </section>
            )}
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted">
            {t('home.noInstalledGames')}
          </div>
        )}
      </div>
    </div>
  )
}

function ActivityMetric({
  label,
  activity,
  hasHistory,
  language,
  t
}: {
  label: string
  activity: LibraryActivityWindow
  hasHistory: boolean
  language: 'en' | 'de'
  t: TFunction
}): JSX.Element {
  return (
    <div className="w-[clamp(6.25rem,9vw,7.75rem)] rounded-xl border border-white/10 bg-black/45 px-3 py-2 text-left shadow-lg backdrop-blur-xl">
      <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-white/50">
        <CalendarDays size={11} className="text-accent" />
        {label}
      </p>
      <p className="mt-1 text-sm font-bold text-white">
        {hasHistory ? formatActivityDuration(activity.playtimeSeconds, language) : '—'}
      </p>
      <p className="mt-0.5 truncate text-[9px] text-white/45">
        {hasHistory
          ? t(activity.sessionCount === 1 ? 'home.sessionCountSingle' : 'home.sessionCount', {
              count: activity.sessionCount
            })
          : t('home.activityWaiting')}
      </p>
    </div>
  )
}

function ActivityInline({
  label,
  activity,
  hasHistory,
  language
}: {
  label: string
  activity: LibraryActivityWindow
  hasHistory: boolean
  language: 'en' | 'de'
}): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/35 px-2.5 py-1 backdrop-blur-lg">
      <CalendarDays size={10} className="text-accent" />
      <span className="font-bold uppercase tracking-wider text-white/45">{label}</span>
      <span className="font-semibold text-white/80">
        {hasHistory ? formatActivityDuration(activity.playtimeSeconds, language) : '—'}
      </span>
    </span>
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
                  value={formatPlaytime(game, t) ?? t('details.notPlayed')}
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

function XModeLibraryRecommendations({
  games,
  onSelectGame,
  onLaunchGame,
  onOpenLibrary,
  recentGame,
  label,
  description,
  t
}: {
  games: LibraryGame[]
  onSelectGame: (game: LibraryGame) => void
  onLaunchGame: (game: LibraryGame) => void
  onOpenLibrary: () => void
  recentGame: LibraryGame | null
  label: string
  description: string
  t: TFunction
}): JSX.Element {
  const reduceMotion = Boolean(useReducedMotion())
  const progressRef = useRef<HTMLSpanElement>(null)
  const focusedRef = useRef(false)
  const hoveredRef = useRef(false)
  const signature = games.map((game) => game.id).join('|')
  const [recommendationIndex, setRecommendationIndex] = useState(() =>
    games.length > 1 ? Math.floor(Math.random() * games.length) : 0
  )

  useEffect(() => {
    setRecommendationIndex(games.length > 1 ? Math.floor(Math.random() * games.length) : 0)
  }, [games.length, signature])

  useEffect(() => {
    const progress = progressRef.current
    if (!progress) return undefined
    progress.style.transform = 'scaleX(0)'
    if (games.length <= 1) return undefined

    let elapsedMs = 0
    let previousTick = performance.now()
    const timer = window.setInterval(() => {
      const now = performance.now()
      const deltaMs = Math.min(500, now - previousTick)
      previousTick = now
      if (document.hidden || focusedRef.current || hoveredRef.current) return

      elapsedMs += deltaMs
      if (elapsedMs >= XMODE_RECOMMENDATION_ROTATION_MS) {
        elapsedMs %= XMODE_RECOMMENDATION_ROTATION_MS
        setRecommendationIndex((current) => nextRandomIndex(current, games.length))
      }
      progress.style.transform = `scaleX(${elapsedMs / XMODE_RECOMMENDATION_ROTATION_MS})`
    }, 100)

    return () => window.clearInterval(timer)
  }, [games.length, signature])

  const recommendation =
    games[recommendationIndex % Math.max(games.length, 1)] ?? recentGame ?? null

  return (
    <div
      data-xmode-recommendation-card
      onMouseEnter={() => {
        hoveredRef.current = true
      }}
      onMouseLeave={() => {
        hoveredRef.current = false
      }}
      onFocusCapture={() => {
        focusedRef.current = true
      }}
      onBlurCapture={(event) => {
        const next = event.relatedTarget
        if (!(next instanceof Node) || !event.currentTarget.contains(next)) {
          focusedRef.current = false
        }
      }}
      className="xmode-recommendation-column grid h-full min-w-0 grid-rows-2 gap-[clamp(0.75rem,1.2vw,1.25rem)] text-left"
    >
      {recommendation && (
        <motion.button
          data-focusable
          data-grid-index={1}
          data-game-card="true"
          data-game-id={recommendation.id}
          data-xmode-recommendation-offer={recommendation.id}
          type="button"
          onFocus={() => onSelectGame(recommendation)}
          onMouseEnter={() => onSelectGame(recommendation)}
          onClick={() => onLaunchGame(recommendation)}
          aria-label={`${label}: ${recommendation.name}`}
          whileHover={reduceMotion ? undefined : { scale: 1.008 }}
          whileFocus={reduceMotion ? undefined : { scale: 1.008 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          className="xmode-recommendation-offer group relative min-h-0 min-w-0 overflow-hidden rounded-xl2 border border-white/10 bg-black/35 text-left shadow-card outline-none"
        >
          <AnimatePresence initial={false} mode="wait">
            <motion.span
              key={recommendation.id}
              initial={reduceMotion ? { opacity: 1 } : { opacity: 0, x: 28 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -28 }}
              transition={{ duration: reduceMotion ? 0 : 0.34, ease: [0.22, 1, 0.36, 1] }}
              className="absolute inset-0"
            >
              <GameImage
                gameId={recommendation.id}
                name={recommendation.name}
                orientation="horizontal"
                fit="cover"
                className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.035] group-data-[focused=true]:scale-[1.035] motion-reduce:transition-none"
              />
              <span className="absolute inset-0 bg-gradient-to-r from-black/88 via-black/34 to-black/8" />
              <span className="absolute inset-0 bg-gradient-to-t from-black/82 via-transparent to-black/28" />
              <span className="xmode-recommendation-info absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-3 p-[clamp(1rem,1.7vw,1.5rem)]">
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-[clamp(1.05rem,1.55vw,1.45rem)] font-bold leading-tight text-white drop-shadow-lg">
                    {recommendation.name}
                  </span>
                  <span className="xmode-recommendation-meta mt-1.5 block truncate text-[10px] font-semibold uppercase tracking-wider text-white/58">
                    {recommendation.provider} · {formatPlaytime(recommendation, t) ?? t('details.notPlayed')}
                  </span>
                </span>
                <GameCardMenuHint size="compact" className="shrink-0" />
              </span>
            </motion.span>
          </AnimatePresence>

          <span className="pointer-events-none absolute left-[clamp(1rem,1.7vw,1.5rem)] top-[clamp(0.85rem,1.5vw,1.25rem)] z-20 min-w-0 rounded-lg bg-black/38 px-2.5 py-2 backdrop-blur-md">
            <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-accent">
              <Shuffle size={12} />
              {label}
            </span>
            <span className="xmode-recommendation-description mt-1 block truncate text-[10px] text-white/58">
              {description}
            </span>
          </span>

          {games.length > 1 && (
            <span className="pointer-events-none absolute inset-x-[clamp(1rem,1.7vw,1.5rem)] bottom-2 z-30 h-1 overflow-hidden rounded-full bg-white/20 shadow-sm">
              <span
                ref={progressRef}
                className="block h-full origin-left scale-x-0 rounded-full bg-white/90"
              />
            </span>
          )}
        </motion.button>
      )}

      {recentGame && (
        <motion.button
          data-focusable
          data-grid-index={3}
          data-game-card="true"
          data-game-id={recentGame.id}
          data-xmode-recently-added={recentGame.id}
          type="button"
          onFocus={() => onSelectGame(recentGame)}
          onMouseEnter={() => onSelectGame(recentGame)}
          onClick={() => (recentGame.installed ? onLaunchGame(recentGame) : onOpenLibrary())}
          aria-label={`${t('home.xmode.recentlyAdded')}: ${recentGame.name}`}
          whileHover={reduceMotion ? undefined : { scale: 1.008 }}
          whileFocus={reduceMotion ? undefined : { scale: 1.008 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          className="xmode-recently-added-tile group relative min-h-0 min-w-0 overflow-hidden rounded-xl2 border border-white/10 bg-black/35 text-left shadow-card outline-none"
        >
          <GameImage
            gameId={recentGame.id}
            name={recentGame.name}
            orientation="horizontal"
            fit="cover"
            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.035] group-data-[focused=true]:scale-[1.035] motion-reduce:transition-none"
          />
          <span className="absolute inset-0 bg-gradient-to-r from-black/88 via-black/32 to-black/8" />
          <span className="absolute inset-0 bg-gradient-to-t from-black/84 via-transparent to-black/28" />
          <span className="pointer-events-none absolute left-[clamp(1rem,1.7vw,1.5rem)] top-[clamp(0.85rem,1.5vw,1.25rem)] z-20 rounded-lg bg-black/38 px-2.5 py-2 backdrop-blur-md">
            <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-accent">
              <CalendarDays size={12} />
              {t('home.xmode.recentlyAdded')}
            </span>
          </span>
          <span className="xmode-recently-added-info absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-3 p-[clamp(1rem,1.7vw,1.5rem)]">
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 text-[clamp(1.05rem,1.55vw,1.45rem)] font-bold leading-tight text-white drop-shadow-lg">
                {recentGame.name}
              </span>
              <span className="mt-1.5 block truncate text-[10px] font-semibold uppercase tracking-wider text-white/58">
                {recentGame.provider} · {t('home.xmode.recentlyAddedBody')}
              </span>
            </span>
            {recentGame.installed ? (
              <GameCardMenuHint size="compact" className="shrink-0" />
            ) : (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/14 text-white backdrop-blur-md">
                <LayoutGrid size={14} />
              </span>
            )}
          </span>
        </motion.button>
      )}
    </div>
  )
}

function XModeWishlistDeals({
  products,
  onOpen,
  onOpenDeals,
  label,
  t
}: {
  products: StoreProduct[]
  onOpen: (product: StoreProduct) => void
  onOpenDeals: () => void
  label: string
  t: TFunction
}): JSX.Element {
  const reduceMotion = Boolean(useReducedMotion())
  const progressRef = useRef<HTMLDivElement>(null)
  const focusedRef = useRef(false)
  const hoveredRef = useRef(false)
  const signature = products.map((product) => product.id).join('|')
  const pageCount = Math.max(1, Math.ceil(products.length / 2))
  const [pageIndex, setPageIndex] = useState(0)

  useEffect(() => setPageIndex(0), [signature])

  useEffect(() => {
    const progress = progressRef.current
    if (!progress) return undefined
    progress.style.transform = 'scaleX(0)'
    if (pageCount <= 1) return undefined

    let elapsedMs = 0
    let previousTick = performance.now()
    const timer = window.setInterval(() => {
      const now = performance.now()
      const deltaMs = Math.min(500, now - previousTick)
      previousTick = now
      if (document.hidden || focusedRef.current || hoveredRef.current) return

      elapsedMs += deltaMs
      if (elapsedMs >= WISHLIST_ROTATION_MS) {
        elapsedMs %= WISHLIST_ROTATION_MS
        setPageIndex((current) => (current + 1) % pageCount)
      }
      progress.style.transform = `scaleX(${elapsedMs / WISHLIST_ROTATION_MS})`
    }, 100)

    return () => window.clearInterval(timer)
  }, [pageCount, signature])

  const normalizedPageIndex = pageIndex % pageCount
  const pairStart = products.length > 0 ? (normalizedPageIndex * 2) % products.length : 0
  const visibleProducts =
    products.length === 0
      ? []
      : products.length === 1
      ? [products[0]]
      : [products[pairStart], products[(pairStart + 1) % products.length]]

  if (visibleProducts.length === 0) {
    return (
      <motion.button
        data-focusable
        data-grid-index={0}
        type="button"
        onClick={onOpenDeals}
        whileHover={reduceMotion ? undefined : { scale: 1.008 }}
        whileFocus={reduceMotion ? undefined : { scale: 1.008 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        className="group relative h-full min-h-0 min-w-0 overflow-hidden rounded-xl2 border border-white/10 bg-black/38 p-[clamp(1.25rem,2vw,2rem)] text-left shadow-card outline-none backdrop-blur-xl"
      >
        <span className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgb(var(--color-accent)/0.28),transparent_42%),linear-gradient(145deg,transparent,rgb(var(--color-accent-2)/0.16))]" />
        <span className="relative flex h-full flex-col justify-end">
          <Heart size={26} className="mb-auto text-accent" />
          <span className="text-[clamp(1.2rem,2vw,1.8rem)] font-bold text-white">
            {t('home.xmode.dealEmpty')}
          </span>
          <span className="mt-1.5 max-w-lg text-sm leading-relaxed text-white/60">
            {t('home.xmode.dealEmptyBody')}
          </span>
        </span>
      </motion.button>
    )
  }

  return (
    <div
      data-xmode-wishlist-card
      onMouseEnter={() => {
        hoveredRef.current = true
      }}
      onMouseLeave={() => {
        hoveredRef.current = false
      }}
      onFocusCapture={() => {
        focusedRef.current = true
      }}
      onBlurCapture={(event) => {
        const next = event.relatedTarget
        if (!(next instanceof Node) || !event.currentTarget.contains(next)) {
          focusedRef.current = false
        }
      }}
      className="xmode-wishlist-stack relative h-full min-w-0 text-left"
    >
      <AnimatePresence initial={false} mode="wait">
        <motion.div
          key={visibleProducts.map((product) => product.id).join(':')}
          initial={reduceMotion ? { opacity: 1 } : { opacity: 0, x: 28 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -28 }}
          transition={{ duration: reduceMotion ? 0 : 0.34, ease: [0.22, 1, 0.36, 1] }}
          style={{
            gridTemplateRows: `repeat(${visibleProducts.length}, minmax(0, 1fr))`
          }}
          className="absolute inset-0 grid gap-[clamp(0.75rem,1.2vw,1.25rem)]"
        >
          {visibleProducts.map((product, index) => {
            const offer = product.bestOffer
            return (
              <motion.button
                key={`${product.id}:${index}`}
                data-focusable
                data-grid-index={index * 2}
                data-home-wishlist-offer={product.id}
                type="button"
                onClick={() => onOpen(product)}
                aria-label={`${label}: ${product.name}, ${offer?.formattedPrice ?? t('store.checkPrice')}`}
                whileHover={reduceMotion ? undefined : { scale: 1.012 }}
                whileFocus={reduceMotion ? undefined : { scale: 1.012 }}
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                className="xmode-wishlist-offer group relative min-h-0 min-w-0 overflow-hidden rounded-xl2 border border-white/10 bg-black/35 text-left shadow-card outline-none"
              >
                <WishlistArtwork product={product} />
                <span className="absolute inset-0 bg-gradient-to-t from-black/94 via-black/20 to-black/30" />
                <span className="absolute inset-0 bg-gradient-to-r from-black/72 via-black/18 to-transparent" />
                <span className="xmode-deal-header pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-3 p-[clamp(0.65rem,1vw,0.9rem)]">
                  <span className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.17em] text-accent">
                    <Heart size={11} fill="currentColor" />
                    {label}
                  </span>
                  {index === 0 && pageCount > 1 && (
                    <span className="rounded-full bg-black/45 px-2 py-1 text-[9px] font-semibold text-white/65 backdrop-blur-md">
                      {normalizedPageIndex + 1}/{pageCount}
                    </span>
                  )}
                </span>
                <span className="xmode-deal-info absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-3 p-[clamp(0.7rem,1.2vw,1.05rem)]">
                  <span className="min-w-0 flex-1">
                    {(offer?.discountPercent ?? 0) > 0 && (
                      <span className="xmode-deal-discount mb-1 inline-flex rounded-md bg-emerald-400 px-1.5 py-0.5 text-[9px] font-black text-black">
                        -{offer?.discountPercent}%
                      </span>
                    )}
                    <span className="line-clamp-2 text-[clamp(1rem,1.45vw,1.35rem)] font-bold leading-tight text-white drop-shadow-lg">
                      {product.name}
                    </span>
                    <span className="xmode-deal-price mt-1.5 flex min-w-0 items-end gap-2">
                      <span className="min-w-0">
                        <span className="xmode-deal-source block truncate text-[9px] uppercase tracking-wider text-white/45">
                          {offer?.sourceLabel ?? t('store.bestPrice')}
                        </span>
                        <span className="mt-0.5 block text-[clamp(1rem,1.4vw,1.3rem)] font-black text-white">
                          {offer?.formattedPrice ?? t('store.checkPrice')}
                        </span>
                      </span>
                    </span>
                  </span>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-black shadow-lg">
                    <ExternalLink size={13} />
                  </span>
                </span>
              </motion.button>
            )
          })}
        </motion.div>
      </AnimatePresence>

      {pageCount > 1 && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-30 h-1 w-[clamp(6rem,16vw,12rem)] -translate-x-1/2 overflow-hidden rounded-full bg-white/20 shadow-sm">
          <div
            ref={progressRef}
            className="h-full origin-left scale-x-0 rounded-full bg-white/90"
          />
        </div>
      )}
    </div>
  )
}

function WishlistOfferBanner({
  product,
  index,
  total,
  onOpen,
  eyebrow,
  t
}: {
  product: StoreProduct
  index: number
  total: number
  onOpen: () => void
  eyebrow?: string
  t: ReturnType<typeof useT>
}): JSX.Element {
  const offer = product.bestOffer
  const label = eyebrow ?? t('home.wishlistOffer')
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
      aria-label={`${label}: ${product.name}, ${offer?.formattedPrice ?? t('store.checkPrice')}`}
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
                {label}
              </p>
              {total > 1 && (
                <span className="rounded-full bg-black/35 px-2 py-1 text-[10px] text-white/60">
                  {index + 1}/{total}
                </span>
              )}
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
