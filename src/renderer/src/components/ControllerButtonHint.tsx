import type { HTMLAttributes } from 'react'
import type { ControllerButtonId } from '@renderer/lib/controllerProfile'
import { useControllerButtonLabels } from '@renderer/state/controllerStore'

interface Props extends HTMLAttributes<HTMLSpanElement> {
  button: ControllerButtonId
}

export function ControllerButtonHint({ button, ...props }: Props): JSX.Element {
  const labels = useControllerButtonLabels()

  return (
    <span {...props} aria-hidden="true" data-controller-button={button}>
      {labels[button]}
    </span>
  )
}
