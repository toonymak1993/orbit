const STEAM_API_ROOT = 'https://api.steampowered.com'
const STEAM_STORE_ROOT = 'https://store.steampowered.com'

export interface SteamOwnedGame {
  appId: number
  name: string
  iconUrl?: string
  playtimeMinutes?: number
  lastPlayedTimestamp?: number
}

export interface SteamClientGame {
  appId: number
  name: string
  installSize?: number
}

export interface SteamUserToken {
  steamId: string
  accessToken: string
}

export interface DynamicStoreData {
  ownedAppIds: number[]
  recentlyPlayedAppIds: number[]
}

export type SteamSessionFetch = (url: string | URL, init?: RequestInit) => Promise<Response>

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = Number(response.headers.get('retry-after'))
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, 30_000)
  return Math.min(5_000 * 2 ** attempt, 30_000)
}

async function fetchWithRetry(
  url: string | URL,
  init?: RequestInit,
  fetcher: SteamSessionFetch = fetch
): Promise<Response> {
  let lastResponse: Response | undefined
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(20_000) })
    lastResponse = response
    if (response.status !== 429 && response.status < 500) return response
    if (attempt < 4) await delay(retryDelay(response, attempt))
  }
  return lastResponse as Response
}

function decodeJavascriptString(value: string): string {
  try {
    return JSON.parse(`"${value.replace(/"/g, '\\"')}"`) as string
  } catch {
    return value
  }
}

/**
 * Playnite obtains this short-lived web API token from the authenticated Steam
 * store page. ORBIT follows that flow and keeps the token in memory only.
 */
export async function getSteamUserToken(
  expectedSteamId: string,
  sessionFetch: SteamSessionFetch
): Promise<SteamUserToken> {
  const response = await fetchWithRetry(
    `${STEAM_STORE_ROOT}/explore/`,
    { headers: { Referer: `${STEAM_STORE_ROOT}/` } },
    sessionFetch
  )
  if (!response.ok || response.url.includes('/login')) {
    throw new Error(`Steam store session unavailable (${response.status})`)
  }

  const source = await response.text()
  const steamId = source.match(/["']steamid["']\s*:\s*["'](\d+)["']/i)?.[1]
  const rawToken = source.match(/["']webapi_token["']\s*:\s*["']([^"'&]+)["']/i)?.[1]
  const accessToken = rawToken ? decodeJavascriptString(rawToken) : undefined
  if (!steamId || !accessToken) throw new Error('Steam web access token was not present')
  if (steamId !== expectedSteamId) throw new Error('Steam web session belongs to another account')
  return { steamId, accessToken }
}

export async function fetchOwnedGamesWithToken(
  token: SteamUserToken,
  language: string
): Promise<Map<number, SteamOwnedGame>> {
  const url = new URL(`${STEAM_API_ROOT}/IPlayerService/GetOwnedGames/v1/`)
  url.searchParams.set('format', 'json')
  url.searchParams.set('access_token', token.accessToken)
  url.searchParams.set('steamid', token.steamId)
  url.searchParams.set('include_appinfo', 'true')
  url.searchParams.set('include_played_free_games', 'true')
  url.searchParams.set('include_free_sub', 'true')
  url.searchParams.set('language', language)

  const response = await fetchWithRetry(url)
  if (!response.ok) throw new Error(`GetOwnedGames failed (${response.status})`)
  const json = (await response.json()) as {
    response?: {
      games?: Array<{
        appid: number
        name?: string
        img_icon_url?: string
        playtime_forever?: number
        rtime_last_played?: number
      }>
    }
  }

  if (!Array.isArray(json.response?.games)) throw new Error('GetOwnedGames returned no game list')
  const games = new Map<number, SteamOwnedGame>()
  for (const game of json.response.games) {
    if (!Number.isInteger(game.appid) || !game.name?.trim()) continue
    games.set(game.appid, {
      appId: game.appid,
      name: game.name.trim(),
      iconUrl: game.img_icon_url
        ? `https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/${game.appid}/${game.img_icon_url}.jpg`
        : undefined,
      playtimeMinutes: game.playtime_forever,
      lastPlayedTimestamp: game.rtime_last_played || undefined
    })
  }
  return games
}

/** Optional merge source used by Playnite when the Steam client is running. */
export async function fetchSteamClientGames(
  token: SteamUserToken,
  language: string
): Promise<Map<number, SteamClientGame>> {
  const url = new URL(`${STEAM_API_ROOT}/IClientCommService/GetClientAppList/v1/`)
  url.searchParams.set('fields', 'games')
  url.searchParams.set('access_token', token.accessToken)
  url.searchParams.set('language', language)

  const response = await fetchWithRetry(url)
  if (!response.ok) return new Map()
  const json = (await response.json()) as {
    response?: { apps?: Array<{ appid: number; app?: string; bytes_required?: string }> }
    apps?: Array<{ appid: number; app?: string; bytes_required?: string }>
  }
  const entries = json.response?.apps ?? json.apps ?? []
  const games = new Map<number, SteamClientGame>()
  for (const game of entries) {
    if (!Number.isInteger(game.appid) || !game.app?.trim()) continue
    const size = Number(game.bytes_required)
    games.set(game.appid, {
      appId: game.appid,
      name: game.app.trim(),
      installSize: Number.isFinite(size) ? size : undefined
    })
  }
  return games
}

/** Last-resort ID source. Its entries are not considered games until resolved. */
export async function fetchDynamicStoreData(
  sessionFetch: SteamSessionFetch
): Promise<DynamicStoreData> {
  const response = await fetchWithRetry(
    `${STEAM_STORE_ROOT}/dynamicstore/userdata/`,
    { headers: { Referer: `${STEAM_STORE_ROOT}/` } },
    sessionFetch
  )
  if (!response.ok) throw new Error(`Steam userdata failed (${response.status})`)
  const json = (await response.json()) as {
    rgOwnedApps?: number[]
    rgRecentlyPlayedApps?: number[]
  }
  return {
    ownedAppIds: Array.isArray(json.rgOwnedApps) ? [...new Set(json.rgOwnedApps)] : [],
    recentlyPlayedAppIds: Array.isArray(json.rgRecentlyPlayedApps)
      ? [...new Set(json.rgRecentlyPlayedApps)]
      : []
  }
}
