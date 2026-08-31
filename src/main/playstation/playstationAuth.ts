import { randomUUID } from 'node:crypto'
import { BrowserWindow, safeStorage, session } from 'electron'
import Store from 'electron-store'
import {
  exchangeAccessCodeForAuthTokens,
  exchangeNpssoForAccessCode,
  exchangeRefreshTokenForAuthTokens,
  getAccountDevices,
  getProfileFromAccountId,
  type AuthTokensResponse
} from 'psn-api'
import type {
  PlayStationAccount,
  PlayStationLoginStatus
} from '@shared/ipc'
import { extractPlayStationNpsso } from '@shared/playstation'

const SESSION_PARTITION = 'orbit-playstation-login'
const OAUTH_REDIRECT_URI = 'com.scee.psxandroid.scecompcall://redirect'
const OAUTH_CLIENT_ID = '09515159-7237-4370-9b40-3806e67c0891'
const OAUTH_SCOPE = 'psn:mobile.v2.core psn:clientapp'
const ACCESS_TOKEN_SKEW_MS = 60_000

// Sony rejects many embedded-browser fingerprints. Keep this dedicated profile
// aligned with the current desktop-browser identity used by Chiaki-ng.
const browserEpoch = Date.UTC(2025, 1, 18)
const browserAgeDays = Math.max(0, Math.floor((Date.now() - browserEpoch) / 86_400_000))
const chromiumMajor = String(133 + Math.floor(browserAgeDays / 28))
const chromiumVersion = `${chromiumMajor}.0.0.0`
const LOGIN_USER_AGENT =
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ` +
  `(KHTML, like Gecko) Chrome/${chromiumVersion} Safari/537.36 Edg/${chromiumVersion}`
const LOGIN_CLIENT_HINTS =
  `"Not(A:Brand";v="99", "Microsoft Edge";v="${chromiumMajor}", ` +
  `"Chromium";v="${chromiumMajor}"`
const LOGIN_FULL_CLIENT_HINTS =
  `"Not A(Brand";v="99.0.0.0", "Microsoft Edge";v="${chromiumVersion}", ` +
  `"Chromium";v="${chromiumVersion}"`

let loginSessionConfigured = false
const TRUSTED_SONY_DOMAINS = [
  'sony.com',
  'playstation.com',
  'playstation.net',
  'sonyentertainmentnetwork.com'
] as const

interface StoredTokens extends AuthTokensResponse {
  obtainedAt: number
}

interface EncryptedTokenStore {
  payload?: string
}

const tokenStore = new Store<EncryptedTokenStore>({
  name: 'orbit-playstation-auth',
  defaults: {}
})
const accountCache = new Store<{ account?: PlayStationAccount }>({
  name: 'orbit-playstation-account',
  defaults: {}
})

function getLoginSession(): Electron.Session {
  const loginSession = session.fromPartition(SESSION_PARTITION)
  if (loginSessionConfigured) return loginSession
  loginSessionConfigured = true

  loginSession.setUserAgent(LOGIN_USER_AGENT, 'de-DE,de,en-US,en')
  loginSession.setPermissionCheckHandler(() => false)
  loginSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  loginSession.webRequest.onBeforeSendHeaders(
    { urls: ['https://*/*'] },
    (details, callback) => {
      const headers = { ...details.requestHeaders }
      for (const name of Object.keys(headers)) {
        const normalized = name.toLowerCase()
        if (
          normalized === 'user-agent' ||
          normalized === 'sec-ch-ua' ||
          normalized === 'sec-ch-ua-full-version-list' ||
          normalized === 'sec-ch-ua-mobile' ||
          normalized === 'sec-ch-ua-platform'
        ) {
          delete headers[name]
        }
      }
      headers['User-Agent'] = LOGIN_USER_AGENT
      headers['sec-ch-ua'] = LOGIN_CLIENT_HINTS
      headers['sec-ch-ua-full-version-list'] = LOGIN_FULL_CLIENT_HINTS
      headers['sec-ch-ua-mobile'] = '?0'
      headers['sec-ch-ua-platform'] = '"Windows"'
      callback({ requestHeaders: headers })
    }
  )
  return loginSession
}

async function configureLoginIdentity(webContents: Electron.WebContents): Promise<void> {
  webContents.setUserAgent(LOGIN_USER_AGENT)
  try {
    webContents.debugger.attach('1.3')
    await webContents.debugger.sendCommand('Emulation.setUserAgentOverride', {
      userAgent: LOGIN_USER_AGENT,
      acceptLanguage: 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
      platform: 'Win32',
      userAgentMetadata: {
        brands: [
          { brand: 'Not(A:Brand', version: '99' },
          { brand: 'Microsoft Edge', version: chromiumMajor },
          { brand: 'Chromium', version: chromiumMajor }
        ],
        fullVersionList: [
          { brand: 'Not A(Brand', version: '99.0.0.0' },
          { brand: 'Microsoft Edge', version: chromiumVersion },
          { brand: 'Chromium', version: chromiumVersion }
        ],
        fullVersion: chromiumVersion,
        platform: 'Windows',
        platformVersion: '10.0.0',
        architecture: 'x86',
        bitness: '64',
        model: '',
        mobile: false,
        wow64: false
      }
    })
  } catch {
    try {
      if (webContents.debugger.isAttached()) webContents.debugger.detach()
    } catch {
      // Navigation still works with the session-level identity fallback.
    }
  }
}

function authorizationUrl(state: string): string {
  const url = new URL('https://ca.account.sony.com/api/authz/v3/oauth/authorize')
  url.search = new URLSearchParams({
    access_type: 'offline',
    client_id: OAUTH_CLIENT_ID,
    redirect_uri: OAUTH_REDIRECT_URI,
    response_type: 'code',
    scope: OAUTH_SCOPE,
    state
  }).toString()
  return url.toString()
}

interface OAuthRedirect {
  code?: string
  state?: string
  error?: string
  errorDescription?: string
}

function oauthRedirectFromUrl(value: string): OAuthRedirect | null {
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'com.scee.psxandroid.scecompcall:' ||
      url.hostname !== 'redirect' ||
      (url.pathname !== '' && url.pathname !== '/') ||
      url.username ||
      url.password ||
      url.port
    ) {
      return null
    }
    const code = url.searchParams.get('code')?.trim()
    const error = url.searchParams.get('error')?.trim()
    const errorDescription = url.searchParams.get('error_description')?.trim()
    return {
      code: code && code.length <= 2_048 ? code : undefined,
      state: url.searchParams.get('state')?.trim() || undefined,
      error: error && error.length <= 160 ? error : undefined,
      errorDescription:
        errorDescription && errorDescription.length <= 500 ? errorDescription : undefined
    }
  } catch {
    return null
  }
}

function isTrustedSonyUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return false
    const host = url.hostname.toLowerCase()
    return isTrustedSonyHost(host)
  } catch {
    return false
  }
}

function isTrustedSonyHost(value: string): boolean {
  const host = value.trim().toLowerCase().replace(/^\.+/, '')
  return TRUSTED_SONY_DOMAINS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`)
  )
}

