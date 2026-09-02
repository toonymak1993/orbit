import { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'
import {
  IPC,
  type RetroEmulatorInstallInput,
  type RetroEmulatorInstallResult,
  type CustomGameCommitInput,
  type CustomGameDraft,
  type CustomGameImportSource,
  type CustomGameSaveSource,
  type GameAchievementsSnapshot,
  type GameCompletionTimes,
  type LibraryGame,
  type LibrarySnapshot,
  type LibraryStats,
  type LocalGameBackupResult,
  type RetroLibraryResult,
  type RetroLibraryStatus,
  type RetroEmulatorDownloadInput,
  type RetroEmulatorDownloadResult,
  type RetroSystemDirectoryResult,
  type RetroSystemId
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
import { playStationAuthManager } from '../playstation/playstationAuth'
import { playStationLibraryService } from '../playstation/playstationLibrary'
import { storeService } from '../store/storeService'
import { customLibraryService } from '../customLibrary'
import { customArtworkService } from '../customArtwork'
import { projectLibraryVisibility } from '@shared/libraryVisibility'
import { retroLibraryService } from '../retro/retroLibrary'
import { retroSetupService } from '../retro/retroSetup'
import { gogLibraryService } from '../gog/gogLibrary'
import { eaLibraryService } from '../ea/eaLibrary'
import { ubisoftLibraryService } from '../ubisoft/ubisoftLibrary'

const MAX_EXCLUDED_GAME_IDS = 10_000

function validExcludedGameIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [
    ...new Set(
      value.filter(
        (gameId): gameId is string =>
          typeof gameId === 'string' && Boolean(gameId.trim()) && gameId.length <= 512
      )
    )
  ].slice(0, MAX_EXCLUDED_GAME_IDS)
}

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
    playStationLibraryService.on('updated', () => this.emitSnapshot())
    gogLibraryService.on('updated', () => this.emitSnapshot())
    eaLibraryService.on('updated', () => this.emitSnapshot())
    ubisoftLibraryService.on('updated', () => this.emitSnapshot())
  }

  hydrateFromDisk(legacySteamId?: string): void {
    gameRepository.openProfile(legacySteamId)
  }

  getSnapshot(): LibrarySnapshot {
    const snapshot = gameRepository.getSnapshot()
    const excludedGameIds = this.getExcludedGameIds()
    const games = projectLibraryVisibility(snapshot.games, excludedGameIds)
    const providerGames = projectLibraryVisibility(snapshot.providerGames, excludedGameIds)
    const excludedGames = [
      ...new Map(
        [...providerGames.excludedGames, ...games.excludedGames].map((game) => [game.id, game])
      ).values()
    ]
    const visibleIds = new Set(games.visibleGames.map((game) => game.id))
    const recentGameIds = snapshot.recentGameIds.filter((gameId) => visibleIds.has(gameId))
    const visibleGamesById = new Map(games.visibleGames.map((game) => [game.id, game]))
    const currentContinueGameId = snapshot.activity?.continueGameId
    const continueGameId =
      currentContinueGameId && visibleIds.has(currentContinueGameId)
        ? currentContinueGameId
        : recentGameIds.find((gameId) => visibleGamesById.get(gameId)?.installed)

    return {
      ...snapshot,
      games: games.visibleGames,
      providerGames: providerGames.visibleGames,
      excludedGames,
      recentGameIds,
      activity: snapshot.activity
        ? { ...snapshot.activity, continueGameId }
        : undefined,
      providerStatuses: [
        steamLibraryService.getProviderStatus(),
        epicLibraryService.getProviderStatus(),
        gogLibraryService.getProviderStatus(),
        xboxLibraryService.getProviderStatus(),
        playStationLibraryService.getProviderStatus(),
        retroLibraryService.getProviderStatus(),
        eaLibraryService.getProviderStatus(),
        ubisoftLibraryService.getProviderStatus()
      ]
    }
  }

  getGame(gameId: string): LibraryGame | undefined {
    return gameRepository.getGame(gameId)
  }

  setGameExcluded(gameId: string, excluded: boolean): LibrarySnapshot {
    if (excluded && !gameRepository.getGame(gameId)) {
      throw new Error('Library game is not available')
    }

    const current = this.getExcludedGameIds()
    const alreadyExcluded = current.includes(gameId)
    if (excluded === alreadyExcluded) return this.getSnapshot()
    if (excluded && current.length >= MAX_EXCLUDED_GAME_IDS) {
      throw new Error('Excluded game limit reached')
    }

    const next = excluded
      ? [...current, gameId]
      : current.filter((candidate) => candidate !== gameId)
    settingsStore.set('excludedGameIds', next)
    const snapshot = this.getSnapshot()
    this.emitSnapshot()
    return snapshot
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

  async resolveAchievements(
    gameId: string,
    force = false
  ): Promise<GameAchievementsSnapshot | null> {
    const game = gameRepository.getGame(gameId)
    if (!game || !settingsStore.store.showAchievements) return null
    return achievementService.resolve(game, force)
  }

  syncAchievements(forceUnavailable = false): Promise<void> {
    return achievementService.sync(this.getSnapshot().games, forceUnavailable)
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
      customArtworkService.reset(gameId, 'logo'),
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

  getRetroLibraryStatus(): RetroLibraryStatus {
    return retroLibraryService.getStatus()
  }

  async refreshRetroLibrary(): Promise<RetroLibraryResult> {
    const status = await retroLibraryService.refresh()
    artworkService.syncProvider(gameRepository.getGamesByProvider('retro'), 'retro')
    this.emitSnapshot()
    return { snapshot: this.getSnapshot(), status }
  }

  async addRetroLibraryDirectory(mainWindow: BrowserWindow): Promise<RetroLibraryResult | null> {
    const status = await retroLibraryService.addDirectory(mainWindow)
    if (!status) return null
    artworkService.syncProvider(gameRepository.getGamesByProvider('retro'), 'retro')
    this.emitSnapshot()
    return { snapshot: this.getSnapshot(), status }
  }

  async removeRetroLibraryDirectory(directory: string): Promise<RetroLibraryResult> {
    const status = await retroLibraryService.removeDirectory(directory)
    this.emitSnapshot()
    return { snapshot: this.getSnapshot(), status }
  }

  ensureRetroSystemDirectory(systemId: RetroSystemId): Promise<RetroSystemDirectoryResult> {
    return retroSetupService.ensureSystemDirectory(systemId)
  }

  async openRetroSystemDirectory(
    mainWindow: BrowserWindow,
    systemId: RetroSystemId
  ): Promise<RetroSystemDirectoryResult> {
    const result = await retroSetupService.openSystemDirectory(systemId)
    const refreshOnReturn = (): void => {
      clearTimeout(cleanupTimer)
      const timer = setTimeout(() => {
        if (!mainWindow.isDestroyed()) void this.refreshRetroLibrary().catch(() => undefined)
      }, 700)
      timer.unref()
    }
    mainWindow.once('focus', refreshOnReturn)
    const cleanupTimer = setTimeout(() => {
      if (!mainWindow.isDestroyed()) mainWindow.removeListener('focus', refreshOnReturn)
    }, 10 * 60 * 1_000)
    cleanupTimer.unref()
    return result
  }

  openRetroEmulatorDownload(
    input: RetroEmulatorDownloadInput
  ): Promise<RetroEmulatorDownloadResult> {
    return retroSetupService.openEmulatorDownload(input.systemId, input.emulatorId)
  }

  async installRetroEmulator(
    mainWindow: BrowserWindow,
    input: RetroEmulatorInstallInput
  ): Promise<RetroEmulatorInstallResult> {
    const result = await retroSetupService.installEmulator(
      input.systemId,
      input.emulatorId,
      (progress) => {
        if (!mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
          mainWindow.webContents.send(IPC.retroEmulatorInstallProgress, progress)
        }
      }
    )
    artworkService.syncProvider(gameRepository.getGamesByProvider('retro'), 'retro')
    this.emitSnapshot()
    return { ...result, snapshot: this.getSnapshot() }
  }

  cancelRetroEmulatorInstall(): boolean {
    return retroSetupService.cancelEmulatorInstall()
  }

  updateRetroGameLaunchArguments(
    gameId: string,
    launchArguments: readonly string[]
  ): LibrarySnapshot {
    if (!gameRepository.updateRetroGameLaunchArguments(gameId, launchArguments)) {
      throw new Error('Retro game is not available')
    }
    this.emitSnapshot()
    return this.getSnapshot()
  }

  private async doRefresh(): Promise<LibrarySnapshot> {
    const steamAccount = steamAuthManager.getAccount() ?? (await steamAuthManager.restoreSession())
    gameRepository.openProfile(steamAccount?.steamId)
    syncCoordinator.beginSession()
    artworkService.beginSyncSession()
    await Promise.allSettled([
      steamLibraryService.refresh(steamAuthManager),
      epicLibraryService.refresh(epicAuthManager),
      gogLibraryService.refresh(),
      xboxLibraryService.refresh(),
      playStationLibraryService.refresh(playStationAuthManager),
      retroLibraryService.refresh(),
      eaLibraryService.refresh(),
      ubisoftLibraryService.refresh()
    ])

    artworkService.syncProvider(gameRepository.getGamesByProvider('steam'), 'steam')
    artworkService.syncProvider(gameRepository.getGamesByProvider('epic'), 'epic')
    artworkService.syncProvider(gameRepository.getGamesByProvider('gog'), 'gog')
    artworkService.syncProvider(gameRepository.getGamesByProvider('xbox'), 'xbox')
    artworkService.syncProvider(gameRepository.getGamesByProvider('playstation'), 'playstation')
    artworkService.syncProvider(gameRepository.getGamesByProvider('ea'), 'ea')
    artworkService.syncProvider(gameRepository.getGamesByProvider('ubisoft'), 'ubisoft')
    artworkService.syncProvider(gameRepository.getGamesByProvider('local'), 'local')
    artworkService.syncProvider(gameRepository.getGamesByProvider('retro'), 'retro')
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

  private getExcludedGameIds(): string[] {
    return validExcludedGameIds(settingsStore.store.excludedGameIds)
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
