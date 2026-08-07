import { EventEmitter } from 'node:events'
import { BrowserWindow, session, type Cookie } from 'electron'
import Store from 'electron-store'
import type { SteamAccount, SteamLoginStatus } from '@shared/ipc'
import { t } from '../i18n'

const SESSION_PARTITION = 'persist:orbit-steam-login'
const CHROME_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const accountCache = new Store<{ account?: SteamAccount }>({ name: 'orbit-steam-account' })

function getLoginSession(): Electron.Session {
  return session.fromPartition(SESSION_PARTITION)
}

async function readAllCookies(): Promise<Cookie[]> {
  return getLoginSession().cookies.get({})
}

/** SteamID64 lives inside the steamLoginSecure cookie as `<steamid>||<token>`. */
function extractSteamId(cookies: Cookie[]): string | null {
  const cookie = cookies.find(
    (c) =>
      c.name === 'steamLoginSecure' &&
      (c.domain?.includes('steampowered.com') || c.domain?.includes('steamcommunity.com'))
  )
  if (!cookie) return null
  const decoded = decodeURIComponent(cookie.value)
  const steamId = decoded.split('||')[0]
  return /^\d{17}$/.test(steamId) ? steamId : null
}

async function fetchPersonaName(steamId: string, cookies: Cookie[]): Promise<string | null> {
  try {
    const cookieHeader = cookies
      .filter((c) => c.domain?.includes('steampowered.com') || c.domain?.includes('steamcommunity.com'))
      .map((c) => `${c.name}=${c.value}`)
      .join('; ')

    const res = await fetch(`https://steamcommunity.com/profiles/${steamId}/?xml=1`, {
      headers: { Cookie: cookieHeader, 'User-Agent': CHROME_USER_AGENT }
    })
    if (!res.ok) return null
    const xml = await res.text()
    const match = xml.match(/<steamID><!\[CDATA\[(.*?)\]\]><\/steamID>/)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

/**
 * Signs the user into Steam via Steam's own real login page rendered in a
 * separate window — the same as logging into Steam in any browser. We never
 * see the password, and Steam sees a normal website login rather than a
 * simulated device/app authentication (which is what the old QR-code flow
 * did, and what got flagged as a suspicious login).
 */
export class SteamAuthManager extends EventEmitter {
  private account: SteamAccount | null = null
  private loginWindow: BrowserWindow | null = null

  async restoreSession(): Promise<SteamAccount | null> {
    const cookies = await readAllCookies()
    const steamId = extractSteamId(cookies)
    if (!steamId) {
      this.account = null
      return null
    }

    const cached = accountCache.get('account')
    if (cached?.steamId === steamId) {
      this.account = cached
      return cached
    }

    const accountName = (await fetchPersonaName(steamId, cookies)) ?? 'Steam User'
    const account: SteamAccount = { steamId, accountName }
    accountCache.set('account', account)
    this.account = account
    return account
  }

  getAccount(): SteamAccount | null {
    return this.account
  }

  async getWebCookies(): Promise<string[]> {
    const cookies = await readAllCookies()
    const relevant = cookies.filter(
      (c) => c.domain?.includes('steampowered.com') || c.domain?.includes('steamcommunity.com')
    )
    if (!relevant.some((c) => c.name === 'steamLoginSecure')) {
      throw new Error(t('noActiveSession'))
    }
    return relevant.map((c) => `${c.name}=${c.value}`)
  }

  /** Executes a request inside the same persistent Chromium session as Steam's login page. */
  async fetchAuthenticated(url: string | URL, init?: RequestInit): Promise<Response> {
    return getLoginSession().fetch(url.toString(), { ...init, credentials: 'include' })
  }

  async startLogin(onStatus: (status: SteamLoginStatus) => void, parent?: BrowserWindow): Promise<void> {
    this.loginWindow?.close()
    onStatus({ state: 'waiting-for-browser' })

    return new Promise((resolve, reject) => {
      const loginSession = getLoginSession()
      let settled = false
      let waitingForCommunitySync = false
      let fallbackTimer: ReturnType<typeof setTimeout> | null = null

      const win = new BrowserWindow({
        width: 480,
        height: 700,
        title: 'Steam',
        autoHideMenuBar: true,
        parent,
        webPreferences: { partition: SESSION_PARTITION, sandbox: true }
      })
      this.loginWindow = win
      win.webContents.setUserAgent(CHROME_USER_AGENT)

      const finalize = (): void => {
        if (settled) return
        settled = true
        if (fallbackTimer) clearTimeout(fallbackTimer)
        loginSession.cookies.removeListener('changed', onCookieChanged)
        win.close()
        void this.restoreSession().then((account) => {
          if (account) {
            onStatus({ state: 'success', account })
            resolve()
          } else {
            const message = t('loginFailed')
            onStatus({ state: 'error', message })
            reject(new Error(message))
          }
        })
      }

      const onCookieChanged = (
        _event: Electron.Event,
        cookie: Cookie,
        _cause: string,
        removed: boolean
      ): void => {
        if (removed || settled || cookie.name !== 'steamLoginSecure' || !cookie.value) return

        // Steam's login redirects through several domains to sync the session
        // everywhere (store, checkout, community, ...). We need the
        // steamcommunity.com cookie specifically for library/profile data, so
        // wait for it rather than closing the instant the first domain logs in
        // — otherwise we're left only partially authenticated.
        if (cookie.domain?.includes('steamcommunity.com')) {
          finalize()
          return
        }
        if (cookie.domain?.includes('steampowered.com') && !waitingForCommunitySync) {
          waitingForCommunitySync = true
          fallbackTimer = setTimeout(finalize, 6000)
        }
      }
      loginSession.cookies.on('changed', onCookieChanged)

      win.on('closed', () => {
        loginSession.cookies.removeListener('changed', onCookieChanged)
        this.loginWindow = null
        if (fallbackTimer) clearTimeout(fallbackTimer)
        if (!settled) {
          // User closed the window without finishing login — not an error.
          settled = true
          onStatus({ state: 'idle' })
          resolve()
        }
      })

      void win.loadURL('https://store.steampowered.com/login/')
    })
  }

  cancelLogin(): void {
    this.loginWindow?.close()
  }

  async logout(): Promise<void> {
    this.loginWindow?.close()
    await getLoginSession().clearStorageData()
    accountCache.delete('account')
    this.account = null
  }
}

export const steamAuthManager = new SteamAuthManager()
