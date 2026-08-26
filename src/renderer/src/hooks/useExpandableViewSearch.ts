import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject
} from 'react'
import { pushBackHandler } from '@renderer/lib/backHandlerStack'
import { focusElement } from '@renderer/lib/spatialNavigation'

interface ExpandableViewSearchOptions<T extends HTMLElement> {
  active: boolean
  containerRef: RefObject<T>
  eventName: string
  onCollapse: () => void
}

interface ExpandableViewSearch {
  expanded: boolean
  inputRef: RefObject<HTMLInputElement>
  expand: () => void
  collapse: () => void
}

/**
 * Keeps a view search outside the spatial focus graph until the dedicated
 * controller shortcut opens it, then restores the previous focus on Back.
 */
export function useExpandableViewSearch<T extends HTMLElement>({
  active,
  containerRef,
  eventName,
  onCollapse
}: ExpandableViewSearchOptions<T>): ExpandableViewSearch {
  const [expanded, setExpanded] = useState(false)
  const expandedRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const restoreFrameRef = useRef<number>()
  const onCollapseRef = useRef(onCollapse)

  useLayoutEffect(() => {
    onCollapseRef.current = onCollapse
  }, [onCollapse])

  const focusInput = useCallback((): void => {
    const input = inputRef.current
    if (!input?.isConnected) return
    focusElement(input)
    input.click()
    input.select()
  }, [])

  const expand = useCallback((): void => {
    if (!active) return
    if (expandedRef.current) {
      focusInput()
      return
    }

    const current = document.activeElement
    returnFocusRef.current =
      current instanceof HTMLElement && current.hasAttribute('data-focusable') ? current : null
    expandedRef.current = true
    setExpanded(true)
  }, [active, focusInput])

  const collapse = useCallback((): void => {
    if (!expandedRef.current) return
    expandedRef.current = false
    setExpanded(false)
    onCollapseRef.current()

    if (restoreFrameRef.current !== undefined) {
      cancelAnimationFrame(restoreFrameRef.current)
    }
    restoreFrameRef.current = requestAnimationFrame(() => {
      restoreFrameRef.current = undefined
      const container = containerRef.current
      const previous = returnFocusRef.current
      const canRestorePrevious = Boolean(
        previous?.isConnected &&
          previous.offsetParent !== null &&
          !previous.closest('[inert]')
      )
      const fallback =
        container?.querySelector<HTMLElement>('[data-search-focus-fallback="true"]') ??
        container?.querySelector<HTMLElement>(
          '[data-focusable]:not([data-disabled="true"])'
        ) ??
        null
      focusElement(canRestorePrevious ? previous : fallback)
      returnFocusRef.current = null
    })
  }, [containerRef])

  useEffect(() => {
    if (!active) return
    window.addEventListener(eventName, expand)
    return () => window.removeEventListener(eventName, expand)
  }, [active, eventName, expand])

  useEffect(() => {
    if (!active || !expanded) return
    const frame = requestAnimationFrame(focusInput)
    return () => cancelAnimationFrame(frame)
  }, [active, expanded, focusInput])

  useEffect(() => {
    if (!active || !expanded) return
    return pushBackHandler(collapse)
  }, [active, collapse, expanded])

  useEffect(
    () => () => {
      if (restoreFrameRef.current !== undefined) {
        cancelAnimationFrame(restoreFrameRef.current)
      }
    },
    []
  )

  return { expanded, inputRef, expand, collapse }
}
