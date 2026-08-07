import Store from 'electron-store'
import { app } from 'electron'
import type {
  GameMetadata,
  GameProvider,
  LibraryGame,
  LibrarySnapshot
} from '@shared/ipc'

const DATABASE_VERSION = 4
const DEFAULT_PROFILE_ID = 'orbit-default'
const STEAM_PROVIDER = 'steam' as const
const LEGACY_APP_NAME = /^App\s+\d+$/i
const KNOWN_PROVIDERS = new Set<GameProvider>([
  'steam',
  'epic',
  'gog',
  'xbox',
  'ea',
  'ubisoft',
  'local'
])

interface StoredGame extends LibraryGame {
  owned: boolean
  lastSeenOnlineAt?: number
  lastSeenInstalledAt?: number
}

interface AccountLibrary {
  games: Record<string, StoredGame>
  recentGameIds: string[]
  loadedAt: number
}

interface LibraryDatabase {
  schemaVersion: number
  accounts: Record<string, AccountLibrary>
}

interface LegacyLibraryCache {
  steamId: string | null
  snapshot: {
    games?: LegacyGameSnapshot[]
    recentlyPlayedAppIds?: number[]
    loadedAt?: number
  } | null
}

interface LegacyMetadataFields {
  screenshotUrl?: string
  shortDescription?: string
  genres?: string[]
  developers?: string[]
}

interface LegacyGameSnapshot extends LegacyMetadataFields {
  appId?: number
  name?: string
  playtimeMinutes?: number
  lastPlayedTimestamp?: number
  installed?: boolean
  installDir?: string
  addedAt?: number
  updatedAt?: number
}

type StoredGameCandidate = Partial<StoredGame> & LegacyMetadataFields

export interface ProviderInstalledDelta {
  providerGameId: string
  name: string
  appId?: number
  installDir: string
  metadata?: GameMetadata
  lastPlayedTimestamp?: number
}

export interface ProviderOwnedDelta {
  providerGameId: string
  name?: string
  appId?: number
  metadata?: GameMetadata
  playtimeMinutes?: number
  lastPlayedTimestamp?: number
}

export interface ProviderMetadataDelta {
  providerGameId: string
  appId?: number
  name?: string
  metadata: GameMetadata
  locale: string
  source: string
  fetchedAt: number
}

export interface SteamOwnedDelta {
  appId: number
  name: string
  iconUrl?: string
  playtimeMinutes?: number
  lastPlayedTimestamp?: number
}

export interface SteamMetadataDelta {
  appId: number
  name?: string
  metadata: GameMetadata
  locale: string
  source: string
  fetchedAt: number
}

export interface SteamInstalledDelta {
  appId: number
  name: string
  installDir: string
  lastPlayedTimestamp?: number
}

const database = new Store<LibraryDatabase>({
  name: 'orbit-library-v2',
  defaults: { schemaVersion: DATABASE_VERSION, accounts: {} }
})

// Read-only migration source. It remains on disk so an older ORBIT build can
// still be restored; schema v4 writes only to the unified default profile.
const legacyDatabase = new Store<LegacyLibraryCache>({
  name: 'orbit-library-cache',
  defaults: { steamId: null, snapshot: null }
})

const databaseState: LibraryDatabase = database.store
const legacyDatabaseState: LegacyLibraryCache = legacyDatabase.store
let databasePersistTimer: ReturnType<typeof setTimeout> | undefined

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

function providerGameId(provider: GameProvider, id: string): string {
  return `${provider}:${id}`
}

function steamGameId(appId: number): string {
  return providerGameId(STEAM_PROVIDER, String(appId))
}

function validProviderGameId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 512
}

function hasUsableName(name: unknown): name is string {
  return typeof name === 'string' && name.trim().length > 0 && !LEGACY_APP_NAME.test(name.trim())
}

