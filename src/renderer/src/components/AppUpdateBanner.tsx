import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { CheckCircle2, Download, Gamepad2, Loader2, X } from 'lucide-react'
import { useAppUpdateStore } from '@renderer/state/appUpdateStore'
import { useBackHandler } from '@renderer/hooks/useBackHandler'
import { useT } from '@renderer/i18n/useT'
import { ControllerButtonHint } from './ControllerButtonHint'
import { focusElement } from '@renderer/lib/spatialNavigation'

function countdownSeconds(endsAt?: number): number {
  return endsAt ? Math.max(1, Math.ceil((endsAt - Date.now()) / 1_000)) : 0
}

export function AppUpdateBanner(): JSX.Element | null {
  const t = useT()
  const reduceMotion = useReducedMotion()
  const snapshot = useAppUpdateStore((state) => state.snapshot)
  const visible = useAppUpdateStore((state) => state.bannerVisible)
  const install = useAppUpdateStore((state) => state.install)
  const defer = useAppUpdateStore((state) => state.defer)
  const hideBanner = useAppUpdateStore((state) => state.hideBanner)
  const deferButtonRef = useRef<HTMLButtonElement>(null)
  const installButtonRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const overlayWasVisibleRef = useRef(false)
  const [remainingSeconds, setRemainingSeconds] = useState(() =>
    countdownSeconds(snapshot.installCountdownEndsAt)
  )

  useBackHandler(() => {
    if (snapshot.stage === 'installing') return
    if (snapshot.installScheduled) void defer()
    else hideBanner()
  }, visible && (snapshot.stage === 'ready' || snapshot.stage === 'installing'))

  useEffect(() => {
    setRemainingSeconds(countdownSeconds(snapshot.installCountdownEndsAt))
    if (!snapshot.installCountdownEndsAt) return
    const timer = window.setInterval(() => {
      setRemainingSeconds(countdownSeconds(snapshot.installCountdownEndsAt))
    }, 250)
    return () => window.clearInterval(timer)
  }, [snapshot.installCountdownEndsAt])

  useEffect(() => {
    const overlayVisible = visible && (snapshot.stage === 'ready' || snapshot.stage === 'installing')
    let restoreFrame: number | undefined
    if (overlayVisible && !overlayWasVisibleRef.current) {
      previousFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null
    } else if (!overlayVisible && overlayWasVisibleRef.current) {
      const previousFocus = previousFocusRef.current
      previousFocusRef.current = null
      if (previousFocus?.isConnected) {
        restoreFrame = requestAnimationFrame(() => focusElement(previousFocus))
      }
    }
    overlayWasVisibleRef.current = overlayVisible
    return () => {
      if (restoreFrame !== undefined) cancelAnimationFrame(restoreFrame)
    }
  }, [snapshot.stage, visible])

  useEffect(() => {
    if (!visible || snapshot.stage !== 'ready') return
    const frame = requestAnimationFrame(() => {
      focusElement(snapshot.installScheduled ? deferButtonRef.current : installButtonRef.current)
    })
    return () => cancelAnimationFrame(frame)
  }, [snapshot.installScheduled, snapshot.stage, visible])

  if (!visible || (snapshot.stage !== 'ready' && snapshot.stage !== 'installing')) return null

  if (snapshot.stage === 'installing') {
    return (
      <motion.div
        data-focus-scope="active"
        role="status"
        aria-live="assertive"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[110] flex items-center justify-center overflow-hidden bg-base/95 backdrop-blur-2xl"
      >
        <motion.div
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          className="relative flex max-w-xl flex-col items-center px-8 text-center"
        >
          <span className="relative flex h-20 w-20 items-center justify-center rounded-[2rem] border border-accent/25 bg-accent/10 text-accent shadow-[0_0_60px_rgb(var(--color-accent)/0.18)]">
            <Download size={34} />
            <Loader2 className="absolute -inset-3 h-[6.5rem] w-[6.5rem] animate-spin text-accent/25" />
          </span>
          <h2 className="mt-7 text-3xl font-black tracking-tight text-white">
            {t('appUpdate.installing.title')}
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-white/50">
            {t('appUpdate.installing.body', { version: snapshot.targetVersion ?? '' })}
          </p>
        </motion.div>
      </motion.div>
    )
  }

  const gameBlocked = snapshot.blockedReason === 'game-active'
  const scheduled = snapshot.installScheduled
  const countdownActive = scheduled && Boolean(snapshot.installCountdownEndsAt)

  return (
    <AnimatePresence>
      <motion.aside
        data-focus-scope="active"
        role="dialog"
        aria-modal="true"
        aria-labelledby="orbit-update-banner-title"
        aria-live="polite"
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 36, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 24, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        className="fixed bottom-5 left-1/2 z-[75] w-[min(48rem,calc(100vw-2rem))] -translate-x-1/2 rounded-[var(--radius-card)] border border-white/10 bg-surface/94 p-1.5 shadow-[0_28px_90px_rgba(0,0,0,0.62)] backdrop-blur-2xl"
      >
        <div className="relative overflow-hidden rounded-[calc(var(--radius-card)-0.3rem)] border border-white/[0.055] bg-[linear-gradient(135deg,rgb(var(--color-accent)/0.13),transparent_52%),rgb(0_0_0/0.22)] px-4 py-3.5 sm:px-5">
          <span className="pointer-events-none absolute -right-10 -top-16 h-36 w-36 rounded-full bg-accent/10 blur-3xl" />
          <div className="relative flex flex-wrap items-center gap-3.5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-accent/25 bg-accent/12 text-accent">
              {scheduled ? <Gamepad2 size={21} /> : <CheckCircle2 size={21} />}
            </span>
            <div className="min-w-[13rem] flex-1">
              <p id="orbit-update-banner-title" className="text-sm font-black tracking-tight text-white">
                {countdownActive
                  ? t('appUpdate.banner.countdownTitle', { seconds: remainingSeconds })
                  : scheduled
                    ? t('appUpdate.banner.scheduledTitle')
                    : t('appUpdate.banner.readyTitle', {
                        version: snapshot.targetVersion ?? ''
                      })}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-white/48">
                {countdownActive
                  ? t('appUpdate.banner.countdownBody')
                  : gameBlocked
                    ? t('appUpdate.banner.gameActiveBody')
                    : t('appUpdate.banner.readyBody')}
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <motion.button
                ref={deferButtonRef}
                data-focusable
                type="button"
                onClick={() => void defer()}
                whileTap={{ scale: 0.96 }}
                className="flex min-h-10 items-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-3.5 text-xs font-bold text-white/65 transition-colors hover:bg-white/[0.1] hover:text-white"
              >
                <ControllerButtonHint
                  button="east"
                  className="rounded-md border border-white/15 px-1.5 py-0.5 text-[9px]"
                />
                {scheduled ? t('appUpdate.action.cancel') : t('appUpdate.action.later')}
              </motion.button>
              {!scheduled && (
                <motion.button
                  ref={installButtonRef}
                  data-focusable
                  type="button"
                  onClick={() => void install()}
                  whileTap={{ scale: 0.96 }}
                  className="flex min-h-10 items-center gap-2 rounded-full border border-accent/70 bg-accent px-4 text-xs font-black text-black shadow-[0_10px_30px_rgb(var(--color-accent)/0.22)]"
                >
                  <ControllerButtonHint
                    button="south"
                    className="rounded-md border border-black/20 px-1.5 py-0.5 text-[9px]"
                  />
                  {gameBlocked
                    ? t('appUpdate.action.afterGame')
                    : t('appUpdate.action.install')}
                </motion.button>
              )}
              {!scheduled && (
                <button
                  data-focusable
                  type="button"
                  onClick={hideBanner}
                  aria-label={t('appUpdate.action.close')}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-white/38 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <X size={16} />
                </button>
              )}
            </div>
          </div>
        </div>
      </motion.aside>
    </AnimatePresence>
  )
}
