import { useEffect } from 'react'
import { moveFocus, type NavDirection } from '@renderer/lib/spatialNavigation'
import { triggerBack } from '@renderer/lib/backHandlerStack'
import { useNavigationStore, MAIN_VIEW_ORDER } from '@renderer/state/navigationStore'
import { useLibraryFilterStore } from '@renderer/state/libraryFilterStore'
import { useSettingsNavigationStore } from '@renderer/state/settingsNavigationStore'
import { useStoreNavigationStore } from '@renderer/state/storeNavigationStore'
import { usePreferencesStore } from '@renderer/state/preferencesStore'
import { LIBRARY_SEARCH_EVENT, STORE_SEARCH_EVENT } from '@renderer/lib/librarySearch'
import { playUiSound } from '@renderer/lib/uiAudio'

const STICK_DEADZONE = 0.5
const REPEAT_DELAY_MS = 420
const REPEAT_RATE_MS = 130
const CATEGORY_REPEAT_DELAY_MS = 220
const CATEGORY_REPEAT_RATE_MS = 170

// Standard gamepad mapping (Xbox/PlayStation layout under the W3C Gamepad API)
const BTN_A = 0
const BTN_B = 1
const BTN_Y = 3
const BTN_LB = 4
const BTN_RB = 5
const BTN_LT = 6
const BTN_RT = 7
const BTN_START = 9
const DPAD_UP = 12
const DPAD_DOWN = 13
const DPAD_LEFT = 14
const DPAD_RIGHT = 15

type DirectionState = Partial<Record<NavDirection, number>>

function confirmFocused(): void {
  const active = document.activeElement as HTMLElement | null
  if (!active?.hasAttribute('data-focusable')) return
  if (!active.hasAttribute('data-ui-sound-skip')) playUiSound('confirm')
  active.click()
}

function openViewSearch(): void {
  if (document.querySelector('[data-game-launch-splash="true"]')) {
    playUiSound('open')
    void window.api.game.revealLauncher()
    return
  }
  if (document.querySelector('[data-focus-scope="active"]')) return
  const mainView = useNavigationStore.getState().mainView
  if (mainView !== 'library' && mainView !== 'store') return
  playUiSound('open')
  window.dispatchEvent(
    new CustomEvent(mainView === 'library' ? LIBRARY_SEARCH_EVENT : STORE_SEARCH_EVENT)
  )
}

/** Cycles the top-level category tabs — bound to LB/RB (or Q/E on keyboard). */
function cycleMainView(step: 1 | -1): void {
  if (document.querySelector('[data-focus-scope="active"]')) return
  const { mainView, setMainView } = useNavigationStore.getState()
  const { showStoreTab } = usePreferencesStore.getState()
  const visibleViews = showStoreTab
    ? MAIN_VIEW_ORDER
    : MAIN_VIEW_ORDER.filter((view) => view !== 'store')
  const idx = visibleViews.indexOf(mainView)
  const next = visibleViews[(idx + step + visibleViews.length) % visibleViews.length]
  setMainView(next, step)
  playUiSound('switch')
}

/** Cycles the current view's secondary tabs â€” bound to LT/RT. */
function cycleSecondaryView(step: 1 | -1): void {
  if (document.querySelector('[data-focus-scope="active"]')) return
  const { mainView } = useNavigationStore.getState()
  if (mainView === 'library') useLibraryFilterStore.getState().cycleSource(step)
  else if (mainView === 'settings') useSettingsNavigationStore.getState().cyclePage(step)
  else if (mainView === 'store') useStoreNavigationStore.getState().cyclePage(step)
  else return
  playUiSound('switch')
}

function isPressed(button: GamepadButton | undefined): boolean {
  return Boolean(button?.pressed || (button?.value ?? 0) > 0.5)
}

/**
 * Global controller + keyboard navigation. Mount once at the app root — it walks
 * whatever `[data-focusable]` elements the currently rendered view exposes, so
 * individual views don't need to know about gamepads at all.
 */
