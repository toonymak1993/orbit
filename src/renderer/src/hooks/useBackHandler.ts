import { useEffect, useLayoutEffect, useRef } from 'react'
import { pushBackHandler } from '@renderer/lib/backHandlerStack'

/** Registers `handler` for the B-button/Escape while the owning view is mounted. */
export function useBackHandler(handler: () => void): void {
  const handlerRef = useRef(handler)

  useLayoutEffect(() => {
    handlerRef.current = handler
  }, [handler])

  // Registration order represents UI depth. Keep the stack entry stable across
  // render-time data deltas so a parent view can never jump above an open panel.
  useEffect(() => pushBackHandler(() => handlerRef.current()), [])
}
