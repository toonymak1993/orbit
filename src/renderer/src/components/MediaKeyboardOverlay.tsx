import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Gamepad2, Keyboard } from 'lucide-react'
import type {
  MediaKeyboardOpenPayload,
  MediaOverlayHintPayload,
  MediaKeyboardUpdatePayload
} from '@shared/ipc'
import { GamepadKeyboard } from '@renderer/components/GamepadKeyboard'
import {
  dispatchGamepadKeyboardShortcut,
  GAMEPAD_KEYBOARD_CLOSE_EVENT,
  showGamepadKeyboardFor
} from '@renderer/lib/gamepadKeyboard'
import { moveFocus, type NavDirection } from '@renderer/lib/spatialNavigation'
import { triggerBack } from '@renderer/lib/backHandlerStack'
import { usePreferencesStore } from '@renderer/state/preferencesStore'

function currentUpdate(
  input: HTMLInputElement,
  requestId: string
): MediaKeyboardUpdatePayload {
  const fallback = input.value.length
  return {
    requestId,
    value: input.value,
    selectionStart: input.selectionStart ?? fallback,
    selectionEnd: input.selectionEnd ?? fallback
  }
}

export function MediaKeyboardOverlay(): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const requestRef = useRef<MediaKeyboardOpenPayload | null>(null)
  const completingRef = useRef(false)
  const [hint, setHint] = useState<MediaOverlayHintPayload | null>(null)
  const hydratePreferences = usePreferencesStore((state) => state.hydrate)

  useEffect(() => {
    document.documentElement.dataset.orbitMediaKeyboard = 'true'
    return () => {
      delete document.documentElement.dataset.orbitMediaKeyboard
    }
  }, [])

  useEffect(() => {
    void hydratePreferences()
  }, [hydratePreferences])

  useEffect(() => {
    const disposeOpen = window.api.mediaKeyboard.onOpen((payload) => {
      const input = inputRef.current
      if (!input) return
      setHint(null)
      requestRef.current = payload
      completingRef.current = false
      input.type = payload.inputType
      input.value = payload.value
      input.maxLength = payload.maxLength && payload.maxLength > 0 ? payload.maxLength : -1
      input.setAttribute('aria-label', payload.label || 'Media')
      input.setSelectionRange(payload.selectionStart, payload.selectionEnd)
      input.focus({ preventScroll: true })
      requestAnimationFrame(() => showGamepadKeyboardFor(input))
    })
    const disposeShortcut = window.api.mediaKeyboard.onShortcut((shortcut) => {
      dispatchGamepadKeyboardShortcut(shortcut)
    })
    const disposeHintOpen = window.api.mediaKeyboard.onHintOpen((payload) => setHint(payload))
    const disposeHintDismiss = window.api.mediaKeyboard.onHintDismiss((hintId) => {
      setHint((current) => (current?.id === hintId ? null : current))
    })
    const handleKeyboardClosed = (event: Event): void => {
      if ((event as CustomEvent<Element>).detail !== inputRef.current) return
      const request = requestRef.current
      requestRef.current = null
      if (request && !completingRef.current) window.api.mediaKeyboard.close(request.requestId)
      completingRef.current = false
    }
    window.addEventListener(GAMEPAD_KEYBOARD_CLOSE_EVENT, handleKeyboardClosed)
    return () => {
      disposeOpen()
      disposeShortcut()
      disposeHintOpen()
      disposeHintDismiss()
      window.removeEventListener(GAMEPAD_KEYBOARD_CLOSE_EVENT, handleKeyboardClosed)
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      // The keyboard's completion action dispatches Enter on the proxy input.
      // Its React handler owns that event; handling it again here would click
      // the focused Done key a second time.
      if (event.target === inputRef.current && event.key === 'Enter') return
      const direction = (
        {
          ArrowUp: 'up',
          ArrowDown: 'down',
          ArrowLeft: 'left',
          ArrowRight: 'right'
        } as Record<string, NavDirection>
      )[event.key]
      if (direction) {
        event.preventDefault()
        moveFocus(direction)
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        ;(document.activeElement as HTMLElement | null)?.click()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        triggerBack()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <div className="h-screen w-screen overflow-hidden bg-transparent">
      <input
        ref={inputRef}
        className="pointer-events-none fixed left-0 top-0 h-px w-px opacity-0"
        onInput={(event) => {
          const request = requestRef.current
          if (request) window.api.mediaKeyboard.update(currentUpdate(event.currentTarget, request.requestId))
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          const request = requestRef.current
          if (!request) return
          event.preventDefault()
          completingRef.current = true
          window.api.mediaKeyboard.complete(currentUpdate(event.currentTarget, request.requestId))
        }}
      />
      <AnimatePresence>
        {hint && (
          <motion.aside
            key={hint.id}
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: -22, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -14, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 340, damping: 31, mass: 0.82 }}
            className="pointer-events-none fixed left-1/2 top-[clamp(2rem,6vh,5rem)] z-[130] flex w-[min(42rem,calc(100vw-3rem))] -translate-x-1/2 items-center gap-4 rounded-[var(--radius-card)] border border-white/15 bg-[rgb(var(--color-surface)/0.94)] px-5 py-4 text-left shadow-[0_24px_80px_rgba(0,0,0,0.58)] backdrop-blur-2xl"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-accent/25 bg-accent/12 text-accent">
              <Keyboard size={24} />
            </span>
            <span className="min-w-0 flex-1">
              <strong className="block text-sm font-black tracking-tight text-white">
                {hint.title}
              </strong>
              <span className="mt-1 block text-xs font-medium leading-relaxed text-white/62">
                {hint.message}
              </span>
            </span>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.045] text-white/45">
              <Gamepad2 size={20} />
            </span>
          </motion.aside>
        )}
      </AnimatePresence>
      <GamepadKeyboard />
    </div>
  )
}
