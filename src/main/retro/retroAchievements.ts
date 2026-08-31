import Store from 'electron-store'
import { app } from 'electron'
import type {
  GameAchievement,
  GameAchievementsSnapshot,
  LibraryGame,
  RetroSystemId
} from '@shared/ipc'
import { retroSystemById } from '@shared/retroSystems'
import { fetchWithElectronNet } from '../networkFetch'
import { settingsStore } from '../settingsStore'
import { retroAchievementsCredentials } from './retroAchievementsCredentials'

const CATALOG_TTL_MS = 14 * 24 * 60 * 60 * 1_000
const API_TIMEOUT_MS = 20_000
const MEDIA_ORIGIN = 'https://media.retroachievements.org'

interface RetroCatalogGame {
  id: number
  title: string
  consoleId: number
  iconUrl?: string
  achievementCount: number
  hashes: string[]
}

interface CachedSystemCatalog {
  fetchedAt: number
  games: RetroCatalogGame[]
}

interface RetroCatalogDatabase {
  schemaVersion: number
  systems: Record<string, CachedSystemCatalog>
}

interface RawCatalogGame {
  ID?: unknown
  Title?: unknown
  ConsoleID?: unknown
  ImageIcon?: unknown
  NumAchievements?: unknown
  Hashes?: unknown
}

interface RawAchievement {
  ID?: unknown
  Title?: unknown
  Description?: unknown
  BadgeName?: unknown
  DateEarned?: unknown
  DateEarnedHardcore?: unknown
}

interface RawProgressResponse {
  Achievements?: unknown
}

export interface RetroAchievementMatchResult {
  systemId: RetroSystemId
  hash: string
  game?: RetroCatalogGame
  state: 'matched' | 'unmatched' | 'unavailable'
}

const catalogDatabase = new Store<RetroCatalogDatabase>({
  name: 'orbit-retroachievements-catalog',
  defaults: { schemaVersion: 1, systems: {} }
})
const catalogState = catalogDatabase.store
let persistTimer: ReturnType<typeof setTimeout> | undefined

function flushCatalog(): void {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = undefined
  catalogDatabase.store = catalogState
}

function scheduleCatalogPersist(): void {
  if (persistTimer) return
  persistTimer = setTimeout(flushCatalog, 500)
  persistTimer.unref()
}

app.on('before-quit', flushCatalog)

function credentials(): { username: string; apiKey: string } | undefined {
  const username = settingsStore.store.retroAchievementsUsername?.trim()
  const apiKey = retroAchievementsCredentials.getApiKey()
  return username && apiKey ? { username, apiKey } : undefined
}

function mediaUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const path = value.trim()
  if (/^https:\/\//i.test(path)) return path
  return `${MEDIA_ORIGIN}${path.startsWith('/') ? '' : '/'}${path}`
}

function normalizeCatalogGame(value: RawCatalogGame): RetroCatalogGame | undefined {
  const id = Number(value.ID)
  const consoleId = Number(value.ConsoleID)
  const title = typeof value.Title === 'string' ? value.Title.trim() : ''
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(consoleId) || consoleId <= 0 || !title) {
    return undefined
  }
  const hashes = Array.isArray(value.Hashes)
    ? value.Hashes
        .filter((hash): hash is string => typeof hash === 'string' && /^[a-f\d]{32}$/i.test(hash))
        .map((hash) => hash.toLocaleLowerCase('en-US'))
    : []
  return {
    id,
    title,
    consoleId,
    iconUrl: mediaUrl(value.ImageIcon),
    achievementCount: Math.max(0, Number(value.NumAchievements) || 0),
    hashes
  }
}

async function fetchSystemCatalog(
  systemId: RetroSystemId,
  auth: { username: string; apiKey: string }
): Promise<RetroCatalogGame[]> {
  const consoleId = retroSystemById(systemId).retroAchievementsConsoleId
  if (!consoleId) return []
  const url = new URL('https://retroachievements.org/API/API_GetGameList.php')
  url.searchParams.set('z', auth.username)
  url.searchParams.set('y', auth.apiKey)
  url.searchParams.set('i', String(consoleId))
  url.searchParams.set('f', '1')
  url.searchParams.set('h', '1')
  const response = await fetchWithElectronNet(url, { signal: AbortSignal.timeout(API_TIMEOUT_MS) })
  if (!response.ok) throw new Error('RetroAchievements catalog is unavailable')
  const raw = (await response.json()) as unknown
  if (!Array.isArray(raw)) throw new Error('RetroAchievements catalog response is invalid')
  return raw.flatMap((candidate) => {
    const game = normalizeCatalogGame(candidate as RawCatalogGame)
    return game ? [game] : []
  })
}

