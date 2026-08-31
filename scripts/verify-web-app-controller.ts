import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import {
  WEB_APP_CONTROLLER_RUNTIME,
  webAppActionExpression,
  type WebAppActionResult,
  type WebAppControllerConfig
} from '../src/main/webAppControllerRuntime.ts'

const config: WebAppControllerConfig = {
  allowedHostSuffixes: ['netflix.com'],
  searchPathHints: ['/search'],
  searchTerms: ['search', 'suche'],
  playerSelectors: ['[data-uia="watch-video"]', '[data-uia="player"]'],
  playerControlSelectors: ['[data-uia="controls-standard"]'],
  playerInitialFocusSelectors: [
    '[data-uia="control-play-pause-play"]',
    '[data-uia="control-play-pause-pause"]'
  ]
}

const runtime = new Function(`return (${WEB_APP_CONTROLLER_RUNTIME})`)()
assert.equal(typeof runtime, 'function', 'controller runtime must compile to a function')
assert.match(
  webAppActionExpression(config, { type: 'direction', direction: 'right' }),
  /allowedHostSuffixes/,
  'every page action carries its explicit host allowlist'
)

interface PendingRequest {
  resolve: (value: Record<string, unknown>) => void
  reject: (error: Error) => void
}

class TestCdpClient {
  private nextId = 1
  private pending = new Map<number, PendingRequest>()
  private readonly socket: WebSocket

  private constructor(socket: WebSocket) {
    this.socket = socket
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number
        result?: Record<string, unknown>
        error?: { message?: string }
      }
      if (!message.id) return
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message || 'CDP error'))
      else pending.resolve(message.result ?? {})
    })
  }

  static async connect(url: string): Promise<TestCdpClient> {
    const socket = new WebSocket(url)
    await new Promise<void>((resolveOpen, rejectOpen) => {
      const timer = setTimeout(() => rejectOpen(new Error('CDP connection timeout')), 5_000)
      socket.addEventListener('open', () => {
        clearTimeout(timer)
        resolveOpen()
      }, { once: true })
      socket.addEventListener('error', () => {
        clearTimeout(timer)
        rejectOpen(new Error('CDP connection failed'))
      }, { once: true })
    })
    return new TestCdpClient(socket)
  }

  async send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = this.nextId++
    return new Promise((resolveRequest, rejectRequest) => {
      this.pending.set(id, { resolve: resolveRequest, reject: rejectRequest })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate<T>(expression: string): Promise<T> {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    })
    assert.equal(result.exceptionDetails, undefined, 'runtime evaluation must not throw')
    return ((result.result as { value?: T } | undefined)?.value ?? {}) as T
  }
}

