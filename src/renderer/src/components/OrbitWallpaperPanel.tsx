import { useState } from 'react'
import {
  CheckCircle2,
  CircleAlert,
  ImageIcon,
  Loader2,
  LockKeyhole,
  Monitor
} from 'lucide-react'
import type { OrbitWallpaperApplyResult, OrbitWallpaperApplyState } from '@shared/ipc'
import { useT } from '@renderer/i18n/useT'
import { FocusableButton } from './FocusableButton'
import orbitWallpaperUrl from '../../../../resources/wallpapers/orbit-horizon.png'

type ApplyPhase = 'idle' | 'applying' | 'success' | 'partial' | 'error' | 'unsupported'

interface Props {
  compact?: boolean
}

function phaseFromResult(result: OrbitWallpaperApplyResult): ApplyPhase {
  if (result.platform === 'unsupported') return 'unsupported'
  if (result.desktop === 'applied' && result.lockScreen === 'applied') return 'success'
  if (result.desktop === 'applied' || result.lockScreen === 'applied') return 'partial'
  return 'error'
}

export function OrbitWallpaperPanel({ compact = false }: Props): JSX.Element {
  const t = useT()
  const [phase, setPhase] = useState<ApplyPhase>('idle')
  const [result, setResult] = useState<OrbitWallpaperApplyResult | null>(null)

  const applyWallpaper = async (): Promise<void> => {
    if (phase === 'applying') return
    setPhase('applying')
    setResult(null)
    try {
      const next = await window.api.system.wallpaper.applyOrbit()
      setResult(next)
      setPhase(phaseFromResult(next))
    } catch {
      setPhase('error')
    }
  }

  const statusKey =
    phase === 'success'
      ? 'settings.wallpaper.applied'
      : phase === 'partial'
        ? 'settings.wallpaper.partial'
        : phase === 'error'
          ? 'settings.wallpaper.failed'
          : phase === 'unsupported'
            ? 'settings.wallpaper.unsupported'
            : null

  return (
    <div
      className={`grid overflow-hidden rounded-2xl border border-white/[0.08] bg-black/[0.28] ${
        compact
          ? 'grid-cols-1 md:grid-cols-[minmax(13rem,0.82fr)_1.18fr]'
          : 'grid-cols-1 lg:grid-cols-[minmax(20rem,0.9fr)_1.1fr]'
      }`}
    >
      <div className="relative min-h-44 overflow-hidden bg-[#06111f]">
        <img
          src={orbitWallpaperUrl}
          alt={t('settings.wallpaper.alt')}
          draggable={false}
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_42%,rgba(3,8,16,0.8)_100%)]" />
        <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-full border border-white/10 bg-black/50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-white/[0.72] backdrop-blur-md">
          <ImageIcon size={12} className="text-accent" />
          ORBIT HORIZON
        </div>
      </div>

      <div className={`flex flex-col justify-center ${compact ? 'p-4' : 'p-5 lg:p-6'}`}>
        <p className="max-w-2xl text-sm leading-relaxed text-muted">
          {t('settings.wallpaper.body')}
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <WallpaperTarget
            icon={<Monitor size={13} />}
            label={t('settings.wallpaper.desktop')}
            state={result?.desktop}
          />
          <WallpaperTarget
            icon={<LockKeyhole size={13} />}
            label={t('settings.wallpaper.lockScreen')}
            state={result?.lockScreen}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <FocusableButton
            type="button"
            disabled={phase === 'applying'}
            data-disabled={phase === 'applying' ? 'true' : undefined}
            onClick={() => void applyWallpaper()}
            className={`flex items-center gap-2 ${phase === 'applying' ? 'opacity-[0.55]' : ''}`}
          >
            {phase === 'applying' ? (
              <Loader2 size={15} className="animate-spin" />
            ) : phase === 'success' ? (
              <CheckCircle2 size={15} />
            ) : (
              <ImageIcon size={15} />
            )}
            {phase === 'applying'
              ? t('settings.wallpaper.applying')
              : phase === 'idle'
                ? t('settings.wallpaper.action')
                : t('settings.wallpaper.actionAgain')}
          </FocusableButton>

          <div className="min-h-5 flex-1" aria-live="polite">
            {statusKey && (
              <p
                className={`flex items-center gap-2 text-xs leading-relaxed ${
                  phase === 'success'
                    ? 'text-emerald-300'
                    : phase === 'partial'
                      ? 'text-amber-200'
                      : 'text-red-300'
                }`}
              >
                {phase === 'success' ? (
                  <CheckCircle2 size={14} className="shrink-0" />
                ) : (
                  <CircleAlert size={14} className="shrink-0" />
                )}
                {t(statusKey)}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function WallpaperTarget({
  icon,
  label,
  state
}: {
  icon: React.ReactNode
  label: string
  state?: OrbitWallpaperApplyState
}): JSX.Element {
  const t = useT()
  const stateLabel =
    state === 'applied'
      ? t('settings.wallpaper.targetApplied')
      : state === 'failed'
        ? t('settings.wallpaper.targetFailed')
        : state === 'unsupported'
          ? t('settings.wallpaper.targetUnsupported')
          : null

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold ${
        state === 'applied'
          ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200'
          : state === 'failed' || state === 'unsupported'
            ? 'border-amber-300/20 bg-amber-300/[0.08] text-amber-100'
            : 'border-white/10 bg-white/[0.045] text-white/[0.62]'
      }`}
    >
      {icon}
      {label}
      {stateLabel && <span className="text-[9px] uppercase tracking-wider opacity-70">{stateLabel}</span>}
    </span>
  )
}
