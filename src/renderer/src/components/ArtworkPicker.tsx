import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardPaste,
  ImagePlus,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  X
} from 'lucide-react'
import type { ArtworkSearchOptions, ImageOrientation } from '@shared/ipc'
import { useBackHandler } from '@renderer/hooks/useBackHandler'
import { useT } from '@renderer/i18n/useT'
import { focusElement } from '@renderer/lib/spatialNavigation'
import { usePreferencesStore } from '@renderer/state/preferencesStore'

type PickerOrientation = ImageOrientation

interface Props {
  gameId: string
  gameName: string
  hasOverrides: Record<PickerOrientation, boolean>
  onApplied: (orientation: PickerOrientation) => void
  onReset: (orientation: PickerOrientation) => void
  onClose: () => void
}

type BusyAction = string | null
type Failure = 'apply' | 'clipboard-empty' | null
type Notice = 'applied' | 'reset' | null

const MIN_QUERY_LENGTH = 2
const MAX_QUERY_LENGTH = 120

export function ArtworkPicker({
  gameId,
  gameName,
  hasOverrides,
  onApplied,
  onReset,
  onClose
}: Props): JSX.Element {
  const t = useT()
  const compact = usePreferencesStore((state) => state.uiDensity === 'compact')
  const customRef = useRef<HTMLButtonElement>(null)
  const requestGenerationRef = useRef(0)
  const initialQuery = gameName.trim().slice(0, MAX_QUERY_LENGTH)
  const [orientation, setOrientation] = useState<PickerOrientation>('vertical')
  const [query, setQuery] = useState(initialQuery)
  const [submittedQuery, setSubmittedQuery] = useState(initialQuery)
  const [queryTooShort, setQueryTooShort] = useState(initialQuery.length < MIN_QUERY_LENGTH)
  const [result, setResult] = useState<ArtworkSearchOptions | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<BusyAction>(null)
  const [failure, setFailure] = useState<Failure>(null)
  const [notice, setNotice] = useState<Notice>(null)

  const load = useCallback(
    (nextOrientation: PickerOrientation, nextQuery: string): void => {
      const normalizedQuery = nextQuery.trim().slice(0, MAX_QUERY_LENGTH)
      const generation = ++requestGenerationRef.current
      setFailure(null)
      setNotice(null)

      if (nextOrientation === 'icon') {
        setQueryTooShort(false)
        setResult(null)
        setLoading(false)
        return
      }

      if (normalizedQuery.length < MIN_QUERY_LENGTH) {
        setQueryTooShort(true)
        setResult(null)
        setLoading(false)
        return
      }

      setQueryTooShort(false)
      setResult(null)
      setLoading(true)
      void window.api.image
        .searchArtwork(gameId, nextOrientation, normalizedQuery)
        .then((nextResult) => {
          if (requestGenerationRef.current === generation) {
            setResult(nextResult)
            setLoading(false)
          }
        })
        .catch(() => {
          if (requestGenerationRef.current === generation) {
            setResult({ state: 'unavailable', options: [] })
            setLoading(false)
          }
        })
    },
    [gameId]
  )

  useBackHandler(() => {
    if (!busy) onClose()
  })

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    const frame = requestAnimationFrame(() => focusElement(customRef.current))
    return () => {
      cancelAnimationFrame(frame)
      if (previousFocus?.isConnected) requestAnimationFrame(() => focusElement(previousFocus))
    }
  }, [])

  useEffect(() => {
    const nextQuery = gameName.trim().slice(0, MAX_QUERY_LENGTH)
    setOrientation('vertical')
    setQuery(nextQuery)
    setSubmittedQuery(nextQuery)
    load('vertical', nextQuery)
  }, [gameId, load])

  useEffect(
    () => () => {
      requestGenerationRef.current++
    },
    []
  )

  const submitSearch = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (busy || loading || orientation === 'icon') return
    const nextQuery = query.trim().slice(0, MAX_QUERY_LENGTH)
    if (nextQuery.length < MIN_QUERY_LENGTH) {
      load(orientation, nextQuery)
      return
    }
    setQuery(nextQuery)
    setSubmittedQuery(nextQuery)
    load(orientation, nextQuery)
  }

  const selectOrientation = (nextOrientation: PickerOrientation): void => {
    if (busy || nextOrientation === orientation) return
    const nextQuery = query.trim().slice(0, MAX_QUERY_LENGTH)
    setOrientation(nextOrientation)
    setFailure(null)
    setNotice(null)
    setQuery(nextQuery)
    if (nextQuery.length >= MIN_QUERY_LENGTH) setSubmittedQuery(nextQuery)
    load(nextOrientation, nextQuery)
  }

  const restoreActionFocus = (actionOrigin: HTMLElement | null): void => {
    requestAnimationFrame(() => {
      focusElement(actionOrigin?.isConnected ? actionOrigin : customRef.current)
    })
  }

  const applySearchedArtwork = async (artworkId: string): Promise<void> => {
    if (busy || orientation === 'icon') return
    const actionOrigin = document.activeElement as HTMLElement | null
    setBusy(artworkId)
    setFailure(null)
    setNotice(null)
    try {
      if (
        await window.api.image.applySearchedArtwork(
          gameId,
          artworkId,
          orientation,
          submittedQuery
        )
      ) {
        setNotice('applied')
        onApplied(orientation)
      }
    } catch {
      setFailure('apply')
    } finally {
      setBusy(null)
      restoreActionFocus(actionOrigin)
    }
  }

  const selectCustom = async (): Promise<void> => {
    if (busy) return
    const actionOrigin = document.activeElement as HTMLElement | null
    setBusy('custom')
    setFailure(null)
    setNotice(null)
    try {
      if (await window.api.image.selectCustom(gameId, orientation)) {
        setNotice('applied')
        onApplied(orientation)
      }
    } catch {
      setFailure('apply')
    } finally {
      setBusy(null)
      restoreActionFocus(actionOrigin)
    }
  }

  const pasteCustom = async (): Promise<void> => {
    if (busy) return
    const actionOrigin = document.activeElement as HTMLElement | null
    setBusy('clipboard')
    setFailure(null)
    setNotice(null)
    try {
      if (await window.api.image.pasteCustom(gameId, orientation)) {
        setNotice('applied')
        onApplied(orientation)
      }
      else setFailure('clipboard-empty')
    } catch {
      setFailure('apply')
    } finally {
      setBusy(null)
      restoreActionFocus(actionOrigin)
    }
  }

  const reset = async (): Promise<void> => {
    if (busy) return
    const actionOrigin = document.activeElement as HTMLElement | null
    let resetApplied = false
    setBusy('reset')
    setFailure(null)
    setNotice(null)
    try {
      if (await window.api.image.resetCustom(gameId, orientation)) {
        resetApplied = true
        setNotice('reset')
        onReset(orientation)
      }
    } catch {
      setFailure('apply')
    } finally {
      setBusy(null)
      restoreActionFocus(resetApplied ? null : actionOrigin)
    }
  }

  const statusMessage =
    result?.state === 'missing' || result?.state === 'ready'
      ? t('artwork.missingQuery', { query: submittedQuery })
      : t('artwork.unavailable')
  const orientationLabel =
    orientation === 'vertical'
      ? t('artwork.cover')
      : orientation === 'horizontal'
        ? t('artwork.background')
        : orientation === 'logo'
          ? t('artwork.logo')
          : t('artwork.icon')
  const optionGridClass =
    orientation === 'vertical'
      ? `grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 ${compact ? 'gap-2' : 'gap-3'}`
      : `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 ${compact ? 'gap-2.5' : 'gap-4'}`
  const optionAspectClass =
    orientation === 'vertical'
      ? 'aspect-[2/3]'
      : orientation === 'logo'
        ? 'aspect-[3/1]'
        : 'aspect-video'

  return createPortal(
    <AnimatePresence>
      <motion.div
        data-focus-scope="active"
        role="dialog"
        aria-modal="true"
        aria-label={t('artwork.title')}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget && !busy) onClose()
        }}
        className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-[clamp(0.75rem,2.5vw,3rem)] backdrop-blur-xl"
      >
        <motion.section
          aria-busy={loading || Boolean(busy)}
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 330, damping: 29 }}
          onPointerDown={(event) => event.stopPropagation()}
          className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-[clamp(1.35rem,2.5vw,2rem)] border border-white/10 bg-surface shadow-[0_36px_120px_rgba(0,0,0,0.75)]"
        >
          <header className={`relative shrink-0 border-b border-white/[0.07] text-center ${compact ? 'px-16 py-3' : 'px-[clamp(4.5rem,10vw,7rem)] py-[clamp(1rem,2.2vh,1.4rem)]'}`}>
            <div className="mx-auto min-w-0 max-w-3xl">
              <h2 className="truncate text-2xl font-bold text-white">{gameName}</h2>
              <p className="mt-1 text-sm font-medium text-white/45">{t('artwork.title')}</p>
            </div>
            <button
              data-focusable
              data-disabled={busy ? 'true' : undefined}
              disabled={Boolean(busy)}
              type="button"
              onClick={onClose}
              aria-label={t('artwork.close')}
              className="absolute right-[clamp(0.8rem,2vw,1.5rem)] top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/[0.06] text-white/55 transition-colors hover:bg-white/15 hover:text-white disabled:opacity-40 data-[focused=true]:bg-white/15 data-[focused=true]:text-accent"
            >
              <X size={18} />
            </button>
          </header>

          <div className={`shrink-0 border-b border-white/[0.06] ${compact ? 'px-4 py-2' : 'px-[clamp(1.15rem,2.4vw,1.75rem)] py-3'}`}>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
              <div
                role="tablist"
                aria-label={t('artwork.title')}
                className="flex shrink-0 rounded-full border border-white/10 bg-black/25 p-1"
              >
                {(['vertical', 'horizontal', 'logo', 'icon'] as const).map((value) => (
                  <button
                    key={value}
                    data-focusable
                    data-disabled={busy ? 'true' : undefined}
                    disabled={Boolean(busy)}
                    aria-disabled={Boolean(busy)}
                    type="button"
                    role="tab"
                    aria-selected={orientation === value}
                    aria-controls="artwork-results"
                    onClick={() => selectOrientation(value)}
                    className={`min-w-[7rem] rounded-full px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-45 data-[focused=true]:shadow-[0_0_0_2px_rgb(var(--color-accent)/0.45)] ${
                      orientation === value
                        ? 'bg-accent text-black'
                        : 'text-white/55 hover:bg-white/[0.08] hover:text-white'
                    }`}
                  >
                    {value === 'vertical'
                      ? t('artwork.cover')
                      : value === 'horizontal'
                        ? t('artwork.background')
                        : value === 'logo'
                          ? t('artwork.logo')
                          : t('artwork.icon')}
                  </button>
                ))}
              </div>

              {orientation !== 'icon' && (
              <form role="search" onSubmit={submitSearch} className="min-w-0 flex-1">
                <label className="sr-only" htmlFor="artwork-search">
                  {t('artwork.searchLabel')}
                </label>
                <div
                  className={`flex min-w-0 items-center gap-2 rounded-full border bg-black/25 p-1 pl-3 transition-colors focus-within:border-accent/55 ${
                    queryTooShort ? 'border-amber-300/35' : 'border-white/10'
                  }`}
                >
                  <Search size={16} className="shrink-0 text-white/35" />
                  <input
                    id="artwork-search"
                    data-focusable
                    type="search"
                    inputMode="search"
                    enterKeyHint="search"
                    autoComplete="off"
                    maxLength={MAX_QUERY_LENGTH}
                    value={query}
                    disabled={Boolean(busy)}
                    aria-label={t('artwork.searchLabel')}
                    aria-invalid={queryTooShort || undefined}
                    aria-describedby={queryTooShort ? 'artwork-query-feedback' : undefined}
                    placeholder={t('artwork.searchPlaceholder')}
                    onChange={(event) => {
                      const nextQuery = event.target.value
                      setQuery(nextQuery)
                      if (nextQuery.trim().length >= MIN_QUERY_LENGTH) setQueryTooShort(false)
                    }}
                    className="min-w-0 flex-1 bg-transparent px-1 py-2 text-sm font-medium text-white outline-none placeholder:text-white/30 disabled:opacity-45"
                  />
                  <button
                    data-focusable
                    data-disabled={busy || loading ? 'true' : undefined}
                    disabled={Boolean(busy)}
                    aria-disabled={Boolean(busy) || loading}
                    type="submit"
                    aria-label={t('artwork.searchAction')}
                    className={`flex shrink-0 items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-bold text-black transition-transform hover:scale-[1.02] disabled:opacity-45 data-[focused=true]:shadow-[0_0_0_3px_rgb(var(--color-accent)/0.25)] ${loading ? 'opacity-45' : ''}`}
                  >
                    <Search size={15} />
                    <span>{t('artwork.searchAction')}</span>
                  </button>
                </div>
                {queryTooShort && (
                  <p
                    id="artwork-query-feedback"
                    role="alert"
                    className="mt-1.5 px-3 text-xs font-medium text-amber-200/80"
                  >
                    {t('artwork.queryTooShort')}
                  </p>
                )}
              </form>
              )}
            </div>
          </div>

          <div className={`flex shrink-0 flex-wrap items-center border-b border-white/[0.06] ${compact ? 'gap-1.5 px-4 py-2' : 'gap-2.5 px-[clamp(1.15rem,2.4vw,1.75rem)] py-2.5'}`}>
            <button
              ref={customRef}
              data-focusable
              data-disabled={busy ? 'true' : undefined}
              disabled={Boolean(busy)}
              type="button"
              onClick={() => void selectCustom()}
              className="flex items-center gap-2 rounded-full bg-accent px-4 py-2.5 text-sm font-bold text-black transition-transform hover:scale-[1.02] disabled:opacity-45 data-[focused=true]:shadow-[0_0_0_3px_rgb(var(--color-accent)/0.25)]"
            >
              {busy === 'custom' ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <ImagePlus size={16} />
              )}
              <span>{t('artwork.chooseFile')}</span>
              <span className="hidden text-xs font-normal text-white/35 sm:inline">
                · {orientationLabel}
              </span>
            </button>

            <button
              data-focusable
              data-disabled={busy ? 'true' : undefined}
              disabled={Boolean(busy)}
              type="button"
              onClick={() => void pasteCustom()}
              className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/[0.12] disabled:opacity-45 data-[focused=true]:border-accent/60 data-[focused=true]:bg-accent/15"
            >
              {busy === 'clipboard' ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <ClipboardPaste size={16} />
              )}
              <span>{t('artwork.clipboard')}</span>
            </button>

            {hasOverrides[orientation] && (
              <button
                data-focusable
                data-disabled={busy ? 'true' : undefined}
                disabled={Boolean(busy)}
                type="button"
                onClick={() => void reset()}
                className="flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-45 data-[focused=true]:bg-white/[0.08] data-[focused=true]:text-accent"
              >
                {busy === 'reset' ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <RotateCcw size={16} />
                )}
                {t('artwork.restore')}
              </button>
            )}
          </div>

          <div
            id="artwork-results"
            role="tabpanel"
            aria-label={orientationLabel}
            className={`min-h-0 flex-1 overflow-y-auto ${compact ? 'px-4 py-3' : 'px-[clamp(1.15rem,2.4vw,1.75rem)] py-4'}`}
          >
            {failure && (
              <p role="alert" className="mb-4 flex items-center gap-2 rounded-xl border border-rose-300/15 bg-rose-300/[0.08] px-3.5 py-3 text-sm text-rose-100">
                <AlertTriangle size={16} />
                {failure === 'clipboard-empty'
                  ? t('artwork.clipboardEmpty')
                  : t('artwork.applyFailed')}
              </p>
            )}
            {notice && (
              <p role="status" aria-live="polite" className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-300/15 bg-emerald-300/[0.08] px-3.5 py-3 text-sm text-emerald-100">
                <CheckCircle2 size={16} />
                {notice === 'applied' ? t('artwork.saved') : t('artwork.restored')}
              </p>
            )}

            {orientation === 'icon' ? (
              <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-center text-white/45">
                <ImagePlus size={30} className="text-accent" />
                <p className="max-w-lg text-sm leading-relaxed">{t('artwork.iconHint')}</p>
              </div>
            ) : queryTooShort && !result ? (
              <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-center text-white/45">
                <Search size={27} className="text-amber-200/75" />
                <p className="max-w-lg text-sm leading-relaxed">{t('artwork.queryTooShort')}</p>
              </div>
            ) : loading ? (
              <div role="status" aria-live="polite" className="flex min-h-64 flex-col items-center justify-center gap-3 text-white/45">
                <Loader2 size={27} className="animate-spin text-accent" />
                <p className="text-sm">{t('artwork.loading')}</p>
              </div>
            ) : !result ? (
              <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-center text-white/45">
                <Search size={27} className="text-accent" />
                <p className="max-w-lg text-sm leading-relaxed">
                  {t('artwork.subtitleSearch', { name: gameName })}
                </p>
              </div>
            ) : result.state === 'ready' && result.options.length > 0 ? (
              <div className={optionGridClass}>
                {result.options.map((option, index) => (
                  <button
                    key={`${orientation}:${option.id}`}
                    data-focusable
                    data-disabled={busy ? 'true' : undefined}
                    disabled={Boolean(busy)}
                    type="button"
                    aria-label={`${orientationLabel}, ${t('artwork.option', { index: index + 1 })}${
                      option.sourceTitle
                        ? `, ${option.sourceTitle}`
                        : option.authorName
                          ? `, ${t('artwork.by', { author: option.authorName })}`
                          : ''
                    }`}
                    onClick={() => void applySearchedArtwork(option.id)}
                    className={`group relative ${optionAspectClass} overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] text-left shadow-xl transition-all hover:-translate-y-1 hover:border-white/25 disabled:opacity-55 data-[focused=true]:-translate-y-1 data-[focused=true]:border-accent data-[focused=true]:shadow-[0_0_0_3px_rgb(var(--color-accent)/0.22),0_22px_45px_rgba(0,0,0,0.45)]`}
                  >
                    <img
                      src={option.previewUrl}
                      alt=""
                      loading={index < (orientation === 'vertical' ? 6 : 3) ? 'eager' : 'lazy'}
                      referrerPolicy="no-referrer"
                      draggable={false}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.025] group-data-[focused=true]:scale-[1.025]"
                    />
                    <span className="absolute inset-x-0 bottom-0 flex min-h-12 items-end bg-gradient-to-t from-black/85 to-transparent px-2.5 pb-2 pt-6 text-[10px] font-medium text-white/70">
                      <span className="min-w-0">
                        <span className="block truncate text-white/85">
                          {option.sourceTitle ||
                            (option.authorName
                              ? t('artwork.by', { author: option.authorName })
                              : t('artwork.option', { index: index + 1 }))}
                        </span>
                        <span className="block text-[9px] uppercase tracking-[0.12em] text-white/45">
                          {option.source === 'steam-store'
                            ? t('artwork.sourceSteamStore')
                            : t('artwork.sourceSteamGridDb')}
                        </span>
                      </span>
                    </span>
                    {busy === option.id && (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/65">
                        <Loader2 size={25} className="animate-spin text-accent" />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <div role="status" aria-live="polite" className="flex min-h-64 flex-col items-center justify-center gap-4 text-center">
                <p className="max-w-lg text-sm leading-relaxed text-white/50">{statusMessage}</p>
                <button
                  data-focusable
                  type="button"
                  disabled={loading || Boolean(busy)}
                  data-disabled={loading || busy ? 'true' : undefined}
                  onClick={() => load(orientation, submittedQuery)}
                  className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-4 py-2.5 text-sm font-semibold text-white data-[focused=true]:border-accent/60 data-[focused=true]:bg-accent/15"
                >
                  <RefreshCw size={15} />
                  {t('artwork.retry')}
                </button>
              </div>
            )}
          </div>

          <footer className={`shrink-0 border-t border-white/[0.06] text-center text-[11px] text-white/25 ${compact ? 'px-4 py-2' : 'px-[clamp(1.15rem,2.4vw,1.75rem)] py-2.5'}`}>
            {t('artwork.localFooter')}
            {result?.state === 'ready' && result.options.length > 0
              ? ` · ${t('artwork.credit')}`
              : ''}
          </footer>
        </motion.section>
      </motion.div>
    </AnimatePresence>,
    document.body
  )
}
