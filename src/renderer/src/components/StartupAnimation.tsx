import type { StartupAnimationMode } from '@shared/ipc'

interface StartupAnimationProps {
  phase: 'playing' | 'leaving'
  mode: Exclude<StartupAnimationMode, 'off'>
  customVideoUrl: string
  onCustomVideoEnded: () => void
  onCustomVideoError: () => void
}

export function StartupAnimation({
  phase,
  mode,
  customVideoUrl,
  onCustomVideoEnded,
  onCustomVideoError
}: StartupAnimationProps): JSX.Element {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  return (
    <div
      className="orbit-startup"
      data-phase={phase}
      role="img"
      aria-label="ORBIT"
    >
      {mode === 'custom' && (
        <>
          <video
            className="orbit-startup__custom-video"
            src={customVideoUrl}
            autoPlay
            muted
            playsInline
            preload="auto"
            disablePictureInPicture
            onEnded={onCustomVideoEnded}
            onError={onCustomVideoError}
            aria-hidden="true"
          />
          <div className="orbit-startup__custom-veil" aria-hidden="true" />
        </>
      )}

      {mode === 'orbit' && (
        <>
      <div className="orbit-startup__stars" aria-hidden="true" />

      <div className="orbit-startup__lockup" aria-hidden="true">
        <svg
          className="orbit-startup__emblem"
          viewBox="0 0 520 280"
          focusable="false"
        >
          <defs>
            <linearGradient id="startup-orbit-gradient" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="rgb(var(--color-accent))" stopOpacity="0.14" />
              <stop offset="0.58" stopColor="rgb(var(--color-accent))" stopOpacity="0.9" />
              <stop offset="1" stopColor="rgb(var(--color-accent-2))" stopOpacity="0.72" />
            </linearGradient>
            <radialGradient id="startup-core-gradient">
              <stop offset="0" stopColor="white" />
              <stop offset="0.32" stopColor="rgb(var(--color-accent))" />
              <stop offset="1" stopColor="rgb(var(--color-accent-2))" />
            </radialGradient>
            <filter id="startup-glow" x="-200%" y="-200%" width="500%" height="500%">
              <feGaussianBlur stdDeviation="5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <path
            className="orbit-startup__trajectory"
            pathLength="1"
            d="M 26 210 C 132 54 405 52 482 126 C 535 177 393 246 251 207 C 132 174 145 111 268 94 C 350 83 407 112 374 145"
          />
          <ellipse
            className="orbit-startup__ring orbit-startup__ring--outer"
            cx="260"
            cy="141"
            rx="119"
            ry="48"
            pathLength="1"
            transform="rotate(-12 260 141)"
          />
          <ellipse
            className="orbit-startup__ring orbit-startup__ring--inner"
            cx="260"
            cy="141"
            rx="53"
            ry="53"
            pathLength="1"
          />
          <path className="orbit-startup__axis" d="M 216 68 L 304 214" />

          <g className="orbit-startup__comet" filter="url(#startup-glow)">
            {!reducedMotion && (
              <animateMotion
                dur="840ms"
                begin="60ms"
                fill="freeze"
                path="M 26 210 C 132 54 405 52 482 126 C 535 177 393 246 251 207 C 132 174 145 111 268 94 C 350 83 407 112 374 145"
              />
            )}
            <circle className="orbit-startup__comet-halo" r="10" />
            <circle className="orbit-startup__comet-head" r="3.5" />
          </g>

          <circle
            className="orbit-startup__satellite"
            cx="374"
            cy="145"
            r="4"
            filter="url(#startup-glow)"
          />
          <circle
            className="orbit-startup__core-halo"
            cx="260"
            cy="141"
            r="30"
          />
          <circle
            className="orbit-startup__core"
            cx="260"
            cy="141"
            r="9"
            fill="url(#startup-core-gradient)"
            filter="url(#startup-glow)"
          />
        </svg>

        <div className="orbit-startup__wordmark">
          <span>ORBIT</span>
          <i />
        </div>
      </div>
        </>
      )}
    </div>
  )
}
