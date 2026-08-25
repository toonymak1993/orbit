import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, ImagePlus, Loader2, RefreshCw, RotateCcw, X } from 'lucide-react'
import type { SteamGridDbArtworkOptions } from '@shared/ipc'
import { useBackHandler } from '@renderer/hooks/useBackHandler'
import { useT } from '@renderer/i18n/useT'
import { focusElement } from '@renderer/lib/spatialNavigation'

interface Props {
  gameId: string
  gameName: string
  hasOverride: boolean
  onApplied: () => void
  onReset: () => void
  onClose: () => void
}

type BusyAction = number | 'custom' | 'reset' | null

export function ArtworkPicker({
  gameId,
  gameName,
  hasOverride,
  onApplied,
  onReset,
  onClose
}: Props): JSX.Element {
  const t = useT()
  const customRef = useRef<HTMLButtonElement>(null)
  const firstArtworkRef = useRef<HTMLButtonElement>(null)
  const [result, setResult] = useState<SteamGridDbArtworkOptions | null>(null)
  const [busy, setBusy] = useState<BusyAction>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback((): void => {
    setResult(null)
    setFailed(false)
    void window.api.image
      .listSteamGridDb(gameId)
      .then(setResult)
      .catch(() => setResult({ state: 'unavailable', options: [] }))
  }, [gameId])

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

  useEffect(load, [load])

  useEffect(() => {
    if (result?.state !== 'ready' || result.options.length === 0) return
    const frame = requestAnimationFrame(() => {
      if (document.activeElement === customRef.current) focusElement(firstArtworkRef.current)
    })
    return () => cancelAnimationFrame(frame)
  }, [result])

  const applySteamGridDb = async (artworkId: number): Promise<void> => {
    if (busy) return
    setBusy(artworkId)
    setFailed(false)
    try {
      if (await window.api.image.applySteamGridDb(gameId, artworkId)) onApplied()
    } catch {
      setFailed(true)
    } finally {
      setBusy(null)
    }
  }

  const selectCustom = async (): Promise<void> => {
    if (busy) return
    setBusy('custom')
    setFailed(false)
    try {
      if (await window.api.image.selectCustom(gameId)) onApplied()
    } catch {
      setFailed(true)
    } finally {
      setBusy(null)
    }
  }

  const reset = async (): Promise<void> => {
    if (busy) return
    setBusy('reset')
    setFailed(false)
    try {
      if (await window.api.image.resetCustom(gameId)) onReset()
    } catch {
      setFailed(true)
    } finally {
      setBusy(null)
    }
  }

  const statusMessage =
    result?.state === 'missing' || result?.state === 'ready'
      ? t('artwork.missing')
      : result?.state === 'not-configured'
        ? t('artwork.notConfigured')
        : t('artwork.unavailable')

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
        className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-[clamp(1rem,3vw,3rem)] backdrop-blur-xl"
      >
        <motion.section
          aria-busy={Boolean(busy)}
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 330, damping: 29 }}
          onPointerDown={(event) => event.stopPropagation()}
          className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-[#0c1119] shadow-[0_36px_120px_rgba(0,0,0,0.75)]"
        >
          <header className="flex shrink-0 items-start justify-between gap-6 border-b border-white/[0.07] px-7 py-5">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-accent">
                SteamGridDB
              </p>
              <h2 className="mt-1 truncate text-2xl font-bold text-white">{t('artwork.title')}</h2>
              <p className="mt-1 text-sm text-white/45">{t('artwork.subtitle', { name: gameName })}</p>
            </div>
            <button
              data-focusable
              data-disabled={busy ? 'true' : undefined}
              disabled={Boolean(busy)}
              type="button"
              onClick={onClose}
              aria-label={t('artwork.close')}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-white/55 transition-colors hover:bg-white/15 hover:text-white disabled:opacity-40 data-[focused=true]:bg-white/15 data-[focused=true]:text-accent"
            >
              <X size={18} />
            </button>
          </header>

          <div className="flex shrink-0 flex-wrap items-center gap-2.5 border-b border-white/[0.06] px-7 py-3.5">
            <button
              ref={customRef}
              data-focusable
              data-disabled={busy ? 'true' : undefined}
              disabled={Boolean(busy)}
              type="button"
              onClick={() => void selectCustom()}
              className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/[0.12] disabled:opacity-45 data-[focused=true]:border-accent/60 data-[focused=true]:bg-accent/15"
            >
              {busy === 'custom' ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />}
              <span>{t('artwork.custom')}</span>
              <span className="hidden text-xs font-normal text-white/35 sm:inline">· {t('artwork.customHint')}</span>
            </button>

            {hasOverride && (
              <button
                data-focusable
                data-disabled={busy ? 'true' : undefined}
                disabled={Boolean(busy)}
                type="button"
                onClick={() => void reset()}
                className="flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-45 data-[focused=true]:bg-white/[0.08] data-[focused=true]:text-accent"
              >
                {busy === 'reset' ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
                {t('artwork.restore')}
              </button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-7 py-5">
            {failed && (
              <p className="mb-4 flex items-center gap-2 rounded-xl border border-rose-300/15 bg-rose-300/[0.08] px-3.5 py-3 text-sm text-rose-100">
                <AlertTriangle size={16} />
                {t('artwork.applyFailed')}
              </p>
            )}

            {!result ? (
              <div className="flex min-h-72 flex-col items-center justify-center gap-3 text-white/45">
                <Loader2 size={27} className="animate-spin text-accent" />
                <p className="text-sm">{t('artwork.loading')}</p>
              </div>
            ) : result.state === 'ready' && result.options.length > 0 ? (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                {result.options.map((option, index) => (
                  <button
                    key={option.id}
                    ref={index === 0 ? firstArtworkRef : undefined}
                    data-focusable
                    data-disabled={busy ? 'true' : undefined}
                    disabled={Boolean(busy)}
                    type="button"
                    aria-label={`${t('artwork.option', { index: index + 1 })}${
                      option.authorName ? `, ${t('artwork.by', { author: option.authorName })}` : ''
                    }`}
                    onClick={() => void applySteamGridDb(option.id)}
                    className="group relative aspect-[2/3] overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] text-left shadow-xl transition-all hover:-translate-y-1 hover:border-white/25 disabled:opacity-55 data-[focused=true]:-translate-y-1 data-[focused=true]:border-accent data-[focused=true]:shadow-[0_0_0_3px_rgb(var(--color-accent)/0.22),0_22px_45px_rgba(0,0,0,0.45)]"
                  >
                    <img
                      src={option.previewUrl}
                      alt=""
                      loading={index < 6 ? 'eager' : 'lazy'}
                      referrerPolicy="no-referrer"
                      draggable={false}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.025] group-data-[focused=true]:scale-[1.025]"
                    />
                    <span className="absolute inset-x-0 bottom-0 flex min-h-12 items-end bg-gradient-to-t from-black/85 to-transparent px-2.5 pb-2 pt-6 text-[10px] font-medium text-white/70">
                      {option.authorName ? t('artwork.by', { author: option.authorName }) : `#${index + 1}`}
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
              <div className="flex min-h-72 flex-col items-center justify-center gap-4 text-center">
                <p className="max-w-lg text-sm leading-relaxed text-white/50">{statusMessage}</p>
                {result.state !== 'not-configured' && (
                  <button
                    data-focusable
                    type="button"
                    onClick={load}
                    className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-4 py-2.5 text-sm font-semibold text-white data-[focused=true]:border-accent/60 data-[focused=true]:bg-accent/15"
                  >
                    <RefreshCw size={15} />
                    {t('artwork.retry')}
                  </button>
                )}
              </div>
            )}
          </div>

          <footer className="shrink-0 border-t border-white/[0.06] px-7 py-3 text-[10px] uppercase tracking-[0.16em] text-white/25">
            {t('artwork.credit')}
          </footer>
        </motion.section>
      </motion.div>
    </AnimatePresence>,
    document.body
  )
}
