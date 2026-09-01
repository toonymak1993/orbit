import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  ArrowDownToLine,
  CheckCircle2,
  LoaderCircle,
  Pause,
  TriangleAlert
} from 'lucide-react'
import type {
  LauncherDownloadActivity,
  LauncherDownloadPhase,
  LauncherDownloadSnapshot
} from '@shared/ipc'
import {
  clampLauncherProgress,
  orderedLauncherDownloads,
  shouldApplyLauncherDownloadSnapshot
} from '@shared/launcherDownloads'
import { useT } from '@renderer/i18n/useT'
import type { TranslationKey } from '@renderer/i18n/translations'
import { GameImage } from './GameImage'

const EMPTY_SNAPSHOT: LauncherDownloadSnapshot = {
  revision: -1,
  updatedAt: 0,
  activities: []
}

const PHASE_KEYS: Record<LauncherDownloadPhase, TranslationKey> = {
  downloading: 'downloads.phase.downloading',
  updating: 'downloads.phase.updating',
  installing: 'downloads.phase.installing',
  verifying: 'downloads.phase.verifying',
  paused: 'downloads.phase.paused',
  completed: 'downloads.phase.completed',
  error: 'downloads.phase.error'
}

function PhaseIcon({
  activity,
  reduceMotion
}: {
  activity: LauncherDownloadActivity
  reduceMotion: boolean
}): JSX.Element {
  if (activity.phase === 'completed') return <CheckCircle2 size={14} strokeWidth={2.4} />
  if (activity.phase === 'paused') return <Pause size={14} fill="currentColor" />
  if (activity.phase === 'error') return <TriangleAlert size={14} strokeWidth={2.4} />
  if (activity.phase === 'installing' || activity.phase === 'verifying') {
    return <LoaderCircle size={14} className={reduceMotion ? '' : 'animate-spin'} />
  }
  return <ArrowDownToLine size={14} strokeWidth={2.4} />
}

