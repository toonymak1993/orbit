import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Check,
  Bell,
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

const STORE_PAGES: Array<{ id: StorePage; key: TranslationKey; icon: typeof Sparkles }> = [
  { id: 'discover', key: 'store.page.discover', icon: Sparkles },
  { id: 'deals', key: 'store.page.deals', icon: Percent },
  { id: 'wishlist', key: 'store.page.wishlist', icon: Heart }
  ,{ id: 'alerts', key: 'store.page.alerts', icon: Bell }
]

const REGIONS: Array<{ id: StoreRegionId; key: TranslationKey; currency: string }> = [
  { id: 'eu', key: 'store.region.eu', currency: 'EUR' },
  { id: 'us', key: 'store.region.us', currency: 'USD' },
  { id: 'gb', key: 'store.region.gb', currency: 'GBP' },
  { id: 'ca', key: 'store.region.ca', currency: 'CAD' },
  { id: 'au', key: 'store.region.au', currency: 'AUD' }
]

interface DiscoverSection {
  id: string
  eyebrow: string
  title: string
  products: StoreProduct[]
}

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
  const lastActivity = game.lastStartedAt ?? game.lastPlayedTimestamp ?? 0
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

function genresOverlap(product: StoreProduct, game: LibraryGame): boolean {
  const gameGenres = new Set((game.metadata.genres ?? []).map(canonicalGenre))
  return (product.genres ?? []).some((genre) => gameGenres.has(canonicalGenre(genre)))
}

function genreSimilarity(left: string[] = [], right: string[] = []): number {
  const leftGenres = new Set(left.map(canonicalGenre))
  const rightGenres = new Set(right.map(canonicalGenre))
  if (leftGenres.size === 0 || rightGenres.size === 0) return 0
  const overlap = [...leftGenres].filter((genre) => rightGenres.has(genre)).length
  const union = new Set([...leftGenres, ...rightGenres]).size
  return union > 0 ? overlap / union : 0
}

function diversifyProducts(candidates: StoreProduct[], limit: number): StoreProduct[] {
  const remaining = [...candidates]
  const selected: StoreProduct[] = []
  while (remaining.length > 0 && selected.length < limit) {
    let bestIndex = 0
    let bestScore = -Infinity
    for (let index = 0; index < remaining.length; index++) {
      const candidate = remaining[index]
      const relevance = 100 - index * 1.4
      const closestGenreMatch = selected.reduce(
        (similarity, product) =>
          Math.max(similarity, genreSimilarity(candidate.genres, product.genres)),
        0
      )
      const candidatePrefix = candidate.name.split(/\s+/)[0]?.toLocaleLowerCase('en')
      const sameFranchise = selected.some(
        (product) => product.name.split(/\s+/)[0]?.toLocaleLowerCase('en') === candidatePrefix
      )
      const score = relevance - closestGenreMatch * 34 - (sameFranchise ? 24 : 0)
      if (score > bestScore) {
        bestScore = score
        bestIndex = index
      }
    }
    selected.push(remaining.splice(bestIndex, 1)[0])
  }
  return selected
}

function selectDistinctAnchorGames(games: LibraryGame[], limit: number): LibraryGame[] {
  const selected: LibraryGame[] = []
  for (const game of games) {
    const tooSimilar = selected.some(
      (anchor) => genreSimilarity(game.metadata.genres, anchor.metadata.genres) >= 0.4
    )
    if (tooSimilar) continue
    selected.push(game)
    if (selected.length >= limit) break
  }
  return selected
}

