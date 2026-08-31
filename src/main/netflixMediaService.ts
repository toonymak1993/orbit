import { app, BrowserWindow, screen, type Rectangle, type WebContents } from 'electron'
import Store from 'electron-store'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type {
  ApplicationLaunchResult,
  MediaKeyboardOpenPayload,
  MediaKeyboardUpdatePayload,
  MediaOverlayHintPayload
} from '@shared/ipc'
import { IPC } from '@shared/ipc'
import { MediaControllerBridge } from './mediaControllerBridge'
import { revealOrbitWindow } from './orbitWindow'
import { settingsStore } from './settingsStore'
import {
  webAppActionExpression,
  webAppInputUpdateExpression,
  type WebAppActionResult,
  type WebAppControllerAction,
  type WebAppControllerConfig,
  type WebAppEditableResult
} from './webAppControllerRuntime'

interface CdpResponse {
  id?: number
  result?: Record<string, unknown>
  error?: { message?: string }
}

interface ActiveKeyboardRequest {
  requestId: string
  fieldToken: string
}

const NETFLIX_URL = 'https://www.netflix.com/browse'
const DEVTOOLS_READY_TIMEOUT_MS = 18_000
const KEYBOARD_VALUE_LIMIT = 4_096
const NETFLIX_CONTROLLER_CONFIG: WebAppControllerConfig = {
  allowedHostSuffixes: ['netflix.com'],
  panelSelectors: [
    '[data-uia="previewModal--container"]',
    '.previewModal--container',
    '.preview-modal-container'
  ],
  playerSelectors: [
    '[data-uia="watch-video"]',
    '.watch-video',
    '[data-uia="player"]'
  ],
  playerControlSelectors: ['[data-uia="controls-standard"]'],
  playerInitialFocusSelectors: [
    '[data-uia="control-play-pause-play"]',
    '[data-uia="control-play-pause-pause"]'
  ],
  searchPathHints: ['/search'],
  searchTerms: [
    'search',
    'suche',
    'recherche',
    'buscar',
    'cerca',
    'zoeken',
    'pesquisa',
    'szukaj',
    'arama',
    'sök',
    'søk',
    '検索',
    '搜索',
    '찾기'
  ]
}

interface MediaStateStoreSchema {
  netflixFirstRunHintShown: boolean
}

const mediaStateStore = new Store<MediaStateStoreSchema>({
  name: 'orbit-media-state',
  defaults: { netflixFirstRunHintShown: false }
})

