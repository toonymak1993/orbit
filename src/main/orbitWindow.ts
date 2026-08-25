import { app, type BrowserWindow } from 'electron'
import { activateOrbitWindow } from './gameSessionManager'

const activations = new WeakMap<BrowserWindow, Promise<boolean>>()

export function revealOrbitWindow(window: BrowserWindow): Promise<boolean> {
  const current = activations.get(window)
  if (current) return current

  const activation = (async () => {
    if (window.isDestroyed()) return false
    if (window.isMinimized()) window.restore()
    window.setAlwaysOnTop(true, 'screen-saver')
    window.show()
    window.setFullScreen(true)
    window.moveTop()
    window.focus()
    await activateOrbitWindow(window)
    if (window.isDestroyed()) return false
    app.focus()
    window.show()
    window.moveTop()
    window.focus()
    await new Promise((resolve) => setTimeout(resolve, 80))
    return !window.isDestroyed() && window.isFocused()
  })().finally(() => {
    if (!window.isDestroyed()) window.setAlwaysOnTop(false)
    activations.delete(window)
  })
  activations.set(window, activation)
  return activation
}