export function StoreView(): JSX.Element {
  const containerRef = useAutoFocus<HTMLDivElement>()
  const searchRef = useRef<HTMLInputElement>(null)
  const t = useT()
  const snapshot = useStoreStore((state) => state.snapshot)
  const initialized = useStoreStore((state) => state.initialized)
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
  const libraryGames = useLibraryStore((state) => state.snapshot.games)
  const isActive = useNavigationStore((state) => state.mainView === 'store')
  const identityProfile = useMemo(
    () => genreProfile(libraryGames, snapshot.products),
    [libraryGames, snapshot.products]
  )

  const openProduct = (productId: string): void => {
    setSelectedProductId(productId)
    void compareProduct(productId)
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

  useEffect(() => {
    if (!isActive) return
    const focusSearch = (): void => {
      const input = searchRef.current
      if (!input) return
      focusElement(input)
      input.click()
      input.select()
    }
    window.addEventListener(STORE_SEARCH_EVENT, focusSearch)
    return () => window.removeEventListener(STORE_SEARCH_EVENT, focusSearch)
  }, [isActive])

  const products = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
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
        .filter((product) => product.artworkStatus === 'available' && Boolean(product.portraitUrl))
        .sort((left, right) => right.recommendationScore - left.recommendationScore)
    }
    if (page === 'wishlist') {
      return matches
        .filter(
          (product) =>
            (product.steamWishlisted || product.orbitWishlisted) &&
            product.artworkStatus === 'available' &&
            Boolean(product.portraitUrl)
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
      .filter((product) => {
        if (normalizedQuery) return true
        if (ownedSteamAppIds.has(product.steamAppId ?? -1)) return false
        if (product.steamWishlisted || product.orbitWishlisted) return true
        if (product.searchOnly || product.artworkStatus !== 'available' || !product.portraitUrl) return false
        if (!product.detailsUpdatedAt || !product.summary || !product.genres?.length) return false
        if (product.discoverEligible === false) return false
        return !/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u.test(product.name)
      })
      .sort(
        (left, right) =>
          personalizedProductScore(right, identityProfile) -
            personalizedProductScore(left, identityProfile) ||
          (right.bestOffer?.discountPercent ?? 0) - (left.bestOffer?.discountPercent ?? 0)
      )
      .slice(0, 72)
  }, [identityProfile, libraryGames, page, query, searchResults, snapshot.products])

  const discoverSections = useMemo<DiscoverSection[]>(() => {
    if (page !== 'discover' || query.trim()) return []
    const ranked = products
    const sections: DiscoverSection[] = []
    const usedProductIds = new Set(ranked.slice(0, 5).map((product) => product.id))
    const reserve = (candidates: StoreProduct[], limit: number, minimum = 1): StoreProduct[] => {
      const selected = diversifyProducts(
        candidates.filter((product) => !usedProductIds.has(product.id)),
        limit
      )
      if (selected.length < minimum) return []
      for (const product of selected) usedProductIds.add(product.id)
      return selected
    }

    const identityMatches = reserve(ranked, 11)
    if (identityMatches.length > 0) {
      sections.push({
        id: 'identity',
        eyebrow: t('store.section.forYou'),
        title: t('store.heading.identity'),
        products: identityMatches
      })
    }
    const anchors = selectDistinctAnchorGames(
      libraryGames
        .filter(
          (game) =>
            (game.playtimeMinutes ?? 0) > 30 &&
            Boolean(game.metadata.genres?.length) &&
            !/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u.test(game.name)
        )
        .sort((left, right) => gameIdentityWeight(right) - gameIdentityWeight(left)),
      2
    )
    for (const game of anchors) {
      const recommendations = reserve(
        ranked
          .filter((product) => genresOverlap(product, game))
          .sort(
            (left, right) =>
              genreSimilarity(right.genres, game.metadata.genres) -
                genreSimilarity(left.genres, game.metadata.genres) ||
              personalizedProductScore(right, identityProfile) -
                personalizedProductScore(left, identityProfile)
          ),
        10,
        4
      )
      if (recommendations.length < 4) continue
      sections.push({
        id: `because:${game.id}`,
        eyebrow: t('store.section.becausePlayed'),
        title: t('store.heading.becauseGame', { game: game.name }),
        products: recommendations
      })
    }
    const installedGames = libraryGames.filter(
      (game) => game.installed && Boolean(game.metadata.genres?.length)
    )
    const installedMatches = reserve(
      ranked.filter((product) => installedGames.some((game) => genresOverlap(product, game))),
      11,
      4
    )
    if (installedMatches.length >= 4) {
      sections.push({
        id: 'installed',
        eyebrow: t('store.section.readyProfile'),
        title: t('store.heading.installedTaste'),
        products: installedMatches
      })
    }
    const personalDeals = reserve(
      ranked
        .filter((product) => (product.bestOffer?.discountPercent ?? 0) >= 20)
        .sort(
          (left, right) =>
            personalizedProductScore(right, identityProfile) -
            personalizedProductScore(left, identityProfile)
        ),
      12,
      4
    )
    if (personalDeals.length >= 4) {
      sections.push({
        id: 'personal-deals',
        eyebrow: t('store.section.smartDeals'),
        title: t('store.heading.dealsForYou'),
        products: personalDeals
      })
    }
    return sections
  }, [identityProfile, libraryGames, page, products, query, t])

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

  const featured = products[0]

  return (
    <div ref={containerRef} className="relative flex h-full flex-col overflow-hidden px-[clamp(1.5rem,3vw,3.5rem)] pb-[clamp(1.5rem,3vh,3rem)] pt-[calc(5rem+clamp(1.25rem,2.5vh,2.5rem))]">
      <div
        onFocusCapture={() => {
          containerRef.current
            ?.querySelector<HTMLElement>('[data-store-scroll]')
            ?.scrollTo({ top: 0, behavior: 'smooth' })
        }}
        className="mb-5 grid shrink-0 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center 2xl:grid-cols-[auto_minmax(16rem,1fr)_auto_auto] 2xl:gap-4"
      >
        <div className="scrollbar-none flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-black/25 p-1 lg:col-span-2 2xl:col-span-1">
          <span className="mx-1 rounded-md border border-white/15 px-1.5 py-0.5 text-[10px] font-bold text-muted">
            LT
          </span>
          {STORE_PAGES.map((item) => {
            const Icon = item.icon
            const active = page === item.id
            return (
              <motion.button
                key={item.id}
                data-focusable
                data-store-page={item.id}
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
          <span className="mx-1 rounded-md border border-white/15 px-1.5 py-0.5 text-[10px] font-bold text-muted">
            RT
          </span>
        </div>

        <label className="flex min-w-0 items-center gap-2 rounded-full bg-white/5 px-4 py-2.5">
          {isSearching ? (
            <Loader2 size={15} className="shrink-0 animate-spin text-accent" />
          ) : (
            <Search size={15} className="shrink-0 text-muted" />
          )}
          <input
            ref={searchRef}
            data-focusable
            data-navigation-horizontal-only
            data-store-search
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('store.search')}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
          />
          <span className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md border border-white/15 bg-black/25 px-1.5 text-[10px] font-black text-white/70">
            Y
          </span>
        </label>

        <div className="flex items-center gap-3 lg:col-start-2 lg:row-start-2 2xl:contents">
        <button
          data-focusable
          onClick={cycleRegion}
          className="flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-xs"
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
            className="scrollbar-none absolute inset-0 overflow-y-auto px-[clamp(0.75rem,1.5vw,1.5rem)] pb-[clamp(5rem,14vh,8rem)] pt-[clamp(0.75rem,2vh,1.25rem)]"
            style={{ scrollPaddingBlock: 'clamp(1.5rem, 7vh, 4rem)' }}
          >
            {page === 'alerts' ? (
              <PriceAlerts
                alerts={snapshot.priceAlerts}
                products={snapshot.products}
                history={snapshot.priceHistory}
                onRemove={(productId) => void removePriceAlert(productId)}
                t={t}
              />
            ) : featured ? (
              page === 'discover' && !query.trim() ? (
                <>
                  <StoreHighlightCarousel
                    products={products.slice(0, 5)}
                    onOpen={openProduct}
                    t={t}
                  />
                  <div className="space-y-[clamp(2rem,5vh,3.75rem)] pb-10">
                    {discoverSections.map((section, shelfIndex) => (
                      <DiscoverShelf
                        key={section.id}
                        section={section}
                        shelfIndex={shelfIndex}
                        matchScores={matchScores}
                        onOpen={openProduct}
                        t={t}
                      />
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="mb-3 mt-2 flex items-end justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
                        {query.trim()
                          ? t('store.section.allStores')
                          : page === 'deals'
                            ? t('store.section.deals')
                            : t('store.section.wishlist')}
                      </p>
                      <h2 className="mt-1 text-xl font-bold">
                        {query.trim()
                          ? t('store.heading.searchResults', { query: query.trim() })
                          : page === 'deals'
                            ? t('store.heading.deals')
                            : t('store.heading.wishlist')}
                      </h2>
                    </div>
                    <p className="text-xs text-muted">
                      {isSearching || snapshot.isRefreshing
                        ? t('store.updating')
                        : t('store.productsCount', { count: products.length })}
                    </p>
                  </div>
                  <div
                    data-navigation-grid
                    data-grid-columns={6}
                    className="grid grid-cols-6 gap-[clamp(0.9rem,1.8vw,1.5rem)] px-1 pb-8 pt-2"
                  >
                    {products.map((product, index) => (
                      <StoreCard
                        key={product.id}
                        product={product}
                        navigationIndex={index}
                        onOpen={() => openProduct(product.id)}
                        t={t}
                      />
                    ))}
                  </div>
                </>
              )
            ) : (
              <div className="flex h-full min-h-72 flex-col items-center justify-center gap-3 text-center">
                <ShoppingBag size={30} className="text-accent" />
                <p className="text-lg font-semibold">
                  {!initialized || snapshot.isRefreshing || isSearching ? t('store.loading') : t('store.empty')}
                </p>
                <p className="max-w-md text-sm text-muted">{t('store.emptyBody')}</p>
              </div>
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
            onClose={() => setSelectedProductId(null)}
            onToggleWishlist={() => void toggleWishlist(selectedProduct.id)}
            onSetPriceAlert={(target) => void setPriceAlert(selectedProduct.id, target)}
            onRemovePriceAlert={() => void removePriceAlert(selectedProduct.id)}
            t={t}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function StoreHighlightCarousel({
  products,
  onOpen,
  t
}: {
  products: StoreProduct[]
  onOpen: (productId: string) => void
  t: ReturnType<typeof useT>
}): JSX.Element {
  const [activeIndex, setActiveIndex] = useState(0)
  useEffect(() => setActiveIndex(0), [products.map((product) => product.id).join('|')])
  useEffect(() => {
    if (products.length < 2) return
    const timer = window.setInterval(
      () => setActiveIndex((current) => (current + 1) % products.length),
      8_000
    )
    return () => window.clearInterval(timer)
  }, [products.length])
  const product = products[activeIndex] ?? products[0]
  if (!product) return <></>
  return (
    <div className="relative">
      <AnimatePresence initial={false} mode="wait">
        <StoreHero
          key={product.id}
          product={product}
          onOpen={() => onOpen(product.id)}
          t={t}
        />
      </AnimatePresence>
      {products.length > 1 && (
        <div className="pointer-events-none absolute bottom-[clamp(2rem,4vh,2.75rem)] right-6 flex gap-1.5">
          {products.map((item, index) => (
            <span
              key={item.id}
              className={`h-1 rounded-full transition-all duration-500 ${
                index === activeIndex ? 'w-7 bg-accent' : 'w-2 bg-white/35'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function DiscoverShelf({
  section,
  shelfIndex,
  matchScores,
  onOpen,
  t
}: {
  section: DiscoverSection
  shelfIndex: number
  matchScores: Map<string, number>
  onOpen: (productId: string) => void
  t: ReturnType<typeof useT>
}): JSX.Element {
  return (
    <section>
      <div className="mb-4 flex items-end justify-between gap-4 px-1">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-accent">
            {section.eyebrow}
          </p>
          <h2 className="mt-1 text-[clamp(1.15rem,2vw,1.55rem)] font-bold tracking-tight">
            {section.title}
          </h2>
        </div>
        <p className="text-xs text-muted">{t('store.productsCount', { count: section.products.length })}</p>
      </div>
      <div
        data-navigation-grid
        data-grid-columns={section.products.length}
        className="scrollbar-none grid grid-flow-col auto-cols-[clamp(10.5rem,15vw,14rem)] gap-[clamp(0.9rem,1.5vw,1.35rem)] overflow-x-auto px-3 pb-6 pt-4"
        style={{ scrollPaddingInline: '0.75rem' }}
      >
        {section.products.map((product, index) => (
          <StoreCard
            key={product.id}
            product={product}
            navigationIndex={index}
            shelfRow={shelfIndex}
            shelfColumn={index}
            matchScore={matchScores.get(product.id)}
            onOpen={() => onOpen(product.id)}
            t={t}
          />
        ))}
      </div>
    </section>
  )
}

function StoreHero({
  product,
  onOpen,
  t
}: {
  product: StoreProduct
  onOpen: () => void
  t: ReturnType<typeof useT>
}): JSX.Element {
  return (
    <motion.button
      data-focusable
      onClick={onOpen}
      initial={{ opacity: 0, x: 34 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -24 }}
      whileHover={{ height: 224 }}
      whileFocus={{ height: 224 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30, mass: 0.85 }}
      className="group relative mb-[clamp(1.5rem,4vh,2.75rem)] h-[clamp(8.5rem,22vh,10rem)] w-full scroll-m-[clamp(1rem,4vh,2.5rem)] overflow-hidden rounded-3xl border border-white/15 bg-white/[0.035] text-left shadow-[0_18px_60px_rgba(0,0,0,0.28)] backdrop-blur-xl"
    >
      <div className="absolute inset-0 opacity-75 transition-opacity duration-500 group-hover:opacity-90 group-focus:opacity-90">
        <StoreArtwork product={product} orientation="hero" />
      </div>
      <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-white/[0.04]" />
      <div className="absolute inset-0 flex items-end justify-between gap-6 p-6">
        <div className="max-w-2xl">
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-accent">
            {product.recommendationReason
              ? t('store.becauseGenre', { genre: product.recommendationReason })
              : t('store.recommended')}
          </p>
          <h1 className="line-clamp-1 text-3xl font-bold">{product.name}</h1>
          {product.summary && <p className="mt-1 line-clamp-1 text-sm text-white/65">{product.summary}</p>}
        </div>
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-accent px-5 py-3 text-right text-black">
            <p className="text-[10px] font-bold uppercase tracking-wider">{t('store.bestPrice')}</p>
            <p className="text-xl font-black">{product.bestOffer?.formattedPrice ?? t('store.checkPrice')}</p>
          </div>
        </div>
      </div>
    </motion.button>
  )
}

function StoreCard({
  product,
  navigationIndex,
  shelfRow,
  shelfColumn,
  matchScore,
  onOpen,
  t
}: {
  product: StoreProduct
  navigationIndex?: number
  shelfRow?: number
  shelfColumn?: number
  matchScore?: number
  onOpen: () => void
  t: ReturnType<typeof useT>
}): JSX.Element {
  return (
    <motion.button
      data-focusable
      data-grid-index={navigationIndex}
      data-store-shelf-row={shelfRow}
      data-store-shelf-column={shelfColumn}
      onClick={onOpen}
      whileHover={{ y: -4, scale: 1.025 }}
      whileFocus={{ y: -4, scale: 1.025 }}
      transition={{ type: 'spring', stiffness: 360, damping: 28 }}
      className="group relative aspect-[2/3] scroll-m-[clamp(1rem,4vh,2.5rem)] overflow-hidden rounded-2xl border border-white/[0.09] bg-white/5 text-left shadow-[0_14px_35px_rgba(0,0,0,0.25)] outline-none transition-[border-color,box-shadow] focus:border-accent/70 focus:shadow-[0_16px_45px_rgba(0,0,0,0.38)]"
    >
      <StoreArtwork product={product} orientation="portrait" />
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/10 to-black/20" />
      {(product.bestOffer?.discountPercent ?? 0) > 0 && (
        <span className="absolute left-2 top-2 rounded-lg bg-emerald-400 px-2 py-1 text-[10px] font-black text-black">
          -{product.bestOffer?.discountPercent}%
        </span>
      )}
      {matchScore && (
        <span className="absolute right-2 top-2 rounded-lg border border-white/10 bg-black/60 px-2 py-1 text-[9px] font-bold text-white/90 backdrop-blur-md">
          {t('store.match', { score: matchScore })}
        </span>
      )}
      <div className="absolute inset-x-0 bottom-0 p-3">
        <p className="line-clamp-2 text-sm font-bold">{product.name}</p>
        <div className="mt-2 flex items-end justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[10px] text-muted">
              {product.recommendationReason
                ? t('store.becauseGenreShort', { genre: product.recommendationReason })
                : product.bestOffer?.sourceLabel ?? 'Steam'}
            </p>
            <p className="text-base font-black text-white">
              {product.bestOffer?.formattedPrice ?? t('store.checkPrice')}
            </p>
          </div>
          {(product.steamWishlisted || product.orbitWishlisted) && (
            <div className="flex gap-1">
              {product.steamWishlisted && <span className="rounded bg-[#1b2838] px-1.5 py-1 text-[9px]">S</span>}
              {product.orbitWishlisted && <span className="rounded bg-accent px-1.5 py-1 text-[9px] font-bold text-black">O</span>}
            </div>
          )}
        </div>
      </div>
    </motion.button>
  )
}

function StoreArtwork({ product, orientation }: { product: StoreProduct; orientation: 'hero' | 'portrait' }): JSX.Element {
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
          orientation={orientation === 'hero' ? 'horizontal' : 'vertical'}
          fit="cover"
          previewUrl={
            orientation === 'hero'
              ? product.heroUrl ?? product.headerUrl
              : product.portraitUrl ?? product.headerUrl
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
  if (alerts.length === 0) return <div className="flex h-full min-h-72 flex-col items-center justify-center gap-3 text-center"><Bell size={32} className="text-accent" /><h2 className="text-xl font-bold">{t('store.alert.empty')}</h2><p className="max-w-lg text-sm text-muted">{t('store.alert.emptyBody')}</p></div>
  return <div className="space-y-4 pb-8"><div className="mb-6"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">{t('store.page.alerts')}</p><h2 className="mt-1 text-2xl font-bold">{t('store.alert.heading')}</h2></div>{alerts.map((alert) => { const product = products.find((item) => item.id === alert.productId); const points = history[alert.productId] ?? []; return <section key={alert.id} className="flex flex-wrap items-center gap-5 rounded-3xl border border-white/[0.08] bg-white/[0.04] p-5"><div className="min-w-48 flex-1"><h3 className="font-bold">{product?.name ?? alert.productId}</h3><p className="mt-1 text-xs text-muted">{t('store.alert.startedAt')} {alert.startPriceMinor === undefined ? '—' : formatMinor(alert.startPriceMinor, alert.currency)} · {t('store.alert.points', { count: points.length })}</p></div><div><p className="text-[10px] uppercase tracking-wider text-muted">{t('store.alert.current')}</p><p className="text-xl font-black">{alert.currentPriceMinor === undefined ? '—' : formatMinor(alert.currentPriceMinor, alert.currency)}</p></div><div><p className="text-[10px] uppercase tracking-wider text-muted">{t('store.alert.target')}</p><p className="text-xl font-black text-accent">{formatMinor(alert.targetPriceMinor, alert.currency)}</p></div>{alert.triggeredAt && <span className="rounded-full bg-emerald-400/15 px-4 py-2 text-xs font-bold text-emerald-300">{t('store.alert.reached')}</span>}<button data-focusable onClick={() => onRemove(alert.productId)} className="flex h-11 w-11 items-center justify-center rounded-full bg-red-500/15 text-red-300"><Trash2 size={16} /></button></section> })}</div>
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