function edgeExecutable(): string | null {
  const candidates = [
    process.env['PROGRAMFILES(X86)'] && join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env['PROGRAMFILES'] && join(process.env['PROGRAMFILES'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env['LOCALAPPDATA'] && join(process.env['LOCALAPPDATA'], 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ].filter((candidate): candidate is string => Boolean(candidate))
  return candidates.find(existsSync) ?? null
}

async function waitForNetflixTarget(profileDirectory: string): Promise<string> {
  const deadline = Date.now() + 20_000
  const portFile = join(profileDirectory, 'DevToolsActivePort')
  while (Date.now() < deadline) {
    try {
      const [portLine] = (await readFile(portFile, 'utf8')).split(/\r?\n/)
      const port = Number.parseInt(portLine, 10)
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      const targets = (await response.json()) as Array<{
        type?: string
        url?: string
        webSocketDebuggerUrl?: string
      }>
      const target = targets.find((candidate) => {
        if (candidate.type !== 'page' || !candidate.url || !candidate.webSocketDebuggerUrl) return false
        const url = new URL(candidate.url)
        return url.hostname === 'netflix.com' || url.hostname.endsWith('.netflix.com')
      })
      if (target?.webSocketDebuggerUrl) return target.webSocketDebuggerUrl
    } catch {
      // Edge creates its debugger endpoint asynchronously.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150))
  }
  throw new Error('Netflix target did not become ready')
}

async function stopProfileProcesses(profileDirectory: string): Promise<void> {
  const encodedProfile = Buffer.from(profileDirectory, 'utf8').toString('base64')
  const script = [
    `$target = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedProfile}'))`,
    `$processes = @(Get-CimInstance Win32_Process -Filter \"name = 'msedge.exe'\" | Where-Object { ([string]$_.CommandLine).IndexOf($target, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 })`,
    `foreach ($process in $processes) { Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue }`
  ].join('\n')
  const encodedCommand = Buffer.from(script, 'utf16le').toString('base64')
  await new Promise<void>((resolveStop) => {
    const child = spawn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodedCommand],
      { windowsHide: true, stdio: 'ignore' }
    )
    child.once('exit', () => resolveStop())
    child.once('error', () => resolveStop())
  })
}

async function verifyModalFocusScope(
  client: TestCdpClient,
  viewport: { width: number; height: number }
): Promise<void> {
  await client.send('Emulation.setDeviceMetricsOverride', {
    ...viewport,
    deviceScaleFactor: 1,
    mobile: false
  })
  await client.evaluate<boolean>(String.raw`
    (() => {
      document.getElementById('orbit-controller-test-stage')?.remove()
      const stage = document.createElement('div')
      stage.id = 'orbit-controller-test-stage'
      const background = document.createElement('button')
      background.id = 'orbit-controller-test-background'
      background.textContent = 'Background title'
      background.style.cssText = 'position:fixed;left:18px;top:48%;width:180px;height:64px;z-index:99990'
      background.addEventListener('click', () => {
        window.__orbitTestBackgroundClicks = (window.__orbitTestBackgroundClicks || 0) + 1
      })
      const dialog = document.createElement('section')
      dialog.id = 'orbit-controller-test-dialog'
      dialog.setAttribute('role', 'dialog')
      dialog.setAttribute('aria-modal', 'true')
      dialog.style.cssText = 'position:fixed;inset:12% 20%;z-index:99999;background:#111;display:flex;align-items:center;justify-content:center;gap:40px'
      for (const label of ['Play', 'My list', 'Close']) {
        const button = document.createElement('button')
        button.textContent = label
        button.style.cssText = 'width:150px;height:70px'
        dialog.appendChild(button)
      }
      stage.append(background, dialog)
      document.body.appendChild(stage)
      window.__orbitTestBackgroundClicks = 0
      window.__orbitWebControllerState = {
        lastRect: null,
        lastUrl: location.href,
        scopeRoot: document.documentElement,
        scopeFocus: new WeakMap()
      }
      document.querySelectorAll('[data-orbit-media-focus]').forEach((element) =>
        element.removeAttribute('data-orbit-media-focus')
      )
      background.setAttribute('data-orbit-media-focus', 'true')
      background.focus()
      return true
    })()
  `)
  await client.evaluate<WebAppActionResult>(
    webAppActionExpression(config, { type: 'direction', direction: 'right' })
  )
  const panelFocus = await client.evaluate<boolean>(
    "Boolean(document.querySelector('[data-orbit-media-focus=\"true\"]')?.closest('#orbit-controller-test-dialog'))"
  )
  assert.equal(panelFocus, true, `${viewport.width}x${viewport.height}: modal must trap focus`)
  await client.evaluate<WebAppActionResult>(
    webAppActionExpression(config, { type: 'direction', direction: 'down' })
  )
  const focusStayedInPanel = await client.evaluate<boolean>(
    "Boolean(document.querySelector('[data-orbit-media-focus=\"true\"]')?.closest('#orbit-controller-test-dialog'))"
  )
  assert.equal(
    focusStayedInPanel,
    true,
    `${viewport.width}x${viewport.height}: direction input must not escape to the dimmed page`
  )
  const panelBack = await client.evaluate<WebAppActionResult>(
    webAppActionExpression(config, { type: 'back-context' })
  )
  assert.equal(panelBack.backContext?.hasDialog, true, 'back context must recognize the active panel')
  await client.evaluate<boolean>(
    "Boolean(document.getElementById('orbit-controller-test-dialog')?.remove() ?? true)"
  )
  await client.evaluate<WebAppActionResult>(webAppActionExpression(config, { type: 'confirm' }))
  const restoredBackground = await client.evaluate<{ clicks?: number; focused?: boolean }>(
    `({
      clicks: window.__orbitTestBackgroundClicks,
      focused: document.getElementById('orbit-controller-test-background')?.getAttribute('data-orbit-media-focus') === 'true'
    })`
  )
  assert.equal(restoredBackground.focused, true, 'closing a panel must restore its background focus')
  assert.equal(restoredBackground.clicks, 1, 'confirmation after closing must target the restored title')
  await client.evaluate<boolean>(
    "Boolean(document.getElementById('orbit-controller-test-stage')?.remove() ?? true)"
  )
}

async function verifyPlayerFocusScope(client: TestCdpClient): Promise<void> {
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 1_280,
    height: 720,
    deviceScaleFactor: 1,
    mobile: false
  })
  await client.evaluate<boolean>(String.raw`
    (() => {
      document.getElementById('orbit-player-test-stage')?.remove()
      const stage = document.createElement('div')
      stage.id = 'orbit-player-test-stage'
      const background = document.createElement('button')
      background.id = 'orbit-player-test-background'
      background.textContent = 'Background card'
      background.style.cssText = 'position:fixed;left:12px;top:48%;width:180px;height:64px;z-index:99990'
      const player = document.createElement('div')
      player.dataset.uia = 'watch-video'
      player.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#000'
      const video = document.createElement('video')
      video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%'
      const controls = document.createElement('div')
      controls.dataset.uia = 'controls-standard'
      controls.style.cssText = 'position:absolute;inset:0;opacity:0'
      const play = document.createElement('button')
      play.dataset.uia = 'control-play-pause-play'
      play.textContent = 'Play'
      play.style.cssText = 'position:absolute;left:32px;bottom:24px;width:88px;height:64px'
      const slider = document.createElement('button')
      slider.dataset.uia = 'timeline-knob'
      slider.setAttribute('role', 'slider')
      slider.textContent = 'Timeline'
      slider.style.cssText = 'position:absolute;left:45%;bottom:112px;width:120px;height:32px'
      const fullscreen = document.createElement('button')
      fullscreen.dataset.uia = 'control-fullscreen-enter'
      fullscreen.textContent = 'Fullscreen'
      fullscreen.style.cssText = 'position:absolute;right:32px;bottom:24px;width:112px;height:64px'
      controls.append(play, slider, fullscreen)
      player.append(video, controls)
      stage.append(background, player)
      document.body.appendChild(stage)
      window.__orbitWebControllerState = undefined
      window.addEventListener('mousemove', (event) => {
        if (event.clientX >= 0 && event.clientY >= 0) controls.style.opacity = '1'
      })
      return true
    })()
  `)
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: -32,
    y: -32,
    button: 'none',
    buttons: 0,
    pointerType: 'mouse'
  })
  const hiddenControls = await client.evaluate<WebAppActionResult>(
    webAppActionExpression(config, { type: 'direction', direction: 'right' })
  )
  assert.equal(hiddenControls.needsPlayerControls, true, 'hidden player controls must request a wake-up')
  assert.deepEqual(
    hiddenControls.pointerWake,
    { x: 640, y: 360 },
    'player wake-up must use a neutral point inside the video'
  )
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: hiddenControls.pointerWake?.x,
    y: hiddenControls.pointerWake?.y,
    button: 'none',
    buttons: 0,
    pointerType: 'mouse'
  })
  await new Promise((resolveWait) => setTimeout(resolveWait, 90))
  await client.evaluate<WebAppActionResult>(
    webAppActionExpression(config, { type: 'direction', direction: 'right' })
  )
  const playerFocus = await client.evaluate<{ focusUia?: string; backgroundFocused?: boolean; cursorHidden?: boolean }>(
    `(() => {
      const focused = document.querySelector('[data-orbit-media-focus="true"]')
      return {
        focusUia: focused?.getAttribute('data-uia'),
        backgroundFocused: document.getElementById('orbit-player-test-background')?.hasAttribute('data-orbit-media-focus'),
        cursorHidden: document.documentElement.getAttribute('data-orbit-controller-mode') === 'true'
      }
    })()`
  )
  assert.equal(playerFocus.focusUia, 'control-play-pause-play', 'player entry must focus Play/Pause')
  assert.notEqual(playerFocus.backgroundFocused, true, 'player focus must exclude the page behind it')
  assert.equal(playerFocus.cursorHidden, true, 'gamepad input must hide the web cursor')
  await client.evaluate<boolean>(
    `(() => {
      const slider = document.querySelector('[data-uia="timeline-knob"]')
      document.querySelectorAll('[data-orbit-media-focus]').forEach((element) =>
        element.removeAttribute('data-orbit-media-focus')
      )
      slider?.setAttribute('data-orbit-media-focus', 'true')
      slider?.focus()
      return Boolean(slider)
    })()`
  )
  const sliderDirection = await client.evaluate<WebAppActionResult>(
    webAppActionExpression(config, { type: 'direction', direction: 'right' })
  )
  assert.equal(sliderDirection.nativeKey, 'ArrowRight', 'horizontal slider input must become a native key')
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: 20,
    y: 20,
    button: 'none',
    buttons: 0,
    pointerType: 'mouse'
  })
  const cursorRestored = await client.evaluate<boolean>(
    "document.documentElement.getAttribute('data-orbit-controller-mode') !== 'true'"
  )
  assert.equal(cursorRestored, true, 'real mouse movement must restore the cursor immediately')
  await client.evaluate<boolean>(
    "Boolean(document.getElementById('orbit-player-test-stage')?.remove() ?? true)"
  )
}

