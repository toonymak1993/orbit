import { EventEmitter } from 'node:events'
import type {
  GameAchievementsSnapshot,
  GameCompletionTimes,
  LibraryGame,
  LibrarySnapshot,
  LibraryStats
} from '@shared/ipc'
import { completionTimesService } from '../completionTimes'
import { artworkService } from '../imageCache'
import { epicAuthManager } from '../epic/epicAuth'
import { epicLibraryService } from '../epic/epicLibrary'
import { steamAuthManager } from '../steam/steamAuth'
import { steamLibraryService } from '../steam/steamLibrary'
import { syncCoordinator } from '../sync/syncCoordinator'
import { gameRepository } from './gameRepository'
import { achievementService } from '../achievements/achievementService'
import { settingsStore } from '../settingsStore'
import { xboxLibraryService } from '../xbox/xboxLibrary'
import { storeService } from '../store/storeService'

/** Coordinates every store into one cache and one three-pipeline sync session. */
export class UnifiedLibraryService extends EventEmitter {
  private refreshInFlight: Promise<LibrarySnapshot> | null = null
  private snapshotEmitTimer: ReturnType<typeof setTimeout> | undefined

  constructor() {
    super()
    steamLibraryService.on('updated', () => this.emitSnapshot())
    epicLibraryService.on('updated', () => this.emitSnapshot())
    xboxLibraryService.on('updated', () => this.emitSnapshot())
  }

  hydrateFromDisk(legacySteamId?: string): void {
    gameRepository.openProfile(legacySteamId)
  }

  getSnapshot(): LibrarySnapshot {
    return gameRepository.getSnapshot()
  }

  getGame(gameId: string): LibraryGame | undefined {
    return gameRepository.getGame(gameId)
  }

  getStats(): LibraryStats {
    const games = this.getSnapshot().games
    const mostPlayed = [...games].sort(
      (a, b) => (b.playtimeMinutes ?? 0) - (a.playtimeMinutes ?? 0)
    )[0]
    const achievements = achievementService.aggregate(games.map((game) => game.id))
    return {
      gameCount: games.length,
      installedCount: games.filter((game) => game.installed).length,
      totalPlaytimeMinutes: games.reduce(
        (total, game) => total + (game.playtimeMinutes ?? 0),
        0
      ),
      mostPlayedGameName:
        mostPlayed && (mostPlayed.playtimeMinutes ?? 0) > 0 ? mostPlayed.name : undefined,
      mostPlayedMinutes: mostPlayed?.playtimeMinutes,
      achievementsUnlocked: achievements.unlocked,
      achievementsTotal: achievements.total
    }
  }

  async refresh(): Promise<LibrarySnapshot> {
    if (this.refreshInFlight) return this.refreshInFlight
    this.refreshInFlight = this.doRefresh()
    try {
      return await this.refreshInFlight
    } finally {
      this.refreshInFlight = null
    }
  }

  async resolveCompletionTimes(gameId: string): Promise<GameCompletionTimes | null> {
    const game = gameRepository.getGame(gameId)
    if (!game) return null
    const completionTimes = await completionTimesService.resolve(game)
    if (completionTimes) {
      const changed = gameRepository.applyEnrichmentDelta(
        gameId,
        { completionTimes },
        completionTimes.fetchedAt
      )
      if (changed) this.emitSnapshot()
    }
    return completionTimes
  }

  async resolveAchievements(gameId: string): Promise<GameAchievementsSnapshot | null> {
    const game = gameRepository.getGame(gameId)
    if (!game || !settingsStore.store.showAchievements) return null
    return achievementService.resolve(game)
  }

  markGameStarted(gameId: string): void {
    if (gameRepository.markStarted(gameId)) this.emitSnapshot()
  }

  private async doRefresh(): Promise<LibrarySnapshot> {
    const steamAccount = steamAuthManager.getAccount() ?? (await steamAuthManager.restoreSession())
    gameRepository.openProfile(steamAccount?.steamId)
    syncCoordinator.beginSession()
    artworkService.beginSyncSession()
    await Promise.allSettled([
      steamLibraryService.refresh(steamAuthManager),
      epicLibraryService.refresh(epicAuthManager),
      xboxLibraryService.refresh()
    ])

    artworkService.syncProvider(gameRepository.getGamesByProvider('steam'), 'steam')
    artworkService.syncProvider(gameRepository.getGamesByProvider('epic'), 'epic')
    artworkService.syncProvider(gameRepository.getGamesByProvider('xbox'), 'xbox')
    const startupTasks: Promise<unknown>[] = [
      achievementService.syncStartup(this.getSnapshot().games)
    ]
    // Steam's authenticated session also powers the wishlist import. Start it
    // with achievements as soon as the library delta is stable so Home has its
    // wishlist offers before the user leaves onboarding.
    if (steamAuthManager.getAccount()) startupTasks.push(storeService.refresh())
    void Promise.allSettled(startupTasks)
    this.emitSnapshot()
    return this.getSnapshot()
  }

  private emitSnapshot(): void {
    if (this.snapshotEmitTimer) return
    this.snapshotEmitTimer = setTimeout(() => {
      this.snapshotEmitTimer = undefined
      this.emit('updated', this.getSnapshot())
    }, 120)
    this.snapshotEmitTimer.unref()
  }
}

export const libraryService = new UnifiedLibraryService()
