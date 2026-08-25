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

type DirectionRepeatState = Partial<Record<NavDirection, number>>

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
    const nextDirectionRepeatAt: DirectionRepeatState = {}
    let rafId = 0

    function handleDirection(direction: NavDirection, now: number): void {
      const repeatAt = nextDirectionRepeatAt[direction]
      if (repeatAt === undefined) {
        nextDirectionRepeatAt[direction] = now + REPEAT_DELAY_MS
        if (moveFocus(direction)) playUiSound('navigate')
        return
      }
      if (now < repeatAt) return

      // Schedule from the current frame so a high-refresh display or a stalled
      // renderer can never emit several navigation steps for one repeat slot.
      nextDirectionRepeatAt[direction] = now + REPEAT_RATE_MS
      if (moveFocus(direction)) playUiSound('navigate')
    }

    function releaseDirection(direction: NavDirection): void {
      delete nextDirectionRepeatAt[direction]
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
      const pads = Array.from(navigator.getGamepads?.() ?? []).filter(
        (pad): pad is Gamepad => pad !== null
      )
      const anyButtonPressed = (buttonIndex: number): boolean =>
        pads.some((pad) => isPressed(pad.buttons[buttonIndex]))

      const directionPressed: Record<NavDirection, boolean> = {
        up: pads.some(
          (pad) => isPressed(pad.buttons[DPAD_UP]) || (pad.axes[1] ?? 0) < -STICK_DEADZONE
        ),
        down: pads.some(
          (pad) => isPressed(pad.buttons[DPAD_DOWN]) || (pad.axes[1] ?? 0) > STICK_DEADZONE
        ),
        left: pads.some(
          (pad) => isPressed(pad.buttons[DPAD_LEFT]) || (pad.axes[0] ?? 0) < -STICK_DEADZONE
        ),
        right: pads.some(
          (pad) => isPressed(pad.buttons[DPAD_RIGHT]) || (pad.axes[0] ?? 0) > STICK_DEADZONE
        )
      }

      // Hardware Control owns global/background controller input in the main
      // process. Keeping navigation foreground-only prevents a held shortcut
      // from launching a focused game card while another app is visible.
      if (!document.hasFocus()) {
        for (const buttonIndex of [
          BTN_A,
          BTN_B,
          BTN_Y,
          BTN_LB,
          BTN_RB,
          BTN_LT,
          BTN_RT,
          BTN_START
        ]) {
          prevButtons[buttonIndex] = anyButtonPressed(buttonIndex)
          delete nextButtonRepeatAt[buttonIndex]
        }
        releaseDirection('up')
        releaseDirection('down')
        releaseDirection('left')
        releaseDirection('right')
        rafId = requestAnimationFrame(pollGamepads)
        return
      }

      // Browsers can expose one physical controller more than once (for example
      // through Steam Input). Aggregate all pads before updating shared state so
      // an idle duplicate cannot release a direction pressed on another pad.
      for (const direction of ['up', 'down', 'left', 'right'] as const) {
        directionPressed[direction]
          ? handleDirection(direction, now)
          : releaseDirection(direction)
      }

      const aPressed = anyButtonPressed(BTN_A)
      if (aPressed && !prevButtons[BTN_A]) confirmFocused()
      prevButtons[BTN_A] = aPressed

      const bPressed = anyButtonPressed(BTN_B)
      if (bPressed && !prevButtons[BTN_B] && triggerBack()) playUiSound('back')
      prevButtons[BTN_B] = bPressed

      const yPressed = anyButtonPressed(BTN_Y)
      if (yPressed && !prevButtons[BTN_Y]) openViewSearch()
      prevButtons[BTN_Y] = yPressed

      handleCyclingButton(BTN_LB, anyButtonPressed(BTN_LB), now, () => cycleMainView(-1))
      handleCyclingButton(BTN_RB, anyButtonPressed(BTN_RB), now, () => cycleMainView(1))
      handleCyclingButton(BTN_LT, anyButtonPressed(BTN_LT), now, () => cycleSecondaryView(-1))
      handleCyclingButton(BTN_RT, anyButtonPressed(BTN_RT), now, () => cycleSecondaryView(1))

      const startPressed = anyButtonPressed(BTN_START)
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
