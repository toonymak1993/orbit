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
import { usePreferencesStore } from '@renderer/state/preferencesStore'

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

function formatTransferRate(bytesPerSecond: number, language: 'en' | 'de'): string {
  const units = ['B', 'KB', 'MB', 'GB'] as const
  let value = bytesPerSecond
  let unitIndex = 0
  while (value >= 1_000 && unitIndex < units.length - 1) {
    value /= 1_000
    unitIndex++
  }
  return `${new Intl.NumberFormat(language, {
    maximumFractionDigits: value >= 10 || unitIndex === 0 ? 0 : 1
  }).format(value)} ${units[unitIndex]}/s`
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
  const language = usePreferencesStore((state) => state.language)
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
  const rate =
    primary?.bytesPerSecond && primary.bytesPerSecond > 0
      ? formatTransferRate(primary.bytesPerSecond, language)
      : undefined
  const progressLabel =
    percentage !== undefined
      ? `${primary?.confidence === 'exact' ? '' : '≈'}${percentage}%`
      : rate ?? phaseLabel
  const liveStatus = primary
    ? `${primary.title}: ${phaseLabel}${
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
            initial={reduceMotion ? false : { height: 0, opacity: 0, y: -7 }}
            animate={{ height: 32, opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0, y: -5 }}
            transition={{ duration: reduceMotion ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] }}
            aria-label={t('downloads.aria')}
            className="glass pointer-events-none relative -mt-1 w-[22rem] max-w-[42vw] overflow-hidden rounded-b-2xl rounded-t-lg border-x border-b border-white/[0.09] shadow-[0_12px_32px_rgba(0,0,0,0.26)]"
          >
            <div className="flex h-[29px] min-w-0 items-center gap-2 px-3 text-[11px]" aria-hidden="true">
              <span className={`flex shrink-0 ${accentClass}`}>
                <PhaseIcon activity={primary} reduceMotion={reduceMotion} />
              </span>
              <span className="shrink-0 font-semibold uppercase tracking-[0.12em] text-muted/80">
                {primary.provider}
              </span>
              <span
                className="min-w-0 flex-1 truncate font-medium text-text/95"
                title={primary.title}
              >
                {primary.title}
              </span>
              {activities.length > 1 && (
                <span className="shrink-0 rounded-full bg-white/[0.08] px-1.5 py-0.5 font-semibold text-muted">
                  +{activities.length - 1}
                </span>
              )}
              <span className={`shrink-0 font-semibold tabular-nums ${accentClass}`}>
                {progressLabel}
              </span>
            </div>

            <div
              role="progressbar"
              aria-label={`${primary.title}: ${phaseLabel}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percentage}
              aria-valuetext={
                percentage !== undefined && primary.confidence !== 'exact'
                  ? `${phaseLabel}, ≈${percentage}%`
                  : undefined
              }
              className="absolute inset-x-3 bottom-0 h-0.5 overflow-hidden rounded-full bg-white/10"
            >
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
                  className={`block h-full w-1/3 rounded-full ${
                    primary.phase === 'paused' ? 'bg-muted/60' : 'bg-accent'
                  }`}
                  initial={false}
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
          </motion.section>
        )}
      </AnimatePresence>
    </>
  )
}
