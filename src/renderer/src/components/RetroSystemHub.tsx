import { useMemo } from 'react'
import { motion, useReducedMotion, type Variants } from 'framer-motion'
import type { LibraryGame, RetroSystemId } from '@shared/ipc'
import { RETRO_SYSTEMS } from '@shared/retroSystems'
import { RETRO_SYSTEM_ARTWORK } from '@renderer/assets/retroSystemArtwork'
import { useT } from '@renderer/i18n/useT'
import {
  RETRO_SYSTEM_SWAY_LOOP,
  RETRO_SYSTEM_SWAY_OFFSET,
  RETRO_SYSTEM_SWAY_ROTATION
} from '@renderer/lib/retroSystemMotion'

const FEATURED_SYSTEM_IDS: readonly RetroSystemId[] = [
  'psp',
  'nes',
  'snes',
  'n64',
  'gb',
  'gba',
  'nds',
  'gamecube',
  'wii',
  'megadrive',
  'dreamcast',
  'ps1',
  'ps2',
  'arcade'
]

const SYSTEM_ARTWORK_VARIANTS: Variants = {
  idle: {
    rotate: 0,
    scale: 1,
    x: 0,
    transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] }
  },
  sway: {
    rotate: RETRO_SYSTEM_SWAY_ROTATION,
    scale: 1.035,
    x: RETRO_SYSTEM_SWAY_OFFSET,
    transition: {
      rotate: RETRO_SYSTEM_SWAY_LOOP,
      scale: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
      x: RETRO_SYSTEM_SWAY_LOOP
    }
  }
}

interface RetroSystemHubProps {
  games: readonly LibraryGame[]
  columns: number
  query: string
  onSelect: (systemId: RetroSystemId) => void
}

export function RetroSystemHub({
  games,
  columns,
  query,
  onSelect
}: RetroSystemHubProps): JSX.Element {
  const t = useT()
  const reduceMotion = Boolean(useReducedMotion())
  const systems = useMemo(() => {
    const counts = new Map<RetroSystemId, number>()
    for (const game of games) {
      const systemId = game.retro?.systemId
      if (game.provider !== 'retro' || !systemId) continue
      counts.set(systemId, (counts.get(systemId) ?? 0) + 1)
    }

    const definitions = new Map(RETRO_SYSTEMS.map((system) => [system.id, system]))
    const featured = FEATURED_SYSTEM_IDS.map((id, order) => ({
      definition: definitions.get(id),
      gameCount: counts.get(id) ?? 0,
      order
    })).filter(
      (entry): entry is {
        definition: (typeof RETRO_SYSTEMS)[number]
        gameCount: number
        order: number
      } => Boolean(entry.definition)
    )
    featured.sort((left, right) => {
      const populatedDelta = Number(right.gameCount > 0) - Number(left.gameCount > 0)
      return populatedDelta || left.order - right.order
    })

    const featuredIds = new Set(FEATURED_SYSTEM_IDS)
    const additional = RETRO_SYSTEMS.filter(
      (system) => !featuredIds.has(system.id) && (counts.get(system.id) ?? 0) > 0
    ).map((definition, order) => ({
      definition,
      gameCount: counts.get(definition.id) ?? 0,
      order: FEATURED_SYSTEM_IDS.length + order
    }))

    const normalizedQuery = query.trim().toLocaleLowerCase()
    return [...featured, ...additional].filter(({ definition }) =>
      normalizedQuery ? definition.name.toLocaleLowerCase().includes(normalizedQuery) : true
    )
  }, [games, query])

  return (
    <section aria-labelledby="retro-systems-title" className="flex flex-col gap-4">
      <div className="px-1 text-center">
        <div className="mx-auto max-w-2xl">
          <h1 id="retro-systems-title" className="text-2xl font-black tracking-tight text-white">
            {t('retro.systems.title')}
          </h1>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            {t('retro.systems.body')}
          </p>
        </div>
        <span className="mt-3 inline-flex rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-bold text-white/55">
          {t('retro.systems.count', { count: systems.length })}
        </span>
      </div>

      {systems.length === 0 ? (
        <div className="flex min-h-[12rem] items-center justify-center rounded-xl2 border border-dashed border-white/10 bg-white/[0.025] px-6 text-center text-sm font-semibold text-white/65">
          {t('retro.systems.noMatch')}
        </div>
      ) : (
        <div
          data-navigation-grid
          data-grid-columns={columns}
          className="grid gap-[clamp(0.8rem,1.5vw,1.25rem)] pb-8"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {systems.map(({ definition, gameCount }, index) => {
            const artwork = RETRO_SYSTEM_ARTWORK[definition.id]
            return (
              <motion.button
                key={definition.id}
                data-focusable
                data-grid-index={index}
                data-retro-system={definition.id}
                type="button"
                onClick={() => onSelect(definition.id)}
                aria-label={t('retro.systems.open', { name: definition.name, count: gameCount })}
                initial="idle"
                animate="idle"
                whileFocus={reduceMotion ? 'idle' : 'sway'}
                whileHover={reduceMotion ? 'idle' : 'sway'}
                className="group relative isolate aspect-[4/3] w-full scroll-m-[clamp(1rem,4vh,2.5rem)] overflow-hidden rounded-xl2 border border-white/[0.08] bg-surface-2 text-center shadow-card transition-[border-color,transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:border-white/20 data-[focused=true]:-translate-y-0.5 data-[focused=true]:border-accent/80 data-[focused=true]:shadow-[0_0_0_3px_rgb(var(--color-accent)/0.2),0_22px_48px_rgba(0,0,0,0.45)]"
              >
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgb(var(--color-accent)/0.18),transparent_38%),radial-gradient(circle_at_88%_72%,rgb(var(--color-accent-2)/0.16),transparent_40%),linear-gradient(145deg,rgb(var(--color-surface-2))_0%,rgb(var(--color-surface))_64%,rgb(var(--color-base))_100%)]" />
                <div className="pointer-events-none absolute inset-x-[12%] top-[5%] bottom-[25%] flex items-center justify-center">
                  <div className="absolute h-[62%] w-[62%] rounded-full bg-accent/10 blur-3xl transition-opacity duration-300 group-hover:bg-accent/15 group-data-[focused=true]:bg-accent/15" />
                  <motion.img
                    src={artwork}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                    variants={SYSTEM_ARTWORK_VARIANTS}
                    className="relative h-full w-full origin-bottom object-contain drop-shadow-[0_14px_18px_rgba(0,0,0,0.55)]"
                  />
                </div>
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/95 via-black/10 to-white/[0.025]" />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 flex min-h-[29%] flex-col items-center justify-end gap-1.5 p-[clamp(0.7rem,1.25vw,1rem)]">
                  <p className="line-clamp-2 text-[clamp(0.72rem,1vw,0.875rem)] font-black leading-tight text-white drop-shadow-md">
                    {definition.name}
                  </p>
                  <span className={`shrink-0 text-[10px] font-bold ${
                    gameCount > 0
                      ? 'text-accent'
                      : 'text-white/40'
                  }`}>
                    {t('retro.gamesCount', { count: gameCount })}
                  </span>
                </div>
              </motion.button>
            )
          })}
        </div>
      )}
    </section>
  )
}
