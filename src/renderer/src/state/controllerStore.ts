import { create } from 'zustand'
import {
  CONTROLLER_BUTTON_LABELS,
  type ControllerButtonLabels,
  type ControllerFamily
} from '@renderer/lib/controllerProfile'

interface ControllerState {
  family: ControllerFamily
  activeGamepadId: string | null
  setActiveController: (family: ControllerFamily, gamepadId: string) => void
}

export const useControllerStore = create<ControllerState>((set, get) => ({
  family: 'xbox',
  activeGamepadId: null,
  setActiveController: (family, activeGamepadId) => {
    const current = get()
    if (current.family === family && current.activeGamepadId === activeGamepadId) return
    document.documentElement.dataset.controllerFamily = family
    set({ family, activeGamepadId })
  }
}))

export function useControllerButtonLabels(): ControllerButtonLabels {
  return useControllerStore((state) => CONTROLLER_BUTTON_LABELS[state.family])
}
