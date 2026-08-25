import { motion } from 'framer-motion'
import { Download, Play } from 'lucide-react'
import type { LibraryGame } from '@shared/ipc'
import { GameImage } from './GameImage'
import { useT } from '@renderer/i18n/useT'
import { formatPlaytime } from '@renderer/lib/playtime'
import { useGameDetailStore } from '@renderer/state/gameDetailStore'

interface Props {
  game: LibraryGame
  navigationIndex?: number
  onActiveChange?: (active: boolean) => void
  variant?: 'poster' | 'home' | 'float'
}

export function GameCard({
  game,
  navigationIndex,
  onActiveChange,
  variant = 'poster'
}: Props): JSX.Element {
  const t = useT()
  const playtime = formatPlaytime(game.playtimeMinutes, t)
  const openGame = useGameDetailStore((state) => state.openGame)
  const isHomeCard = variant === 'home' || variant === 'float'

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
      onClick={() => openGame(game.id)}
      onMouseEnter={() => onActiveChange?.(true)}
      onMouseLeave={(event) => {
        if (document.activeElement !== event.currentTarget) onActiveChange?.(false)
      }}
      onFocus={() => onActiveChange?.(true)}
      onBlur={(event) => {
        const next = event.relatedTarget as HTMLElement | null
        if (isHomeCard && next?.matches('[data-home-game-card="true"]')) return
        onActiveChange?.(false)
      }}
      whileHover={{ scale: 1.025, y: -1 }}
      whileFocus={{ scale: 1.025, y: -1 }}
      transition={{ duration: 0.115, ease: [0.22, 1, 0.36, 1] }}
      className={`group relative isolate w-full scroll-m-[clamp(1rem,4vh,2.5rem)] overflow-hidden rounded-xl2 bg-surface-2 text-left shadow-card ${
        variant === 'home' ? 'aspect-[1/1.08]' : 'aspect-[2/3]'
      }`}
    >
      <GameImage
        gameId={game.id}
        name={game.name}
        orientation="vertical"
        className={`h-full w-full object-cover ${isHomeCard ? 'object-top' : ''}`}
      />
      {isHomeCard && (
        <div aria-hidden="true" className="game-card-shine pointer-events-none absolute inset-y-0 z-10" />
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-transparent opacity-0 transition-opacity group-hover:opacity-100 group-data-[focused=true]:opacity-100" />
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-end p-3 opacity-0 transition-opacity group-hover:opacity-100 group-data-[focused=true]:opacity-100">
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
      <div
        className={`pointer-events-none absolute right-2 flex h-8 w-8 items-center justify-center rounded-full bg-accent text-black opacity-0 transition-opacity group-hover:opacity-100 group-data-[focused=true]:opacity-100 ${
          game.updateAvailable ? 'top-11' : 'top-2'
        }`}
      >
        <Play size={14} fill="currentColor" />
      </div>
    </motion.button>
  )
}
