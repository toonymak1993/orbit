import { app, shell, protocol, net, BrowserWindow } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { ORBIT_AGENT_ARGUMENT } from './orbitServiceProtocol'

const isBackgroundAgent = process.argv.includes(ORBIT_AGENT_ARGUMENT)

// ORBIT has a bounded set of singleton services with independent shutdown hooks.
// Keep EventEmitter leak detection enabled above that known baseline.
app.setMaxListeners(20)

if (isBackgroundAgent) {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-software-rasterizer')
} else {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'orbit-image', privileges: { supportFetchAPI: true, bypassCSP: true, corsEnabled: true } }
  ])
}

function createWindow(registerIpcHandlers: (window: BrowserWindow) => void): BrowserWindow {
  const mainWindow = new BrowserWindow({
    show: false,
    frame: false,
    fullscreen: true,
    autoHideMenuBar: true,
    backgroundColor: '#05070c',
    title: 'ORBIT',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        void shell.openExternal(parsed.toString())
      }
    } catch {
      // Ignore malformed and non-web URLs from renderer content.
    }
    return { action: 'deny' }
  })

  // F11 toggles fullscreen for dev convenience — Escape stays reserved for in-app "back" navigation.
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      mainWindow.setFullScreen(!mainWindow.isFullScreen())
    }
  })

  registerIpcHandlers(mainWindow)

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

async function startOrbitUi(): Promise<void> {
  const [{ registerIpcHandlers }, { getCacheDir }, { startOrbitAppCommandServer }, { revealOrbitWindow }] =
    await Promise.all([
      import('./ipcHandlers'),
      import('./imageCache'),
      import('./orbitAppCommands'),
      import('./orbitWindow')
    ])

  // The AppX package already supplies the shell identity used by Xbox Mode.
  // Overriding it would detach ORBIT from its registered Gaming Home entry.
  if (!process.windowsStore) {
    electronApp.setAppUserModelId('com.orbit.launcher')
  }

  protocol.handle('orbit-image', (request) => {
    const fileName = decodeURIComponent(request.url.replace('orbit-image://', ''))
    if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
      return new Response(null, { status: 400 })
    }
    return net.fetch(pathToFileURL(join(getCacheDir(), fileName)).toString())
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const mainWindow = createWindow(registerIpcHandlers)
  const closeCommandServer = await startOrbitAppCommandServer(mainWindow)
  app.once('before-quit', () => void closeCommandServer())

  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0]
    if (window) void revealOrbitWindow(window)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(registerIpcHandlers)
  })
}

if (isBackgroundAgent) {
  void app.whenReady().then(async () => {
    try {
      const { startOrbitBackgroundAgent } = await import('./orbitBackgroundAgent')
      await startOrbitBackgroundAgent()
    } catch (error) {
      console.error('[background-service] Failed to start:', error)
      app.quit()
    }
  })
} else {
  const hasSingleInstanceLock = app.requestSingleInstanceLock()
  if (!hasSingleInstanceLock) {
    app.quit()
  } else {
    void app.whenReady().then(startOrbitUi)
  }

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