function migrateMetadata(candidate: StoredGameCandidate): GameMetadata {
  const legacy: GameMetadata = {
    summary: candidate.shortDescription,
    genres: candidate.genres,
    developers: candidate.developers,
    backgroundUrl: candidate.screenshotUrl
  }
  return { ...legacy, ...(candidate.metadata ?? {}) }
}

function mergeDefinedMetadata(current: GameMetadata, delta: GameMetadata): GameMetadata {
  const merged = { ...current }
  for (const [key, value] of Object.entries(delta)) {
    if (value !== undefined) (merged as Record<string, unknown>)[key] = value
  }
  return merged
}

function metadataEquals(left: GameMetadata, right: GameMetadata): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function canonicalName(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/[\u00ae\u2122\u00a9]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('en')
}

function preferDisplayGame(current: StoredGame, candidate: StoredGame): StoredGame {
  if (candidate.installed !== current.installed) return candidate.installed ? candidate : current
  const candidatePlayed = candidate.lastStartedAt ?? candidate.lastPlayedTimestamp ?? 0
  const currentPlayed = current.lastStartedAt ?? current.lastPlayedTimestamp ?? 0
  if (candidatePlayed !== currentPlayed) return candidatePlayed > currentPlayed ? candidate : current
  const candidatePlaytime = candidate.playtimeMinutes ?? 0
  const currentPlaytime = current.playtimeMinutes ?? 0
  if (candidatePlaytime !== currentPlaytime) return candidatePlaytime > currentPlaytime ? candidate : current
  return candidate.id.localeCompare(current.id) < 0 ? candidate : current
}

function emptyAccount(): AccountLibrary {
  return { games: {}, recentGameIds: [], loadedAt: 0 }
}

/**
 * Persistent, provider-neutral repository. Identity follows Playnite's rule:
 * library plugin/provider + provider game ID. Every import is an idempotent
 * upsert, while the public snapshot collapses same-title cross-store copies to
 * the best installed/recent record.
 */
export class GameRepository {
  private profileOpen = false
  private account: AccountLibrary = emptyAccount()
  private metadataLoadingProviders = new Set<string>()

  openProfile(legacySteamId?: string): void {
    if (this.profileOpen) return
    this.profileOpen = true

    const accounts = databaseState.accounts
    const stored = accounts[DEFAULT_PROFILE_ID]
    if (stored) {
      this.account = this.sanitize(stored)
      this.persist()
      return
    }

    const previous = legacySteamId ? accounts[legacySteamId] : undefined
    const newest = Object.entries(accounts)
      .filter(([id]) => id !== DEFAULT_PROFILE_ID)
      .sort(([, left], [, right]) => (right.loadedAt ?? 0) - (left.loadedAt ?? 0))[0]?.[1]
    const migrationSource = previous ?? newest
    this.account = migrationSource
      ? this.sanitize(migrationSource)
      : this.migrateLegacy(legacySteamId ?? legacyDatabase.get('steamId') ?? '')
    this.persist()
  }

  // Compatibility entry point for the existing Steam adapter.
  openSteamAccount(steamId: string): void {
    this.openProfile(steamId)
  }

  getSnapshot(): LibrarySnapshot {
    this.ensureOpen()
    const visibleRecords = Object.values(this.account.games).filter(
      (game) => hasUsableName(game.name) && (game.owned || game.installed)
    )
    const canonicalRecords = new Map<string, StoredGame>()
    const canonicalIdByStoredId = new Map<string, string>()
    for (const game of visibleRecords) {
      const nameKey = canonicalName(game.name)
      const current = canonicalRecords.get(nameKey)
      canonicalRecords.set(nameKey, current ? preferDisplayGame(current, game) : game)
    }
    for (const game of visibleRecords) {
      const canonical = canonicalRecords.get(canonicalName(game.name)) as StoredGame
      canonicalIdByStoredId.set(game.id, canonical.id)
    }

    const toPublicGame = ({
      owned: _owned,
      lastSeenOnlineAt: _online,
      lastSeenInstalledAt: _local,
      ...game
    }: StoredGame): LibraryGame => game
    const games = [...canonicalRecords.values()].map(toPublicGame)
    const providerGames = visibleRecords.map(toPublicGame)
    const visibleIds = new Set(games.map((game) => game.id))
    const recentGameIds = [
      ...new Set(this.account.recentGameIds.map((id) => canonicalIdByStoredId.get(id) ?? id))
    ].filter((id) => visibleIds.has(id))

    return {
      games,
      providerGames,
      recentGameIds,
      loadedAt: this.account.loadedAt,
      isLoadingMetadata: this.metadataLoadingProviders.size > 0
    }
  }

