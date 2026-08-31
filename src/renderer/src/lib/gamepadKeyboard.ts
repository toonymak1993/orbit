import type { ControllerFamily } from './controllerProfile'

const TEXT_INPUT_TYPES = new Set(['email', 'number', 'password', 'search', 'tel', 'text', 'url'])

export const GAMEPAD_KEYBOARD_OPEN_EVENT = 'orbit:gamepad-keyboard:open'
export const GAMEPAD_KEYBOARD_SHORTCUT_EVENT = 'orbit:gamepad-keyboard:shortcut'
export const GAMEPAD_KEYBOARD_CLOSE_EVENT = 'orbit:gamepad-keyboard:close'
let gamepadKeyboardOpen = false

export type EditableTextControl = HTMLInputElement | HTMLTextAreaElement

export type GamepadKeyboardShortcut =
  | 'backspace'
  | 'space'
  | 'cursor-left'
  | 'cursor-right'
  | 'shift'
  | 'layout'
  | 'done'

export interface TextSelectionState {
  value: string
  selectionStart: number
  selectionEnd: number
}

/**
 * Automatic opening is reserved for PlayStation controllers. Other input
 * methods can still request the ORBIT keyboard deliberately from their own UI.
 */
export function shouldUseOrbitKeyboard(
  controllerFamily: ControllerFamily | null,
  explicitlyRequested = false
): boolean {
  return explicitlyRequested || controllerFamily === 'playstation'
}

/** Xbox uses Windows' gaming-aware system input pane when a field opts in. */
export function shouldUseSystemKeyboard(
  controllerFamily: ControllerFamily | null,
  systemKeyboardRequested: boolean
): boolean {
  return systemKeyboardRequested && controllerFamily === 'xbox'
}

export type TextEdit =
  | { type: 'insert'; text: string }
  | { type: 'backspace' }
  | { type: 'delete' }
  | { type: 'cursor'; direction: -1 | 1 }

function previousCodePointIndex(value: string, index: number): number {
  if (index <= 0) return 0
  const previous = value.charCodeAt(index - 1)
  const beforePrevious = index > 1 ? value.charCodeAt(index - 2) : 0
  return previous >= 0xdc00 && previous <= 0xdfff && beforePrevious >= 0xd800 && beforePrevious <= 0xdbff
    ? index - 2
    : index - 1
}

function nextCodePointIndex(value: string, index: number): number {
  if (index >= value.length) return value.length
  const current = value.charCodeAt(index)
  const next = index + 1 < value.length ? value.charCodeAt(index + 1) : 0
  return current >= 0xd800 && current <= 0xdbff && next >= 0xdc00 && next <= 0xdfff
    ? index + 2
    : index + 1
}

function normalizedSelection(state: TextSelectionState): TextSelectionState {
  const selectionStart = Math.max(0, Math.min(state.value.length, state.selectionStart))
  const selectionEnd = Math.max(selectionStart, Math.min(state.value.length, state.selectionEnd))
  return { value: state.value, selectionStart, selectionEnd }
}

/** Pure text-editing model shared by the controller UI and its verification script. */
export function applyTextEdit(
  input: TextSelectionState,
  edit: TextEdit,
  maxLength = -1
): TextSelectionState {
  const state = normalizedSelection(input)
  const { value, selectionStart, selectionEnd } = state

  if (edit.type === 'cursor') {
    const nextPosition =
      edit.direction < 0
        ? selectionStart !== selectionEnd
          ? selectionStart
          : previousCodePointIndex(value, selectionStart)
        : selectionStart !== selectionEnd
          ? selectionEnd
          : nextCodePointIndex(value, selectionEnd)
    return { value, selectionStart: nextPosition, selectionEnd: nextPosition }
  }

  if (edit.type === 'backspace') {
    const deleteStart =
      selectionStart === selectionEnd
        ? previousCodePointIndex(value, selectionStart)
        : selectionStart
    if (deleteStart === selectionEnd) return state
    const nextValue = value.slice(0, deleteStart) + value.slice(selectionEnd)
    return { value: nextValue, selectionStart: deleteStart, selectionEnd: deleteStart }
  }

  if (edit.type === 'delete') {
    const deleteEnd =
      selectionStart === selectionEnd
        ? nextCodePointIndex(value, selectionEnd)
        : selectionEnd
    if (selectionStart === deleteEnd) return state
    const nextValue = value.slice(0, selectionStart) + value.slice(deleteEnd)
    return { value: nextValue, selectionStart, selectionEnd: selectionStart }
  }

  const retainedLength = value.length - (selectionEnd - selectionStart)
  const availableLength = maxLength >= 0 ? Math.max(0, maxLength - retainedLength) : edit.text.length
  let insertion = edit.text.slice(0, availableLength)
  if (insertion.length > 0) {
    const finalCode = insertion.charCodeAt(insertion.length - 1)
    if (finalCode >= 0xd800 && finalCode <= 0xdbff) insertion = insertion.slice(0, -1)
  }
  if (!insertion) return state
  const nextValue = value.slice(0, selectionStart) + insertion + value.slice(selectionEnd)
  const nextPosition = selectionStart + insertion.length
  return { value: nextValue, selectionStart: nextPosition, selectionEnd: nextPosition }
}

export function isEditableTextElement(element: Element | null): element is EditableTextControl {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return false
  if (
    (element.closest('[inert]') && element.dataset.gamepadKeyboardActive !== 'true') ||
    element.dataset.gamepadKeyboard === 'off'
  ) return false
  if (element.disabled || element.readOnly || element.inputMode === 'none') return false
  return element instanceof HTMLTextAreaElement || TEXT_INPUT_TYPES.has(element.type)
}

export function editableTextLabel(element: EditableTextControl): string | undefined {
  const labelledBy = element.getAttribute('aria-labelledby')
  if (labelledBy) {
    const label = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim())
      .filter(Boolean)
      .join(' ')
    if (label) return label
  }

  const ariaLabel = element.getAttribute('aria-label')?.trim()
  if (ariaLabel) return ariaLabel
  const explicitLabel = element.id
    ? document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(element.id)}"]`)
    : null
  const wrappingLabel = element.closest('label')
  const labelText = (explicitLabel ?? wrappingLabel)?.querySelector('span')?.textContent?.trim()
  return labelText || element.placeholder.trim() || element.name.trim() || undefined
}

export function showGamepadKeyboardFor(element: Element | null): boolean {
  if (!isEditableTextElement(element)) return false
  window.dispatchEvent(
    new CustomEvent<EditableTextControl>(GAMEPAD_KEYBOARD_OPEN_EVENT, { detail: element })
  )
  return true
}

export function isGamepadKeyboardOpen(): boolean {
  return gamepadKeyboardOpen
}

export function setGamepadKeyboardOpen(open: boolean): void {
  gamepadKeyboardOpen = open
}

export function dispatchGamepadKeyboardShortcut(shortcut: GamepadKeyboardShortcut): boolean {
  if (!isGamepadKeyboardOpen()) return false
  window.dispatchEvent(
    new CustomEvent<GamepadKeyboardShortcut>(GAMEPAD_KEYBOARD_SHORTCUT_EVENT, {
      detail: shortcut
    })
  )
  return true
}
