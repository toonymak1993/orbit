import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Check,
  Bell,
  CalendarDays,
  Globe2,
  Heart,
  Loader2,
  Percent,
  RefreshCw,
  Search,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Trash2,
  X
} from 'lucide-react'
import { useAutoFocus } from '@renderer/hooks/useAutoFocus'
import { useBackHandler } from '@renderer/hooks/useBackHandler'
import { focusElement } from '@renderer/lib/spatialNavigation'
import { STORE_SEARCH_EVENT } from '@renderer/lib/librarySearch'
import { GameImage } from '@renderer/components/GameImage'
import { ControllerButtonHint } from '@renderer/components/ControllerButtonHint'
import { ReleaseCalendarView } from '@renderer/views/Releases/ReleaseCalendarView'
import { useExpandableViewSearch } from '@renderer/hooks/useExpandableViewSearch'
import { useStoreStore } from '@renderer/state/storeStore'
import { useLibraryStore } from '@renderer/state/libraryStore'
import { useNavigationStore } from '@renderer/state/navigationStore'
import { useStoreNavigationStore, type StorePage } from '@renderer/state/storeNavigationStore'
import { useT } from '@renderer/i18n/useT'
import type { TranslationKey } from '@renderer/i18n/translations'
import type {
  LibraryGame,
  StoreOffer,
  StorePriceAlert,
  StorePricePoint,
  StoreProduct,
  StoreRegionId
} from '@shared/ipc'
import { latestLibraryActivity } from '@shared/libraryTime'
import {
  hasStoreArtwork,
  isStoreDiscoverProductVisible
} from '@shared/storeVisibility'

const STORE_PAGES: Array<{ id: StorePage; key: TranslationKey; icon: typeof Sparkles }> = [
  { id: 'discover', key: 'store.page.discover', icon: Sparkles },
  { id: 'releases', key: 'nav.releases', icon: CalendarDays },
  { id: 'deals', key: 'store.page.deals', icon: Percent },
  { id: 'wishlist', key: 'store.page.wishlist', icon: Heart },
  { id: 'alerts', key: 'store.page.alerts', icon: Bell }
]

const REGIONS: Array<{ id: StoreRegionId; key: TranslationKey; currency: string }> = [
  { id: 'eu', key: 'store.region.eu', currency: 'EUR' },
  { id: 'us', key: 'store.region.us', currency: 'USD' },
  { id: 'gb', key: 'store.region.gb', currency: 'GBP' },
  { id: 'ca', key: 'store.region.ca', currency: 'CAD' },
  { id: 'au', key: 'store.region.au', currency: 'AUD' }
]

function canonicalGenre(value: string): string {
  const genre = value.normalize('NFKD').toLocaleLowerCase('en')
  const aliases: Array<[RegExp, string]> = [
    [/action|aktion/, 'action'],
    [/adventure|abenteuer/, 'adventure'],
    [/role.?playing|rollenspiel|\brpg\b/, 'rpg'],
    [/strategy|strategie/, 'strategy'],
    [/simulation/, 'simulation'],
    [/racing|rennen/, 'racing'],
    [/sport/, 'sports'],
    [/puzzle|r.tsel/, 'puzzle'],
    [/horror/, 'horror'],
    [/shooter/, 'shooter'],
    [/indie/, 'indie']
  ]
  return aliases.find(([pattern]) => pattern.test(genre))?.[1] ?? genre.trim()
}

function gameIdentityWeight(game: LibraryGame): number {
  const playtime = Math.min(Math.log2(1 + (game.playtimeMinutes ?? 0) / 60) * 5, 28)
  const lastActivity = latestLibraryActivity(game)
  const ageDays = lastActivity ? (Date.now() - lastActivity) / 86_400_000 : Infinity
  const recency = ageDays < 30 ? 16 : ageDays < 180 ? 9 : ageDays < 365 ? 4 : 0
  return 1 + playtime + recency + (game.installed ? 5 : 0)
}

