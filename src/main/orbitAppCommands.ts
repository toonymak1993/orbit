import { app, type BrowserWindow } from 'electron'
import {
  closePipeServer,
  createOrbitPipeServer,
  orbitServicePipeNames,
  type OrbitAppCommand
} from './orbitServiceProtocol'
import { revealOrbitWindow } from './orbitWindow'

export async function startOrbitAppCommandServer(
  mainWindow: BrowserWindow
): Promise<() => Promise<void>> {
  const pipeName = orbitServicePipeNames(app.getPath('userData')).app
  const server = await createOrbitPipeServer(pipeName, async ({ command }) => {
    if (command !== ('show' satisfies OrbitAppCommand)) {
      throw new Error('Unknown ORBIT app command')
    }
    return revealOrbitWindow(mainWindow)
  })
  return () => closePipeServer(server)
}
