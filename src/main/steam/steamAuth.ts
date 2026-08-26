import { EventEmitter } from 'node:events'
import { BrowserWindow, session, type Cookie } from 'electron'
import Store from 'electron-store'
import type { SteamAccount, SteamLoginStatus } from '@shared/ipc'
import { t } from '../i18n'
import { fetchDynamicStoreData, getSteamUserToken } from './steamWebService'

const SESSION_PARTITION = 'persist:orbit-steam-login'
const CHROME_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const PROFILE_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000
const PROFILE_FAILURE_CACHE_AGE_MS = 5 * 60 * 1000

const accountCache = new Store<{ account?: SteamAccount; profileUpdatedAt?: number }>({
  name: 'orbit-steam-account'
})

function getLoginSession(): Electron.Session {
  return session.fromPartition(SESSION_PARTITION)
}

async function readAllCookies(): Promise<Cookie[]> {
  return getLoginSession().cookies.get({})
}

/** SteamID64 lives inside the steamLoginSecure cookie as `<steamid>||<token>`. */
function cookieSteamId(cookie: Cookie): string | null {
  if (cookie.name !== 'steamLoginSecure' || !cookie.value) return null
  try {
    const steamId = decodeURIComponent(cookie.value).split('||')[0]
    return /^\d{17}$/.test(steamId) ? steamId : null
  } catch {
    return null
  }
}

function extractSteamId(cookies: Cookie[], preferredSteamId?: string): string | null {
  const candidates = cookies.flatMap((cookie) => {
    const steamId = cookieSteamId(cookie)
    return steamId &&
      (cookie.domain?.includes('steampowered.com') ||
        cookie.domain?.includes('steamcommunity.com'))
      ? [{ steamId, domain: cookie.domain ?? '' }]
      : []
  })
  const storeCandidates = candidates.filter((candidate) =>
    candidate.domain.includes('steampowered.com')
  )
  if (storeCandidates.length > 0) {
    return (
      storeCandidates.find((candidate) => candidate.steamId === preferredSteamId)?.steamId ??
      storeCandidates[0].steamId
    )
  }
  if (preferredSteamId && candidates.some((candidate) => candidate.steamId === preferredSteamId)) {
    return preferredSteamId
  }
  return candidates[0]?.steamId ?? null
}

interface SteamProfile {
  accountName?: string
  avatarUrl?: string
}

