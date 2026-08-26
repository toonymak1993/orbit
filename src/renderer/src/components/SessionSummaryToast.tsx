import { motion } from 'framer-motion'
import { Check, Clock3, TimerReset } from 'lucide-react'
import type { GameLaunchStatus } from '@shared/ipc'
import { useT, type TFunction } from '@renderer/i18n/useT'
import { GameImage } from './GameImage'

interface Props {
  status: GameLaunchStatus
  visibleSeconds: number
}

function durationLabel(seconds: number | undefined, t: TFunction): string {
  if (seconds === undefined) return '—'
  const total = Math.max(0, Math.round(seconds ?? 0))
  const hours = Math.floor(total / 3_600)
  const minutes = Math.floor((total % 3_600) / 60)
  const remainder = total % 60
  if (hours > 0) return `${hours} h ${minutes} min`
  if (minutes > 0) return `${minutes} min ${remainder} s`
  return t('playtime.seconds', { seconds: remainder })
}

export function SessionSummaryToast({ status, visibleSeconds }: Props): JSX.Element {
  const t = useT()
  const gameName = status.gameName ?? t('launch.gameFallback')

  return (
    <motion.aside
      role="status"
      aria-live="polite"
      data-session-summary="true"
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 16, scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 360, damping: 32 }}
      className="pointer-events-none fixed bottom-8 right-8 z-[110] w-[min(26rem,calc(100vw-4rem))] overflow-hidden rounded-xl2 border border-white/15 bg-[#080b12]/92 p-4 text-white shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-2xl"
    >
      <div className="flex items-center gap-3.5">
        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-[24%] border border-white/15 bg-white/[0.06]">
          {status.gameId && (
            <GameImage
              gameId={status.gameId}
              name={gameName}
              orientation="icon"
              className="h-full w-full object-cover"
            />
          )}
          <span className="absolute bottom-0 right-0 flex h-5 w-5 items-center justify-center rounded-tl-lg bg-accent text-black">
            <Check size={12} strokeWidth={3} />
          </span>
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-accent">
            {t('launch.summaryTitle')}
          </p>
          <p className="mt-1 truncate text-base font-bold">{gameName}</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-white/10 bg-white/[0.055] px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/45">
            <Clock3 size={12} className="text-accent" />
            {t('launch.thisSession')}
          </p>
          <p className="mt-1 text-sm font-bold">
            {durationLabel(status.sessionDurationSeconds, t)}
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.055] px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/45">
            <TimerReset size={12} className="text-accent" />
            {t('launch.totalPlaytime')}
          </p>
          <p className="mt-1 text-sm font-bold">
            {durationLabel(status.totalPlaytimeSeconds, t)}
          </p>
        </div>
      </div>

      <motion.div
        aria-hidden="true"
        initial={{ scaleX: 1 }}
        animate={{ scaleX: 0 }}
        transition={{ duration: visibleSeconds, ease: 'linear' }}
        className="absolute bottom-0 left-0 h-0.5 w-full origin-left bg-accent"
      />
    </motion.aside>
  )
}