function genreProfile(games: LibraryGame[], storeProducts: StoreProduct[]): Map<string, number> {
  const profile = new Map<string, number>()
  for (const game of games) {
    const weight = gameIdentityWeight(game)
    for (const genre of game.metadata.genres ?? []) {
      const key = canonicalGenre(genre)
      profile.set(key, (profile.get(key) ?? 0) + weight)
    }
  }
  for (const product of storeProducts) {
    if (!product.steamWishlisted && !product.orbitWishlisted) continue
    const wishlistWeight = product.steamWishlisted ? 18 : 14
    for (const genre of product.genres ?? []) {
      const key = canonicalGenre(genre)
      profile.set(key, (profile.get(key) ?? 0) + wishlistWeight)
    }
  }
  return profile
}

function personalizedProductScore(product: StoreProduct, profile: Map<string, number>): number {
  const affinity = (product.genres ?? []).reduce(
    (score, genre) => score + (profile.get(canonicalGenre(genre)) ?? 0),
    0
  )
  const discount = Math.min(product.bestOffer?.discountPercent ?? 0, 40)
  const wishlistAffinity = product.steamWishlisted ? 42 : product.orbitWishlisted ? 28 : 0
  return affinity + product.recommendationScore * 0.35 + discount * 0.18 + wishlistAffinity
}