function readProfileValue(xml: string, tag: string): string | undefined {
  const cdata = new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`).exec(xml)
  if (cdata?.[1]) return cdata[1].trim()
  return new RegExp(`<${tag}>([^<]+)<\\/${tag}>`).exec(xml)?.[1]?.trim()
}

function trustedAvatarUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    if (url.protocol !== 'https:') return undefined
    if (host !== 'steamstatic.com' && !host.endsWith('.steamstatic.com')) return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

async function fetchSteamProfile(steamId: string): Promise<SteamProfile | null> {
  try {
    const res = await getLoginSession().fetch(
      `https://steamcommunity.com/profiles/${steamId}/?xml=1`,
      {
        credentials: 'include',
        headers: { 'User-Agent': CHROME_USER_AGENT },
        signal: AbortSignal.timeout(5000)
      }
    )
    if (!res.ok) return null
    const xml = await res.text()
    const accountName = readProfileValue(xml, 'steamID')
    const avatarUrl = trustedAvatarUrl(readProfileValue(xml, 'avatarFull'))
    return accountName || avatarUrl ? { accountName, avatarUrl } : null
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
    const cached = accountCache.get('account')
    const steamId = extractSteamId(cookies, cached?.steamId)
    if (!steamId) {
      this.account = null
      return null
    }

    const profileUpdatedAt = accountCache.get('profileUpdatedAt')
    if (
      cached?.steamId === steamId &&
      profileUpdatedAt !== undefined &&
      Date.now() - profileUpdatedAt < PROFILE_CACHE_MAX_AGE_MS
    ) {
      this.account = cached
      return cached
    }

    const profile = await fetchSteamProfile(steamId)
    const account: SteamAccount = {
      steamId,
      accountName: profile?.accountName ?? cached?.accountName ?? 'Steam User',
      avatarUrl: profile?.avatarUrl ?? cached?.avatarUrl
    }
    accountCache.set('account', account)
    // A failed/offline profile lookup is still a completed refresh attempt.
    // Cache its fallback briefly as well so every restore does not block on
    // another five-second request while the network or profile is unavailable.
    accountCache.set(
      'profileUpdatedAt',
      profile
        ? Date.now()
        : Date.now() - PROFILE_CACHE_MAX_AGE_MS + PROFILE_FAILURE_CACHE_AGE_MS
    )
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
      let verificationInFlight = false
      let verificationAttempts = 0
      let verificationDeadline = 0
      let verificationTimer: ReturnType<typeof setTimeout> | undefined

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

      const cleanup = (): void => {
        if (verificationTimer) clearTimeout(verificationTimer)
        verificationTimer = undefined
        loginSession.cookies.removeListener('changed', onCookieChanged)
        win.webContents.removeListener('did-finish-load', onDidFinishLoad)
      }

      const failLibraryVerification = (): void => {
        if (settled) return
        settled = true
        cleanup()
        win.close()
        const message = t('librarySessionUnavailable')
        onStatus({ state: 'error', message })
        reject(new Error(message))
      }

      const finalize = async (): Promise<void> => {
        if (settled) return
        settled = true
        cleanup()
        win.close()
        try {
          const account = await this.restoreSession()
          if (account) {
            onStatus({ state: 'success', account })
            resolve()
          } else {
            const message = t('loginFailed')
            onStatus({ state: 'error', message })
            reject(new Error(message))
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : t('loginFailed')
          onStatus({ state: 'error', message })
          reject(error instanceof Error ? error : new Error(message))
        }
      }

      const scheduleVerification = (delay = 0): void => {
        if (settled || verificationTimer) return
        verificationTimer = setTimeout(() => {
          verificationTimer = undefined
          void verifyLibrarySession()
        }, delay)
      }

      const verifyLibrarySession = async (): Promise<void> => {
        if (settled || verificationInFlight) return
        verificationInFlight = true
        try {
          const cookies = await loginSession.cookies.get({})
          const cached = accountCache.get('account')
          const steamId = extractSteamId(cookies, cached?.steamId)
          if (!steamId) return

          if (verificationDeadline === 0) verificationDeadline = Date.now() + 30_000
          verificationAttempts++
          const sessionFetch = (url: string | URL, init?: RequestInit): Promise<Response> =>
            loginSession.fetch(url.toString(), { ...init, credentials: 'include' })
          const verification = await Promise.allSettled([
            getSteamUserToken(steamId, sessionFetch, 1, 8_000),
            fetchDynamicStoreData(sessionFetch)
          ])
          if (verification.every((attempt) => attempt.status === 'rejected')) {
            throw new Error('Steam library session unavailable')
          }
          await finalize()
        } catch {
          // A Steam login can publish its store cookie before either the Store
          // token or authenticated dynamic-library endpoint becomes readable.
          if (verificationAttempts < 6 && Date.now() < verificationDeadline) {
            scheduleVerification(1_000)
          } else {
            failLibraryVerification()
          }
        } finally {
          verificationInFlight = false
        }
      }

      const onCookieChanged = (
        _event: Electron.Event,
        cookie: Cookie,
        _cause: string,
        removed: boolean
      ): void => {
        if (removed || settled || cookie.name !== 'steamLoginSecure' || !cookie.value) return
        scheduleVerification()
      }
      const onDidFinishLoad = (): void => scheduleVerification()
      loginSession.cookies.on('changed', onCookieChanged)
      win.webContents.on('did-finish-load', onDidFinishLoad)

      win.on('closed', () => {
        cleanup()
        this.loginWindow = null
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
    accountCache.delete('profileUpdatedAt')
    this.account = null
  }
}

export const steamAuthManager = new SteamAuthManager()
