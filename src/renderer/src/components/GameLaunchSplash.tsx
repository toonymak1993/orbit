import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { AlertTriangle, ExternalLink, X } from 'lucide-react'
import {
  GAME_LAUNCH_CANCEL_WINDOW_MS,
  GAME_TRACKING_STOP_HOLD_MS,
  type GameLaunchStatus
} from '@shared/ipc'
import { GameImage } from './GameImage'
import { ControllerButtonHint } from './ControllerButtonHint'
import { useBackHandler } from '@renderer/hooks/useBackHandler'
import { useT } from '@renderer/i18n/useT'
import { focusElement, focusFirstIn } from '@renderer/lib/spatialNavigation'
import { playUiSound } from '@renderer/lib/uiAudio'
import { subscribeBackInput } from '@renderer/lib/backHandlerStack'

interface Props {
  status: GameLaunchStatus
}

function elapsedLabel(startedAt?: number): string | null {
  if (!startedAt) return null
  const totalSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function GameLaunchSplash({ status }: Props): JSX.Element {
  const t = useT()
  const reduceMotion = useReducedMotion()
  const [, setClock] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [cancelInFlight, setCancelInFlight] = useState(false)
  const [stopTrackingInFlight, setStopTrackingInFlight] = useState(false)
  const [stopHoldActive, setStopHoldActive] = useState(false)
  const [stopHoldProgress, setStopHoldProgress] = useState(0)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const revealRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const stopHoldStartedAtRef = useRef<number | null>(null)
  const stopHoldFrameRef = useRef<number | null>(null)
  const stopTrackingInFlightRef = useRef(false)
  const cancelableUntil = status.cancelableUntil
  const remainingMs = cancelableUntil ? Math.max(0, cancelableUntil - now) : 0
  const canCancel = status.phase === 'launching' && remainingMs > 0
  const countdownSeconds = Math.max(1, Math.ceil(remainingMs / 1_000))
  const cancelWindowMs = cancelableUntil
    ? Math.max(
        1,
        cancelableUntil -
          (status.requestedAt ?? cancelableUntil - GAME_LAUNCH_CANCEL_WINDOW_MS)
      )
    : 1
  const countdownProgress = Math.min(1, remainingMs / cancelWindowMs)
  const stopHoldTotalSeconds = Math.ceil(GAME_TRACKING_STOP_HOLD_MS / 1_000)
  const stopHoldRemainingSeconds = Math.max(
    1,
    Math.ceil((GAME_TRACKING_STOP_HOLD_MS * (1 - stopHoldProgress)) / 1_000)
  )

  const cancelStopHold = useCallback((): void => {
    if (stopHoldFrameRef.current !== null) {
      cancelAnimationFrame(stopHoldFrameRef.current)
      stopHoldFrameRef.current = null
    }
    stopHoldStartedAtRef.current = null
    if (!stopTrackingInFlightRef.current) {
      setStopHoldActive(false)
      setStopHoldProgress(0)
    }
  }, [])

  const requestStopTracking = useCallback((): void => {
    if (status.phase !== 'running' || stopTrackingInFlightRef.current) return
    stopTrackingInFlightRef.current = true
    setStopHoldActive(false)
    setStopHoldProgress(1)
    setStopTrackingInFlight(true)
    playUiSound('close')
    void window.api.game
      .stopTracking()
      .then((stopped) => {
        if (stopped) return
        stopTrackingInFlightRef.current = false
        setStopTrackingInFlight(false)
        setStopHoldProgress(0)
        playUiSound('error')
      })
      .catch(() => {
        stopTrackingInFlightRef.current = false
        setStopTrackingInFlight(false)
        setStopHoldProgress(0)
        playUiSound('error')
      })
  }, [status.phase])

  const beginStopHold = useCallback((): void => {
    if (
      status.phase !== 'running' ||
      stopTrackingInFlightRef.current ||
      stopHoldStartedAtRef.current !== null
    ) {
      return
    }

    stopHoldStartedAtRef.current = performance.now()
    setStopHoldActive(true)
    setStopHoldProgress(0)
    const updateProgress = (timestamp: number): void => {
      const startedAt = stopHoldStartedAtRef.current
      if (startedAt === null) return
      const progress = Math.min(1, (timestamp - startedAt) / GAME_TRACKING_STOP_HOLD_MS)
      setStopHoldProgress(progress)
      if (progress >= 1) {
        stopHoldStartedAtRef.current = null
        stopHoldFrameRef.current = null
        requestStopTracking()
        return
      }
      stopHoldFrameRef.current = requestAnimationFrame(updateProgress)
    }
    stopHoldFrameRef.current = requestAnimationFrame(updateProgress)
  }, [requestStopTracking, status.phase])

  useEffect(() => {
    if (status.phase !== 'running') return
    return subscribeBackInput((pressed) => {
      if (pressed) beginStopHold()
      else cancelStopHold()
      return true
    })
  }, [beginStopHold, cancelStopHold, status.phase])

  useEffect(() => {
    if (status.phase === 'running') return
    cancelStopHold()
    stopTrackingInFlightRef.current = false
    setStopTrackingInFlight(false)
  }, [cancelStopHold, status.phase])

  useEffect(
    () => () => {
      if (stopHoldFrameRef.current !== null) cancelAnimationFrame(stopHoldFrameRef.current)
    },
    []
  )

  useEffect(() => {
    if (status.phase !== 'running') return
    const timer = window.setInterval(() => setClock((value) => value + 1), 1_000)
    return () => window.clearInterval(timer)
  }, [status.phase])

  useEffect(() => {
    setNow(Date.now())
    setCancelInFlight(false)
    if (!cancelableUntil) return
    const timer = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(timer)
  }, [cancelableUntil])

  useEffect(() => {
    const active = document.activeElement
    if (active instanceof HTMLElement && active !== document.body) {
      returnFocusRef.current = active
    }
    return () => {
      const previous = returnFocusRef.current
      requestAnimationFrame(() => {
        if (document.querySelector('[data-game-launch-splash="true"]')) return
        if (previous?.isConnected && !previous.closest('[inert]')) focusElement(previous)
        else focusFirstIn()
      })
    }
  }, [])

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement
      if (
        active instanceof HTMLElement &&
        active !== document.body &&
        !active.closest('[data-game-launch-splash="true"]')
      ) {
        returnFocusRef.current = active
      }
      focusElement(canCancel ? cancelRef.current : revealRef.current)
    })
    return () => cancelAnimationFrame(frame)
  }, [canCancel, cancelableUntil, status.phase])

  const requestCancel = (): void => {
    if (!canCancel || cancelInFlight) return
    setCancelInFlight(true)
    void window.api.game
      .cancelLaunch()
      .then((cancelled) => {
        if (!cancelled) setCancelInFlight(false)
      })
      .catch(() => {
        setCancelInFlight(false)
        playUiSound('error')
      })
  }

  useBackHandler(requestCancel)

  const returnTitle =
    status.returnTask === 'backing-up'
      ? t('launch.backingUp')
      : status.returnTask === 'backup-complete'
        ? t('launch.backupComplete')
        : status.returnTask === 'backup-failed'
          ? t('launch.backupFailed')
          : status.returnTask === 'tracking-stopped'
            ? t('launch.trackingStopped')
            : t('launch.returning')
  const failureTitle =
    status.failureReason === 'launch-rejected'
      ? t('launch.failed')
      : t('launch.monitorUnavailable')
  const failureDescription =
    status.failureReason === 'launch-rejected'
      ? t('launch.failureLaunchRejected')
      : status.failureReason === 'not-started'
        ? t('launch.failureNotStarted')
        : status.failureReason === 'startup-ended'
          ? t('launch.failureStartupEnded')
          : t('launch.failureMonitorUnavailable')
  const title = canCancel
    ? t('launch.countdown', { seconds: countdownSeconds })
    : status.phase === 'launching'
      ? t('launch.starting')
      : status.phase === 'running'
        ? stopTrackingInFlight
          ? t('launch.stoppingTracking')
          : stopHoldActive
            ? t('launch.stopTrackingCountdown', { seconds: stopHoldRemainingSeconds })
            : t('launch.running')
        : status.phase === 'returning'
          ? returnTitle
          : failureTitle
  const gameName = status.gameName ?? t('launch.gameFallback')
  const elapsed = status.phase === 'running' ? elapsedLabel(status.detectedAt) : null
  const showLauncher =
    !cancelableUntil && (status.phase === 'launching' || status.phase === 'running')

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-labelledby="game-launch-name"
      aria-describedby="game-launch-state"
      data-focus-scope="active"
      data-game-launch-splash="true"
      data-launch-cancelable={canCancel ? 'true' : 'false'}
      data-launch-revealable={showLauncher ? 'true' : 'false'}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.015, filter: reduceMotion ? 'none' : 'blur(8px)' }}
      transition={{ duration: reduceMotion ? 0 : 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="fixed inset-0 z-[100] overflow-hidden bg-[#030509]"
    >
      {status.gameId && (
        <motion.div
          initial={{ opacity: 0, scale: reduceMotion ? 1 : 1.04 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: reduceMotion ? 0 : 1.2, ease: [0.22, 1, 0.36, 1] }}
          className="absolute inset-0"
        >
          <GameImage
            gameId={status.gameId}
            name={gameName}
            orientation="horizontal"
            className="h-full w-full object-cover"
          />
        </motion.div>
      )}
      <div className="absolute inset-0 bg-black/65 backdrop-blur-[3px]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(3,5,9,0.38)_42%,rgba(3,5,9,0.96)_100%)]" />

      <div className="relative z-10 flex h-full flex-col items-center justify-center px-8 text-center">
        <div className="relative mb-[clamp(1rem,2.8vh,2rem)] flex h-[clamp(8rem,21vh,12.5rem)] w-[clamp(8rem,21vh,12.5rem)] items-center justify-center">
          {status.phase !== 'error' && (
            <>
              <motion.div
                animate={reduceMotion ? undefined : { rotate: 360 }}
                transition={{ duration: 3.2, repeat: Infinity, ease: 'linear' }}
                className="absolute inset-0 rounded-full border border-white/10 border-r-accent border-t-accent/70"
              />
              <motion.div
                animate={reduceMotion ? undefined : { rotate: -360 }}
                transition={{ duration: 5.5, repeat: Infinity, ease: 'linear' }}
                className="absolute inset-[10%] rounded-full border border-white/10 border-b-white/55"
              />
            </>
          )}

          <motion.div
            initial={{ opacity: 0, y: reduceMotion ? 0 : 8, scale: reduceMotion ? 1 : 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: reduceMotion ? 0 : 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="relative h-[78%] aspect-[2/3] overflow-hidden rounded-xl2 border border-white/15 bg-black/45 shadow-card"
          >
            {status.gameId && (
              <GameImage
                gameId={status.gameId}
                name={gameName}
                orientation="vertical"
                className="h-full w-full object-cover"
              />
            )}
          </motion.div>

          {status.phase === 'error' && (
            <div className="absolute -bottom-2 -right-1 flex h-12 w-12 items-center justify-center rounded-full border border-red-200/25 bg-red-500/85 text-white shadow-2xl">
              <AlertTriangle size={22} />
            </div>
          )}
        </div>

        <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-accent">
          ORBIT{status.provider ? ` · ${status.provider.toUpperCase()}` : ''}
        </p>
        <h1
          id="game-launch-name"
          className="mt-3 line-clamp-2 max-w-4xl text-[clamp(1.6rem,3.6vw,3.5rem)] font-bold leading-tight tracking-[-0.035em] text-white"
        >
          {gameName}
        </h1>
        <p
          id="game-launch-state"
          aria-live="polite"
          className="mt-3 text-[clamp(0.85rem,1.3vw,1.05rem)] font-medium text-white/70"
        >
          {title}
        </p>

        {canCancel ? (
          <div className="mt-4 h-1 w-[min(15rem,58vw)] overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full origin-left rounded-full bg-accent ${reduceMotion ? '' : 'transition-transform duration-100 ease-linear'}`}
              style={{ transform: `scaleX(${countdownProgress})` }}
            />
          </div>
        ) : status.phase === 'running' && (stopHoldActive || stopTrackingInFlight) ? (
          <div
            role="progressbar"
            aria-label={t('launch.stopTracking')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(stopHoldProgress * 100)}
            className="mt-4 h-1 w-[min(15rem,58vw)] overflow-hidden rounded-full bg-white/10"
          >
            <div
              className={`h-full origin-left rounded-full bg-red-400 ${reduceMotion ? '' : 'transition-transform duration-75 ease-linear'}`}
              style={{ transform: `scaleX(${stopHoldProgress})` }}
            />
          </div>
        ) : status.phase !== 'error' ? (
          <div className="mt-5 flex h-4 items-center gap-2">
            {[0, 1, 2].map((index) => (
              <motion.span
                key={index}
                animate={
                  reduceMotion
                    ? { opacity: 0.7 }
                    : { opacity: [0.25, 1, 0.25], y: [0, -3, 0] }
                }
                transition={{ duration: 1.1, repeat: Infinity, delay: index * 0.16 }}
                className="h-1.5 w-1.5 rounded-full bg-white"
              />
            ))}
          </div>
        ) : null}

        <p className="mt-4 max-w-xl text-xs leading-relaxed text-white/45">
          {canCancel
            ? t('launch.cancelHint')
            : status.phase === 'error'
              ? failureDescription
              : status.phase === 'running'
                ? stopHoldActive
                  ? t('launch.stopTrackingReleaseHint')
                  : t('launch.sessionActive')
                : status.phase === 'launching'
                  ? t('launch.waitingForGame')
                  : t('launch.automaticReturn')}
        </p>
        {elapsed && <p className="mt-2 font-mono text-xs tracking-wider text-white/45">{elapsed}</p>}

        {canCancel && (
          <button
            ref={cancelRef}
            data-focusable
            data-disabled={cancelInFlight ? 'true' : undefined}
            type="button"
            aria-busy={cancelInFlight}
            aria-keyshortcuts="Escape Backspace"
            onClick={requestCancel}
            className="mt-[clamp(1rem,2.5vh,1.5rem)] inline-flex min-w-[11rem] items-center justify-center gap-2.5 rounded-full border border-white/15 bg-white/[0.09] px-5 py-2.5 text-sm font-semibold text-white backdrop-blur-xl transition-colors hover:border-accent/55 hover:bg-white/[0.14]"
          >
            <ControllerButtonHint
              button="east"
              className="flex h-5 min-w-5 items-center justify-center rounded-md border border-white/15 bg-black/25 px-1 text-[9px] font-black text-white/65"
            />
            <X size={14} />
            {t('launch.cancel')}
          </button>
        )}

        {showLauncher && (
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              ref={revealRef}
              data-focusable
              type="button"
              aria-keyshortcuts="Y"
              onClick={() => void window.api.game.revealLauncher()}
              className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-black/35 px-4 py-2 text-xs font-semibold text-white/65 backdrop-blur-xl transition-colors hover:border-accent/45 hover:text-white focus:border-accent/60 focus:text-white"
            >
              <ControllerButtonHint
                button="north"
                className="flex h-5 min-w-5 items-center justify-center rounded-md border border-white/15 bg-white/[0.07] px-1 text-[9px] font-black text-white/55"
              />
              <ExternalLink size={13} />
              {t('launch.showLauncher')}
            </button>

            {status.phase === 'running' && (
              <button
                type="button"
                tabIndex={-1}
                aria-label={t('launch.stopTrackingHint', { seconds: stopHoldTotalSeconds })}
                aria-keyshortcuts="Escape Backspace"
                onClick={(event) => event.preventDefault()}
                onPointerDown={(event) => {
                  if (event.button !== 0) return
                  event.currentTarget.setPointerCapture(event.pointerId)
                  beginStopHold()
                }}
                onPointerUp={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId)
                  }
                  cancelStopHold()
                }}
                onPointerCancel={cancelStopHold}
                onLostPointerCapture={cancelStopHold}
                className={`relative inline-flex select-none items-center gap-2 overflow-hidden rounded-full border px-4 py-2 text-xs font-semibold backdrop-blur-xl transition-colors ${
                  stopHoldActive || stopTrackingInFlight
                    ? 'border-red-300/55 bg-red-500/10 text-white'
                    : 'border-white/12 bg-black/35 text-white/55 hover:border-red-300/35 hover:text-white/80'
                }`}
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 left-0 origin-left bg-red-400/15"
                  style={{ width: `${stopHoldProgress * 100}%` }}
                />
                <ControllerButtonHint
                  button="east"
                  className="relative flex h-5 min-w-5 items-center justify-center rounded-md border border-white/15 bg-white/[0.07] px-1 text-[9px] font-black text-white/60"
                />
                <X size={13} className="relative" />
                <span className="relative">
                  {stopTrackingInFlight
                    ? t('launch.stoppingTracking')
                    : stopHoldActive
                      ? t('launch.stopTrackingHolding', { seconds: stopHoldRemainingSeconds })
                      : t('launch.stopTrackingHold', { seconds: stopHoldTotalSeconds })}
                </span>
              </button>
            )}
          </div>
        )}
      </div>
    </motion.div>
  )
}
