import type { GameProvider } from '@shared/ipc'
import customIcon from '@renderer/assets/library-icons/custom.png'
import eaIcon from '@renderer/assets/library-icons/ea.png'
import epicIcon from '@renderer/assets/library-icons/epic.png'
import gogIcon from '@renderer/assets/library-icons/gog.png'
import playStationIcon from '@renderer/assets/library-icons/playstation.png'
import retroIcon from '@renderer/assets/library-icons/retro.png'
import steamIcon from '@renderer/assets/library-icons/steam.png'
import ubisoftIcon from '@renderer/assets/library-icons/ubisoft.png'
import xboxIcon from '@renderer/assets/library-icons/xbox.png'

const PROVIDER_ICONS = {
  steam: steamIcon,
  epic: epicIcon,
  gog: gogIcon,
  xbox: xboxIcon,
  playstation: playStationIcon,
  retro: retroIcon,
  ea: eaIcon,
  ubisoft: ubisoftIcon,
  local: customIcon
} satisfies Record<GameProvider, string>

interface Props {
  provider: GameProvider
  className?: string
  size?: 'compact' | 'default'
}

export function LibraryProviderBadge({
  provider,
  className = '',
  size = 'default'
}: Props): JSX.Element {
  return (
    <span
      aria-hidden="true"
      data-size={size}
      className={`library-provider-badge pointer-events-none ${className}`}
    >
      <img src={PROVIDER_ICONS[provider]} alt="" draggable={false} decoding="async" />
    </span>
  )
}
