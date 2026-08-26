import Store from 'electron-store'
import { app } from 'electron'
import type {
  GameAchievement,
  GameAchievementsSnapshot,
  LibraryGame
} from '@shared/ipc'
import { latestLibraryActivity } from '@shared/libraryTime'
import { settingsStore } from '../settingsStore'
import { steamAuthManager } from '../steam/steamAuth'
import { syncCoordinator } from '../sync/syncCoordinator'

interface AchievementDatabase {
  schemaVersion: number
  snapshots: Record<string, GameAchievementsSnapshot>
}

const AVAILABLE_TTL_MS = 6 * 60 * 60 * 1000
const UNAVAILABLE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const STARTUP_BATCH_LIMIT = 12
const REQUEST_PACING_MS = 450

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

const database = new Store<AchievementDatabase>({
  name: 'orbit-achievements',
  defaults: { schemaVersion: 3, snapshots: {} }
})
const databaseState: AchievementDatabase = database.store
let databasePersistTimer: ReturnType<typeof setTimeout> | undefined

if (databaseState.schemaVersion < 3) {
  databaseState.schemaVersion = 3
  databaseState.snapshots = {}
}

function flushDatabase(): void {
  if (databasePersistTimer) clearTimeout(databasePersistTimer)
  databasePersistTimer = undefined
  database.store = databaseState
}

function scheduleDatabasePersist(): void {
  if (databasePersistTimer) return
  databasePersistTimer = setTimeout(flushDatabase, 500)
  databasePersistTimer.unref()
}

app.on('before-quit', flushDatabase)

function fresh(snapshot: GameAchievementsSnapshot): boolean {
  const ttl = snapshot.state === 'available' ? AVAILABLE_TTL_MS : UNAVAILABLE_TTL_MS
  return Date.now() - snapshot.fetchedAt < ttl
}

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

function parseSteamAchievements(game: LibraryGame, xml: string): GameAchievementsSnapshot {
  const fetchedAt = Date.now()
  if (/<privacyMessage>/i.test(xml)) {
    return {
      gameId: game.id,
      provider: 'steam',
      state: 'unavailable',
      achievements: [],
      unlocked: 0,
      total: 0,
      fetchedAt,
      reason: 'private'
    }
  }

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
          : undefined
    })
  }

  if (achievements.length === 0) {
    return {
      gameId: game.id,
      provider: 'steam',
      state: 'unavailable',
      achievements: [],
      unlocked: 0,
      total: 0,
      fetchedAt,
      reason: 'unavailable'
    }
  }

  return {
    gameId: game.id,
    provider: 'steam',
    state: 'available',
    achievements,
    unlocked: achievements.filter((achievement) => achievement.unlocked).length,
    total: achievements.length,
    fetchedAt
  }
}

async function fetchSteamAchievements(game: LibraryGame): Promise<GameAchievementsSnapshot> {
  if (!game.appId) return unavailable(game, 'unavailable')
  const account = steamAuthManager.getAccount() ?? (await steamAuthManager.restoreSession())
  if (!account) return unavailable(game, 'unavailable')
  const language = settingsStore.store.language === 'de' ? 'german' : 'english'
  const url = new URL(
    `https://steamcommunity.com/profiles/${account.steamId}/stats/${game.appId}/`
  )
  url.searchParams.set('xml', '1')
  url.searchParams.set('l', language)
  try {
    const response = await steamAuthManager.fetchAuthenticated(url, {
      signal: AbortSignal.timeout(15_000)
    })
    if (!response.ok) return unavailable(game, response.status === 403 ? 'private' : 'unavailable')
    return parseSteamAchievements(game, await response.text())
  } catch {
    return unavailable(game, 'unavailable')
  }
}

function unavailable(
  game: LibraryGame,
  reason: GameAchievementsSnapshot['reason']
): GameAchievementsSnapshot {
  return {
    gameId: game.id,
    provider: game.provider,
    state: 'unavailable',
    achievements: [],
    unlocked: 0,
    total: 0,
    fetchedAt: Date.now(),
    reason
  }
}

async function fetchProviderAchievements(game: LibraryGame): Promise<GameAchievementsSnapshot> {
  if (game.provider === 'steam') return fetchSteamAchievements(game)
  // Epic achievement state requires game-specific EOS credentials. The adapter
  // remains explicit and cached instead of pretending that an Epic web login
  // grants access to EOS player data.
  return unavailable(game, 'unsupported')
}

export class AchievementService {
  private inFlight = new Map<string, Promise<GameAchievementsSnapshot>>()

  get(gameId: string): GameAchievementsSnapshot | null {
    return databaseState.snapshots[gameId] ?? null
  }

  aggregate(gameIds: Iterable<string>): { unlocked: number; total: number } {
    let unlocked = 0
    let total = 0
    for (const gameId of gameIds) {
      const snapshot = this.get(gameId)
      if (!snapshot || snapshot.state !== 'available') continue
      unlocked += snapshot.unlocked
      total += snapshot.total
    }
    return { unlocked, total }
  }

  resolve(game: LibraryGame, force = false): Promise<GameAchievementsSnapshot> {
    const cached = this.get(game.id)
    if (!force && cached && fresh(cached)) return Promise.resolve(cached)
    const active = this.inFlight.get(game.id)
    if (active) return active
    const request = fetchProviderAchievements(game)
      .then((snapshot) => {
        databaseState.snapshots[game.id] = snapshot
        scheduleDatabasePersist()
        return snapshot
      })
      .finally(() => this.inFlight.delete(game.id))
    this.inFlight.set(game.id, request)
    return request
  }

  async syncStartup(games: LibraryGame[]): Promise<void> {
    if (!settingsStore.store.showAchievements) {
      syncCoordinator.begin('achievements', 0, 0, undefined, 'system')
      return
    }

    const candidates = games
      .filter(
        (game) =>
          game.provider === 'steam' || game.provider === 'epic'
      )
      .filter(
        (game) =>
          (game.playtimeMinutes ?? 0) > 0 ||
          (game.metadata.achievementCount ?? 0) > 0
      )
      .sort((a, b) => latestLibraryActivity(b) - latestLibraryActivity(a))
      .slice(0, STARTUP_BATCH_LIMIT)

    const stale = candidates.filter((game) => {
      const cached = this.get(game.id)
      return !cached || !fresh(cached)
    })
    const completedInitially = candidates.length - stale.length
    syncCoordinator.begin(
      'achievements',
      candidates.length,
      completedInitially,
      undefined,
      'unified'
    )

    let completed = completedInitially
    const queue = [...stale]
    const workers = Array.from({ length: Math.min(1, queue.length) }, async () => {
      while (queue.length > 0) {
        const game = queue.shift()
        if (!game) return
        await this.resolve(game)
        completed += 1
        syncCoordinator.progress(
          'achievements',
          completed,
          candidates.length,
          game.name,
          'unified'
        )
        if (queue.length > 0) await wait(REQUEST_PACING_MS)
      }
    })
    await Promise.allSettled(workers)
    syncCoordinator.complete('achievements', undefined, 'unified')
  }
}

export const achievementService = new AchievementService()