async function runLiveCheck(): Promise<void> {
  assert.equal(process.platform, 'win32', 'live controller check currently requires Windows')
  const executable = edgeExecutable()
  assert.ok(executable, 'Microsoft Edge must be installed for the live check')
  const profileDirectory = await mkdtemp(join(tmpdir(), 'orbit-web-controller-'))
  const resolvedProfile = resolve(profileDirectory)
  const resolvedTemp = resolve(tmpdir())
  assert.ok(
    resolvedProfile.startsWith(`${resolvedTemp}${sep}`) && basename(resolvedProfile).startsWith('orbit-web-controller-'),
    'temporary profile must stay inside the OS temp directory'
  )

  try {
    spawn(
      executable,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--remote-debugging-port=0',
        '--remote-debugging-address=127.0.0.1',
        `--user-data-dir=${resolvedProfile}`,
        'https://www.netflix.com/browse'
      ],
      { windowsHide: true, stdio: 'ignore' }
    )
    const debuggerUrl = await waitForNetflixTarget(resolvedProfile)
    const client = await TestCdpClient.connect(debuggerUrl)
    const documentDeadline = Date.now() + 8_000
    let locationInfo: { protocol?: string; hostname?: string; href?: string } = {}
    while (Date.now() < documentDeadline) {
      locationInfo = await client.evaluate('({ protocol: location.protocol, hostname: location.hostname, href: location.href })')
      if (
        locationInfo.protocol === 'https:' &&
        (locationInfo.hostname === 'netflix.com' || locationInfo.hostname?.endsWith('.netflix.com'))
      ) break
      await new Promise((resolveWait) => setTimeout(resolveWait, 120))
    }
    assert.equal(locationInfo.protocol, 'https:', `Netflix document did not become trusted: ${locationInfo.href}`)
    const focusDeadline = Date.now() + 8_000
    let direction: WebAppActionResult = {}
    let focusApplied = false
    while (Date.now() < focusDeadline && !focusApplied) {
      direction = await client.evaluate<WebAppActionResult>(
        webAppActionExpression(config, { type: 'direction', direction: 'right' })
      )
      focusApplied = await client.evaluate<boolean>(
        "Boolean(document.querySelector('[data-orbit-media-focus=\"true\"]'))"
      )
      if (!focusApplied) await new Promise((resolveWait) => setTimeout(resolveWait, 180))
    }
    assert.notEqual(direction.blocked, true, 'Netflix must pass the configured host boundary')
    assert.equal(focusApplied, true, 'direction input must establish a visible controller focus')

    await verifyModalFocusScope(client, { width: 1_280, height: 720 })
    await verifyModalFocusScope(client, { width: 1_920, height: 1_080 })
    await verifyPlayerFocusScope(client)

    const back = await client.evaluate<WebAppActionResult>(
      webAppActionExpression(config, { type: 'back-context' })
    )
    assert.equal(typeof back.backContext?.url, 'string', 'back context must be available')
    await client.send('Page.navigate', { url: 'data:text/html,<title>untrusted</title>' })
    await new Promise((resolveWait) => setTimeout(resolveWait, 180))
    const blocked = await client.evaluate<WebAppActionResult>(
      webAppActionExpression(config, { type: 'confirm' })
    )
    assert.equal(blocked.blocked, true, 'controller DOM injection must stop outside allowed hosts')
    await client.send('Browser.close').catch(() => undefined)
  } finally {
    await stopProfileProcesses(resolvedProfile)
    await new Promise((resolveWait) => setTimeout(resolveWait, 350))
    await rm(resolvedProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 180 })
  }
}

if (process.argv.includes('--live')) {
  await runLiveCheck()
  console.log('ORBIT live web-app controller checks passed')
} else {
  console.log('ORBIT web-app controller syntax checks passed')
}
