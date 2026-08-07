import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  CalendarDays,
  ExternalLink,
  Gamepad2,
  HardDriveDownload,
  Play,
  Sparkles,
  Timer,
  Trophy,
  X
} from 'lucide-react'
import type {
  GameAchievementsSnapshot,
  GameCompletionTimes,
  LibraryGame
} from '@shared/ipc'
import { GameImage } from './GameImage'
import { useBackHandler } from '@renderer/hooks/useBackHandler'
import { useLaunchGame } from '@renderer/hooks/useLaunchGame'
import { useT } from '@renderer/i18n/useT'
import { usePreferencesStore } from '@renderer/state/preferencesStore'
import { useGameDetailStore } from '@renderer/state/gameDetailStore'
import { focusElement } from '@renderer/lib/spatialNavigation'
import { formatPlaytime } from '@renderer/lib/playtime'

interface Props {
  game: LibraryGame
}

function formatHours(minutes: number | undefined, language: 'en' | 'de'): string {
  if (!minutes) return '—'
  const hours = minutes / 60
  const value = new Intl.NumberFormat(language === 'de' ? 'de-DE' : 'en-US', {
    maximumFractionDigits: hours < 10 ? 1 : 0
  }).format(hours)
  return `${value} h`
}

export function GameDetailPanel({ game }: Props): JSX.Element {
  const t = useT()
  const language = usePreferencesStore((state) => state.language)
  const showAchievements = usePreferencesStore((state) => state.showAchievements)
  const closeGame = useGameDetailStore((state) => state.closeGame)
  const launch = useLaunchGame()
  const launchRef = useRef<HTMLButtonElement>(null)
  const [completionTimes, setCompletionTimes] = useState<GameCompletionTimes | null>(
    game.metadata.completionTimes ?? null
  )
  const [loadingTimes, setLoadingTimes] = useState(!game.metadata.completionTimes)
  const [achievements, setAchievements] = useState<GameAchievementsSnapshot | null>(null)
  const [loadingAchievements, setLoadingAchievements] = useState(showAchievements)

  useBackHandler(closeGame)

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    const frame = requestAnimationFrame(() => focusElement(launchRef.current))
    return () => {
      cancelAnimationFrame(frame)
      if (previousFocus?.isConnected) requestAnimationFrame(() => focusElement(previousFocus))
    }
  }, [])

  useEffect(() => {
    let active = true
    setCompletionTimes(game.metadata.completionTimes ?? null)
    setLoadingTimes(!game.metadata.completionTimes)
    void window.api.game
      .resolveCompletionTimes(game.id)
      .then((result) => {
        if (active) setCompletionTimes(result)
      })
      .finally(() => {
        if (active) setLoadingTimes(false)
      })
    return () => {
      active = false
    }
  }, [game.id])

  useEffect(() => {
    let active = true
    setAchievements(null)
    setLoadingAchievements(showAchievements)
    if (showAchievements) {
      void window.api.game
        .resolveAchievements(game.id)
        .then((result) => {
          if (active) setAchievements(result)
        })
        .finally(() => {
          if (active) setLoadingAchievements(false)
        })
    }
    return () => {
      active = false
    }
  }, [game.id, showAchievements])

  const playtime = formatPlaytime(game.playtimeMinutes, t) ?? t('details.notPlayed')
  const summary = game.metadata.summary ?? game.metadata.description
  const developer = game.metadata.developers?.[0]
  const genreText = useMemo(() => game.metadata.genres?.slice(0, 3).join(' · '), [game.metadata.genres])
  const completionAvailable = completionTimes?.state === 'available'

  const handleLaunch = (): void => {
    launch(game.id)
    closeGame()
  }

  return (
    <motion.div
      data-focus-scope="active"
      role="dialog"
      aria-modal="true"
      aria-label={game.name}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22 }}
      onPointerDown={(event) => {
        if (event.currentTarget === event.target) closeGame()
      }}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[6px]"
    >
      <motion.section
        initial={{ x: '108%', opacity: 0.65, scale: 0.985 }}
        animate={{ x: 0, opacity: 1, scale: 1 }}
        exit={{ x: '108%', opacity: 0.55, scale: 0.99 }}
        transition={{ type: 'spring', stiffness: 280, damping: 31, mass: 0.9 }}
        onPointerDown={(event) => event.stopPropagation()}
        className="game-detail-panel absolute overflow-hidden rounded-[clamp(1.4rem,2.3vw,2.8rem)] border border-white/10 bg-surface shadow-[0_32px_100px_rgba(0,0,0,0.65)]"
      >
        <GameImage
          gameId={game.id}
          name={game.name}
          orientation="horizontal"
          className="absolute inset-0 h-full w-full scale-[1.02] object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/65 to-black/20" />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/45 to-black/10" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_82%_18%,transparent_0%,rgba(0,0,0,0.28)_48%,rgba(0,0,0,0.72)_100%)]" />

        <button
          data-focusable
          onClick={closeGame}
          aria-label={t('details.close')}
          className="absolute right-[clamp(1rem,2vw,2rem)] top-[clamp(1rem,2vw,2rem)] z-30 flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-black/35 text-white backdrop-blur-xl transition-colors hover:bg-white/15"
        >
          <X size={20} />
        </button>

        <div className="absolute inset-0 z-20 overflow-hidden">
          <div className="game-detail-layout grid h-full items-end">
            <div className="min-w-0 self-end">
              <div className="game-detail-identity flex items-end gap-[clamp(0.8rem,1.4vw,1.35rem)]">
                <div className="h-[clamp(4rem,6vw,6rem)] w-[clamp(4rem,6vw,6rem)] shrink-0 overflow-hidden rounded-[26%] border border-white/15 bg-black/35 shadow-2xl">
                  <GameImage
                    gameId={game.id}
                    name={game.name}
                    orientation="icon"
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="min-w-0 pb-1">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[clamp(0.6rem,0.8vw,0.72rem)] font-semibold uppercase tracking-[0.16em] text-white/60">
                    <span>{game.provider}</span>
                    {game.installed && (
                      <span className="rounded-full bg-accent/15 px-2.5 py-1 text-accent">
                        {t('details.installed')}
                      </span>
                    )}
                  </div>
                  <h1 className="line-clamp-2 text-[clamp(1.8rem,3.25vw,3.8rem)] font-bold leading-[0.96] tracking-[-0.04em] text-white">
                    {game.name}
                  </h1>
                </div>
              </div>

              <div className="game-detail-meta flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[clamp(0.72rem,0.9vw,0.88rem)] text-white/65">
                {developer && (
                  <span className="flex min-w-0 items-center gap-2">
                    <Gamepad2 size={14} className="shrink-0 text-accent" />
                    <span className="truncate">{developer}</span>
                  </span>
                )}
                {game.metadata.releaseDateText && (
                  <span className="flex items-center gap-2">
                    <CalendarDays size={14} className="text-accent" />
                    {game.metadata.releaseDateText}
                  </span>
                )}
                {genreText && <span className="truncate">{genreText}</span>}
              </div>

              {summary && (
                <p className="game-detail-summary line-clamp-3 text-[clamp(0.76rem,0.95vw,0.94rem)] leading-relaxed text-white/65">
                  {summary}
                </p>
              )}

              <div className="game-detail-actions flex flex-wrap items-center gap-2.5">
                <button
                  ref={launchRef}
                  data-focusable
                  onClick={handleLaunch}
                  className="flex min-w-[9.5rem] items-center justify-center gap-2.5 rounded-full bg-accent px-6 py-3 text-sm font-bold text-black shadow-[0_12px_40px_rgb(var(--color-accent)/0.25)] transition-transform hover:scale-[1.025]"
                >
                  {game.installed ? <Play size={17} fill="currentColor" /> : <HardDriveDownload size={17} />}
                  {game.installed ? t('details.play') : t('details.install')}
                </button>

                {game.metadata.storeUrl && (
                  <button
                    data-focusable
                    onClick={() => void window.api.app.openExternal(game.metadata.storeUrl as string)}
                    className="flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.07] px-5 py-3 text-sm font-semibold text-white backdrop-blur-md transition-colors hover:bg-white/15"
                  >
                    <ExternalLink size={16} />
                    {t('details.storePage')}
                  </button>
                )}

                {completionTimes?.sourceUrl && (
                  <button
                    data-focusable
                    onClick={() => void window.api.app.openExternal(completionTimes.sourceUrl as string)}
                    className="flex items-center gap-2 rounded-full px-3 py-3 text-xs font-medium text-white/55 transition-colors hover:text-white"
                  >
                    <Sparkles size={14} className="text-accent" />
                    HLTB
                  </button>
                )}
              </div>
            </div>

            <div className="min-w-0 self-end">
              <div className="game-detail-stats grid grid-cols-2 gap-2.5">
                <div className="rounded-xl2 border border-white/10 bg-black/30 px-3.5 py-3 backdrop-blur-md">
                  <div className="mb-1.5 flex items-center gap-2 text-[11px] font-medium text-white/55">
                    <Timer size={14} className="text-accent" />
                    {t('details.yourPlaytime')}
                  </div>
                  <p className="text-lg font-semibold text-white">{playtime}</p>
                </div>

                {loadingTimes ? (
                  [0, 1, 2].map((index) => (
                    <div
                      key={index}
                      className="min-h-[4.5rem] animate-pulse rounded-xl2 border border-white/5 bg-white/[0.06]"
                    />
                  ))
                ) : completionAvailable ? (
                  <>
                    <TimeCard
                      label={t('details.mainStory')}
                      value={formatHours(completionTimes.mainStoryMinutes, language)}
                    />
                    <TimeCard
                      label={t('details.mainExtra')}
                      value={formatHours(completionTimes.mainExtraMinutes, language)}
                    />
                    <TimeCard
                      label={t('details.completionist')}
                      value={formatHours(completionTimes.completionistMinutes, language)}
                    />
                  </>
                ) : (
                  <div className="flex min-h-[4.5rem] items-center rounded-xl2 border border-white/10 bg-black/30 px-3.5 py-3 text-sm text-white/55">
                    {t('details.noCompletionData')}
                  </div>
                )}
              </div>

              {showAchievements && (loadingAchievements || achievements?.state === 'available') && (
                <AchievementGallery
                  snapshot={achievements}
                  loading={loadingAchievements}
                  t={t}
                />
              )}
            </div>
          </div>
        </div>
      </motion.section>
    </motion.div>
  )
}

