import type { CSSProperties } from 'react'

export type HomeCardReflectionEdge = 'left' | 'right' | 'self'

export interface HomeCardReflectionState {
  sourceIndex: number
  distance: number
  edge: HomeCardReflectionEdge
  strength: number
  reach: number
}

const HOME_REFLECTION_RANGE = 6

export function resolveHomeCardReflection(
  cardIndex: number,
  sourceIndex: number
): HomeCardReflectionState | null {
  if (sourceIndex < 0) return null

  const offset = cardIndex - sourceIndex
  const distance = Math.abs(offset)
  if (distance > HOME_REFLECTION_RANGE) return null
  const falloff = Math.pow(0.55, Math.max(0, distance - 1))

  return {
    sourceIndex,
    distance,
    edge: offset === 0 ? 'self' : offset < 0 ? 'right' : 'left',
    strength: distance === 0 ? 0 : 0.62 * falloff,
    reach: Math.max(18, 54 * Math.pow(0.8, Math.max(0, distance - 1)))
  }
}

export function HomeCardReflection({
  reflection
}: {
  reflection: HomeCardReflectionState
}): JSX.Element {
  if (reflection.edge === 'self') {
    return (
      <span
        aria-hidden="true"
        className="game-card-shine"
        data-reflection-distance={reflection.distance}
        data-reflection-edge={reflection.edge}
      />
    )
  }

  return (
    <span
      aria-hidden="true"
      className="home-card-reflection"
      data-reflection-distance={reflection.distance}
      data-reflection-edge={reflection.edge}
      style={
        {
          '--reflection-opacity': reflection.strength,
          '--reflection-edge-reach': `${reflection.reach}%`
        } as CSSProperties
      }
    />
  )
}
