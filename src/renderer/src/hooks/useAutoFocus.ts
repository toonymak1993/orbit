import { useEffect, useRef } from 'react'
import { focusFirstIn } from '@renderer/lib/spatialNavigation'

/** Focuses the first `[data-focusable]` inside the returned ref as soon as the view mounts. */
export function useAutoFocus<T extends HTMLElement>(): React.RefObject<T> {
  const ref = useRef<T>(null)

  useEffect(() => {
    if (ref.current) focusFirstIn(ref.current)
  }, [])

  return ref
}