function AchievementGallery({
  snapshot,
  loading,
  t
}: {
  snapshot: GameAchievementsSnapshot | null
  loading: boolean
  t: ReturnType<typeof useT>
}): JSX.Element {
  if (loading) {
    return (
      <div className="game-detail-achievements h-32 animate-pulse rounded-xl2 border border-white/5 bg-white/[0.05]" />
    )
  }

  const ordered = [...(snapshot?.achievements ?? [])].sort(
    (a, b) => Number(b.unlocked) - Number(a.unlocked) || (b.unlockedAt ?? 0) - (a.unlockedAt ?? 0)
  )
  const percent = snapshot?.total ? Math.round((snapshot.unlocked / snapshot.total) * 100) : 0

  return (
    <section className="game-detail-achievements rounded-xl2 border border-white/10 bg-black/30 p-3.5 backdrop-blur-md">
      <div className="mb-2 flex items-center justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-white/60">
            <Trophy size={14} className="text-accent" />
            {t('achievements.title')}
          </p>
          <p className="mt-0.5 text-xs font-semibold text-white">
            {t('achievements.progress', {
              unlocked: snapshot?.unlocked ?? 0,
              total: snapshot?.total ?? 0
            })}
          </p>
        </div>
        <span className="text-lg font-black text-white">{percent}%</span>
      </div>
      <div className="mb-3 h-1 overflow-hidden rounded-full bg-white/10">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${percent}%` }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2"
        />
      </div>
      <div className="scrollbar-none flex gap-2 overflow-x-auto pb-0.5">
        {ordered.slice(0, 8).map((achievement) => (
          <div
            key={achievement.id}
            className={`flex w-[11.5rem] shrink-0 items-center gap-2.5 rounded-xl border px-2.5 py-2 ${
              achievement.unlocked
                ? 'border-accent/20 bg-accent/[0.08]'
                : 'border-white/[0.06] bg-white/[0.035] opacity-55'
            }`}
          >
            <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-black/40">
              {(achievement.unlocked ? achievement.iconUrl : achievement.lockedIconUrl) ? (
                <img
                  src={achievement.unlocked ? achievement.iconUrl : achievement.lockedIconUrl}
                  alt=""
                  loading="lazy"
                  className={`h-full w-full object-cover ${achievement.unlocked ? '' : 'grayscale'}`}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-white/30">
                  <Trophy size={18} />
                </div>
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-white/85">{achievement.name}</p>
              <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-white/40">
                {achievement.description ??
                  (achievement.unlocked ? t('achievements.unlocked') : t('achievements.locked'))}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function TimeCard({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-xl2 border border-white/10 bg-black/30 px-3.5 py-3 backdrop-blur-md">
      <p className="mb-1.5 text-[11px] font-medium text-white/55">{label}</p>
      <p className="text-lg font-semibold text-white">{value}</p>
    </div>
  )
}
