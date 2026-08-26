export type ControllerFamily = 'xbox' | 'playstation'

export type ControllerButtonId =
  | 'south'
  | 'east'
  | 'west'
  | 'north'
  | 'leftBumper'
  | 'rightBumper'
  | 'leftTrigger'
  | 'rightTrigger'
  | 'menu'
  | 'view'
  | 'guide'
  | 'leftStick'
  | 'rightStick'

export type ControllerButtonLabels = Record<ControllerButtonId, string>

export const CONTROLLER_BUTTON_LABELS: Record<ControllerFamily, ControllerButtonLabels> = {
  xbox: {
    south: 'A',
    east: 'B',
    west: 'X',
    north: 'Y',
    leftBumper: 'LB',
    rightBumper: 'RB',
    leftTrigger: 'LT',
    rightTrigger: 'RT',
    menu: 'Menu / Start',
    view: 'View / Select',
    guide: 'Xbox / Guide',
    leftStick: 'LS',
    rightStick: 'RS'
  },
  playstation: {
    south: '×',
    east: '○',
    west: '□',
    north: '△',
    leftBumper: 'L1',
    rightBumper: 'R1',
    leftTrigger: 'L2',
    rightTrigger: 'R2',
    menu: 'Options',
    view: 'Create',
    guide: 'PS',
    leftStick: 'L3',
    rightStick: 'R3'
  }
}

/**
 * Chromium exposes DualSense IDs differently over USB, Bluetooth and Steam
 * Input. Sony's vendor ID is the stable fallback when the product name is not.
 */
export function detectControllerFamily(gamepadId: string): ControllerFamily {
  const normalizedId = gamepadId.toLowerCase()
  const isPlayStation =
    normalizedId.includes('dualsense') ||
    normalizedId.includes('dualshock') ||
    normalizedId.includes('playstation') ||
    normalizedId.includes('sony interactive entertainment') ||
    /(?:vendor[:= ]+|vid[_:-]?)(?:0x)?054c\b/.test(normalizedId) ||
    /\b054c[-_:]/.test(normalizedId)

  return isPlayStation ? 'playstation' : 'xbox'
}

/**
 * Returns a coarse input snapshot. Changes represent intentional controller
 * activity while ignoring normal analog-stick drift.
 */
export function getGamepadInputSignature(gamepad: Gamepad): string {
  const pressedButtons = gamepad.buttons
    .map((button, index) => (button.pressed || button.value > 0.5 ? String(index) : ''))
    .filter(Boolean)
    .join(',')
  const activeAxes = gamepad.axes
    .map((value, index) => {
      if (value < -0.45) return `${index}-`
      if (value > 0.45) return `${index}+`
      return ''
    })
    .filter(Boolean)
    .join(',')

  return pressedButtons || activeAxes ? `${pressedButtons}|${activeAxes}` : ''
}
