import { BrowserWindow, safeStorage, session } from 'electron'
import Store from 'electron-store'
import type { EpicAccount, EpicLoginStatus } from '@shared/ipc'
import { t } from '../i18n'

const SESSION_PARTITION = 'persist:orbit-epic-login'
const EPIC_LOGIN_URL = 'https://www.epicgames.com/id/login?responseType=code'
const EPIC_OAUTH_URL = 'https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/token'
const EPIC_ACCOUNT_URL = 'https://account-public-service-prod03.ol.epicgames.com/account/api/public/account/'
const EPIC_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) EpicGamesLauncher'

// Public Epic Games Launcher OAuth client used by Playnite's built-in Epic
// integration. It authorizes a launcher session; it is not a user credential.
const EPIC_LAUNCHER_BASIC =
  'MzRhMDJjZjhmNDQxNGUyOWIxNTkyMTg3NmRhMzZmOWE6ZGFhZmJjY2M3Mzc3NDUwMzlkZmZlNTNkOTRmYzc2Y2Y='

export interface EpicOAuthTokens {
  access_token: string
  expires_in?: number
  expires_at?: string
  token_type?: string
  refresh_token: string
  refresh_expires?: number
  refresh_expires_at?: string
  account_id: string
}

interface EncryptedTokenStore {
  payload?: string
}

const tokenStore = new Store<EncryptedTokenStore>({
  name: 'orbit-epic-auth',
  defaults: {}
})
const accountCache = new Store<{ account?: EpicAccount }>({
  name: 'orbit-epic-account',
  defaults: {}
})

function getLoginSession(): Electron.Session {
  return session.fromPartition(SESSION_PARTITION)
}