function normalizedTokens(tokens: AuthTokensResponse): StoredTokens {
  if (
    !tokens ||
    typeof tokens.accessToken !== 'string' ||
    !tokens.accessToken ||
    typeof tokens.refreshToken !== 'string' ||
    !tokens.refreshToken ||
    !Number.isFinite(tokens.expiresIn)
  ) {
    throw new Error('PlayStation did not return a valid session')
  }
  return { ...tokens, obtainedAt: Date.now() }
}

function trustedAvatarUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    if (
      url.protocol !== 'https:' ||
      !(
        host === 'playstation.com' ||
        host.endsWith('.playstation.com') ||
        host === 'playstation.net' ||
        host.endsWith('.playstation.net')
      )
    ) {
      return undefined
    }
    return url.toString()
  } catch {
    return undefined
  }
}

export class PlayStationAuthManager {
  private account: PlayStationAccount | null = null
  private tokens: StoredTokens | null = null
  private refreshInFlight: Promise<StoredTokens> | null = null
  private loginWindow: BrowserWindow | null = null
  private authGeneration = 0

  getAccount(): PlayStationAccount | null {
    return this.account
  }

  async restoreSession(): Promise<PlayStationAccount | null> {
    const generation = this.authGeneration
    const tokens = this.loadTokens()
    if (!tokens) {
      this.account = null
      return null
    }
    this.tokens = tokens
    const cached = accountCache.get('account')
    try {
      const account = await this.fetchAccount()
      if (generation !== this.authGeneration) return null
      this.account = account
      accountCache.set('account', account)
      return account
    } catch {
      if (generation !== this.authGeneration) return null
      // Keep a refreshable account visible during an offline startup. The next
      // provider refresh validates the token again before reading any library data.
      this.account = cached ?? null
      return this.account
    }
  }

