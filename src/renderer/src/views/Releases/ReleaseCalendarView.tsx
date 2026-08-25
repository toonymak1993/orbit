import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { CalendarDays, ExternalLink, Heart, RefreshCw, Sparkles } from 'lucide-react'
import { GameImage } from '@renderer/components/GameImage'
import { useT } from '@renderer/i18n/useT'
import { usePreferencesStore } from '@renderer/state/preferencesStore'
import { useNavigationStore } from '@renderer/state/navigationStore'
import { useStoreStore } from '@renderer/state/storeStore'
import { focusElement } from '@renderer/lib/spatialNavigation'
import type { StoreRelease } from '@shared/ipc'

const DAY_MS = 86_400_000

function dayKey(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`
}

function daysUntil(timestamp: number): number {
  const release = new Date(timestamp)
  const now = new Date()
  const releaseDay = Date.UTC(release.getUTCFullYear(), release.getUTCMonth(), release.getUTCDate())
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.max(0, Math.round((releaseDay - today) / DAY_MS))
}

function isTodayOrLater(timestamp: number): boolean {
  const release = new Date(timestamp)
  const now = new Date()
  return (
    Date.UTC(release.getUTCFullYear(), release.getUTCMonth(), release.getUTCDate()) >=
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  )
}

export function ReleaseCalendarView(): JSX.Element {
  const viewRef = useRef<HTMLDivElement>(null)
  const featuredRef = useRef<HTMLButtonElement>(null)
  const refreshRef = useRef<HTMLButtonElement>(null)
  const entryFocusHandledRef = useRef(false)
  const t = useT()
  const language = usePreferencesStore((state) => state.language)
  const snapshot = useStoreStore((state) => state.snapshot)
  const initialized = useStoreStore((state) => state.initialized)
  const refresh = useStoreStore((state) => state.refresh)
  const toggleWishlist = useStoreStore((state) => state.toggleWishlist)
  const isActive = useNavigationStore((state) => state.mainView === 'releases')
  const [pendingFavoriteIds, setPendingFavoriteIds] = useState<Set<string>>(() => new Set())
  const locale = language === 'de' ? 'de-DE' : 'en-US'
  const expectedMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
  const releases =
    snapshot.releaseCalendarMonth === expectedMonth
      ? snapshot.monthlyReleases.filter(
          (release) => isTodayOrLater(release.releaseDate) && release.name.length <= 72
        )
      : []
  const featured = releases.find((release) => release.featured) ?? releases[0]
  const chronological = featured
    ? releases.filter((release) => release.id !== featured.id)
    : releases
  const monthLabel = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(
    new Date()
  )
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }),
    [locale]
  )
  const shortDateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short' }),
    [locale]
  )
  const groups = useMemo(() => {
    const result: Array<{ timestamp: number; releases: StoreRelease[] }> = []
    for (const release of chronological) {
      const previous = result.at(-1)
      if (previous && dayKey(previous.timestamp) === dayKey(release.releaseDate)) {
        previous.releases.push(release)
      } else {
        result.push({ timestamp: release.releaseDate, releases: [release] })
      }
    }
    return result
  }, [chronological])
  const isInitialLoading = !initialized || (snapshot.isRefreshing && releases.length === 0)
  const hasError = snapshot.releaseCalendarError && releases.length === 0

  useEffect(() => {
    if (!isActive) {
      entryFocusHandledRef.current = false
      return
    }
    if (isInitialLoading || entryFocusHandledRef.current) return
    entryFocusHandledRef.current = true
    viewRef.current?.scrollTo({ top: 0 })
    let settleTimer: number | undefined
    const frame = requestAnimationFrame(() => {
      focusElement(featuredRef.current ?? refreshRef.current)
      viewRef.current?.scrollTo({ top: 0 })
      settleTimer = window.setTimeout(() => viewRef.current?.scrollTo({ top: 0 }), 160)
    })
    return () => {
      cancelAnimationFrame(frame)
      if (settleTimer !== undefined) window.clearTimeout(settleTimer)
    }
  }, [featured?.id, isActive, isInitialLoading])

  const relativeDate = (timestamp: number): string => {
    const days = daysUntil(timestamp)
    if (days === 0) return t('release.today')
    if (days === 1) return t('release.tomorrow')
    return t('release.inDays', { count: days })
  }

  const openRelease = (release: StoreRelease): void => {
    void window.api.app.openExternal(release.storeUrl)
  }

  const favoriteLabel = (release: StoreRelease): string =>
    release.orbitWishlisted
      ? t('release.favorite.remove', { game: release.name })
      : t('release.favorite.add', { game: release.name })

  const toggleReleaseFavorite = async (release: StoreRelease): Promise<void> => {
    if (pendingFavoriteIds.has(release.id)) return
    setPendingFavoriteIds((current) => new Set(current).add(release.id))
    try {
      await toggleWishlist(release.id)
    } finally {
      setPendingFavoriteIds((current) => {
        const next = new Set(current)
        next.delete(release.id)
        return next
      })
    }
  }

  return (
    <div
      ref={viewRef}
      className="release-calendar-view scrollbar-none h-full overflow-y-auto px-5 pb-12 pt-24 xl:px-8"
    >
      <section className="release-calendar-hero relative mx-auto max-w-[112rem] overflow-hidden rounded-[calc(var(--radius-card)+0.55rem)] border border-white/10 bg-surface shadow-card">
        {featured ? (
          <motion.button
            ref={featuredRef}
            data-focusable
            onFocus={() => viewRef.current?.scrollTo({ top: 0 })}
            onClick={() => openRelease(featured)}
            aria-label={`${featured.name} – ${t('release.openStore')}`}
            whileHover={{ scale: 1.004 }}
            whileTap={{ scale: 0.992 }}
            className="group absolute inset-0 w-full overflow-hidden text-left"
          >
            <GameImage
              gameId={featured.id}
              name={featured.name}
              orientation="horizontal"
              previewUrl={featured.heroUrl ?? featured.capsuleUrl}
              fit="cover"
              className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.025] group-data-[focused=true]:scale-[1.025]"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-black/95 via-black/70 to-black/10" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/25" />
            <div className="relative z-10 flex h-full max-w-3xl flex-col justify-end p-[clamp(1.35rem,3vw,3.25rem)] pr-[clamp(5rem,11vw,10rem)]">
              <div className="mb-auto flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-accent">
                <Sparkles size={14} />
                {t('release.spotlight')}
              </div>
              <p className="text-xs font-black uppercase tracking-[0.24em] text-accent">
                {t('release.eyebrow')} · {monthLabel}
              </p>
              <h1 className="mt-2 text-[clamp(2rem,4.5vw,4.75rem)] font-black leading-[0.94] tracking-[-0.045em]">
                {featured.name}
              </h1>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <span className="rounded-full border border-white/15 bg-black/35 px-4 py-2 text-sm font-bold backdrop-blur-md">
                  {dateFormatter.format(new Date(featured.releaseDate))}
                </span>
                <span className="rounded-full bg-accent px-4 py-2 text-sm font-black text-black">
                  {relativeDate(featured.releaseDate)}
                </span>
                <span className="flex items-center gap-2 text-sm font-bold text-white/80">
                  {t('release.openStore')} <ExternalLink size={15} />
                </span>
              </div>
            </div>
          </motion.button>
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/12 text-accent">
              <CalendarDays size={30} />
            </div>
            <h1 className="mt-5 text-3xl font-black">
              {hasError ? t('release.error') : isInitialLoading ? t('release.loading') : t('release.empty')}
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
              {hasError
                ? t('release.errorBody')
                : isInitialLoading
                  ? t('release.loadingBody')
                  : t('release.emptyBody')}
            </p>
          </div>
        )}

        {featured && (
          <button
            data-focusable
            data-disabled={pendingFavoriteIds.has(featured.id) ? 'true' : undefined}
            disabled={pendingFavoriteIds.has(featured.id)}
            onClick={() => void toggleReleaseFavorite(featured)}
            aria-label={favoriteLabel(featured)}
            aria-pressed={featured.orbitWishlisted}
            title={favoriteLabel(featured)}
            className={`absolute bottom-5 right-20 z-20 flex h-11 w-11 items-center justify-center rounded-full border backdrop-blur-xl transition disabled:opacity-60 ${
              featured.orbitWishlisted
                ? 'border-accent/55 bg-accent text-black shadow-[0_0_28px_rgb(var(--color-accent)/0.28)]'
                : 'border-white/10 bg-black/55 text-white/80 hover:bg-white/15 hover:text-white'
            }`}
          >
            <Heart
              size={18}
              strokeWidth={2.3}
              fill={featured.orbitWishlisted ? 'currentColor' : 'none'}
              className={pendingFavoriteIds.has(featured.id) ? 'animate-pulse' : ''}
            />
          </button>
        )}

        <div className="pointer-events-none absolute right-5 top-5 z-20 flex max-w-[55%] items-center gap-3 rounded-full border border-white/10 bg-black/45 px-4 py-2 backdrop-blur-xl">
          <CalendarDays size={16} className="shrink-0 text-accent" />
          <div className="min-w-0">
            <p className="truncate text-[10px] font-black uppercase tracking-[0.18em] text-white/55">
              {t('release.title')}
            </p>
            <p className="truncate text-xs font-bold text-white">
              {releases.length > 0
                ? t('release.count', { count: releases.length })
                : monthLabel}
            </p>
          </div>
        </div>
        <button
          ref={refreshRef}
          data-focusable
          data-disabled={snapshot.isRefreshing ? 'true' : undefined}
          disabled={snapshot.isRefreshing}
          onClick={() => void refresh()}
          aria-label={t('release.refresh')}
          className="absolute bottom-5 right-5 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-black/55 text-white/80 backdrop-blur-xl transition hover:bg-white/15 disabled:opacity-50"
        >
          <RefreshCw size={17} className={snapshot.isRefreshing ? 'animate-spin' : ''} />
        </button>
      </section>

      {releases.length > 0 && (
        <div className="mx-auto mt-[var(--content-gap)] max-w-[112rem]">
          <div className="mb-5 flex items-end justify-between gap-4 px-1">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-accent">
                {t('release.eyebrow')}
              </p>
              <h2 className="mt-1 text-2xl font-black">{t('release.all')}</h2>
            </div>
            <p className="hidden max-w-lg text-right text-xs text-muted md:block">
              {t('release.source')}
            </p>
          </div>

          {groups.length === 0 ? (
            <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.035] p-6 text-sm text-muted">
              {t('release.onlySpotlight')}
            </div>
          ) : (
            <div className="space-y-7">
              {groups.map((group) => (
                <section key={dayKey(group.timestamp)} className="release-day-group">
                  <div className="release-day-label">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-accent">
                      {relativeDate(group.timestamp)}
                    </p>
                    <p className="mt-1 text-lg font-black capitalize">
                      {dateFormatter.format(new Date(group.timestamp))}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      {t('release.dayCount', { count: group.releases.length })}
                    </p>
                  </div>

                  <div className="release-calendar-grid grid min-w-0 grid-cols-1 gap-[var(--tile-gap)] md:grid-cols-2 2xl:grid-cols-3">
                    {group.releases.map((release) => (
                      <motion.div
                        key={release.id}
                        whileHover={{ y: -3 }}
                        className="release-calendar-card group relative min-h-36 overflow-hidden text-left"
                      >
                        <motion.button
                          data-focusable
                          onClick={() => openRelease(release)}
                          aria-label={`${release.name} – ${t('release.openStore')}`}
                          whileTap={{ scale: 0.985 }}
                          className="group absolute inset-0 w-full overflow-hidden rounded-[var(--radius-card)] text-left"
                        >
                          <GameImage
                            gameId={release.id}
                            name={release.name}
                            orientation="horizontal"
                            previewUrl={release.capsuleUrl}
                            fit="cover"
                            className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-105 group-data-[focused=true]:scale-105"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/45 to-transparent" />
                          <div className="absolute inset-x-0 bottom-0 z-10 p-4">
                            <p className="truncate pr-10 text-base font-black text-white drop-shadow-md">
                              {release.name}
                            </p>
                            <div className="mt-2 flex items-center justify-between gap-3 text-xs">
                              <span className="font-bold text-white/70">
                                {shortDateFormatter.format(new Date(release.releaseDate))}
                              </span>
                              <span className="flex items-center gap-1 font-bold text-accent">
                                Steam <ExternalLink size={12} />
                              </span>
                            </div>
                          </div>
                        </motion.button>
                        <button
                          data-focusable
                          data-disabled={pendingFavoriteIds.has(release.id) ? 'true' : undefined}
                          disabled={pendingFavoriteIds.has(release.id)}
                          onClick={() => void toggleReleaseFavorite(release)}
                          aria-label={favoriteLabel(release)}
                          aria-pressed={release.orbitWishlisted}
                          title={favoriteLabel(release)}
                          className={`absolute right-3 top-3 z-20 flex h-9 w-9 items-center justify-center rounded-full border backdrop-blur-xl transition disabled:opacity-60 ${
                            release.orbitWishlisted
                              ? 'border-accent/55 bg-accent text-black shadow-[0_0_22px_rgb(var(--color-accent)/0.24)]'
                              : 'border-white/10 bg-black/60 text-white/75 hover:bg-white/15 hover:text-white'
                          }`}
                        >
                          <Heart
                            size={16}
                            strokeWidth={2.3}
                            fill={release.orbitWishlisted ? 'currentColor' : 'none'}
                            className={pendingFavoriteIds.has(release.id) ? 'animate-pulse' : ''}
                          />
                        </button>
                      </motion.div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