function edgeExecutable(): string | null {
  if (process.platform !== 'win32') return null
  const candidates = [
    process.env['PROGRAMFILES(X86)'] &&
      join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env['PROGRAMFILES'] &&
      join(process.env['PROGRAMFILES'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env['LOCALAPPDATA'] &&
      join(process.env['LOCALAPPDATA'], 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ].filter((candidate): candidate is string => Boolean(candidate))
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function rendererUrlForKeyboard(): string | null {
  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (!rendererUrl) return null
  const url = new URL(rendererUrl)
  url.searchParams.set('orbitMode', 'media-keyboard')
  return url.toString()
}

function bundledAssetPath(...segments: string[]): string {
  return join(app.getAppPath(), 'out', ...segments)
}

function netflixLaunchLocale(): string {
  const orbitLanguage = settingsStore.store.language
  const prefix = orbitLanguage === 'de' ? 'de' : 'en'
  const preferred = [app.getLocale(), ...app.getPreferredSystemLanguages()]
    .map((locale) => locale.replaceAll('_', '-').trim())
    .find((locale) => locale.toLowerCase() === prefix || locale.toLowerCase().startsWith(`${prefix}-`))
  return preferred && /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(preferred)
    ? preferred
    : orbitLanguage === 'de'
      ? 'de-DE'
      : 'en-US'
}

function normalizedKeyboardUpdate(value: unknown): MediaKeyboardUpdatePayload | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<MediaKeyboardUpdatePayload>
  if (
    typeof candidate.requestId !== 'string' ||
    candidate.requestId.length < 1 ||
    candidate.requestId.length > 160 ||
    typeof candidate.value !== 'string' ||
    candidate.value.length > KEYBOARD_VALUE_LIMIT ||
    !Number.isInteger(candidate.selectionStart) ||
    !Number.isInteger(candidate.selectionEnd)
  ) {
    return null
  }
  const selectionStartValue = candidate.selectionStart as number
  const selectionEndValue = candidate.selectionEnd as number
  const selectionStart = Math.max(0, Math.min(candidate.value.length, selectionStartValue))
  const selectionEnd = Math.max(selectionStart, Math.min(candidate.value.length, selectionEndValue))
  return {
    requestId: candidate.requestId,
    value: candidate.value,
    selectionStart,
    selectionEnd
  }
}

class NetflixDevToolsClient {
  private socket: WebSocket | null = null
  private nextId = 1
  private disposed = false
  private pending = new Map<
    number,
    { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >()

  private constructor(private readonly onUnexpectedClose: () => void) {}

  static async connect(
    profileDirectory: string,
    onUnexpectedClose: () => void
  ): Promise<NetflixDevToolsClient> {
    const deadline = Date.now() + DEVTOOLS_READY_TIMEOUT_MS
    const activePortFile = join(profileDirectory, 'DevToolsActivePort')
    let debuggerUrl = ''

    while (Date.now() < deadline && !debuggerUrl) {
      try {
        const [portLine] = readFileSync(activePortFile, 'utf8').split(/\r?\n/)
        const port = Number.parseInt(portLine, 10)
        if (Number.isInteger(port) && port > 0 && port <= 65_535) {
          const response = await fetch(`http://127.0.0.1:${port}/json/list`)
          if (response.ok) {
            const targets = (await response.json()) as Array<{
              type?: string
              url?: string
              webSocketDebuggerUrl?: string
            }>
            const target = targets.find((candidate) => {
              if (candidate.type !== 'page' || !candidate.webSocketDebuggerUrl || !candidate.url) return false
              try {
                const url = new URL(candidate.url)
                return url.protocol === 'https:' &&
                  (url.hostname === 'netflix.com' || url.hostname.endsWith('.netflix.com'))
              } catch {
                return false
              }
            })
            debuggerUrl = target?.webSocketDebuggerUrl ?? ''
          }
        }
      } catch {
        // Edge creates the port file and page target asynchronously.
      }
      if (!debuggerUrl) await new Promise((resolve) => setTimeout(resolve, 180))
    }

    if (!debuggerUrl) throw new Error('Die sichere Netflix-Steuerverbindung wurde nicht bereit')
    const client = new NetflixDevToolsClient(onUnexpectedClose)
    try {
      await client.open(debuggerUrl)
      await client.send('Runtime.enable')
      await client.send('Page.enable')
      return client
    } catch (error) {
      client.dispose()
      throw error
    }
  }

  private async open(url: string): Promise<void> {
    const socket = new WebSocket(url)
    this.socket = socket
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Netflix-Steuerverbindung: Zeitüberschreitung')), 5_000)
      socket.addEventListener('open', () => {
        clearTimeout(timer)
        resolve()
      }, { once: true })
      socket.addEventListener('error', () => {
        clearTimeout(timer)
        reject(new Error('Netflix-Steuerverbindung konnte nicht geöffnet werden'))
      }, { once: true })
    })
    socket.addEventListener('message', (event) => {
      let message: CdpResponse
      try {
        message = JSON.parse(String(event.data)) as CdpResponse
      } catch {
        return
      }
      if (!message.id) return
      const pending = this.pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message || 'Netflix-Steuerfehler'))
      else pending.resolve(message.result ?? {})
    })
    socket.addEventListener('close', () => {
      this.rejectPending('Netflix-Steuerverbindung wurde geschlossen')
      if (this.socket === socket) this.socket = null
      if (!this.disposed) this.onUnexpectedClose()
    })
  }

  async send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error('Netflix-Steuerverbindung ist nicht aktiv')
    }
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Netflix-Steuerbefehl '${method}' hat zu lange gedauert`))
      }, 5_000)
      this.pending.set(id, { resolve, reject, timer })
      socket.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate<T>(expression: string): Promise<T> {
    const response = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    })
    const exception = response.exceptionDetails as { text?: string } | undefined
    if (exception) throw new Error(exception.text || 'Netflix-Seitensteuerung fehlgeschlagen')
    const result = response.result as { value?: T } | undefined
    return (result?.value ?? {}) as T
  }

  async key(key: string, code = key): Promise<void> {
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code })
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code })
  }

  async pointerMove(x: number, y: number): Promise<void> {
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y,
      button: 'none',
      buttons: 0,
      pointerType: 'mouse'
    })
  }

  async waitForTrustedHost(hostSuffixes: readonly string[], timeoutMs = 8_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        const location = await this.evaluate<{ protocol?: string; hostname?: string }>(
          '({ protocol: location.protocol, hostname: location.hostname })'
        )
        const hostname = String(location.hostname || '').toLowerCase()
        if (
          location.protocol === 'https:' &&
          hostSuffixes.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`))
        ) {
          return
        }
      } catch {
        // The first Netflix document can be replaced while Edge is booting.
      }
      await new Promise((resolve) => setTimeout(resolve, 120))
    }
    throw new Error('Netflix hat das sichere Web-Dokument nicht rechtzeitig geladen')
  }

  dispose(): void {
    this.disposed = true
    this.rejectPending('Netflix-Steuerverbindung beendet')
    const socket = this.socket
    this.socket = null
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close()
  }

  private rejectPending(message: string): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error(message))
    }
    this.pending.clear()
  }
}

