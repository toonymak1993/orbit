import { motion, useReducedMotion } from 'framer-motion'
import { Download } from 'lucide-react'
import type { LibraryGame } from '@shared/ipc'
import { GameImage } from './GameImage'
import { useT } from '@renderer/i18n/useT'
import { formatPlaytime } from '@renderer/lib/playtime'
import { useLaunchGame } from '@renderer/hooks/useLaunchGame'
import {
  HomeCardReflection,
  type HomeCardReflectionState
} from './HomeCardReflection'
import { GameCardMenuHint } from './GameCardMenuHint'

interface Props {
  game: LibraryGame
  navigationIndex?: number
  homeReflection?: HomeCardReflectionState | null
  onActiveChange?: (active: boolean, source: 'focus' | 'pointer') => void
  variant?: 'poster' | 'home' | 'float'
}

export function GameCard({
  game,
  navigationIndex,
  homeReflection,
  onActiveChange,
  variant = 'poster'
}: Props): JSX.Element {
  const t = useT()
  const reduceMotion = useReducedMotion()
  const playtime = formatPlaytime(game, t)
  const launchGame = useLaunchGame()
  const isHomeCard = variant === 'home' || variant === 'float'
  const activeMotion = reduceMotion ? { scale: 1, y: 0 } : { scale: 1.025, y: -1 }
  const homeMotion = isHomeCard
    ? homeReflection?.distance === 0
      ? activeMotion
      : { scale: 1, y: 0 }
    : undefined

  return (
    <motion.button
      data-focusable
      data-game-card="true"
      data-game-id={game.id}
      data-grid-index={navigationIndex}
      data-home-game-card={isHomeCard ? 'true' : undefined}
      aria-label={
        game.updateAvailable
          ? `${game.name}. ${t('library.updateAvailable')}`
          : game.name
      }
      onClick={() => launchGame(game.id)}
      onMouseEnter={() => onActiveChange?.(true, 'pointer')}
      onMouseMove={() => onActiveChange?.(true, 'pointer')}
      onMouseLeave={(event) => {
        const next = event.relatedTarget
        if (next instanceof Element && next.closest('[data-home-game-card="true"]')) return
        onActiveChange?.(false, 'pointer')
      }}
      onFocus={() => onActiveChange?.(true, 'focus')}
      onBlur={(event) => {
        const next = event.relatedTarget as HTMLElement | null
        if (isHomeCard && next?.matches('[data-home-game-card="true"]')) return
        onActiveChange?.(false, 'focus')
      }}
      animate={homeMotion}
      whileHover={isHomeCard ? undefined : activeMotion}
      whileFocus={isHomeCard ? undefined : activeMotion}
      transition={
        reduceMotion
          ? { duration: 0 }
          : { duration: 0.115, ease: [0.22, 1, 0.36, 1] }
      }
      className={`group relative isolate w-full scroll-m-[clamp(1rem,4vh,2.5rem)] overflow-hidden rounded-xl2 bg-surface-2 text-left shadow-card ${
        isHomeCard ? 'home-card-convex ' : ''
      }${
        variant === 'home' ? 'aspect-[1/1.08]' : 'aspect-[2/3]'
      }`}
    >
      <GameImage
        gameId={game.id}
        name={game.name}
        orientation="vertical"
        className={`h-full w-full object-cover ${isHomeCard ? 'object-top' : ''}`}
      />
      {isHomeCard && homeReflection && (
        <HomeCardReflection reflection={homeReflection} />
      )}
      <div className="pointer-events-none absolute inset-0 z-20 bg-gradient-to-t from-black/90 via-black/10 to-transparent opacity-0 transition-opacity group-hover:opacity-100 group-data-[focused=true]:opacity-100" />
      <div className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-end p-3 opacity-0 transition-opacity group-hover:opacity-100 group-data-[focused=true]:opacity-100">
        <p className="line-clamp-2 text-sm font-semibold text-white">{game.name}</p>
        {playtime && <p className="text-xs text-muted">{playtime}</p>}
      </div>
      {game.updateAvailable && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-0 top-0 z-20 flex items-center gap-1.5 rounded-bl-xl bg-accent px-3 py-2 text-xs font-bold text-black shadow-card"
        >
          <Download size={14} strokeWidth={2.5} />
          <span>{t('library.updateBadge')}</span>
        </div>
      )}
      <GameCardMenuHint
        className={`absolute right-2 z-20 opacity-0 transition-opacity group-hover:opacity-100 group-data-[focused=true]:opacity-100 ${
          game.updateAvailable ? 'top-11' : 'top-2'
        }`}
      />
    </motion.button>
  )
}