function parseRedirectCode(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.hostname !== 'localhost' || !url.pathname.toLowerCase().includes('/launcher/authorized')) {
      return null
    }
    return url.searchParams.get('code')?.trim() || null
  } catch {
    const match = value.match(/localhost\/launcher\/authorized\?code=([^&\s"'<>]+)/i)
    return match?.[1] ? decodeURIComponent(match[1]) : null
  }
}

function tokenExpiry(tokens: EpicOAuthTokens): number {
  const explicit = tokens.expires_at ? Date.parse(tokens.expires_at) : NaN
  if (Number.isFinite(explicit)) return explicit
  return Date.now() + Math.max(0, Number(tokens.expires_in ?? 0)) * 1000
}

export class EpicAuthManager {
  private account: EpicAccount | null = null
  private tokens: EpicOAuthTokens | null = null
  private tokenExpiresAt = 0
  private loginWindow: BrowserWindow | null = null
  private refreshInFlight: Promise<EpicOAuthTokens> | null = null

  async restoreSession(): Promise<EpicAccount | null> {
    const tokens = this.loadTokens()
    if (!tokens) {
      this.account = null
      return null
    }

    this.tokens = tokens
    this.tokenExpiresAt = tokenExpiry(tokens)
    const cached = accountCache.get('account')
    try {
      const account = await this.fetchAccount()
      this.account = account
      accountCache.set('account', account)
      return account
    } catch {
      // An offline startup must not discard a still-refreshable account. The
      // next library refresh retries token validation before making API calls.
      if (cached?.accountId === tokens.account_id) {
        this.account = cached
        return cached
      }
      this.account = null
      return null
    }
  }

  getAccount(): EpicAccount | null {
    return this.account
  }

  async getAccessToken(forceRefresh = false): Promise<string> {
    if (!this.tokens) {
      const loaded = this.loadTokens()
      if (!loaded) throw new Error(t('epicNoActiveSession'))
      this.tokens = loaded
      this.tokenExpiresAt = tokenExpiry(loaded)
    }
    if (forceRefresh || Date.now() >= this.tokenExpiresAt - 60_000) {
      await this.refreshTokens()
    }
    if (!this.tokens?.access_token) throw new Error(t('epicNoActiveSession'))
    return this.tokens.access_token
  }

  async fetchAuthenticated(url: string | URL, init?: RequestInit, retry = true): Promise<Response> {
    const accessToken = await this.getAccessToken()
    const headers = new Headers(init?.headers)
    headers.set('Authorization', `bearer ${accessToken}`)
    headers.set('User-Agent', EPIC_USER_AGENT)
    const response = await fetch(url, {
      ...init,
      headers,
      signal: init?.signal ?? AbortSignal.timeout(25_000)
    })
    if (response.status === 401 && retry) {
      await this.getAccessToken(true)
      return this.fetchAuthenticated(url, init, false)
    }
    return response
  }

  async startLogin(
    onStatus: (status: EpicLoginStatus) => void,
    parent?: BrowserWindow
  ): Promise<void> {
    this.loginWindow?.close()
    onStatus({ state: 'waiting-for-browser' })
    await getLoginSession().clearStorageData({ origin: 'https://www.epicgames.com' })

    return new Promise((resolve) => {
      let settled = false
      let processing = false
      const win = new BrowserWindow({
        width: 620,
        height: 760,
        title: 'Epic Games',
        autoHideMenuBar: true,
        parent,
        modal: Boolean(parent),
        backgroundColor: '#0b0b0d',
        webPreferences: {
          partition: SESSION_PARTITION,
          sandbox: true,
          nodeIntegration: false,
          contextIsolation: true
        }
      })
      this.loginWindow = win
      win.webContents.setUserAgent(EPIC_USER_AGENT)

      const finish = async (code: string): Promise<void> => {
        if (settled || processing) return
        processing = true
        try {
          const tokens = await this.exchangeCode(code)
          this.rememberTokens(tokens)
          const account = await this.fetchAccount()
          this.account = account
          accountCache.set('account', account)
          settled = true
          onStatus({ state: 'success', account })
          win.close()
        } catch (error) {
          settled = true
          onStatus({
            state: 'error',
            message: error instanceof Error ? error.message : t('epicLoginFailed')
          })
          win.close()
        } finally {
          resolve()
        }
      }

      const inspectUrl = (url: string): void => {
        const code = parseRedirectCode(url)
        if (code) void finish(code)
      }

      win.webContents.on('will-redirect', (event, url) => {
        const code = parseRedirectCode(url)
        if (code) {
          event.preventDefault()
          void finish(code)
        }
      })
      win.webContents.on('will-navigate', (event, url) => {
        const code = parseRedirectCode(url)
        if (code) {
          event.preventDefault()
          void finish(code)
        }
      })
      win.webContents.on('did-navigate', (_event, url) => inspectUrl(url))
      win.webContents.on('did-navigate-in-page', (_event, url) => inspectUrl(url))
      win.webContents.on('did-fail-load', (_event, _code, _description, url, isMainFrame) => {
        if (isMainFrame) inspectUrl(url)
      })
      win.webContents.setWindowOpenHandler(({ url }) => {
        void win.loadURL(url)
        return { action: 'deny' }
      })

      win.on('closed', () => {
        this.loginWindow = null
        if (!settled) {
          settled = true
          onStatus({ state: 'idle' })
          resolve()
        }
      })

      void win.loadURL(EPIC_LOGIN_URL)
    })
  }

  cancelLogin(): void {
    this.loginWindow?.close()
  }

  async logout(): Promise<void> {
    this.loginWindow?.close()
    await getLoginSession().clearStorageData()
    tokenStore.clear()
    accountCache.clear()
    this.tokens = null
    this.tokenExpiresAt = 0
    this.account = null
  }

  private async exchangeCode(code: string): Promise<EpicOAuthTokens> {
    return this.exchangeTokens({
      grant_type: 'authorization_code',
      code,
      token_type: 'eg1'
    })
  }

  private async refreshTokens(): Promise<EpicOAuthTokens> {
    if (this.refreshInFlight) return this.refreshInFlight
    if (!this.tokens?.refresh_token) throw new Error(t('epicNoActiveSession'))
    this.refreshInFlight = this.exchangeTokens({
      grant_type: 'refresh_token',
      refresh_token: this.tokens.refresh_token,
      token_type: 'eg1'
    })
    try {
      const tokens = await this.refreshInFlight
      this.rememberTokens(tokens)
      return tokens
    } finally {
      this.refreshInFlight = null
    }
  }

  private async exchangeTokens(fields: Record<string, string>): Promise<EpicOAuthTokens> {
    const response = await fetch(EPIC_OAUTH_URL, {
      method: 'POST',
      headers: {
        Authorization: `basic ${EPIC_LAUNCHER_BASIC}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': EPIC_USER_AGENT
      },
      body: new URLSearchParams(fields),
      signal: AbortSignal.timeout(25_000)
    })
    const body = (await response.json().catch(() => null)) as
      | (Partial<EpicOAuthTokens> & { errorMessage?: string })
      | null
    if (!response.ok || !body?.access_token || !body.refresh_token || !body.account_id) {
      throw new Error(body?.errorMessage || t('epicLoginFailed'))
    }
    return body as EpicOAuthTokens
  }

  private async fetchAccount(): Promise<EpicAccount> {
    if (!this.tokens?.account_id) throw new Error(t('epicNoActiveSession'))
    const response = await this.fetchAuthenticated(
      `${EPIC_ACCOUNT_URL}${encodeURIComponent(this.tokens.account_id)}`
    )
    const body = (await response.json().catch(() => null)) as
      | { id?: string; displayName?: string; errorMessage?: string }
      | null
    if (!response.ok || !body?.id) throw new Error(body?.errorMessage || t('epicLoginFailed'))
    return {
      accountId: body.id,
      displayName: body.displayName?.trim() || 'Epic User'
    }
  }

  private rememberTokens(tokens: EpicOAuthTokens): void {
    this.tokens = tokens
    this.tokenExpiresAt = tokenExpiry(tokens)
    if (!safeStorage.isEncryptionAvailable()) return
    const encrypted = safeStorage.encryptString(JSON.stringify(tokens))
    tokenStore.set('payload', encrypted.toString('base64'))
  }

  private loadTokens(): EpicOAuthTokens | null {
    const payload = tokenStore.get('payload')
    if (!payload || !safeStorage.isEncryptionAvailable()) return this.tokens
    try {
      const json = safeStorage.decryptString(Buffer.from(payload, 'base64'))
      const tokens = JSON.parse(json) as EpicOAuthTokens
      return tokens.access_token && tokens.refresh_token && tokens.account_id ? tokens : null
    } catch {
      return null
    }
  }
}

export const epicAuthManager = new EpicAuthManager()
