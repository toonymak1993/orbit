import assert from 'node:assert/strict'
import {
  applyTextEdit,
  shouldUseOrbitKeyboard,
  shouldUseSystemKeyboard,
  type TextSelectionState
} from '../src/renderer/src/lib/gamepadKeyboard.ts'

function state(
  value: string,
  selectionStart = value.length,
  selectionEnd = selectionStart
): TextSelectionState {
  return { value, selectionStart, selectionEnd }
}

assert.deepEqual(
  applyTextEdit(state('ORBT', 3), { type: 'insert', text: 'I' }),
  state('ORBIT', 4),
  'inserts at the active caret'
)

assert.deepEqual(
  applyTextEdit(state('ORBIT', 1, 4), { type: 'insert', text: 'rb' }),
  state('OrbT', 3),
  'replaces the current selection'
)

assert.deepEqual(
  applyTextEdit(state('ORBIT', 1, 4), { type: 'insert', text: 'really-long' }, 6),
  state('OrealT', 5),
  'respects maxLength after accounting for selected text'
)

assert.deepEqual(
  applyTextEdit(state('Play 🎮'), { type: 'backspace' }),
  state('Play ', 5),
  'backspace removes a complete Unicode code point'
)

assert.deepEqual(
  applyTextEdit(state('A🎮B', 1), { type: 'delete' }),
  state('AB', 1),
  'forward delete removes a complete Unicode code point'
)

assert.deepEqual(
  applyTextEdit(state('A🎮B', 3), { type: 'cursor', direction: -1 }),
  state('A🎮B', 1),
  'cursor movement never lands inside a surrogate pair'
)

assert.deepEqual(
  applyTextEdit(state('ORBIT', 1, 4), { type: 'cursor', direction: 1 }),
  state('ORBIT', 4),
  'right movement collapses a selection at its end'
)

assert.equal(
  shouldUseOrbitKeyboard('playstation'),
  true,
  'DualSense and other PlayStation controllers open the ORBIT keyboard automatically'
)

assert.equal(
  shouldUseOrbitKeyboard('xbox'),
  false,
  'Xbox controllers never open the ORBIT keyboard automatically'
)

assert.equal(
  shouldUseOrbitKeyboard('xbox', true),
  true,
  'an explicit UI request can still open the ORBIT keyboard independently of controller type'
)

assert.equal(
  shouldUseSystemKeyboard('xbox', true),
  true,
  'Xbox controllers use the Windows system keyboard for opted-in chat fields'
)

assert.equal(
  shouldUseSystemKeyboard('playstation', true),
  false,
  'PlayStation controllers keep the ORBIT keyboard for opted-in chat fields'
)

console.log('ORBIT gamepad keyboard editing checks passed')