class NetflixMediaService {
  private edgeProcess: ChildProcess | null = null
  private client: NetflixDevToolsClient | null = null
  private controller = new MediaControllerBridge()
  private keyboardWindow: BrowserWindow | null = null
  private keyboardReady: Promise<void> | null = null
  private activeKeyboard: ActiveKeyboardRequest | null = null
  private mainWindow: BrowserWindow | null = null
  private profileDirectory: string | null = null
  private actionQueue: Promise<void> = Promise.resolve()
  private pendingDirection: WebAppControllerAction | null = null
  private directionActionScheduled = false
  private closeFallbackTimer: NodeJS.Timeout | null = null
  private hintTimer: NodeJS.Timeout | null = null
  private disposing = false

  isAvailable(): boolean {
    return Boolean(edgeExecutable())
  }

  async launch(mainWindow: BrowserWindow): Promise<ApplicationLaunchResult['controllerBridge']> {
    if (this.client) {
      this.mainWindow = mainWindow
      await this.client.send('Page.bringToFront').catch(() => undefined)
      if (!mainWindow.isDestroyed()) mainWindow.hide()
      return 'active'
    }

    const executable = edgeExecutable()
    if (!executable) throw new Error('Microsoft Edge ist für den Netflix-Modus nicht verfügbar')
    this.disposing = false
    this.mainWindow = mainWindow
    const profileDirectory = join(app.getPath('userData'), 'netflix-edge-profile')
    this.profileDirectory = profileDirectory
    mkdirSync(profileDirectory, { recursive: true })
    await this.closeEdgeProfileProcesses()
    rmSync(join(profileDirectory, 'DevToolsActivePort'), { force: true })
    const displayBounds = this.mediaDisplayBounds()
    await this.ensureKeyboardWindow()

    const locale = netflixLaunchLocale()
    const edge = spawn(
      executable,
      [
        `--app=${NETFLIX_URL}`,
        '--start-fullscreen',
        '--no-first-run',
        '--no-default-browser-check',
        '--remote-debugging-port=0',
        '--remote-debugging-address=127.0.0.1',
        `--user-data-dir=${profileDirectory}`,
        `--lang=${locale}`,
        `--window-position=${displayBounds.x},${displayBounds.y}`,
        `--window-size=${displayBounds.width},${displayBounds.height}`
      ],
      { shell: false, stdio: 'ignore', windowsHide: false }
    )
    this.edgeProcess = edge
    edge.once('exit', () => {
      // Edge may replace its initial compatibility/bootstrap process. The CDP
      // connection, not this short-lived PID, is the authoritative lifetime.
      if (this.edgeProcess === edge) this.edgeProcess = null
    })

    let connectedClient: NetflixDevToolsClient | null = null
    try {
      await new Promise<void>((resolve, reject) => {
        edge.once('spawn', resolve)
        edge.once('error', reject)
      })
      connectedClient = await NetflixDevToolsClient.connect(profileDirectory, () => {
        if (this.client !== connectedClient) return
        this.finishSession(!this.disposing)
      })
      await connectedClient.waitForTrustedHost(NETFLIX_CONTROLLER_CONFIG.allowedHostSuffixes)
      this.client = connectedClient
    } catch (error) {
      connectedClient?.dispose()
      void this.closeEdgeProfileProcesses()
      this.finishSession(false)
      throw new Error(
        error instanceof Error
          ? `Netflix konnte nicht in ORBIT gestartet werden: ${error.message}`
          : 'Netflix konnte nicht in ORBIT gestartet werden'
      )
    }

    const controllerActive = await this.controller.start({
      direction: (direction) => this.queueAction({ type: 'direction', direction }),
      confirm: () => this.queueAction({ type: 'confirm' }),
      back: () => this.queueBack(),
      backHold: () => this.close(),
      playPause: () => this.queueAction({ type: 'play-pause' }),
      search: () => this.queueAction({ type: 'search' }),
      history: (delta) => this.queueAction({ type: 'history', delta })
    })
    if (!mainWindow.isDestroyed()) mainWindow.hide()
    await this.client.send('Page.bringToFront').catch(() => undefined)
    await this.showFirstRunHint()
    return controllerActive ? 'active' : 'unavailable'
  }

