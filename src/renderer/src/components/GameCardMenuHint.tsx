import { useControllerStore } from '@renderer/state/controllerStore'
import xboxMenuIcon from '@renderer/assets/icons/xbox-menu.png'

interface Props {
  className?: string
  size?: 'compact' | 'default' | 'large'
}

export function GameCardMenuHint({
  className = '',
  size = 'default'
}: Props): JSX.Element {
  const controllerFamily = useControllerStore((state) => state.family)
  const sizeClass =
    size === 'compact' ? 'h-7 w-7' : size === 'large' ? 'h-9 w-9' : 'h-8 w-8'

  return (
    <span
      aria-hidden="true"
      data-card-menu-controller={controllerFamily}
      className={`pointer-events-none inline-flex shrink-0 items-center justify-center rounded-full shadow-lg ${sizeClass} ${className}`}
    >
      {controllerFamily === 'xbox' ? (
        <img src={xboxMenuIcon} alt="" className="block h-full w-full" />
      ) : (
        <span className="flex h-full w-full items-center justify-center rounded-full bg-[#7d8992] shadow-[inset_0_1px_1px_rgba(255,255,255,0.2)]">
          <span className="flex h-[19px] w-[12px] flex-col items-center justify-center gap-[2px] rounded-[5px] border-[1.5px] border-white/90 px-[2px]">
            <span className="h-[1.5px] w-full rounded-full bg-white/90" />
            <span className="h-[1.5px] w-full rounded-full bg-white/90" />
            <span className="h-[1.5px] w-full rounded-full bg-white/90" />
          </span>
        </span>
      )}
    </span>
  )
}
