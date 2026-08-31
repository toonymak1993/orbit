import type { GameAchievement, GameAchievementsSnapshot, LibraryGame } from '@shared/ipc'

function decodeXml(value: string): string {
  return value
    .replace(/^<!\[CDATA\[|\]\]>$/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
}

function xmlTag(block: string, tag: string): string | undefined {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return match ? decodeXml(match[1]) : undefined
}

function unavailable(
  game: LibraryGame,
  reason: GameAchievementsSnapshot['reason']
): GameAchievementsSnapshot {
  return {
    gameId: game.id,
    provider: 'steam',
    state: 'unavailable',
    achievements: [],
    unlocked: 0,
    total: 0,
    fetchedAt: Date.now(),
    reason
  }
}

function available(
  game: LibraryGame,
  achievements: GameAchievement[],
  source: GameAchievementsSnapshot['source']
): GameAchievementsSnapshot {
  return {
    gameId: game.id,
    provider: 'steam',
    state: 'available',
    achievements,
    unlocked: achievements.filter((achievement) => achievement.unlocked).length,
    total: achievements.length,
    fetchedAt: Date.now(),
    source
  }
}

export function parseSteamCommunityAchievements(
  game: LibraryGame,
  xml: string
): GameAchievementsSnapshot {
  if (/<privacyMessage>/i.test(xml)) return unavailable(game, 'private')
  if (!/<playerstats\b/i.test(xml)) return unavailable(game, 'unavailable')

  const achievements: GameAchievement[] = []
  for (const match of xml.matchAll(/<achievement\b[^>]*>([\s\S]*?)<\/achievement>/gi)) {
    const block = match[1]
    const id = xmlTag(block, 'apiname')
    const name = xmlTag(block, 'name')
    if (!id || !name) continue
    const unlocked = /<achievement\b[^>]*\bclosed=["']1["']/i.test(match[0])
    const unlockSeconds = Number(xmlTag(block, 'unlockTimestamp'))
    achievements.push({
      id,
      name,
      description: xmlTag(block, 'description'),
      iconUrl: xmlTag(block, 'iconClosed'),
      lockedIconUrl: xmlTag(block, 'iconOpen'),
      unlocked,
      unlockedAt:
        unlocked && Number.isFinite(unlockSeconds) && unlockSeconds > 0
          ? unlockSeconds * 1000
          : undefined,
      hidden: xmlTag(block, 'hidden') === '1'
    })
  }

  return achievements.length > 0
    ? available(game, achievements, 'steam-community')
    : unavailable(game, 'unsupported')
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

export function parseSteamWebApiAchievements(
  game: LibraryGame,
  payload: unknown
): GameAchievementsSnapshot {
  const playerStats = objectValue(objectValue(payload)?.playerstats)
  if (!playerStats) return unavailable(game, 'unavailable')

  if (playerStats.success !== true) {
    const error = typeof playerStats.error === 'string' ? playerStats.error.toLowerCase() : ''
    if (error.includes('private')) return unavailable(game, 'private')
    if (error.includes('no stats') || error.includes('does not have stats')) {
      return unavailable(game, 'unsupported')
    }
    return unavailable(game, 'unavailable')
  }

  const rawAchievements = Array.isArray(playerStats.achievements)
    ? playerStats.achievements
    : []
  const achievements = rawAchievements.flatMap((candidate): GameAchievement[] => {
    const raw = objectValue(candidate)
    const id = typeof raw?.apiname === 'string' ? raw.apiname.trim() : ''
    if (!raw || !id) return []
    const unlocked = raw.achieved === 1 || raw.achieved === true
    const unlockSeconds = Number(raw.unlocktime)
    return [
      {
        id,
        name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : id,
        description:
          typeof raw.description === 'string' && raw.description.trim()
            ? raw.description.trim()
            : undefined,
        unlocked,
        unlockedAt:
          unlocked && Number.isFinite(unlockSeconds) && unlockSeconds > 0
            ? unlockSeconds * 1000
            : undefined
      }
    ]
  })

  return achievements.length > 0
    ? available(game, achievements, 'steam-web-api')
    : unavailable(game, 'unsupported')
}
