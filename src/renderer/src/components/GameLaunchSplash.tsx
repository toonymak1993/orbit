import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, ExternalLink } from 'lucide-react'
import type { GameLaunchStatus } from '@shared/ipc'
import { GameImage } from './GameImage'
import { useT } from '@renderer/i18n/useT'

interface Props {
  status: GameLaunchStatus
}

function elapsedLabel(startedAt?: number): string | null {
  if (!startedAt) return null
  const totalSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function GameLaunchSplash({ status }: Props): JSX.Element {
  const t = useT()
  const [, setClock] = useState(0)

  useEffect(() => {
    if (status.phase !== 'running') return
    const timer = window.setInterval(() => setClock((value) => value + 1), 1_000)
    return () => window.clearInterval(timer)
  }, [status.phase])

  const returnTitle =
    status.returnTask === 'backing-up'
      ? t('launch.backingUp')
      : status.returnTask === 'backup-complete'
        ? t('launch.backupComplete')
        : status.returnTask === 'backup-failed'
          ? t('launch.backupFailed')
          : t('launch.returning')
  const title =
    status.phase === 'launching'
      ? t('launch.starting')
      : status.phase === 'running'
        ? t('launch.running')
        : status.phase === 'returning'
          ? returnTitle
          : t('launch.failed')
  const gameName = status.gameName ?? 'Game'
  const elapsed = status.phase === 'running' ? elapsedLabel(status.startedAt) : null

  return (
    <motion.div
      role="status"
      aria-live="polite"
      data-game-launch-splash="true"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.015, filter: 'blur(8px)' }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="fixed inset-0 z-[100] overflow-hidden bg-[#030509]"
    >
      {status.gameId && (
        <motion.div
          initial={{ opacity: 0, scale: 1.04 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
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
        <div className="relative mb-[clamp(1.5rem,4vh,3rem)] flex h-[clamp(7.5rem,15vw,11rem)] w-[clamp(7.5rem,15vw,11rem)] items-center justify-center">
          {status.phase === 'error' ? (
            <div className="flex h-24 w-24 items-center justify-center rounded-full border border-red-300/25 bg-red-400/10 text-red-300 backdrop-blur-xl">
              <AlertTriangle size={38} />
            </div>
          ) : (
            <>
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 3.2, repeat: Infinity, ease: 'linear' }}
                className="absolute inset-0 rounded-full border border-white/10 border-r-accent border-t-accent/70"
              />
              <motion.div
                animate={{ rotate: -360 }}
                transition={{ duration: 5.5, repeat: Infinity, ease: 'linear' }}
                className="absolute inset-[10%] rounded-full border border-white/10 border-b-white/55"
              />
              <div className="h-[58%] w-[58%] overflow-hidden rounded-[28%] border border-white/15 bg-black/45 shadow-[0_0_55px_rgb(var(--color-accent)/0.24)] backdrop-blur-xl">
                {status.gameId && (
                  <GameImage
                    gameId={status.gameId}
                    name={gameName}
                    orientation="icon"
                    className="h-full w-full object-cover"
                  />
                )}
              </div>
            </>
          )}
        </div>

        <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-accent">
          ORBIT · {(status.provider ?? '').toUpperCase()}
        </p>
        <h1 className="mt-3 max-w-4xl text-[clamp(1.8rem,4vw,4rem)] font-bold tracking-[-0.035em] text-white">
          {gameName}
        </h1>
        <p className="mt-3 text-[clamp(0.85rem,1.3vw,1.05rem)] font-medium text-white/70">
          {title}
        </p>

        {status.phase !== 'error' && (
          <div className="mt-5 flex h-4 items-center gap-2">
            {[0, 1, 2].map((index) => (
              <motion.span
                key={index}
                animate={{ opacity: [0.25, 1, 0.25], y: [0, -3, 0] }}
                transition={{ duration: 1.1, repeat: Infinity, delay: index * 0.16 }}
                className="h-1.5 w-1.5 rounded-full bg-white"
              />
            ))}
          </div>
        )}

        <p className="mt-5 max-w-xl text-xs leading-relaxed text-white/40">
          {status.phase === 'running' ? t('launch.sessionActive') : t('launch.automaticReturn')}
        </p>
        {elapsed && <p className="mt-2 font-mono text-xs tracking-wider text-white/45">{elapsed}</p>}

        {(status.phase === 'launching' || status.phase === 'running') && (
          <button
            data-focusable
            type="button"
            onClick={() => void window.api.game.revealLauncher()}
            className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/12 bg-black/35 px-4 py-2 text-xs font-semibold text-white/65 backdrop-blur-xl transition-colors hover:border-accent/45 hover:text-white focus:border-accent/60 focus:text-white"
          >
            <span className="rounded-md border border-white/15 bg-white/[0.07] px-1.5 py-0.5 text-[9px] font-black text-white/55">
              Y
            </span>
            <ExternalLink size={13} />
            {t('launch.showLauncher')}
          </button>
        )}
      </div>
    </motion.div>
  )
}