  setMetadataLoading(provider: string, loading?: boolean): void {
    const active = loading ?? Boolean(provider)
    const key = loading === undefined ? 'system' : provider
    if (active) this.metadataLoadingProviders.add(key)
    else this.metadataLoadingProviders.delete(key)
  }

  /** Local state is authoritative only for one provider's installation status. */
  applyInstalledProviderDelta(
    provider: GameProvider,
    installedGames: Iterable<ProviderInstalledDelta>
  ): void {
    this.ensureOpen()
    const now = Date.now()
    for (const game of Object.values(this.account.games)) {
      if (game.provider === provider) {
        game.installed = false
        game.installDir = undefined
      }
    }

    for (const installed of installedGames) {
      if (!validProviderGameId(installed.providerGameId) || !hasUsableName(installed.name)) continue
      const rawProviderId = installed.providerGameId.trim()
      const id = providerGameId(provider, rawProviderId)
      const existing = this.account.games[id]
      const currentMetadata = existing?.metadata ?? {}
      const nextMetadata = mergeDefinedMetadata(currentMetadata, installed.metadata ?? {})
      const metadataChanged = !metadataEquals(currentMetadata, nextMetadata)
      this.account.games[id] = {
        ...existing,
        id,
        provider,
        providerGameId: rawProviderId,
        appId: installed.appId ?? existing?.appId,
        name: installed.name.trim(),
        metadata: nextMetadata,
        metadataRevision: (existing?.metadataRevision ?? 0) + (metadataChanged ? 1 : 0),
        metadataUpdatedAt: metadataChanged ? now : existing?.metadataUpdatedAt,
        installed: true,
        installDir: installed.installDir,
        owned: existing?.owned ?? false,
        lastPlayedTimestamp: installed.lastPlayedTimestamp ?? existing?.lastPlayedTimestamp,
        addedAt: existing?.addedAt ?? now,
        updatedAt: now,
        lastSeenInstalledAt: now
      }
    }

    this.rebuildRecentIds()
    this.commit(now)
  }

  /** A successful online response is authoritative for one provider only. */
  applyAuthoritativeProviderDelta(
    provider: GameProvider,
    ownedGames: Iterable<ProviderOwnedDelta>
  ): void {
    this.ensureOpen()
    const now = Date.now()
    const seen = new Set<string>()

    for (const owned of ownedGames) {
      if (!validProviderGameId(owned.providerGameId)) continue
      const rawProviderId = owned.providerGameId.trim()
      const id = providerGameId(provider, rawProviderId)
      const existing = this.account.games[id]
      const currentMetadata = existing?.metadata ?? {}
      const nextMetadata = mergeDefinedMetadata(currentMetadata, owned.metadata ?? {})
      const metadataChanged = !metadataEquals(currentMetadata, nextMetadata)
      const name = hasUsableName(owned.name) ? owned.name.trim() : (existing?.name ?? '')
      seen.add(id)
      this.account.games[id] = {
        ...existing,
        id,
        provider,
        providerGameId: rawProviderId,
        appId: owned.appId ?? existing?.appId,
        name,
        metadata: nextMetadata,
        metadataRevision: (existing?.metadataRevision ?? 0) + (metadataChanged ? 1 : 0),
        metadataUpdatedAt: metadataChanged ? now : existing?.metadataUpdatedAt,
        installed: existing?.installed ?? false,
        owned: true,
        playtimeMinutes: owned.playtimeMinutes ?? existing?.playtimeMinutes,
        lastPlayedTimestamp: owned.lastPlayedTimestamp ?? existing?.lastPlayedTimestamp,
        addedAt: existing?.addedAt ?? now,
        updatedAt: now,
        lastSeenOnlineAt: now
      }
    }

    for (const [id, game] of Object.entries(this.account.games)) {
      if (game.provider !== provider || seen.has(id)) continue
      game.owned = false
      if (!game.installed) delete this.account.games[id]
    }

    this.rebuildRecentIds()
    this.commit(now)
  }