export function StoreView(): JSX.Element {
  const containerRef = useAutoFocus<HTMLDivElement>()
  const t = useT()
  const snapshot = useStoreStore((state) => state.snapshot)
  const initialized = useStoreStore((state) => state.initialized)
  const loadError = useStoreStore((state) => state.loadError)
  const refresh = useStoreStore((state) => state.refresh)
  const compareProduct = useStoreStore((state) => state.compareProduct)
  const searchStore = useStoreStore((state) => state.search)
  const clearStoreSearch = useStoreStore((state) => state.clearSearch)
  const searchResults = useStoreStore((state) => state.searchResults)
  const isSearching = useStoreStore((state) => state.isSearching)
  const setRegion = useStoreStore((state) => state.setRegion)
  const toggleWishlist = useStoreStore((state) => state.toggleWishlist)
  const setPriceAlert = useStoreStore((state) => state.setPriceAlert)
  const removePriceAlert = useStoreStore((state) => state.removePriceAlert)
  const page = useStoreNavigationStore((state) => state.page)
  const direction = useStoreNavigationStore((state) => state.direction)
  const setPage = useStoreNavigationStore((state) => state.setPage)
  const [query, setQuery] = useState('')
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null)
  const lastOpenedProductId = useRef<string | null>(null)
  const librarySnapshot = useLibraryStore((state) => state.snapshot)
  const libraryGames = useMemo(
    () => [...librarySnapshot.games, ...(librarySnapshot.excludedGames ?? [])],
    [librarySnapshot.excludedGames, librarySnapshot.games]
  )
  const isActive = useNavigationStore((state) => state.mainView === 'store')
  const {
    expanded: searchExpanded,
    inputRef: searchRef,
    expand: expandSearch,
    collapse: collapseSearch
  } = useExpandableViewSearch({
    active: isActive,
    containerRef,
    eventName: STORE_SEARCH_EVENT,
    onCollapse: () => setQuery('')
  })
  const identityProfile = useMemo(
    () => genreProfile(libraryGames, snapshot.products),
    [libraryGames, snapshot.products]
  )
  const activeQuery = query.trim().length >= 2 ? query.trim() : ''

  const openProduct = (productId: string): void => {
    lastOpenedProductId.current = productId
    setSelectedProductId(productId)
    void compareProduct(productId)
  }

  const closeProduct = (): void => {
    const productId = lastOpenedProductId.current
    setSelectedProductId(null)
    window.requestAnimationFrame(() => {
      if (!productId) return
      focusElement(
        containerRef.current?.querySelector<HTMLElement>(
          `[data-store-product-id="${CSS.escape(productId)}"]`
        ) ?? null
      )
    })
  }

  const selectedProduct = selectedProductId
    ? [...snapshot.products, ...searchResults].find((product) => product.id === selectedProductId) ?? null
    : null

  useEffect(() => {
    const normalized = query.trim()
    if (normalized.length < 2) {
      clearStoreSearch()
      return
    }
    const timer = window.setTimeout(() => void searchStore(normalized), 320)
    return () => window.clearTimeout(timer)
  }, [clearStoreSearch, query, searchStore])

  const products = useMemo(() => {
    const normalizedQuery = activeQuery.toLocaleLowerCase()
    const ownedSteamAppIds = new Set(
      libraryGames
        .map((game) => game.appId)
        .filter((appId): appId is number => Number.isInteger(appId))
    )
    const sourceProducts = normalizedQuery ? searchResults : snapshot.products
    const matches = sourceProducts.filter(
      (product) =>
        product.artworkStatus !== 'missing' &&
        (!normalizedQuery ||
          product.name.toLocaleLowerCase().includes(normalizedQuery) ||
          product.genres?.some((genre) => genre.toLocaleLowerCase().includes(normalizedQuery)))
    )
    if (normalizedQuery) {
      return matches
        .filter(
          (product) =>
            product.artworkStatus === 'available' &&
            hasStoreArtwork(product)
        )
        .sort((left, right) => right.recommendationScore - left.recommendationScore)
    }
    if (page === 'wishlist') {
      return matches
        .filter(
          (product) =>
            (product.steamWishlisted || product.orbitWishlisted) &&
            product.artworkStatus === 'available' &&
            hasStoreArtwork(product)
        )
        .sort(
          (left, right) =>
            Number(right.orbitWishlisted) - Number(left.orbitWishlisted) ||
            (right.steamWishlistAddedAt ?? 0) - (left.steamWishlistAddedAt ?? 0)
        )
    }
    if (page === 'deals') {
      return matches
        .filter(
          (product) =>
            !ownedSteamAppIds.has(product.steamAppId ?? -1) &&
            product.artworkStatus === 'available' &&
            (product.steamWishlisted || product.orbitWishlisted || product.discoverEligible !== false) &&
            (product.bestOffer?.discountPercent ?? 0) > 0
        )
        .sort(
          (left, right) =>
            (right.bestOffer?.discountPercent ?? 0) - (left.bestOffer?.discountPercent ?? 0) ||
            (left.bestOffer?.priceMinor ?? Infinity) - (right.bestOffer?.priceMinor ?? Infinity)
        )
    }
    return matches
      .filter((product) => isStoreDiscoverProductVisible(product, ownedSteamAppIds))
      .sort(
        (left, right) =>
          personalizedProductScore(right, identityProfile) -
            personalizedProductScore(left, identityProfile) ||
          (right.bestOffer?.discountPercent ?? 0) - (left.bestOffer?.discountPercent ?? 0)
      )
      .slice(0, 72)
  }, [activeQuery, identityProfile, libraryGames, page, searchResults, snapshot.products])

  const matchScores = useMemo(() => {
    const rawScores = products.map((product) => personalizedProductScore(product, identityProfile))
    const ceiling = Math.max(...rawScores, 1)
    return new Map(
      products.map((product) => [
        product.id,
        Math.min(98, Math.max(58, Math.round(58 + (personalizedProductScore(product, identityProfile) / ceiling) * 40)))
      ])
    )
  }, [identityProfile, products])

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (document.activeElement === searchRef.current) return
      const tab = containerRef.current?.querySelector<HTMLElement>(`[data-store-page="${page}"]`)
      focusElement(tab ?? null)
    })
    return () => cancelAnimationFrame(frame)
  }, [containerRef, page])

  function cycleRegion(): void {
    const currentIndex = REGIONS.findIndex((region) => region.id === snapshot.region)
    const next = REGIONS[(currentIndex + 1) % REGIONS.length]
    void setRegion(next.id)
  }

  const contentEyebrow = activeQuery
    ? t('store.section.allStores')
    : page === 'discover'
      ? t('store.section.forYou')
      : page === 'deals'
        ? t('store.section.deals')
        : page === 'wishlist'
          ? t('store.section.wishlist')
          : t('store.page.alerts')
  const contentHeading = activeQuery
    ? t('store.heading.searchResults', { query: activeQuery })
    : page === 'discover'
      ? t('store.heading.discover')
      : page === 'deals'
        ? t('store.heading.deals')
        : page === 'wishlist'
          ? t('store.heading.wishlist')
          : t('store.alert.heading')
  const visibleItemCount = page === 'alerts' && !activeQuery ? snapshot.priceAlerts.length : products.length

  return (
    <div
      ref={containerRef}
      className="relative flex h-full flex-col overflow-hidden px-[clamp(1.25rem,3vw,3.5rem)] pb-[clamp(0.75rem,2vh,1.5rem)] pt-[calc(5rem+clamp(0.65rem,1.8vh,1.15rem))]"
    >
      <div
        onFocusCapture={() => {
          containerRef.current
            ?.querySelector<HTMLElement>('[data-store-scroll]')
            ?.scrollTo({ top: 0, behavior: 'smooth' })
        }}
        className="store-toolbar mb-[clamp(0.75rem,1.8vh,1.15rem)] shrink-0"
      >
        <div
          data-navigation-layer="secondary"
          className="scrollbar-none flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-black/25 p-1"
        >
          <ControllerButtonHint
            button="leftTrigger"
            className="mx-1 rounded-md border border-white/15 px-1.5 py-0.5 text-[10px] font-bold text-muted"
          />
          {STORE_PAGES.map((item) => {
            const Icon = item.icon
            const active = page === item.id
            return (
              <motion.button
                key={item.id}
                data-focusable
                data-store-page={item.id}
                data-search-focus-fallback={active ? 'true' : undefined}
                aria-pressed={active}
                onClick={() => setPage(item.id)}
                whileTap={{ scale: 0.96 }}
                className={`relative flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold ${
                  active ? 'text-black' : 'text-muted hover:bg-white/10 hover:text-white'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="store-page-active"
                    className="absolute inset-0 rounded-full bg-accent"
                    transition={{ type: 'spring', stiffness: 440, damping: 34 }}
                  />
                )}
                <Icon size={14} className="relative z-10" />
                <span className="relative z-10">{t(item.key)}</span>
              </motion.button>
            )
          })}
          <ControllerButtonHint
            button="rightTrigger"
            className="mx-1 rounded-md border border-white/15 px-1.5 py-0.5 text-[10px] font-bold text-muted"
          />
        </div>

        <motion.div
          layout
          transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
          className={searchExpanded ? 'min-w-0 w-full' : 'w-fit min-w-0 justify-self-start'}
        >
          {searchExpanded ? (
            <div className="view-search-shell flex min-w-0 items-center gap-2 rounded-full border border-white/[0.07] bg-white/5 px-4 py-2.5">
              {isSearching ? (
                <Loader2 size={15} className="shrink-0 animate-spin text-accent" />
              ) : (
                <Search size={15} className="shrink-0 text-muted" />
              )}
              <input
                ref={searchRef}
                data-focusable
                data-view-search
                data-store-search
                type="search"
                inputMode="search"
                enterKeyHint="search"
                autoComplete="off"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label={t('store.search')}
                placeholder={t('store.search')}
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
              />
              <ControllerButtonHint
                button="north"
                className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md border border-white/15 bg-black/25 px-1.5 text-[10px] font-black text-white/70"
              />
              <button
                data-focusable
                type="button"
                onClick={collapseSearch}
                aria-label={t('search.close')}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-white/10 hover:text-white"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              tabIndex={-1}
              aria-label={t('store.search')}
              aria-keyshortcuts="Y"
              onClick={expandSearch}
              className="flex h-10 items-center gap-2 rounded-full border border-white/[0.07] bg-white/5 px-3 text-muted transition-colors hover:bg-white/10 hover:text-white"
            >
              <Search size={15} />
              <ControllerButtonHint
                button="north"
                className="flex h-6 min-w-6 items-center justify-center rounded-md border border-white/15 bg-black/25 px-1.5 text-[10px] font-black text-white/70"
              />
            </button>
          )}
        </motion.div>

        <div className="flex items-center justify-end gap-2">
        <button
          data-focusable
          onClick={cycleRegion}
          className="flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-semibold"
        >
          <Globe2 size={14} className="text-accent" />
          {t(REGIONS.find((region) => region.id === snapshot.region)?.key ?? 'store.region.eu')}
        </button>
        <button
          data-focusable
          onClick={() => void refresh()}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/5"
          aria-label={t('store.refresh')}
        >
          {snapshot.isRefreshing ? (
            <Loader2 size={15} className="animate-spin text-accent" />
          ) : (
            <RefreshCw size={15} />
          )}
        </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <AnimatePresence initial={false} mode="sync" custom={direction}>
          <motion.div
            data-store-scroll
            key={page}
            initial={{ opacity: 0, x: direction * 42 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction * -30 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="scrollbar-none absolute inset-0 overflow-y-auto px-[clamp(0.35rem,0.8vw,0.75rem)] pb-[clamp(4rem,10vh,6rem)] pt-1"
            style={{ scrollPaddingBlock: 'clamp(1rem, 5vh, 3rem)' }}
          >
            {page === 'releases' && !activeQuery ? (
              <ReleaseCalendarView />
            ) : (
              <>
                <div className="mb-[clamp(0.75rem,1.6vh,1rem)] flex min-h-12 items-end justify-between gap-4 px-1">
                  <div className="min-w-0">
                    <p className="truncate text-[10px] font-bold uppercase tracking-[0.2em] text-accent">
                      {contentEyebrow}
                    </p>
                    <h1 className="mt-0.5 truncate text-[clamp(1.25rem,2.2vw,1.75rem)] font-black tracking-tight">
                      {contentHeading}
                    </h1>
                  </div>
                  <p className="shrink-0 pb-0.5 text-xs font-medium text-muted">
                    {isSearching || snapshot.isRefreshing
                      ? t('store.updating')
                      : page === 'alerts' && !activeQuery
                        ? t('store.alert.count', { count: visibleItemCount })
                        : t('store.productsCount', { count: visibleItemCount })}
                  </p>
                </div>

                {page === 'alerts' && !activeQuery ? (
                  <PriceAlerts
                    alerts={snapshot.priceAlerts}
                    products={snapshot.products}
                    history={snapshot.priceHistory}
                    onRemove={(productId) => void removePriceAlert(productId)}
                    t={t}
                  />
                ) : products.length > 0 ? (
                  <StoreProductGrid
                    products={products}
                    matchScores={page === 'discover' && !activeQuery ? matchScores : undefined}
                    onOpen={openProduct}
                    t={t}
                  />
                ) : (
                  <div className="flex h-full min-h-72 flex-col items-center justify-center gap-3 text-center">
                    <ShoppingBag size={30} className="text-accent" />
                    <p className="text-lg font-semibold">
                      {!initialized || snapshot.isRefreshing || isSearching
                        ? t('store.loading')
                        : loadError || snapshot.catalogError
                          ? t('store.loadError')
                          : t('store.empty')}
                    </p>
                    <p className="max-w-md text-sm text-muted">
                      {loadError || snapshot.catalogError
                        ? t('store.loadErrorBody')
                        : t('store.emptyBody')}
                    </p>
                    {(loadError || snapshot.catalogError) && !snapshot.isRefreshing && (
                      <button
                        data-focusable
                        type="button"
                        onClick={() => void refresh()}
                        className="mt-1 flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-black text-black"
                      >
                        <RefreshCw size={15} />
                        {t('store.retry')}
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {selectedProduct && (
          <StoreDetailPanel
            key={selectedProduct.id}
            product={selectedProduct}
            alert={snapshot.priceAlerts.find((item) => item.productId === selectedProduct.id)}
            history={snapshot.priceHistory[selectedProduct.id] ?? []}
            onToggleWishlist={() => void toggleWishlist(selectedProduct.id)}
            onSetPriceAlert={(target) => void setPriceAlert(selectedProduct.id, target)}
            onRemovePriceAlert={() => void removePriceAlert(selectedProduct.id)}
            onClose={closeProduct}
            t={t}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function storeGridColumnsFor(width: number): number {
  if (width < 720) return 2
  if (width < 1020) return 3
  if (width < 1380) return 4
  if (width < 1700) return 5
  return 6
}

function StoreProductGrid({
  products,
  matchScores,
  onOpen,
  t
}: {
  products: StoreProduct[]
  matchScores?: Map<string, number>
  onOpen: (productId: string) => void
  t: ReturnType<typeof useT>
}): JSX.Element {
  const gridRef = useRef<HTMLDivElement>(null)
  const [columns, setColumns] = useState(() => storeGridColumnsFor(window.innerWidth))

  useEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    const updateColumns = (): void => setColumns(storeGridColumnsFor(grid.clientWidth))
    updateColumns()
    const observer = new ResizeObserver(updateColumns)
    observer.observe(grid)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={gridRef}
      data-navigation-grid
      data-grid-columns={columns}
      className="store-product-grid grid px-1 pb-8 pt-1"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {products.map((product, index) => (
        <StoreCard
          key={product.id}
          product={product}
          navigationIndex={index}
          matchScore={matchScores?.get(product.id)}
          onOpen={() => onOpen(product.id)}
          t={t}
        />
      ))}
    </div>
  )
}

function StoreCard({
  product,
  navigationIndex,
  matchScore,
  onOpen,
  t
}: {
  product: StoreProduct
  navigationIndex: number
  matchScore?: number
  onOpen: () => void
  t: ReturnType<typeof useT>
}): JSX.Element {
  return (
    <motion.button
      data-focusable
      data-grid-index={navigationIndex}
      data-store-product-id={product.id}
      onClick={onOpen}
      whileHover={{ y: -3, scale: 1.012 }}
      whileFocus={{ y: -3, scale: 1.012 }}
      transition={{ type: 'spring', stiffness: 360, damping: 28 }}
      className="store-product-card group relative scroll-m-[clamp(1rem,4vh,2.5rem)] overflow-hidden text-left outline-none"
    >
      <div className="relative aspect-[16/9] overflow-hidden bg-black/20">
        <StoreArtwork product={product} orientation="tile" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/25" />
        {(product.bestOffer?.discountPercent ?? 0) > 0 && (
          <span className="absolute left-2.5 top-2.5 rounded-lg bg-emerald-400 px-2 py-1 text-[10px] font-black text-black shadow-lg">
            -{product.bestOffer?.discountPercent}%
          </span>
        )}
        {matchScore && (
          <span className="absolute right-2.5 top-2.5 rounded-lg border border-white/10 bg-black/65 px-2 py-1 text-[9px] font-bold text-white/90 backdrop-blur-md">
            {t('store.match', { score: matchScore })}
          </span>
        )}
      </div>
      <div className="flex min-h-[4.6rem] items-end justify-between gap-3 px-3.5 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold tracking-tight">{product.name}</p>
          <div className="mt-1.5 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[10px] text-muted">
              {product.recommendationReason
                ? t('store.becauseGenreShort', { genre: product.recommendationReason })
                : product.bestOffer?.sourceLabel ?? 'Steam'}
            </p>
          </div>
            <p className="shrink-0 text-sm font-black text-white">
              {product.bestOffer?.formattedPrice ?? t('store.checkPrice')}
            </p>
          </div>
        </div>
        {(product.steamWishlisted || product.orbitWishlisted) && (
          <Heart size={15} className="mb-0.5 shrink-0 fill-accent text-accent" />
        )}
      </div>
    </motion.button>
  )
}

function StoreArtwork({ product, orientation }: { product: StoreProduct; orientation: 'hero' | 'tile' }): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [shouldResolve, setShouldResolve] = useState(orientation === 'hero')

  useEffect(() => {
    if (shouldResolve || orientation === 'hero') return
    const element = containerRef.current
    if (!element || typeof IntersectionObserver === 'undefined') {
      setShouldResolve(true)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        setShouldResolve(true)
        observer.disconnect()
      },
      { rootMargin: '500px 250px' }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [orientation, shouldResolve])

  return (
    <div ref={containerRef} className="absolute inset-0">
      {shouldResolve ? (
        <GameImage
          gameId={product.id}
          name={product.name}
          orientation="horizontal"
          fit="cover"
          previewUrl={
            orientation === 'hero'
              ? product.heroUrl ?? product.headerUrl
              : product.headerUrl ?? product.heroUrl ?? product.portraitUrl
          }
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="h-full w-full bg-white/[0.025]" />
      )}
    </div>
  )
}

function StoreDetailPanel({
  product,
  alert,
  history,
  onClose,
  onToggleWishlist,
  onSetPriceAlert,
  onRemovePriceAlert,
  t
}: {
  product: StoreProduct
  alert?: StorePriceAlert
  history: StorePricePoint[]
  onClose: () => void
  onToggleWishlist: () => void
  onSetPriceAlert: (targetPriceMinor: number) => void
  onRemovePriceAlert: () => void
  t: ReturnType<typeof useT>
}): JSX.Element {
  const panelRef = useAutoFocus<HTMLDivElement>()
  useBackHandler(onClose)

  return (
    <motion.div
      data-focus-scope="active"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-[4vh] backdrop-blur-md"
    >
      <motion.div
        ref={panelRef}
        initial={{ opacity: 0, y: 40, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 30, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
        className="scrollbar-none relative h-[88vh] w-[92vw] overflow-y-auto rounded-[2rem] border border-white/10 bg-[#090c12] shadow-2xl"
      >
        <div className="relative h-64 overflow-hidden rounded-t-[2rem]">
          <StoreArtwork product={product} orientation="hero" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#090c12] via-black/35 to-black/20" />
          <h2 className="absolute bottom-7 left-8 text-4xl font-black">{product.name}</h2>
          <button
            data-focusable
            onClick={onClose}
            aria-label={t('store.details.close')}
            className="absolute right-6 top-6 flex h-12 w-12 items-center justify-center rounded-full bg-black/60"
          >
            <X size={22} />
          </button>
        </div>

        <div className="space-y-4 p-7 pt-2">
          <div className="flex items-center justify-between gap-5 rounded-3xl border border-accent/30 bg-accent/10 p-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-accent">{t('store.bestPrice')}</p>
              <p className="mt-1 text-3xl font-black">{product.bestOffer?.formattedPrice ?? t('store.checkPrice')}</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                data-focusable
                onClick={onToggleWishlist}
                className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold"
              >
                {product.orbitWishlisted ? <Check size={15} /> : <Heart size={15} />}
                {product.orbitWishlisted ? t('store.wishlist.saved') : t('store.wishlist.add')}
              </button>
              {product.bestOffer && (
                <button
                  data-focusable
                  onClick={() => void window.api.app.openExternal(product.bestOffer!.url)}
                  className="flex items-center gap-2 rounded-full bg-accent px-6 py-3 text-sm font-black text-black"
                >
                  <ShoppingCart size={16} />
                  {t('store.buyBest')}
                </button>
              )}
            </div>
          </div>

          {product.summary && <p className="max-w-5xl text-sm leading-relaxed text-white/65">{product.summary}</p>}

          <PriceAlertControl
            product={product}
            alert={alert}
            history={history}
            onSet={onSetPriceAlert}
            onRemove={onRemovePriceAlert}
            t={t}
          />

          <div className="space-y-2">
            {product.offers
              .filter((offer) => offer.exactMatch && offer.priceMinor !== undefined)
              .map((offer) => (
              <OfferRow key={offer.id} offer={offer} t={t} />
              ))}
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

function formatMinor(value: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value / 100)
}

function PriceAlertControl({
  product,
  alert,
  history,
  onSet,
  onRemove,
  t
}: {
  product: StoreProduct
  alert?: StorePriceAlert
  history: StorePricePoint[]
  onSet: (target: number) => void
  onRemove: () => void
  t: ReturnType<typeof useT>
}): JSX.Element {
  const current = product.bestOffer?.priceMinor
  const currency = product.bestOffer?.currency ?? alert?.currency ?? 'EUR'
  const [target, setTarget] = useState(alert?.targetPriceMinor ?? Math.max(0, Math.round((current ?? 0) * 0.8)))
  useEffect(() => {
    setTarget(alert?.targetPriceMinor ?? Math.max(0, Math.round((current ?? 0) * 0.8)))
  }, [alert?.targetPriceMinor, current])
  return (
    <section className="rounded-3xl border border-white/[0.07] bg-white/[0.035] p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 font-bold"><Bell size={16} className="text-accent" />{t('store.alert.title')}</p>
          <p className="mt-1 text-xs text-muted">{t('store.alert.history', { count: history.length })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button data-focusable onClick={() => setTarget(Math.max(0, target - 100))} className="h-10 w-10 rounded-full bg-white/5 text-lg">−</button>
          <span className="min-w-28 text-center text-lg font-black">{formatMinor(target, currency)}</span>
          <button data-focusable onClick={() => setTarget(target + 100)} className="h-10 w-10 rounded-full bg-white/5 text-lg">+</button>
          <button data-focusable onClick={() => onSet(target)} className="rounded-full bg-accent px-5 py-3 text-sm font-black text-black">{alert ? t('store.alert.update') : t('store.alert.create')}</button>
          {alert && <button data-focusable onClick={onRemove} className="flex h-11 w-11 items-center justify-center rounded-full bg-red-500/15 text-red-300"><Trash2 size={16} /></button>}
        </div>
      </div>
    </section>
  )
}

function PriceAlerts({
  alerts,
  products,
  history,
  onRemove,
  t
}: {
  alerts: StorePriceAlert[]
  products: StoreProduct[]
  history: Record<string, StorePricePoint[]>
  onRemove: (productId: string) => void
  t: ReturnType<typeof useT>
}): JSX.Element {
  if (alerts.length === 0) {
    return (
      <div className="flex h-full min-h-72 flex-col items-center justify-center gap-3 text-center">
        <Bell size={32} className="text-accent" />
        <h2 className="text-xl font-bold">{t('store.alert.empty')}</h2>
        <p className="max-w-lg text-sm text-muted">{t('store.alert.emptyBody')}</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-[clamp(0.75rem,1.25vw,1.15rem)] px-1 pb-8 md:grid-cols-2 xl:grid-cols-3">
      {alerts.map((alert) => {
        const product = products.find((item) => item.id === alert.productId)
        const points = history[alert.productId] ?? []
        return (
          <section
            key={alert.id}
            className="flex min-h-52 flex-col rounded-[var(--radius-card)] border border-white/[0.08] bg-surface/70 p-5 shadow-card"
          >
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent">
                {t('store.alert.title')}
              </p>
              <h2 className="mt-1 truncate text-lg font-bold">{product?.name ?? alert.productId}</h2>
              <p className="mt-1 truncate text-xs text-muted">
                {t('store.alert.startedAt')}{' '}
                {alert.startPriceMinor === undefined
                  ? '—'
                  : formatMinor(alert.startPriceMinor, alert.currency)}
              </p>
            </div>

            <div className="my-5 grid grid-cols-2 gap-3 rounded-2xl bg-black/20 p-3">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted">
                  {t('store.alert.current')}
                </p>
                <p className="mt-1 text-lg font-black">
                  {alert.currentPriceMinor === undefined
                    ? '—'
                    : formatMinor(alert.currentPriceMinor, alert.currency)}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted">
                  {t('store.alert.target')}
                </p>
                <p className="mt-1 text-lg font-black text-accent">
                  {formatMinor(alert.targetPriceMinor, alert.currency)}
                </p>
              </div>
            </div>

            <div className="mt-auto flex items-center justify-between gap-3">
              {alert.triggeredAt ? (
                <span className="rounded-full bg-emerald-400/15 px-3 py-2 text-xs font-bold text-emerald-300">
                  {t('store.alert.reached')}
                </span>
              ) : (
                <span className="truncate text-xs text-muted">
                  {t('store.alert.points', { count: points.length })}
                </span>
              )}
              <button
                data-focusable
                onClick={() => onRemove(alert.productId)}
                aria-label={t('store.alert.remove')}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-300"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </section>
        )
      })}
    </div>
  )
}

function OfferRow({ offer, t }: { offer: StoreOffer; t: ReturnType<typeof useT> }): JSX.Element {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.035] p-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="font-bold">{offer.sourceLabel}</p>
          <span className="rounded-md bg-white/[0.06] px-2 py-1 text-[9px] font-bold uppercase text-muted">
            {offer.platform === 'xbox' ? 'Xbox' : 'PC'}
          </span>
          <span className="rounded-md bg-white/10 px-2 py-1 text-[9px] font-bold uppercase text-muted">
            {offer.kind === 'official' ? t('store.offer.official') : offer.kind === 'keyshop' ? t('store.offer.keyshop') : t('store.offer.search')}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted">
          {offer.exactMatch ? t('store.offer.exact') : t('store.offer.unverified')}
        </p>
      </div>
      {offer.discountPercent ? (
        <span className="rounded-lg bg-emerald-400/15 px-2 py-1 text-xs font-bold text-emerald-300">
          -{offer.discountPercent}%
        </span>
      ) : null}
      <p className="min-w-28 text-right text-xl font-black">
        {offer.formattedPrice ?? t('store.checkPrice')}
      </p>
      <button
        data-focusable
        onClick={() => void window.api.app.openExternal(offer.url)}
        className="rounded-full bg-white/10 px-5 py-2.5 text-sm font-bold"
      >
        {offer.priceMinor !== undefined ? t('store.buy') : t('store.openStore')}
      </button>
    </div>
  )
}
