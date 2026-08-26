import { useEffect, useState } from 'react'
import {
  Flame,
  Gamepad2,
  ImagePlus,
  Rocket,
  Sparkles,
  Zap,
  type LucideIcon
} from 'lucide-react'
import type { ProfileAvatarId } from '@shared/ipc'
import { useT } from '@renderer/i18n/useT'
import type { TranslationKey } from '@renderer/i18n/translations'

type LocalAvatarId = Exclude<ProfileAvatarId, 'steam'>

interface AvatarVisual {
  icon?: LucideIcon
  gradient: string
  decoration: string
}

const AVATAR_VISUALS: Record<LocalAvatarId, AvatarVisual> = {
  orbit: {
    gradient: 'from-accent to-accent-2',
    decoration: 'after:bg-white/35'
  },
  nova: {
    icon: Sparkles,
    gradient: 'from-[#7c3aed] via-[#c026d3] to-[#fb7185]',
    decoration: 'after:bg-fuchsia-200/45'
  },
  pulse: {
    icon: Zap,
    gradient: 'from-[#0891b2] via-[#22d3ee] to-[#a3e635]',
    decoration: 'after:bg-cyan-100/55'
  },
  drift: {
    icon: Rocket,
    gradient: 'from-[#1d4ed8] via-[#6366f1] to-[#a78bfa]',
    decoration: 'after:bg-indigo-100/45'
  },
  ember: {
    icon: Flame,
    gradient: 'from-[#b91c1c] via-[#f97316] to-[#facc15]',
    decoration: 'after:bg-amber-100/55'
  },
  pixel: {
    icon: Gamepad2,
    gradient: 'from-[#0f172a] via-[#475569] to-[#22d3ee]',
    decoration: 'after:bg-sky-100/40'
  },
  custom: {
    icon: ImagePlus,
    gradient: 'from-[#334155] via-[#475569] to-[#64748b]',
    decoration: 'after:bg-white/30'
  }
}

export const PROFILE_AVATAR_OPTIONS: Array<{
  id: ProfileAvatarId
  labelKey: TranslationKey
}> = [
  { id: 'orbit', labelKey: 'settings.avatar.orbit' },
  { id: 'nova', labelKey: 'settings.avatar.nova' },
  { id: 'pulse', labelKey: 'settings.avatar.pulse' },
  { id: 'drift', labelKey: 'settings.avatar.drift' },
  { id: 'ember', labelKey: 'settings.avatar.ember' },
  { id: 'pixel', labelKey: 'settings.avatar.pixel' },
  { id: 'custom', labelKey: 'settings.avatar.custom' },
  { id: 'steam', labelKey: 'settings.avatar.steam' }
]

export function trustedSteamAvatarUrl(value?: string): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    if (url.protocol !== 'https:') return undefined
    if (host !== 'steamstatic.com' && !host.endsWith('.steamstatic.com')) return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

function trustedCustomAvatarUrl(value?: string): string | undefined {
  if (!value || !/^orbit-image:\/\/profile-avatar-[a-f0-9]{16}\.png$/.test(value)) {
    return undefined
  }
  return value
}