  handleKeyboardUpdate(sender: WebContents, value: unknown): void {
    const update = normalizedKeyboardUpdate(value)
    if (!update || !this.isTrustedKeyboardSender(sender, update.requestId)) return
    this.queueKeyboardUpdate(update)
  }

  handleKeyboardComplete(sender: WebContents, value: unknown): void {
    const update = normalizedKeyboardUpdate(value)
    if (!update || !this.isTrustedKeyboardSender(sender, update.requestId)) return
    this.queueKeyboardUpdate(update, true)
  }

  handleKeyboardClose(sender: WebContents, requestId: unknown): void {
    if (typeof requestId !== 'string' || !this.isTrustedKeyboardSender(sender, requestId)) return
    this.closeKeyboard()
  }

  close(): void {
    const client = this.client
    if (!client) {
      void this.closeEdgeProfileProcesses()
      this.finishSession(true)
      return
    }
    // Browser.close survives Edge's bootstrap PID hand-off and closes only the
    // dedicated ORBIT Netflix profile. A profile-scoped fallback handles a
    // broken DevTools connection without touching the user's normal Edge.
    void client.send('Browser.close').catch(() => undefined)
    if (this.closeFallbackTimer) clearTimeout(this.closeFallbackTimer)
    this.closeFallbackTimer = setTimeout(() => {
      this.closeFallbackTimer = null
      if (this.client !== client) return
      void this.closeEdgeProfileProcesses()
      this.finishSession(true)
    }, 1_800)
  }

  dispose(): void {
    this.disposing = true
    void this.closeEdgeProfileProcesses()
    this.finishSession(false)
    if (this.keyboardWindow && !this.keyboardWindow.isDestroyed()) this.keyboardWindow.destroy()
    this.keyboardWindow = null
    this.keyboardReady = null
  }

  private queueAction(action: WebAppControllerAction): void {
    if (action.type !== 'direction') {
      this.queueTask(() => this.performAction(action))
      return
    }
    // Direction repeats are lossily coalesced. A slow page can never build an
    // input backlog that keeps moving after the user released the stick.
    this.pendingDirection = action
    if (this.directionActionScheduled) return
    this.directionActionScheduled = true
    this.actionQueue = this.actionQueue
      .then(async () => {
        const next = this.pendingDirection
        this.pendingDirection = null
        if (next) await this.performAction(next)
      })
      .catch(() => undefined)
      .finally(() => {
        this.directionActionScheduled = false
        const next = this.pendingDirection
        if (next) this.queueAction(next)
      })
  }

  private queueBack(): void {
    this.queueTask(async () => {
      const client = this.client
      if (!client) return
      await client.pointerMove(-32, -32).catch(() => undefined)
      const context = await client.evaluate<WebAppActionResult>(
        webAppActionExpression(NETFLIX_CONTROLLER_CONFIG, { type: 'back-context' })
      )
      if (this.client !== client || context.blocked) return
      await client.key('Escape', 'Escape')
      await new Promise((resolve) => setTimeout(resolve, 150))
      const back = context.backContext
      if (this.client !== client || !back || back.hasDialog || back.hasVideo) return
      await client.evaluate<WebAppActionResult>(
        webAppActionExpression(NETFLIX_CONTROLLER_CONFIG, {
          type: 'back-fallback',
          previousUrl: back.url
        })
      )
    })
  }

  private queueTask(task: () => Promise<void>): void {
    this.actionQueue = this.actionQueue.then(task).catch(() => undefined)
  }

