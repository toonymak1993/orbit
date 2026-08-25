import { useEffect, useState } from 'react'
import type { ImageOrientation, ImageUpdate, ResolvedImage } from '@shared/ipc'

interface Props {
  gameId: string
  name: string
  orientation: ImageOrientation
  className?: string
  previewUrl?: string
  fit?: 'auto' | 'cover'
}

const ACCENT_GRADIENTS = [
  'from-[#3fd0ff] to-[#8b5cf6]',
  'from-[#a78bfa] to-[#f472b6]',
  'from-[#34d399] to-[#22d3ee]',
  'from-[#fbbf24] to-[#fb7185]',
  'from-[#fb7185] to-[#f59e0b]'
]

const resolvedCache = new Map<string, ResolvedImage | null>()
const listeners = new Map<string, Set<(image: ResolvedImage | null) => void>>()
const inFlight = new Map<string, Promise<ResolvedImage | null>>()
let isListening = false

function imageKey(gameId: string, orientation: ImageOrientation): string {
  return `${gameId}:${orientation}`
}

function publish(key: string, image: ResolvedImage | null): void {
  resolvedCache.set(key, image)
  for (const listener of listeners.get(key) ?? []) listener(image)
}

function ensureArtworkListener(): void {
  if (isListening) return
  isListening = true
  window.api.image.onUpdated((update: ImageUpdate) => {
    publish(imageKey(update.gameId, update.orientation), update.image)
  })
}

function requestImage(gameId: string, orientation: ImageOrientation): Promise<ResolvedImage | null> {
  const key = imageKey(gameId, orientation)
  const current = inFlight.get(key)
  if (current) return current
  const request = window.api.image
    .resolve(gameId, orientation)
    .then((image) => {
      publish(key, image)
      return image
    })
    .catch(() => {
      // An IPC/startup failure is not a durable "missing artwork" result. Show
      // the local fallback now, but let a later mount retry the resolution.
      resolvedCache.delete(key)
      for (const listener of listeners.get(key) ?? []) listener(null)
      return null
    })
    .finally(() => inFlight.delete(key))
  inFlight.set(key, request)
  return request
}

function gradientFor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return ACCENT_GRADIENTS[hash % ACCENT_GRADIENTS.length]
}

/**
 * One renderer-wide listener receives artwork deltas. Components render the
 * current disk-cached result immediately and update only when its exact game +
 * slot receives a newer revision.
 */
export function GameImage({
  gameId,
  name,
  orientation,
  className = '',
  previewUrl,
  fit = 'auto'
}: Props): JSX.Element {
  const key = imageKey(gameId, orientation)
  const [resolved, setResolved] = useState<ResolvedImage | null | undefined>(() => resolvedCache.get(key))
  const [previewFailed, setPreviewFailed] = useState(false)
  const [failedRevision, setFailedRevision] = useState<number | null>(null)

  useEffect(() => {
    ensureArtworkListener()
    setResolved(resolvedCache.get(key))
    let subscriptions = listeners.get(key)
    if (!subscriptions) {
      subscriptions = new Set()
      listeners.set(key, subscriptions)
    }
    subscriptions.add(setResolved)
    if (!resolvedCache.has(key)) void requestImage(gameId, orientation)
    return () => {
      subscriptions?.delete(setResolved)
      if (subscriptions?.size === 0) listeners.delete(key)
    }
  }, [gameId, key, orientation])

  useEffect(() => setPreviewFailed(false), [previewUrl])

  const displayed = resolved?.revision === failedRevision ? null : resolved
  const reportResolvedFailure = (): void => {
    if (!resolved) return
    setFailedRevision(resolved.revision)
    void window.api.image
      .reportFailure(gameId, orientation, resolved.revision)
      .catch(() => undefined)
  }

  if ((displayed === undefined || displayed === null) && previewUrl && !previewFailed) {
    return (
      <img
        src={previewUrl}
        alt=""
        draggable={false}
        loading={orientation === 'horizontal' ? 'eager' : 'lazy'}
        decoding="async"
        onError={() => setPreviewFailed(true)}
        className={className}
      />
    )
  }

  if (displayed === undefined) {
    return <div className={`animate-pulse bg-white/5 ${className}`} />
  }

  if (displayed === null) {
    return (
      <div
        className={`flex items-center justify-center bg-gradient-to-br text-lg font-bold text-black/70 ${gradientFor(name)} ${className}`}
      >
        {name.charAt(0).toUpperCase()}
      </div>
    )
  }

  if (displayed.contain && fit !== 'cover') {
    return (
      <div
        className={`flex items-center justify-center bg-gradient-to-br ${orientation === 'icon' ? 'p-2' : 'p-6'} ${gradientFor(name)} ${className}`}
      >
        <img
          key={displayed.revision}
          src={displayed.url}
          alt=""
          draggable={false}
          loading={orientation === 'horizontal' ? 'eager' : 'lazy'}
          decoding="async"
          onError={reportResolvedFailure}
          className={`${orientation === 'icon' ? 'max-h-[88%] max-w-[88%]' : 'max-h-[45%] max-w-[70%]'} object-contain drop-shadow-lg`}
        />
      </div>
    )
  }

  return (
    <img
      key={displayed.revision}
      src={displayed.url}
      alt=""
      draggable={false}
      loading={orientation === 'horizontal' ? 'eager' : 'lazy'}
      decoding="async"
      onError={reportResolvedFailure}
      className={className}
    />
  )
}
