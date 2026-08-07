import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, Loader2 } from 'lucide-react'
import { useAutoFocus } from '@renderer/hooks/useAutoFocus'
import { useLibraryStore } from '@renderer/state/libraryStore'
import {
  LIBRARY_SOURCE_ORDER,
  useLibraryFilterStore,
  type LibrarySource
} from '@renderer/state/libraryFilterStore'
import { useAuthStore } from '@renderer/state/authStore'
import { useEpicAuthStore } from '@renderer/state/epicAuthStore'
import { useNavigationStore } from '@renderer/state/navigationStore'
import { GameCard } from '@renderer/components/GameCard'
import { useT } from '@renderer/i18n/useT'
import { focusElement } from '@renderer/lib/spatialNavigation'
import { LIBRARY_SEARCH_EVENT } from '@renderer/lib/librarySearch'

const GRID_COLUMNS = 6
const INITIAL_RENDER_LIMIT = 30
const RENDER_BATCH_SIZE = 18
const PRELOAD_CARD_THRESHOLD = GRID_COLUMNS * 2

export function LibraryView(): JSX.Element {
  const containerRef = useAutoFocus<HTMLDivElement>()
  const account = useAuthStore((s) => s.account)
  const epicAccount = useEpicAuthStore((s) => s.account)
  const { games, providerGames, isLoadingMetadata, loadedAt } = useLibraryStore((s) => s.snapshot)
  const source = useLibraryFilterStore((s) => s.source)
  const setSource = useLibraryFilterStore((s) => s.setSource)
  const isActive = useNavigationStore((s) => s.mainView === 'library')
  const [query, setQuery] = useState('')
  const [renderLimit, setRenderLimit] = useState(INITIAL_RENDER_LIMIT)
  const revealLockedRef = useRef(false)
  const revealUnlockTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const searchRef = useRef<HTMLInputElement>(null)
  const t = useT()

  const sourceCounts = useMemo(
    () => ({
      all: games.length,
      steam: providerGames.filter((game) => game.provider === 'steam').length,
      epic: providerGames.filter((game) => game.provider === 'epic').length,
      xbox: providerGames.filter((game) => game.provider === 'xbox').length
    }),
    [games, providerGames]
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const sorted = [
      ...(source === 'all' ? games : providerGames.filter((game) => game.provider === source))
    ].sort((a, b) => a.name.localeCompare(b.name))
    if (!q) return sorted
    return sorted.filter((g) => g.name.toLowerCase().includes(q))
  }, [games, providerGames, query, source])

  const revealNextBatch = useCallback((): void => {
    if (revealLockedRef.current) return
    revealLockedRef.current = true
    setRenderLimit((current) => Math.min(filtered.length, current + RENDER_BATCH_SIZE))
    if (revealUnlockTimerRef.current) clearTimeout(revealUnlockTimerRef.current)
    revealUnlockTimerRef.current = setTimeout(() => {
      revealLockedRef.current = false
    }, 180)
  }, [filtered.length])

  useEffect(
    () => () => {
      if (revealUnlockTimerRef.current) clearTimeout(revealUnlockTimerRef.current)
    },
    []
  )

  // Reset only when the user changes the visible collection. Metadata/artwork
  // deltas must never remove the currently focused card from the DOM.
  useEffect(() => {
    setRenderLimit(Math.min(INITIAL_RENDER_LIMIT, filtered.length))
    // `filtered.length` is deliberately handled by the non-resetting effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, source])

  useEffect(() => {
    setRenderLimit((current) => {
      if (filtered.length === 0) return 0
      return Math.min(filtered.length, Math.max(current, Math.min(INITIAL_RENDER_LIMIT, filtered.length)))
    })
  }, [filtered.length])

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement as HTMLElement | null
      const firstGame = containerRef.current?.querySelector<HTMLElement>('[data-game-card="true"]')
      const activeSource = containerRef.current?.querySelector<HTMLElement>(
        `[data-library-source="${source}"]`
      )

      if (active?.hasAttribute('data-library-source')) {
        focusElement(activeSource ?? null)
        return
      }
      focusElement(firstGame ?? activeSource ?? null)
    })
    return () => cancelAnimationFrame(frame)
  }, [containerRef, source])

  useEffect(() => {
    if (!isActive) return
    const focusSearch = (): void => {
      const input = searchRef.current
      if (!input) return
      focusElement(input)
      input.click()
      input.select()
    }
    window.addEventListener(LIBRARY_SEARCH_EVENT, focusSearch)
    return () => window.removeEventListener(LIBRARY_SEARCH_EVENT, focusSearch)
  }, [isActive])

  function sourceLabel(value: LibrarySource): string {
    if (value === 'steam') return t('library.source.steam')
    if (value === 'epic') return t('library.source.epic')
    if (value === 'xbox') return t('library.source.xbox')
    return t('library.source.all')
  }

  if (!account && !epicAccount && games.length === 0 && loadedAt > 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        {t('library.noAccount')}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      onScroll={(event) => {
        const scroller = event.currentTarget
        const remaining = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
        if (remaining < scroller.clientHeight * 1.25) revealNextBatch()
      }}
      className="scrollbar-none flex h-full flex-col gap-[clamp(1rem,3vh,1.75rem)] overflow-y-auto px-[clamp(1.5rem,3vw,3.5rem)] pb-[clamp(5rem,14vh,8rem)] pt-[calc(5rem+clamp(1.25rem,2.5vh,2.5rem))]"
      style={{ scrollPaddingBlock: 'clamp(1.5rem, 7vh, 4rem)' }}
    >
      <div
        onFocusCapture={() => containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
        className="grid grid-cols-1 gap-3 2xl:grid-cols-[auto_minmax(14rem,1fr)] 2xl:items-center"
      >
        <div
          className="scrollbar-none flex max-w-full shrink-0 items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-black/25 p-1"
          aria-label={t('library.source.label')}
        >
          <span className="mx-1 rounded-md border border-white/15 px-1.5 py-0.5 text-[10px] font-bold text-muted">
            LT
          </span>
          {LIBRARY_SOURCE_ORDER.map((value) => (
            <button
              key={value}
              data-focusable
              data-library-source={value}
              aria-pressed={source === value}
              onClick={() => setSource(value)}
              className={`rounded-full px-3 py-2 text-xs font-semibold transition-colors ${
                source === value
                  ? 'bg-accent text-black'
                  : 'text-muted hover:bg-white/10 hover:text-white'
              }`}
            >
              {sourceLabel(value)}
              <span className={`ml-1.5 ${source === value ? 'text-black/60' : 'text-white/35'}`}>
                {sourceCounts[value as keyof typeof sourceCounts] ?? 0}
              </span>
            </button>
          ))}
          <span className="mx-1 rounded-md border border-white/15 px-1.5 py-0.5 text-[10px] font-bold text-muted">
            RT
          </span>
        </div>
        <div className="flex flex-1 items-center gap-2 rounded-full border border-white/[0.06] bg-white/5 px-3 py-2.5">
          <Search size={16} className="text-muted" />
          <input
            ref={searchRef}
            data-focusable
            data-navigation-horizontal-only
            data-library-search
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('library.search')}
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted"
          />
          <span className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md border border-white/15 bg-black/25 px-1.5 text-[10px] font-black text-white/70">
            Y
          </span>
        </div>
        {isLoadingMetadata && (
          <div className="flex items-center gap-2 text-xs text-muted">
            <Loader2 size={14} className="animate-spin" />
            {t('library.loadingMetadata')}
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted">
          {games.length === 0 && loadedAt === 0 ? t('library.loading') : t('library.empty')}
        </p>
      ) : (
        <div
          data-navigation-grid
          data-grid-columns={GRID_COLUMNS}
          onFocusCapture={(event) => {
            const focused = (event.target as HTMLElement).closest<HTMLElement>('[data-grid-index]')
            const index = Number(focused?.dataset.gridIndex)
            if (Number.isInteger(index) && index >= renderLimit - PRELOAD_CARD_THRESHOLD) {
              revealNextBatch()
            }
          }}
          className="-mx-2 grid gap-[clamp(0.9rem,1.8vw,1.5rem)] px-2 pb-8 pt-2"
          style={{ gridTemplateColumns: `repeat(${GRID_COLUMNS}, minmax(0, 1fr))` }}
        >
          {filtered.slice(0, renderLimit).map((game, index) => (
            <GameCard key={game.id} game={game} navigationIndex={index} />
          ))}
        </div>
      )}
    </div>
  )
}
