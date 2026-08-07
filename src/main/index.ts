import { app, shell, protocol, net, BrowserWindow } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpcHandlers } from './ipcHandlers'
import { getCacheDir } from './imageCache'

protocol.registerSchemesAsPrivileged([
  { scheme: 'orbit-image', privileges: { supportFetchAPI: true, bypassCSP: true, corsEnabled: true } }
])

function createWindow(): BrowserWindow {
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

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
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

void app.whenReady().then(() => {
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

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