  applyProviderMetadataDelta(
    provider: GameProvider,
    delta: ProviderMetadataDelta,
    allowCreate: boolean
  ): boolean {
    this.ensureOpen()
    if (!validProviderGameId(delta.providerGameId)) return false
    const rawProviderId = delta.providerGameId.trim()
    const id = providerGameId(provider, rawProviderId)
    const existing = this.account.games[id]
    if (!existing && (!allowCreate || !hasUsableName(delta.name))) return false

    const now = Date.now()
    const name = hasUsableName(delta.name) ? delta.name.trim() : existing?.name
    if (!hasUsableName(name)) return false

    const currentMetadata = existing?.metadata ?? {}
    const nextMetadata = mergeDefinedMetadata(currentMetadata, delta.metadata)
    const contentChanged = !metadataEquals(currentMetadata, nextMetadata)
    const identityChanged = !existing || existing.name !== name
    const localeChanged = existing?.metadataLocale !== delta.locale
    const sourceChanged = existing?.metadataSource !== delta.source
    if (existing && !contentChanged && !identityChanged && !localeChanged && !sourceChanged) return false

    this.account.games[id] = {
      ...existing,
      id,
      provider,
      providerGameId: rawProviderId,
      appId: delta.appId ?? existing?.appId,
      name,
      metadata: nextMetadata,
      metadataRevision:
        contentChanged || localeChanged
          ? (existing?.metadataRevision ?? 0) + 1
          : (existing?.metadataRevision ?? 0),
      metadataUpdatedAt:
        contentChanged || localeChanged ? delta.fetchedAt : existing?.metadataUpdatedAt,
      metadataLocale: delta.locale,
      metadataSource: delta.source,
      installed: existing?.installed ?? false,
      owned: existing?.owned ?? allowCreate,
      addedAt: existing?.addedAt ?? now,
      updatedAt: now,
      lastSeenOnlineAt: existing?.lastSeenOnlineAt ?? (allowCreate ? now : undefined)
    }

    this.commit(now)
    return true
  }

  removeProviderGame(provider: GameProvider, rawProviderId: string): boolean {
    this.ensureOpen()
    if (!validProviderGameId(rawProviderId)) return false
    const id = providerGameId(provider, rawProviderId.trim())
    const game = this.account.games[id]
    if (!game) return false
    if (game.installed) game.owned = false
    else delete this.account.games[id]
    this.rebuildRecentIds()
    this.commit(Date.now())
    return true
  }

  // Steam compatibility wrappers keep the existing adapter small while all
  // future stores use the provider-neutral methods above.
  applyInstalledDelta(installedGames: Iterable<SteamInstalledDelta>): void {
    this.applyInstalledProviderDelta(
      STEAM_PROVIDER,
      [...installedGames].map((game) => ({
        providerGameId: String(game.appId),
        appId: game.appId,
        name: game.name,
        installDir: game.installDir,
        lastPlayedTimestamp: game.lastPlayedTimestamp
      }))
    )
  }

  applyAuthoritativeOwnedDelta(ownedGames: Iterable<SteamOwnedDelta>): void {
    this.applyAuthoritativeProviderDelta(
      STEAM_PROVIDER,
      [...ownedGames].map((game) => ({
        providerGameId: String(game.appId),
        appId: game.appId,
        name: game.name,
        metadata: { iconUrl: game.iconUrl },
        playtimeMinutes: game.playtimeMinutes,
        lastPlayedTimestamp: game.lastPlayedTimestamp
      }))
    )
  }

