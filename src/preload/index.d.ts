import type { ElectronAPI } from '@electron-toolkit/preload'
import type { OrbitApi } from './index'

declare global {
  interface Window {
    electron: ElectronAPI
    api: OrbitApi
  }
}