  async getAccessToken(forceRefresh = false): Promise<string> {
    if (!this.tokens) this.tokens = this.loadTokens()
    if (!this.tokens) throw new Error('No active PlayStation session')
    const expiresAt = this.tokens.obtainedAt + Math.max(0, this.tokens.expiresIn) * 1_000
    if (forceRefresh || Date.now() >= expiresAt - ACCESS_TOKEN_SKEW_MS) {
      await this.refreshTokens()
    }
    if (!this.tokens?.accessToken) throw new Error('No active PlayStation session')
    return this.tokens.accessToken
  }

  async startLogin(
    onStatus: (status: PlayStationLoginStatus) => void,
    parentWindow?: BrowserWindow
  ): Promise<void> {
    if (this.loginWindow && !this.loginWindow.isDestroyed()) {
      this.loginWindow.show()
      this.loginWindow.focus()
      return
    }

    const generation = ++this.authGeneration
    const reportStatus = (status: PlayStationLoginStatus): void => {
      try {
        onStatus(status)
      } catch {
        // The parent renderer may have closed while authentication was finishing.
      }
    }
    reportStatus({ state: 'waiting-for-browser' })
    const oauthState = randomUUID()
    const loginSession = getLoginSession()
    const parent = parentWindow && !parentWindow.isDestroyed() ? parentWindow : undefined
    const loginWindow = new BrowserWindow({
      width: 680,
      height: 820,
      minWidth: 480,
      minHeight: 620,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      title: 'Bei PlayStation anmelden',
      ...(parent ? { parent, modal: true } : {}),
      webPreferences: {
        partition: SESSION_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        devTools: false,
        spellcheck: false
      }
    })
    this.loginWindow = loginWindow

    await new Promise<void>((resolve, reject) => {
      let finished = false
      let authAttempt = 0
      let handledRedirectCode: string | null = null
      let handledNpsso: string | null = null
      let onCookieChanged: (
        event: Electron.Event,
        cookie: Electron.Cookie,
        cause: unknown,
        removed: boolean
      ) => void = () => undefined

      const isActive = (): boolean =>
        !finished &&
        generation === this.authGeneration &&
        this.loginWindow === loginWindow &&
        !loginWindow.isDestroyed()

      const restoreParentFocus = (): void => {
        if (!parent || parent.isDestroyed()) return
        parent.show()
        parent.focus()
      }

      const cleanup = (): void => {
        loginSession.cookies.off('changed', onCookieChanged)
        try {
          if (
            !loginWindow.webContents.isDestroyed() &&
            loginWindow.webContents.debugger.isAttached()
          ) {
            loginWindow.webContents.debugger.detach()
          }
        } catch {
          // The renderer may already have exited.
        }
      }

      const closeLoginWindow = (): void => {
        if (!loginWindow.isDestroyed()) loginWindow.destroy()
      }

      const fail = (cause: unknown): void => {
        if (finished) return
        finished = true
        cleanup()
        if (this.loginWindow === loginWindow) this.loginWindow = null
        const error = cause instanceof Error ? cause : new Error('PlayStation sign-in failed')
        reportStatus({ state: 'error', message: error.message })
        closeLoginWindow()
        restoreParentFocus()
        reject(error)
      }

      const completeLogin = async (
        exchangeTokens: () => Promise<AuthTokensResponse>,
        fatal: boolean
      ): Promise<void> => {
        if (!isActive()) return
        const attempt = ++authAttempt
        try {
          const tokens = normalizedTokens(await exchangeTokens())
          if (!isActive() || attempt !== authAttempt) return
          const account = await this.fetchAccountForTokens(tokens)
          if (!isActive() || attempt !== authAttempt) return

          this.tokens = tokens
          this.account = account
          this.persistTokens(tokens)
          accountCache.set('account', account)

          finished = true
          cleanup()
          await loginSession.clearStorageData({ storages: ['cookies'] }).catch(() => undefined)
          if (this.loginWindow === loginWindow) this.loginWindow = null
          reportStatus({ state: 'success', account })
          closeLoginWindow()
          restoreParentFocus()
          resolve()
        } catch (error) {
          if (fatal && isActive() && attempt === authAttempt) fail(error)
        }
      }

      const captureRedirect = (
        value: string,
        event?: { preventDefault: () => void }
      ): boolean => {
        const redirect = oauthRedirectFromUrl(value)
        if (!redirect) return false
        event?.preventDefault()
        if (redirect.state !== oauthState) {
          fail(new Error('PlayStation returned an invalid sign-in state'))
          return true
        }
        if (redirect.error) {
          fail(new Error(redirect.errorDescription || redirect.error))
          return true
        }
        if (!redirect.code) {
          fail(new Error('PlayStation did not return an authorization code'))
          return true
        }
        const code = redirect.code
        if (handledRedirectCode === code) return true
        handledRedirectCode = code
        void completeLogin(() => exchangeAccessCodeForAuthTokens(code), true)
        return true
      }

      onCookieChanged = (
        _event: Electron.Event,
        cookie: Electron.Cookie,
        _cause: unknown,
        removed: boolean
      ): void => {
        if (
          removed ||
          handledRedirectCode ||
          cookie.name.toLowerCase() !== 'npsso' ||
          !cookie.value ||
          !cookie.secure ||
          !isTrustedSonyHost(cookie.domain ?? '')
        ) {
          return
        }
        try {
          const npsso = extractPlayStationNpsso(cookie.value)
          if (handledNpsso === npsso) return
          handledNpsso = npsso
          void completeLogin(async () => {
            const code = await exchangeNpssoForAccessCode(npsso)
            return exchangeAccessCodeForAuthTokens(code)
          }, false)
        } catch {
          // Ignore malformed or transitional cookie writes and keep the Sony page open.
        }
      }

      loginSession.cookies.on('changed', onCookieChanged)
      loginWindow.once('ready-to-show', () => {
        if (isActive()) loginWindow.show()
      })
      loginWindow.on('closed', () => {
        cleanup()
        if (this.loginWindow === loginWindow) this.loginWindow = null
        if (!finished) {
          finished = true
          reportStatus({ state: 'idle' })
          resolve()
        }
        restoreParentFocus()
      })
      loginWindow.webContents.on('will-redirect', (event, url) => {
        if (captureRedirect(url, event)) return
        if (!isTrustedSonyUrl(url)) event.preventDefault()
      })
      loginWindow.webContents.on('will-navigate', (event, url) => {
        if (captureRedirect(url, event)) return
        if (!isTrustedSonyUrl(url)) event.preventDefault()
      })
      loginWindow.webContents.on(
        'did-start-navigation',
        (_event, url, _isInPlace, isMainFrame) => {
          if (isMainFrame) captureRedirect(url)
        }
      )
      loginWindow.webContents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
        if (isMainFrame) captureRedirect(url)
      })
      loginWindow.webContents.on(
        'did-fail-load',
        (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
          if (!isMainFrame || captureRedirect(validatedUrl) || errorCode === -3) return
          fail(new Error(errorDescription + ' (' + String(errorCode) + ')'))
        }
      )
      loginWindow.webContents.on('render-process-gone', () => {
        fail(new Error('The PlayStation sign-in window stopped unexpectedly'))
      })
      loginWindow.webContents.on('will-prevent-unload', (event) => {
        event.preventDefault()
      })
      loginWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (captureRedirect(url)) return { action: 'deny' }
        if (isTrustedSonyUrl(url) && isActive()) void loginWindow.loadURL(url).catch(fail)
        return { action: 'deny' }
      })

      void configureLoginIdentity(loginWindow.webContents)
        .then(() => loginWindow.loadURL(authorizationUrl(oauthState)))
        .catch(fail)
    })
  }

  cancelLogin(): void {
    if (this.loginWindow && !this.loginWindow.isDestroyed()) this.loginWindow.destroy()
  }

  async logout(): Promise<void> {
    this.authGeneration += 1
    this.cancelLogin()
    await session.fromPartition(SESSION_PARTITION).clearStorageData()
    tokenStore.delete('payload')
    accountCache.delete('account')
    this.tokens = null
    this.account = null
  }

  private async fetchAccount(): Promise<PlayStationAccount> {
    const accessToken = await this.getAccessToken()
    if (!this.tokens) throw new Error('No active PlayStation session')
    return this.fetchAccountForTokens({ ...this.tokens, accessToken })
  }

  private async fetchAccountForTokens(tokens: StoredTokens): Promise<PlayStationAccount> {
    const self = await getAccountDevices({ accessToken: tokens.accessToken })
    const accountId = typeof self.accountId === 'string' ? self.accountId.trim() : ''
    if (!/^\d{1,20}$/.test(accountId)) {
      throw new Error('PlayStation did not return a valid account ID')
    }
    const profile = await getProfileFromAccountId({ accessToken: tokens.accessToken }, accountId)
    const onlineId = profile.onlineId?.trim()
    if (!onlineId || onlineId.length > 64) throw new Error('PlayStation profile is unavailable')
    const avatarUrl = trustedAvatarUrl(
      [...(profile.avatars ?? [])].reverse().find((avatar) => avatar.url)?.url
    )
    return {
      accountId,
      onlineId,
      avatarUrl
    }
  }

  private async refreshTokens(): Promise<StoredTokens> {
    if (this.refreshInFlight) return this.refreshInFlight
    if (!this.tokens?.refreshToken) throw new Error('No active PlayStation session')
    const generation = this.authGeneration
    const refreshToken = this.tokens.refreshToken
    const refresh = exchangeRefreshTokenForAuthTokens(refreshToken)
      .then(normalizedTokens)
      .then((tokens) => {
        if (generation !== this.authGeneration) {
          throw new Error('PlayStation session changed while refreshing')
        }
        this.tokens = tokens
        this.persistTokens(tokens)
        return tokens
      })
      .finally(() => {
        if (this.refreshInFlight === refresh) this.refreshInFlight = null
      })
    this.refreshInFlight = refresh
    return refresh
  }

  private persistTokens(tokens: StoredTokens): void {
    if (!safeStorage.isEncryptionAvailable()) return
    const encrypted = safeStorage.encryptString(JSON.stringify(tokens))
    tokenStore.set('payload', encrypted.toString('base64'))
  }

  private loadTokens(): StoredTokens | null {
    const payload = tokenStore.get('payload')
    if (!payload || !safeStorage.isEncryptionAvailable()) return this.tokens
    try {
      const parsed = JSON.parse(
        safeStorage.decryptString(Buffer.from(payload, 'base64'))
      ) as AuthTokensResponse & { obtainedAt?: unknown }
      return {
        ...normalizedTokens(parsed),
        obtainedAt:
          typeof parsed.obtainedAt === 'number' && Number.isFinite(parsed.obtainedAt)
            ? parsed.obtainedAt
            : Date.now()
      }
    } catch {
      return null
    }
  }
}

export const playStationAuthManager = new PlayStationAuthManager()