  /** Dynamicstore IDs are non-authoritative because they include DLC/tools. */
  applyNonAuthoritativeOwnedIds(appIds: Iterable<number>): number[] {
    this.ensureOpen()
    const now = Date.now()
    const unresolved: number[] = []
    for (const appId of new Set(appIds)) {
      if (!Number.isInteger(appId) || appId <= 0) continue
      const id = steamGameId(appId)
      const existing = this.account.games[id]
      if (existing && hasUsableName(existing.name)) {
        existing.owned = true
        existing.lastSeenOnlineAt = now
        existing.updatedAt = now
      } else {
        unresolved.push(appId)
      }
    }
    this.commit(now)
    return unresolved
  }

  applyMetadataDelta(metadata: SteamMetadataDelta, allowCreate: boolean): boolean {
    return this.applyProviderMetadataDelta(
      STEAM_PROVIDER,
      {
        providerGameId: String(metadata.appId),
        appId: metadata.appId,
        name: metadata.name,
        metadata: metadata.metadata,
        locale: metadata.locale,
        source: metadata.source,
        fetchedAt: metadata.fetchedAt
      },
      allowCreate
    )
  }

  /** Applies provider-neutral enrichment (for example completion-time data). */
  applyEnrichmentDelta(gameId: string, metadata: GameMetadata, fetchedAt: number): boolean {
    this.ensureOpen()
    const existing = this.account.games[gameId]
    if (!existing) return false
    const nextMetadata = mergeDefinedMetadata(existing.metadata, metadata)
    if (metadataEquals(existing.metadata, nextMetadata)) return false
    this.account.games[gameId] = {
      ...existing,
      metadata: nextMetadata,
      metadataRevision: existing.metadataRevision + 1,
      metadataUpdatedAt: fetchedAt,
      updatedAt: Date.now()
    }
    this.commit(Date.now())
    return true
  }

  setRecentSteamAppIds(appIds: Iterable<number>): void {
    this.ensureOpen()
    const ids = [...new Set(appIds)].map(steamGameId)
    const known = new Set(Object.keys(this.account.games))
    const otherProviders = this.account.recentGameIds.filter(
      (id) => this.account.games[id]?.provider !== STEAM_PROVIDER
    )
    this.account.recentGameIds = [...ids.filter((id) => known.has(id)), ...otherProviders]
    this.commit(Date.now())
  }

  markStarted(gameId: string): boolean {
    this.ensureOpen()
    const game = this.account.games[gameId]
    if (!game) return false
    const now = Date.now()
    game.lastStartedAt = now
    game.updatedAt = now
    this.rebuildRecentIds()
    this.commit(now)
    return true
  }

  getGame(id: string): LibraryGame | undefined {
    this.ensureOpen()
    const game = this.account.games[id]
    if (!game) return undefined
    const { owned: _owned, lastSeenOnlineAt: _online, lastSeenInstalledAt: _local, ...output } = game
    return output
  }

  getGamesByProvider(provider: GameProvider): LibraryGame[] {
    return this.getSnapshot().games.filter((game) => game.provider === provider)
  }

  private rebuildRecentIds(): void {
    this.account.recentGameIds = Object.values(this.account.games)
      .filter((game) => (game.lastStartedAt || game.lastPlayedTimestamp) && (game.owned || game.installed))
      .sort(
        (a, b) =>
          (b.lastStartedAt ?? b.lastPlayedTimestamp ?? 0) -
          (a.lastStartedAt ?? a.lastPlayedTimestamp ?? 0)
      )
      .map((game) => game.id)
  }