  private async performAction(action: WebAppControllerAction): Promise<void> {
    const client = this.client
    if (!client) return
    await client.pointerMove(-32, -32).catch(() => undefined)
    let result = await client.evaluate<WebAppActionResult>(
      webAppActionExpression(NETFLIX_CONTROLLER_CONFIG, action)
    )
    if (
      this.client === client &&
      result.needsPlayerControls &&
      result.pointerWake &&
      Number.isFinite(result.pointerWake.x) &&
      Number.isFinite(result.pointerWake.y)
    ) {
      await client.pointerMove(result.pointerWake.x, result.pointerWake.y).catch(() => undefined)
      await new Promise((resolve) => setTimeout(resolve, 90))
      if (this.client !== client) return
      result = await client.evaluate<WebAppActionResult>(
        webAppActionExpression(NETFLIX_CONTROLLER_CONFIG, action)
      )
    }
    if (this.client !== client || result.blocked) return
    if (result.nativeKey) await client.key(result.nativeKey, result.nativeKey)
    if (result.editable) await this.openKeyboard(result.editable)
  }

  private queueKeyboardUpdate(update: MediaKeyboardUpdatePayload, complete = false): void {
    const keyboard = this.activeKeyboard
    if (!keyboard || keyboard.requestId !== update.requestId) return
    const fieldToken = keyboard.fieldToken
    this.actionQueue = this.actionQueue
      .then(async () => {
        const client = this.client
        if (!client) return
        const expression = webAppInputUpdateExpression(
          NETFLIX_CONTROLLER_CONFIG,
          fieldToken,
          update
        )
        await client.evaluate<boolean>(expression)
        if (complete) await client.key('Enter', 'Enter')
      })
      .catch(() => undefined)
      .finally(() => {
        if (complete && this.activeKeyboard?.requestId === update.requestId) this.closeKeyboard()
      })
  }

  private async showFirstRunHint(): Promise<void> {
    if (mediaStateStore.get('netflixFirstRunHintShown')) return
    const overlayWindow = this.keyboardWindow
    if (!overlayWindow || overlayWindow.isDestroyed()) return
    await this.keyboardReady
    const german = settingsStore.store.language === 'de'
    const payload: MediaOverlayHintPayload = {
      id: 'netflix-first-login',
      title: german ? 'Netflix zum ersten Mal' : 'First time with Netflix',
      message: german
        ? 'Nutze bitte einmalig deine Tastatur, um dich anzumelden. Danach kannst du dein Gamepad wie gewohnt verwenden.'
        : 'Please use your keyboard once to sign in. After that, you can use your gamepad as usual.'
    }
    overlayWindow.setIgnoreMouseEvents(true, { forward: true })
    overlayWindow.webContents.send(IPC.mediaOverlayHintOpen, payload)
    overlayWindow.showInactive()
    mediaStateStore.set('netflixFirstRunHintShown', true)
    if (this.hintTimer) clearTimeout(this.hintTimer)
    this.hintTimer = setTimeout(() => this.dismissHint(payload.id), 8_500)
  }

  private dismissHint(hintId = 'netflix-first-login'): void {
    if (this.hintTimer) clearTimeout(this.hintTimer)
    this.hintTimer = null
    const overlayWindow = this.keyboardWindow
    if (!overlayWindow || overlayWindow.isDestroyed()) return
    overlayWindow.webContents.send(IPC.mediaOverlayHintDismiss, hintId)
    if (!this.activeKeyboard) overlayWindow.hide()
  }

  private async openKeyboard(editable: WebAppEditableResult): Promise<void> {
    const keyboardWindow = this.keyboardWindow
    if (!this.client || !keyboardWindow || keyboardWindow.isDestroyed()) return
    await this.keyboardReady
    this.dismissHint()
    keyboardWindow.setIgnoreMouseEvents(false)
    const requestId = randomUUID()
    this.activeKeyboard = { requestId, fieldToken: editable.fieldToken }
    const payload: MediaKeyboardOpenPayload = {
      requestId,
      value: editable.value.slice(0, KEYBOARD_VALUE_LIMIT),
      selectionStart: Math.max(0, Math.min(editable.value.length, editable.selectionStart)),
      selectionEnd: Math.max(0, Math.min(editable.value.length, editable.selectionEnd)),
      inputType: editable.inputType,
      label: editable.label?.slice(0, 160),
      maxLength: editable.maxLength
    }
    keyboardWindow.webContents.send(IPC.mediaKeyboardOpen, payload)
    keyboardWindow.show()
    keyboardWindow.focus()
    this.controller.setKeyboardTarget({
      webContents: keyboardWindow.webContents,
      shortcut: (shortcut) => {
        if (!keyboardWindow.webContents.isDestroyed()) {
          keyboardWindow.webContents.send(IPC.mediaKeyboardShortcut, shortcut)
        }
      }
    })
  }

