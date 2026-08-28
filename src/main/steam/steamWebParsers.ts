export interface ParsedSteamUserToken {
  steamId: string
  accessToken: string
}

export interface ParsedSteamOwnedGame {
  appId: number
  name?: string
  iconHash?: string
  playtimeMinutes?: number
  lastPlayedTimestamp?: number
}

export interface ParsedSteamOwnedGames {
  games: ParsedSteamOwnedGame[]
  reportedCount: number
}

export interface ParsedSteamCommunityFriend {
  steamId: string
  displayName: string
  avatarUrl?: string
  profileUrl?: string
  presence: 'online' | 'away' | 'busy' | 'offline' | 'unknown'
  activity?: string
}

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"'
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[\da-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (!entity.startsWith('#')) return HTML_ENTITIES[entity.toLowerCase()] ?? match

    const hexadecimal = entity[1]?.toLowerCase() === 'x'
    const codePoint = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10)
    if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return match
    try {
      return String.fromCodePoint(codePoint)
    } catch {
      return match
    }
  })
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function htmlAttribute(tag: string, name: string): string | undefined {
  const attribute = new RegExp(
    `(?:^|\\s)${escapeRegExp(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    'i'
  ).exec(tag)
  const value = attribute?.[1] ?? attribute?.[2]
  return value === undefined ? undefined : decodeHtmlEntities(value)
}

function applicationConfigTag(source: string): string | undefined {
  for (const match of source.matchAll(/<[a-z][^>]*>/gi)) {
    if (htmlAttribute(match[0], 'id') === 'application_config') return match[0]
  }
  return undefined
}

function plainHtmlText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const text = decodeHtmlEntities(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
  return text || undefined
}

function communityPresence(className: string | undefined): ParsedSteamCommunityFriend['presence'] {
  const classes = new Set(className?.toLowerCase().split(/\s+/).filter(Boolean))
  if (classes.has('busy')) return 'busy'
  if (classes.has('away') || classes.has('snooze')) return 'away'
  if (classes.has('in-game') || classes.has('online')) return 'online'
  if (classes.has('offline')) return 'offline'
  return 'unknown'
}

/** Parses Steam's authenticated Community friends page, so no personal API key is needed. */
export function parseSteamCommunityFriendsHtml(source: string): ParsedSteamCommunityFriend[] {
  const starts = [...source.matchAll(/<div\b[^>]*class\s*=\s*(?:"[^"]*\bfriend_block_v2\b[^"]*"|'[^']*\bfriend_block_v2\b[^']*')[^>]*>/gi)]
  const friends: ParsedSteamCommunityFriend[] = []
  const seen = new Set<string>()

  for (let index = 0; index < starts.length; index++) {
    const start = starts[index]
    const openingTag = start[0]
    const steamId = htmlAttribute(openingTag, 'data-steamid')
    if (!steamId || !/^\d{17}$/.test(steamId) || seen.has(steamId)) continue

    const offset = start.index ?? 0
    const nextOffset = starts[index + 1]?.index ?? source.length
    const block = source.slice(offset, nextOffset)
    const displayName = plainHtmlText(
      block.match(
        /<div\b[^>]*class\s*=\s*(?:"[^"]*\bfriend_block_content\b[^"]*"|'[^']*\bfriend_block_content\b[^']*')[^>]*>([\s\S]*?)<br\s*\/?\s*>/i
      )?.[1]
    )
    if (!displayName) continue

    const overlayTag = block.match(
      /<a\b[^>]*class\s*=\s*(?:"[^"]*\bselectable_overlay\b[^"]*"|'[^']*\bselectable_overlay\b[^']*')[^>]*>/i
    )?.[0]
    const imageTag = block.match(/<img\b[^>]*>/i)?.[0]
    const smallText = plainHtmlText(
      block.match(
        /<span\b[^>]*class\s*=\s*(?:"[^"]*\bfriend_small_text\b[^"]*"|'[^']*\bfriend_small_text\b[^']*')[^>]*>([\s\S]*?)<\/span>/i
      )?.[1]
    )
    const searchActivity = htmlAttribute(openingTag, 'data-search')
      ?.split(';')[1]
      ?.trim()

    seen.add(steamId)
    friends.push({
      steamId,
      displayName,
      avatarUrl: imageTag ? htmlAttribute(imageTag, 'src') : undefined,
      profileUrl: overlayTag ? htmlAttribute(overlayTag, 'href') : undefined,
      presence: communityPresence(htmlAttribute(openingTag, 'class')),
      activity: smallText || searchActivity || undefined
    })
  }

  return friends
}

function jsonObject(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

/** Parses the same #application_config attributes used by Steam's own store UI. */
export function parseSteamUserTokenFromHtml(source: string): ParsedSteamUserToken | null {
  const configTag = applicationConfigTag(source)
  if (!configTag) return null

  const userInfo = jsonObject(htmlAttribute(configTag, 'data-userinfo'))
  const storeConfig = jsonObject(htmlAttribute(configTag, 'data-store_user_config'))
  const steamId = typeof userInfo?.steamid === 'string' ? userInfo.steamid.trim() : ''
  const accessToken =
    typeof storeConfig?.webapi_token === 'string' ? storeConfig.webapi_token.trim() : ''

  if (userInfo?.logged_in !== true || !/^\d{17}$/.test(steamId)) return null
  if (!accessToken || accessToken.length > 4096) return null
  return { steamId, accessToken }
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/**
 * Validates Steam's declared count before a response may drive an authoritative
 * mark-and-sweep. Missing names remain valid identities and are enriched later.
 */
export function parseSteamOwnedGamesPayload(payload: unknown): ParsedSteamOwnedGames {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('GetOwnedGames returned an invalid response')
  }
  const response = (payload as Record<string, unknown>).response
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new Error('GetOwnedGames returned no response object')
  }

  const record = response as Record<string, unknown>
  const reportedCount = record.game_count
  const rawGames = record.games
  if (!Number.isInteger(reportedCount) || (reportedCount as number) < 0) {
    throw new Error('GetOwnedGames returned no valid game count')
  }
  if (!Array.isArray(rawGames)) throw new Error('GetOwnedGames returned no game list')

  const games: ParsedSteamOwnedGame[] = []
  const seen = new Set<number>()
  for (const candidate of rawGames) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    const game = candidate as Record<string, unknown>
    const appId = game.appid
    if (!Number.isInteger(appId) || (appId as number) <= 0 || (appId as number) > 0xffffffff) {
      continue
    }
    if (seen.has(appId as number)) continue
    seen.add(appId as number)

    const name = typeof game.name === 'string' ? game.name.trim() || undefined : undefined
    const iconHash =
      typeof game.img_icon_url === 'string' && /^[\da-f]{1,128}$/i.test(game.img_icon_url)
        ? game.img_icon_url
        : undefined
    const playtimeMinutes = finiteNonNegative(game.playtime_forever)
    const lastPlayed = finiteNonNegative(game.rtime_last_played)
    games.push({
      appId: appId as number,
      name,
      iconHash,
      playtimeMinutes,
      lastPlayedTimestamp:
        lastPlayed !== undefined && lastPlayed > 0 ? Math.trunc(lastPlayed) : undefined
    })
  }

  if (games.length !== reportedCount || rawGames.length !== reportedCount) {
    throw new Error('GetOwnedGames returned an incomplete game list')
  }
  return { games, reportedCount }
}