  private sanitize(input: AccountLibrary): AccountLibrary {
    const clean = emptyAccount()
    const now = Date.now()

    for (const stored of Object.values(input.games ?? {})) {
      const candidate = stored as StoredGameCandidate
      const provider = KNOWN_PROVIDERS.has(candidate.provider as GameProvider)
        ? (candidate.provider as GameProvider)
        : STEAM_PROVIDER
      const rawProviderId = String(candidate.providerGameId ?? candidate.appId ?? '').trim()
      if (!validProviderGameId(rawProviderId)) continue
      const appIdValue = Number(candidate.appId ?? (provider === STEAM_PROVIDER ? rawProviderId : NaN))
      const appId = Number.isInteger(appIdValue) && appIdValue > 0 ? appIdValue : undefined
      if (provider === STEAM_PROVIDER && !appId) continue
      const id = providerGameId(provider, rawProviderId)
      const existing = clean.games[id]
      if (existing && existing.updatedAt > (candidate.updatedAt ?? 0)) continue
      const {
        screenshotUrl: _legacyScreenshot,
        shortDescription: _legacySummary,
        genres: _legacyGenres,
        developers: _legacyDevelopers,
        ...currentFields
      } = candidate
      const migratedMetadata = migrateMetadata(candidate)
      clean.games[id] = {
        ...currentFields,
        id,
        provider,
        providerGameId: rawProviderId,
        appId,
        name: typeof candidate.name === 'string' ? candidate.name.trim() : '',
        metadata: migratedMetadata,
        metadataRevision:
          candidate.metadataRevision ?? (Object.keys(migratedMetadata).length > 0 ? 1 : 0),
        installed: Boolean(candidate.installed),
        owned: Boolean(candidate.owned),
        addedAt: candidate.addedAt || now,
        updatedAt: candidate.updatedAt || now
      }
    }

    clean.recentGameIds = [...new Set(input.recentGameIds ?? [])].filter((id) => Boolean(clean.games[id]))
    clean.loadedAt = input.loadedAt ?? 0
    return clean
  }

  private migrateLegacy(steamId: string): AccountLibrary {
    const legacy = legacyDatabaseState
    if (legacy.steamId !== steamId || !legacy.snapshot) return emptyAccount()
    const account = emptyAccount()
    const now = Date.now()
    for (const old of legacy.snapshot.games ?? []) {
      const appId = Number(old.appId)
      if (!Number.isInteger(appId) || appId <= 0 || !hasUsableName(old.name)) continue
      const id = steamGameId(appId)
      const existing = account.games[id]
      const candidate: StoredGame = {
        id,
        provider: STEAM_PROVIDER,
        providerGameId: String(appId),
        appId,
        name: old.name.trim(),
        metadata: migrateMetadata(old),
        metadataRevision: Object.keys(migrateMetadata(old)).length > 0 ? 1 : 0,
        playtimeMinutes: old.playtimeMinutes,
        lastPlayedTimestamp: old.lastPlayedTimestamp,
        installed: Boolean(old.installed),
        installDir: old.installDir,
        owned: Boolean(old.installed),
        addedAt: old.addedAt ?? now,
        updatedAt: old.updatedAt ?? now
      }
      if (!existing || candidate.updatedAt >= existing.updatedAt) account.games[id] = candidate
    }
    account.recentGameIds = [...new Set(legacy.snapshot.recentlyPlayedAppIds ?? [])]
      .map(steamGameId)
      .filter((id) => Boolean(account.games[id]))
    account.loadedAt = legacy.snapshot.loadedAt ?? now
    return account
  }

  private ensureOpen(): void {
    if (!this.profileOpen) this.openProfile()
  }

  private commit(timestamp: number): void {
    this.account.loadedAt = timestamp
    this.persist()
  }

  private persist(): void {
    if (!this.profileOpen) return
    databaseState.schemaVersion = DATABASE_VERSION
    databaseState.accounts[DEFAULT_PROFILE_ID] = this.account
    scheduleDatabasePersist()
  }
}

export const gameRepository = new GameRepository()