export function ProfileAvatar({
  avatarId,
  steamAvatarUrl,
  customAvatarUrl,
  label,
  className = 'h-10 w-10'
}: {
  avatarId: ProfileAvatarId
  steamAvatarUrl?: string
  customAvatarUrl?: string
  label?: string
  className?: string
}): JSX.Element {
  const trustedUrl = trustedSteamAvatarUrl(steamAvatarUrl)
  const trustedCustomUrl = trustedCustomAvatarUrl(customAvatarUrl)
  const [imageFailed, setImageFailed] = useState(false)

  useEffect(() => setImageFailed(false), [trustedCustomUrl, trustedUrl])

  const imageUrl =
    avatarId === 'steam' ? trustedUrl : avatarId === 'custom' ? trustedCustomUrl : undefined

  if (imageUrl && !imageFailed) {
    return (
      <span
        role={label ? 'img' : undefined}
        aria-label={label}
        className={`relative inline-flex shrink-0 overflow-hidden rounded-[32%] border border-white/25 bg-black/40 shadow-[0_8px_22px_rgba(0,0,0,0.32)] ${className}`}
      >
        <img
          src={imageUrl}
          alt=""
          draggable={false}
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
          className="h-full w-full object-cover"
        />
        <span className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/12" />
      </span>
    )
  }

  const fallbackId: LocalAvatarId = avatarId === 'steam' ? 'orbit' : avatarId
  const visual = AVATAR_VISUALS[fallbackId]
  const Icon = visual.icon

  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[32%] border border-white/25 bg-gradient-to-br text-white shadow-[0_8px_22px_rgba(0,0,0,0.32)] after:absolute after:right-[12%] after:top-[10%] after:h-[28%] after:w-[28%] after:rounded-full after:blur-[1px] ${visual.gradient} ${visual.decoration} ${className}`}
    >
      <span className="absolute inset-[8%] rounded-[27%] border border-white/15 bg-black/10" />
      {Icon ? (
        <Icon size={20} strokeWidth={2.35} className="relative z-10 drop-shadow-md" />
      ) : (
        <span className="relative z-10 text-[0.85em] font-black text-black/90 drop-shadow-sm">O</span>
      )}
    </span>
  )
}

export function ProfileAvatarPicker({
  selected,
  steamAvatarUrl,
  customAvatarUrl,
  onChange,
  onSelectCustom,
  compact = false,
  primary = false
}: {
  selected: ProfileAvatarId
  steamAvatarUrl?: string
  customAvatarUrl?: string
  onChange: (avatar: ProfileAvatarId) => void
  onSelectCustom: () => Promise<boolean>
  compact?: boolean
  primary?: boolean
}): JSX.Element {
  const t = useT()
  const steamAvailable = Boolean(trustedSteamAvatarUrl(steamAvatarUrl))
  const customAvailable = Boolean(trustedCustomAvatarUrl(customAvatarUrl))
  const [customState, setCustomState] = useState<'idle' | 'selecting' | 'error'>('idle')

  return (
    <div>
      <p className={`${compact ? 'mb-2' : 'mb-3'} text-xs leading-relaxed text-muted`}>
        {t('settings.avatar.body')}
        {!steamAvailable && (
          <span className="ml-1 text-white/35">{t('settings.avatar.steamUnavailable')}</span>
        )}
      </p>
      <div className={`grid grid-cols-4 ${compact ? 'gap-2 sm:grid-cols-8' : 'gap-3 sm:grid-cols-8'}`}>
        {PROFILE_AVATAR_OPTIONS.map((option, index) => {
          const active = selected === option.id
          const disabled =
            (option.id === 'steam' && !steamAvailable) ||
            (option.id === 'custom' && customState === 'selecting')
          const label = t(option.labelKey)
          const title =
            option.id === 'steam' && !steamAvailable
              ? t('settings.avatar.steamUnavailable')
              : option.id === 'custom'
                ? customState === 'selecting'
                  ? t('settings.avatar.customSelecting')
                  : customAvailable && active
                    ? t('settings.avatar.customReplace')
                    : customAvailable
                      ? label
                      : t('settings.avatar.customChoose')
                : label
          return (
            <button
              key={option.id}
              data-focusable={disabled ? undefined : true}
              data-onboarding-primary={primary && index === 0 ? true : undefined}
              data-disabled={disabled ? 'true' : undefined}
              type="button"
              disabled={disabled}
              title={title}
              aria-label={label}
              aria-pressed={active}
              onClick={() => {
                if (option.id !== 'custom') {
                  onChange(option.id)
                  return
                }
                if (customAvailable && !active) {
                  onChange('custom')
                  return
                }
                setCustomState('selecting')
                void onSelectCustom()
                  .then(() => setCustomState('idle'))
                  .catch(() => setCustomState('error'))
              }}
              className={`group flex min-w-0 flex-col items-center rounded-xl border transition-[border-color,background-color,transform,opacity] ${
                compact ? 'gap-1 p-1.5' : 'gap-2 p-2.5'
              } ${
                active
                  ? 'border-accent/70 bg-accent/12'
                  : 'border-white/[0.07] bg-white/[0.025] hover:bg-white/[0.06]'
              } ${
                disabled
                  ? 'cursor-not-allowed opacity-30'
                  : 'data-[focused=true]:border-accent data-[focused=true]:bg-white/[0.08]'
              }`}
            >
              <span
                className={`rounded-[34%] transition-shadow ${
                  active ? 'shadow-[0_0_0_3px_rgb(var(--color-accent)/0.35)]' : ''
                }`}
              >
                <ProfileAvatar
                  avatarId={option.id}
                  steamAvatarUrl={steamAvatarUrl}
                  customAvatarUrl={customAvatarUrl}
                  className={compact ? 'h-10 w-10 text-base' : 'h-12 w-12 text-lg'}
                />
              </span>
              <span
                className={`w-full truncate text-center font-semibold ${
                  compact ? 'text-[9px]' : 'text-[10px]'
                } ${active ? 'text-white' : 'text-white/50'}`}
              >
                {label}
              </span>
            </button>
          )
        })}
      </div>
      {customState === 'error' && (
        <p role="alert" className="mt-2 text-xs text-red-300">
          {t('settings.avatar.customError')}
        </p>
      )}
      {customState !== 'error' && selected === 'custom' && customAvailable && (
        <p className="mt-2 text-xs text-white/35">
          {t('settings.avatar.customReplaceHint')}
        </p>
      )}
    </div>
  )
}
