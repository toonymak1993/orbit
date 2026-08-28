import { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'
import type {
  CustomGameCommitInput,
  CustomGameDraft,
  CustomGameImportSource,
  CustomGameSaveSource,
  GameAchievementsSnapshot,
  GameCompletionTimes,
  LibraryGame,
  LibrarySnapshot,
  LibraryStats,
  LocalGameBackupResult
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
import { customLibraryService } from '../customLibrary'
import { customArtworkService } from '../customArtwork'

/** Coordinates every store into one cache and one three-pipeline sync session. */
export class UnifiedLibraryService extends EventEmitter {
  private refreshInFlight: Promise<LibrarySnapshot> | null = null
  private refreshQueued = false
  private snapshotEmitTimer: ReturnType<typeof setTimeout> | undefined
  private playtimeSyncTimers = new Map<string, ReturnType<typeof setTimeout>>()

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
    return {
      ...gameRepository.getSnapshot(),
      providerStatuses: [
        steamLibraryService.getProviderStatus(),
        epicLibraryService.getProviderStatus(),
        xboxLibraryService.getProviderStatus()
      ]
    }
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

  refresh(): Promise<LibrarySnapshot> {
    if (this.refreshInFlight) {
      this.refreshQueued = true
      return this.refreshInFlight
    }

    const run = async (): Promise<LibrarySnapshot> => {
      let snapshot = this.getSnapshot()
      do {
        this.refreshQueued = false
        snapshot = await this.doRefresh()
      } while (this.refreshQueued)
      return snapshot
    }
    const refresh = run().finally(() => {
      if (this.refreshInFlight === refresh) this.refreshInFlight = null
    })
    this.refreshInFlight = refresh
    return refresh
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

  markGameStarted(gameId: string, startedAt?: number): void {
    if (gameRepository.markStarted(gameId, startedAt)) this.emitSnapshot()
  }

  recordGameSession(
    gameId: string,
    durationSeconds: number,
    endedAt: number
  ): { totalPlaytimeSeconds?: number } | undefined {
    const game = gameRepository.getGame(gameId)
    if (!game || !gameRepository.recordGameSession(gameId, durationSeconds, endedAt)) return undefined
    this.emitSnapshot()

    const result = { totalPlaytimeSeconds: gameRepository.getGame(gameId)?.playtimeSeconds }

    const existingTimer = this.playtimeSyncTimers.get(gameId)
    if (existingTimer) clearTimeout(existingTimer)
    if ((game.provider !== 'steam' || !game.appId) && game.provider !== 'epic') return result

    // Give the store client a short window to publish its final total. ORBIT's
    // local seconds remain visible immediately and are reconciled in-place.
    const timer = setTimeout(() => {
      this.playtimeSyncTimers.delete(gameId)
      if (game.provider === 'steam' && game.appId) {
        void steamLibraryService.refreshPlaytime(steamAuthManager, game.appId)
      } else if (game.provider === 'epic') {
        void epicLibraryService.refreshPlaytime(epicAuthManager, game.providerGameId)
      }
    }, 3_000)
    timer.unref()
    this.playtimeSyncTimers.set(gameId, timer)
    return result
  }

  beginCustomGameImport(
    mainWindow: BrowserWindow,
    source: CustomGameImportSource
  ): Promise<CustomGameDraft | null> {
    return customLibraryService.beginImport(mainWindow, source)
  }

  selectCustomGameArtwork(
    mainWindow: BrowserWindow,
    draftId: string
  ): Promise<CustomGameDraft | null> {
    return customLibraryService.selectArtwork(mainWindow, draftId)
  }

  selectCustomGameSave(
    mainWindow: BrowserWindow,
    draftId: string,
    source: CustomGameSaveSource
  ): Promise<CustomGameDraft | null> {
    return customLibraryService.selectSave(mainWindow, draftId, source)
  }

  clearCustomGameSave(draftId: string): CustomGameDraft {
    return customLibraryService.clearSave(draftId)
  }

  cancelCustomGameImport(draftId: string): void {
    customLibraryService.cancel(draftId)
  }

  async commitCustomGame(input: CustomGameCommitInput): Promise<LibrarySnapshot> {
    const record = await customLibraryService.commit(
      input.draftId,
      input.name,
      input.launchArguments
    )
    const game = gameRepository.upsertLocalGame(record)
    artworkService.syncProvider([game], 'local')
    this.emitSnapshot()
    return this.getSnapshot()
  }

  updateCustomGameLaunchArguments(
    gameId: string,
    launchArguments: readonly string[]
  ): LibrarySnapshot {
    if (!gameRepository.updateLocalGameLaunchArguments(gameId, launchArguments)) {
      throw new Error('Custom game is not available')
    }
    this.emitSnapshot()
    return this.getSnapshot()
  }

  async removeCustomGame(gameId: string): Promise<LibrarySnapshot> {
    const game = gameRepository.getGame(gameId)
    if (!game || game.provider !== 'local') throw new Error('Custom game is not available')
    await Promise.all([
      customArtworkService.reset(gameId, 'vertical'),
      customArtworkService.reset(gameId, 'horizontal'),
      customArtworkService.reset(gameId, 'icon')
    ])
    if (!gameRepository.removeLocalGame(gameId)) throw new Error('Custom game is not available')
    this.emitSnapshot()
    return this.getSnapshot()
  }

  async backupCustomGame(gameId: string): Promise<LocalGameBackupResult> {
    const game = gameRepository.getGame(gameId)
    if (!game || game.provider !== 'local') throw new Error('Custom game is not available')
    const result = await customLibraryService.backup(game)
    if (gameRepository.recordLocalBackup(gameId, result)) this.emitSnapshot()
    return result
  }

  async openCustomGameBackups(gameId: string): Promise<void> {
    const game = gameRepository.getGame(gameId)
    if (!game || game.provider !== 'local') throw new Error('Custom game is not available')
    await customLibraryService.openBackupDirectory(game)
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
    artworkService.syncProvider(gameRepository.getGamesByProvider('local'), 'local')
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