async function systemCatalog(systemId: RetroSystemId): Promise<RetroCatalogGame[] | undefined> {
  const auth = credentials()
  if (!auth) return undefined
  const key = String(retroSystemById(systemId).retroAchievementsConsoleId ?? '')
  if (!key) return []
  const cached = catalogState.systems[key]
  if (cached && Date.now() - cached.fetchedAt < CATALOG_TTL_MS) return cached.games
  try {
    const games = await fetchSystemCatalog(systemId, auth)
    catalogState.systems[key] = { fetchedAt: Date.now(), games }
    scheduleCatalogPersist()
    return games
  } catch {
    return cached?.games
  }
}

export async function matchRetroAchievementHashes(
  targets: readonly { systemId: RetroSystemId; hash: string }[]
): Promise<RetroAchievementMatchResult[]> {
  const catalogs = new Map<RetroSystemId, RetroCatalogGame[] | undefined>()
  const systemIds = [...new Set(targets.map((target) => target.systemId))]
  for (const systemId of systemIds) catalogs.set(systemId, await systemCatalog(systemId))

  return targets.map((target) => {
    const catalog = catalogs.get(target.systemId)
    if (!catalog) return { ...target, state: 'unavailable' }
    const normalizedHash = target.hash.toLocaleLowerCase('en-US')
    const game = catalog.find((candidate) => candidate.hashes.includes(normalizedHash))
    return game
      ? { ...target, game, state: 'matched' }
      : { ...target, state: 'unmatched' }
  })
}

function unavailable(game: LibraryGame): GameAchievementsSnapshot {
  return {
    gameId: game.id,
    provider: game.provider,
    state: 'unavailable',
    achievements: [],
    unlocked: 0,
    total: 0,
    fetchedAt: Date.now(),
    reason: 'unavailable'
  }
}

function earnedAt(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const timestamp = Date.parse(`${value.trim().replace(' ', 'T')}Z`)
  return Number.isFinite(timestamp) ? timestamp : undefined
}

function parseAchievement(value: RawAchievement): GameAchievement | undefined {
  const id = Number(value.ID)
  const name = typeof value.Title === 'string' ? value.Title.trim() : ''
  const badgeName = typeof value.BadgeName === 'string' ? value.BadgeName.trim() : ''
  if (!Number.isInteger(id) || id <= 0 || !name) return undefined
  const unlockedAt = earnedAt(value.DateEarnedHardcore) ?? earnedAt(value.DateEarned)
  return {
    id: String(id),
    name,
    description:
      typeof value.Description === 'string' && value.Description.trim()
        ? value.Description.trim()
        : undefined,
    iconUrl: badgeName ? `${MEDIA_ORIGIN}/Badge/${encodeURIComponent(badgeName)}.png` : undefined,
    lockedIconUrl: badgeName
      ? `${MEDIA_ORIGIN}/Badge/${encodeURIComponent(badgeName)}_lock.png`
      : undefined,
    unlocked: unlockedAt !== undefined,
    unlockedAt
  }
}

export async function fetchRetroAchievements(
  game: LibraryGame
): Promise<GameAchievementsSnapshot> {
  const auth = credentials()
  const gameId = game.retro?.retroAchievementsGameId
  if (!auth || !gameId) return unavailable(game)
  const url = new URL('https://retroachievements.org/API/API_GetGameInfoAndUserProgress.php')
  url.searchParams.set('z', auth.username)
  url.searchParams.set('y', auth.apiKey)
  url.searchParams.set('u', auth.username)
  url.searchParams.set('g', String(gameId))
  url.searchParams.set('a', '1')
  try {
    const response = await fetchWithElectronNet(url, { signal: AbortSignal.timeout(API_TIMEOUT_MS) })
    if (!response.ok) return unavailable(game)
    const raw = (await response.json()) as RawProgressResponse
    const values =
      raw.Achievements && typeof raw.Achievements === 'object'
        ? Object.values(raw.Achievements as Record<string, RawAchievement>)
        : []
    const achievements = values.flatMap((candidate) => {
      const achievement = parseAchievement(candidate)
      return achievement ? [achievement] : []
    })
    if (achievements.length === 0) return unavailable(game)
    return {
      gameId: game.id,
      provider: 'retro',
      state: 'available',
      achievements,
      unlocked: achievements.filter((achievement) => achievement.unlocked).length,
      total: achievements.length,
      fetchedAt: Date.now()
    }
  } catch {
    return unavailable(game)
  }
}

export function hasRetroAchievementsCredentials(): boolean {
  return Boolean(credentials())
}