export function useGamepadNavigation(): void {
  useEffect(() => {
    const heldSince: DirectionState = {}
    let rafId = 0

    function handleDirection(direction: NavDirection, now: number): void {
      const startedAt = heldSince[direction]
      if (startedAt === undefined) {
        heldSince[direction] = now
        if (moveFocus(direction)) playUiSound('navigate')
        return
      }
      const elapsed = now - startedAt
      if (elapsed < REPEAT_DELAY_MS) return
      const sinceRepeatWindow = (elapsed - REPEAT_DELAY_MS) % REPEAT_RATE_MS
      if (sinceRepeatWindow < 16 && moveFocus(direction)) playUiSound('navigate')
    }

    function releaseDirection(direction: NavDirection): void {
      delete heldSince[direction]
    }

    const prevButtons: Record<number, boolean> = {}
    const nextButtonRepeatAt: Record<number, number> = {}

    function handleCyclingButton(
      buttonIndex: number,
      pressed: boolean,
      now: number,
      action: () => void
    ): void {
      if (!pressed) {
        prevButtons[buttonIndex] = false
        delete nextButtonRepeatAt[buttonIndex]
        return
      }

      if (!prevButtons[buttonIndex]) {
        action()
        nextButtonRepeatAt[buttonIndex] = now + CATEGORY_REPEAT_DELAY_MS
      } else if (now >= (nextButtonRepeatAt[buttonIndex] ?? Infinity)) {
        action()
        nextButtonRepeatAt[buttonIndex] = now + CATEGORY_REPEAT_RATE_MS
      }
      prevButtons[buttonIndex] = true
    }

    function pollGamepads(now: number): void {
      const pads = navigator.getGamepads?.() ?? []
      for (const pad of pads) {
        if (!pad) continue

        const axisX = pad.axes[0] ?? 0
        const axisY = pad.axes[1] ?? 0

        const dpadUp = pad.buttons[DPAD_UP]?.pressed || axisY < -STICK_DEADZONE
        const dpadDown = pad.buttons[DPAD_DOWN]?.pressed || axisY > STICK_DEADZONE
        const dpadLeft = pad.buttons[DPAD_LEFT]?.pressed || axisX < -STICK_DEADZONE
        const dpadRight = pad.buttons[DPAD_RIGHT]?.pressed || axisX > STICK_DEADZONE

        dpadUp ? handleDirection('up', now) : releaseDirection('up')
        dpadDown ? handleDirection('down', now) : releaseDirection('down')
        dpadLeft ? handleDirection('left', now) : releaseDirection('left')
        dpadRight ? handleDirection('right', now) : releaseDirection('right')

        const aPressed = pad.buttons[BTN_A]?.pressed ?? false
        if (aPressed && !prevButtons[BTN_A]) confirmFocused()
        prevButtons[BTN_A] = aPressed

        const bPressed = pad.buttons[BTN_B]?.pressed ?? false
        if (bPressed && !prevButtons[BTN_B] && triggerBack()) playUiSound('back')
        prevButtons[BTN_B] = bPressed

        const yPressed = pad.buttons[BTN_Y]?.pressed ?? false
        if (yPressed && !prevButtons[BTN_Y]) openViewSearch()
        prevButtons[BTN_Y] = yPressed

        const lbPressed = pad.buttons[BTN_LB]?.pressed ?? false
        handleCyclingButton(BTN_LB, lbPressed, now, () => cycleMainView(-1))

        const rbPressed = pad.buttons[BTN_RB]?.pressed ?? false
        handleCyclingButton(BTN_RB, rbPressed, now, () => cycleMainView(1))

        const ltPressed = isPressed(pad.buttons[BTN_LT])
        handleCyclingButton(BTN_LT, ltPressed, now, () => cycleSecondaryView(-1))

        const rtPressed = isPressed(pad.buttons[BTN_RT])
        handleCyclingButton(BTN_RT, rtPressed, now, () => cycleSecondaryView(1))

        const startPressed = pad.buttons[BTN_START]?.pressed ?? false
        if (startPressed && !prevButtons[BTN_START]) {
          const active = document.activeElement as HTMLElement | null
          const gameId = active?.matches('[data-game-card="true"]')
            ? active.dataset.gameId
            : undefined
          if (gameId) {
            playUiSound('confirm')
            void window.api.game.launch(gameId).catch(() => playUiSound('error'))
          }
        }
        prevButtons[BTN_START] = startPressed
      }

      rafId = requestAnimationFrame(pollGamepads)
    }

    rafId = requestAnimationFrame(pollGamepads)

    function isEditingText(): boolean {
      const active = document.activeElement
      if (!(active instanceof HTMLElement)) return false
      return active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable
    }

    function handleKeyDown(e: KeyboardEvent): void {
      const editing = isEditingText()

      if (editing) {
        // Let text inputs keep native caret/selection behaviour; only Escape and
        // vertical moves (leave the field) are still handled by ORBIT's navigation.
        if (e.key === 'Escape') {
          e.preventDefault()
          if (triggerBack()) playUiSound('back')
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          if (moveFocus(e.key === 'ArrowUp' ? 'up' : 'down')) playUiSound('navigate')
        }
        return
      }

      const map: Record<string, NavDirection> = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right'
      }
      if (map[e.key]) {
        e.preventDefault()
        if (moveFocus(map[e.key])) playUiSound('navigate')
        return
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        confirmFocused()
        return
      }
      if (e.key === 'Escape' || e.key === 'Backspace') {
        e.preventDefault()
        if (triggerBack()) playUiSound('back')
        return
      }
      if (e.key === 'q' || e.key === 'Q') {
        e.preventDefault()
        cycleMainView(-1)
        return
      }
      if (e.key === 'e' || e.key === 'E') {
        e.preventDefault()
        cycleMainView(1)
        return
      }
      if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault()
        openViewSearch()
        return
      }
      if (e.key === '[') {
        e.preventDefault()
        cycleSecondaryView(-1)
        return
      }
      if (e.key === ']') {
        e.preventDefault()
        cycleSecondaryView(1)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])
}