export function DownloadActivityIsland(): JSX.Element {
  const [snapshot, setSnapshot] = useState<LauncherDownloadSnapshot>(EMPTY_SNAPSHOT)
  const latestRevision = useRef(EMPTY_SNAPSHOT.revision)
  const reduceMotion = Boolean(useReducedMotion())
  const t = useT()

  useEffect(() => {
    let mounted = true
    const applySnapshot = (incoming: LauncherDownloadSnapshot): void => {
      if (!mounted || incoming.revision < latestRevision.current) return
      setSnapshot((current) => {
        if (!shouldApplyLauncherDownloadSnapshot(current, incoming)) return current
        latestRevision.current = incoming.revision
        return incoming
      })
    }
    const unsubscribe = window.api.downloads.onUpdated(applySnapshot)
    void window.api.downloads.get().then(applySnapshot).catch(() => undefined)
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  const activities = useMemo(
    () => orderedLauncherDownloads(snapshot.activities),
    [snapshot.activities]
  )
  const primary = activities[0]
  const progress = clampLauncherProgress(primary?.progress)
  const percentage = progress === undefined ? undefined : Math.round(progress * 100)
  const phaseLabel = primary
    ? primary.confidence === 'heuristic' && primary.phase === 'downloading'
      ? t('downloads.phase.detected')
      : t(PHASE_KEYS[primary.phase])
    : ''
  const isActive =
    primary !== undefined &&
    primary.phase !== 'paused' &&
    primary.phase !== 'completed' &&
    primary.phase !== 'error'
  const liveStatus = primary
    ? `${primary.title}: ${phaseLabel}${
        percentage !== undefined ? `, ${percentage}%` : ''
      }${
        activities.length > 1
          ? `. ${t('downloads.more', { count: activities.length - 1 })}`
          : ''
      }`
    : ''
  const accentClass =
    primary?.phase === 'error'
      ? 'text-amber-300'
      : primary?.phase === 'completed'
        ? 'text-emerald-300'
        : 'text-accent'

  return (
    <>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {liveStatus}
      </span>
      <AnimatePresence initial={false}>
        {primary && (
          <motion.section
            key="launcher-download-island"
            initial={reduceMotion ? false : { maxWidth: 0, opacity: 0, scale: 0.78 }}
            animate={{ maxWidth: 352, opacity: 1, scale: 1 }}
            exit={
              reduceMotion
                ? { maxWidth: 0, opacity: 0 }
                : { maxWidth: 0, opacity: 0, scale: 0.82 }
            }
            transition={
              reduceMotion
                ? { duration: 0 }
                : {
                    maxWidth: { type: 'spring', stiffness: 360, damping: 31, mass: 0.82 },
                    opacity: { duration: 0.18 },
                    scale: { type: 'spring', stiffness: 420, damping: 27, mass: 0.72 }
                  }
            }
            aria-hidden="true"
            className="pointer-events-none relative flex h-9 w-[min(22rem,36vw)] shrink-0 origin-center items-center overflow-hidden rounded-full"
          >
            <div className="relative h-8 w-full min-w-[11rem] overflow-hidden rounded-full bg-white/[0.065] text-[11px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
              {primary.gameId && (
                <GameImage
                  gameId={primary.gameId}
                  name={primary.title}
                  orientation="horizontal"
                  fit="cover"
                  className="absolute inset-0 h-full w-full object-cover opacity-55 saturate-[0.85]"
                />
              )}
              <span className="absolute inset-0 bg-[linear-gradient(90deg,rgba(3,6,11,0.88),rgba(3,6,11,0.56)_58%,rgba(3,6,11,0.8))]" />
              <div className="relative z-10 flex h-full w-full items-center gap-2 px-3 pb-0.5">
                <span
                  className={`relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-black/30 ${accentClass}`}
                >
                  {primary.phase !== 'paused' && primary.phase !== 'error' && (
                    <motion.span
                      className="absolute inset-0 rounded-full border border-current/30"
                      animate={
                        reduceMotion
                          ? undefined
                          : { scale: [0.82, 1.3], opacity: [0.5, 0] }
                      }
                      transition={{ duration: 1.35, repeat: Infinity, ease: 'easeOut' }}
                    />
                  )}
                  <PhaseIcon activity={primary} reduceMotion={reduceMotion} />
                </span>
                <span className="hidden shrink-0 font-semibold uppercase tracking-[0.12em] text-white/65 min-[900px]:inline">
                  {primary.provider}
                </span>
                <span
                  className="min-w-0 flex-1 truncate font-semibold text-white drop-shadow-md"
                  title={primary.title}
                >
                  {primary.title}
                </span>
                {activities.length > 1 && (
                  <span className="shrink-0 rounded-full bg-black/35 px-1.5 py-0.5 font-semibold text-white/75">
                    +{activities.length - 1}
                  </span>
                )}
                <span
                  className={`flex min-w-8 shrink-0 items-center justify-end font-bold tabular-nums drop-shadow-md ${accentClass}`}
                  aria-label={phaseLabel}
                >
                  {percentage !== undefined ? (
                    `${primary.confidence === 'exact' ? '' : '≈'}${percentage}%`
                  ) : isActive ? (
                    <LoaderCircle
                      size={16}
                      strokeWidth={2.4}
                      className={reduceMotion ? '' : 'animate-spin'}
                    />
                  ) : (
                    <PhaseIcon activity={primary} reduceMotion={reduceMotion} />
                  )}
                </span>
              </div>
              <div className="absolute inset-x-2 bottom-0.5 z-20 h-0.5 overflow-hidden rounded-full bg-white/15">
                {progress !== undefined ? (
                  <motion.span
                    className={`block h-full w-full origin-left rounded-full ${
                      primary.phase === 'error' ? 'bg-amber-300' : 'bg-accent'
                    }`}
                    initial={false}
                    animate={{ scaleX: progress }}
                    transition={{
                      duration: reduceMotion ? 0 : 0.35,
                      ease: [0.22, 1, 0.36, 1]
                    }}
                  />
                ) : (
                  <motion.span
                    className="block h-full w-1/3 rounded-full bg-accent"
                    animate={
                      reduceMotion || primary.phase === 'paused'
                        ? { x: '100%' }
                        : { x: ['-110%', '310%'] }
                    }
                    transition={
                      reduceMotion || primary.phase === 'paused'
                        ? { duration: 0 }
                        : { duration: 1.35, repeat: Infinity, ease: 'easeInOut' }
                    }
                  />
                )}
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </>
  )
}