  private closeKeyboard(): void {
    this.activeKeyboard = null
    this.controller.setKeyboardTarget(null)
    if (this.keyboardWindow && !this.keyboardWindow.isDestroyed()) this.keyboardWindow.hide()
    void this.client?.send('Page.bringToFront').catch(() => undefined)
  }

  private isTrustedKeyboardSender(sender: WebContents, requestId: string): boolean {
    return Boolean(
      this.keyboardWindow &&
        !this.keyboardWindow.isDestroyed() &&
        sender === this.keyboardWindow.webContents &&
        this.activeKeyboard?.requestId === requestId
    )
  }

  private async ensureKeyboardWindow(): Promise<void> {
    const bounds = this.mediaDisplayBounds()
    if (this.keyboardWindow && !this.keyboardWindow.isDestroyed() && this.keyboardReady) {
      const currentBounds = this.keyboardWindow.getBounds()
      if (
        currentBounds.x !== bounds.x ||
        currentBounds.y !== bounds.y ||
        currentBounds.width !== bounds.width ||
        currentBounds.height !== bounds.height
      ) {
        this.keyboardWindow.setFullScreen(false)
        this.keyboardWindow.setBounds(bounds)
        this.keyboardWindow.setFullScreen(true)
      }
      await this.keyboardReady
      return
    }
    const keyboardWindow = new BrowserWindow({
      ...bounds,
      show: false,
      fullscreen: true,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      autoHideMenuBar: true,
      backgroundColor: '#00000000',
      title: 'ORBIT · Media-Tastatur',
      webPreferences: {
        preload: bundledAssetPath('preload', 'index.mjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })
    this.keyboardWindow = keyboardWindow
    keyboardWindow.setAlwaysOnTop(true, 'screen-saver')
    keyboardWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    keyboardWindow.on('closed', () => {
      if (this.keyboardWindow === keyboardWindow) {
        this.keyboardWindow = null
        this.keyboardReady = null
        this.activeKeyboard = null
        this.controller.setKeyboardTarget(null)
      }
    })
    const developmentUrl = rendererUrlForKeyboard()
    this.keyboardReady = developmentUrl
      ? keyboardWindow.loadURL(developmentUrl)
      : keyboardWindow.loadFile(bundledAssetPath('renderer', 'index.html'), {
          query: { orbitMode: 'media-keyboard' }
        })
    await this.keyboardReady
  }

  private mediaDisplayBounds(): Rectangle {
    const mainWindow = this.mainWindow
    return mainWindow && !mainWindow.isDestroyed()
      ? screen.getDisplayMatching(mainWindow.getBounds()).bounds
      : screen.getPrimaryDisplay().bounds
  }

  private finishSession(reveal: boolean): void {
    if (this.closeFallbackTimer) clearTimeout(this.closeFallbackTimer)
    this.closeFallbackTimer = null
    this.dismissHint()
    this.closeKeyboard()
    this.controller.dispose()
    this.client?.dispose()
    this.client = null
    this.edgeProcess = null
    this.pendingDirection = null
    this.directionActionScheduled = false
    this.actionQueue = Promise.resolve()
    const mainWindow = this.mainWindow
    this.mainWindow = null
    if (reveal && mainWindow && !mainWindow.isDestroyed()) void revealOrbitWindow(mainWindow)
  }

  private closeEdgeProfileProcesses(): Promise<void> {
    const profileDirectory = this.profileDirectory
    if (!profileDirectory || process.platform !== 'win32') return Promise.resolve()
    const encodedProfile = Buffer.from(profileDirectory, 'utf8').toString('base64')
    const script = [
      `$target = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedProfile}'))`,
      `$processes = @(Get-CimInstance Win32_Process -Filter \"name = 'msedge.exe'\" | Where-Object { ([string]$_.CommandLine).IndexOf($target, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 })`,
      `foreach ($process in $processes) { Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue }`
    ].join('\n')
    const encodedCommand = Buffer.from(script, 'utf16le').toString('base64')
    return new Promise((resolve) => {
      execFile(
        'powershell.exe',
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodedCommand],
        { windowsHide: true },
        () => resolve()
      )
    })
  }
}

export const netflixMediaService = new NetflixMediaService()
