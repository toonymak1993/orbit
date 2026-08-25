import { useEffect } from 'react'
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'framer-motion'
import { BadgeEuro, BellRing, Check, CircleAlert, Sparkles } from 'lucide-react'
import type { NotificationMotion, NotificationPosition } from '@shared/ipc'
import { useT } from '@renderer/i18n/useT'
import { usePreferencesStore } from '@renderer/state/preferencesStore'
import {
  useNotificationStore,
  type NotificationTone
} from '@renderer/state/notificationStore'

const POSITION_CLASS: Record<NotificationPosition, string> = {
  'top-right': 'right-4 top-24 items-end xl:right-8',
  'top-center': 'left-1/2 top-24 -translate-x-1/2 items-center',
  'bottom-right': 'bottom-6 right-4 items-end xl:right-8'
}

const TONE_CLASS: Record<NotificationTone, string> = {
  info: 'border-accent/35 bg-accent/12 text-accent',
  success: 'border-emerald-300/35 bg-emerald-300/12 text-emerald-300',
  price: 'border-amber-300/40 bg-amber-300/12 text-amber-200',
  error: 'border-rose-300/40 bg-rose-300/12 text-rose-200'
}

function ToneIcon({ tone }: { tone: NotificationTone }): JSX.Element {
  if (tone === 'success') return <Check size={19} strokeWidth={2.6} />
  if (tone === 'price') return <BadgeEuro size={20} />
  if (tone === 'error') return <CircleAlert size={20} />
  return <BellRing size={19} />
}

function notificationVariants(
  motionStyle: NotificationMotion,
  position: NotificationPosition,
  reduceMotion: boolean
): Variants {
  if (reduceMotion) {
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0 }
    }
  }
  if (motionStyle === 'lift') {
    return {
      initial: { opacity: 0, y: 28, scale: 0.98 },
      animate: { opacity: 1, y: 0, scale: 1 },
      exit: { opacity: 0, y: -18, scale: 0.985 }
    }
  }
  if (motionStyle === 'scale') {
    return {
      initial: { opacity: 0, scale: 0.9, filter: 'blur(8px)' },
      animate: { opacity: 1, scale: 1, filter: 'blur(0px)' },
      exit: { opacity: 0, scale: 0.94, filter: 'blur(5px)' }
    }
  }
  const fromX = position === 'top-center' ? 0 : 56
  return {
    initial: { opacity: 0, x: fromX, y: position === 'top-center' ? -24 : 0 },
    animate: { opacity: 1, x: 0, y: 0 },
    exit: { opacity: 0, x: fromX * 0.72, y: position === 'top-center' ? -16 : 0 }
  }
}

export function NotificationCenter(): JSX.Element {
  const t = useT()
  const reduceMotion = useReducedMotion()
  const current = useNotificationStore((state) => state.items[0])
  const dismiss = useNotificationStore((state) => state.dismiss)
  const position = usePreferencesStore((state) => state.notificationPosition)
  const motionStyle = usePreferencesStore((state) => state.notificationMotion)

  useEffect(() => {
    if (!current) return
    const timeout = window.setTimeout(() => dismiss(current.id), current.durationMs)
    return () => window.clearTimeout(timeout)
  }, [current, dismiss])

  const variants = notificationVariants(motionStyle, position, Boolean(reduceMotion))

  return (
    <div
      className={`pointer-events-none fixed z-[100] flex w-[min(26rem,calc(100vw-2rem))] flex-col ${POSITION_CLASS[position]}`}
      aria-live="polite"
      aria-atomic="true"
    >
      <AnimatePresence mode="wait">
        {current && (
          <motion.div
            key={current.id}
            role="status"
            variants={variants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ duration: reduceMotion ? 0.12 : 0.42, ease: [0.22, 1, 0.36, 1] }}
            className="relative w-full overflow-hidden rounded-[var(--radius-card)] border border-white/[0.11] bg-surface/90 p-1 shadow-[0_24px_70px_rgba(0,0,0,0.48)] backdrop-blur-2xl"
          >
            <div className="relative flex items-center gap-3 overflow-hidden rounded-[calc(var(--radius-card)-0.25rem)] bg-[linear-gradient(135deg,rgb(255_255_255/0.055),transparent_64%)] px-4 py-3.5">
              <Sparkles
                aria-hidden="true"
                size={70}
                className="pointer-events-none absolute -right-4 -top-6 text-accent opacity-[0.055]"
              />
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${TONE_CLASS[current.tone]}`}
              >
                <ToneIcon tone={current.tone} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold tracking-tight text-white">
                  {t(current.titleKey, current.vars)}
                </span>
                <span className="mt-0.5 block line-clamp-2 text-xs leading-relaxed text-white/55">
                  {t(current.messageKey, current.vars)}
                </span>
              </span>
              <span className="self-start rounded-full border border-white/[0.08] bg-black/20 px-2 py-1 text-[8px] font-black uppercase tracking-[0.18em] text-white/35">
                ORBIT
              </span>
            </div>
            <motion.div
              key={`${current.id}-progress`}
              initial={{ scaleX: 1 }}
              animate={{ scaleX: 0 }}
              transition={{ duration: current.durationMs / 1000, ease: 'linear' }}
              className="absolute inset-x-1 bottom-0 h-px origin-left bg-gradient-to-r from-accent via-accent-2 to-transparent"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
