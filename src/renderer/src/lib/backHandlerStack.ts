type BackHandler = () => void
type BackInputHandler = (pressed: boolean) => boolean

const stack: BackHandler[] = []
const BACK_INPUT_EVENT = 'orbit:back-input'

export function pushBackHandler(handler: BackHandler): () => void {
  stack.push(handler)
  return () => {
    const idx = stack.lastIndexOf(handler)
    if (idx !== -1) stack.splice(idx, 1)
  }
}

export function triggerBack(): boolean {
  const handler = stack[stack.length - 1]
  if (!handler) return false
  handler()
  return true
}

/**
 * Broadcasts the physical state of the controller/keyboard back input. A hold
 * action can claim the press synchronously so the normal one-shot handler does
 * not fire as well.
 */
export function dispatchBackInput(pressed: boolean): boolean {
  const event = new CustomEvent<{ pressed: boolean }>(BACK_INPUT_EVENT, {
    cancelable: true,
    detail: { pressed }
  })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

export function subscribeBackInput(handler: BackInputHandler): () => void {
  const listener = (event: Event): void => {
    const input = event as CustomEvent<{ pressed: boolean }>
    if (handler(input.detail.pressed)) input.preventDefault()
  }
  window.addEventListener(BACK_INPUT_EVENT, listener)
  return () => window.removeEventListener(BACK_INPUT_EVENT, listener)
}
