import { EventEmitter } from 'node:events'
import {
  getPurchasedGames,
  getUserPlayedGames,
  type PurchasedGame,
  type UserPlayedGamesResponse
} from 'psn-api'
import type {
  GameMetadata,
  LibraryDetectionMethod,
  LibraryProviderStatus,
  LibrarySnapshot
} from '@shared/ipc'
import { playStationDurationSeconds } from '@shared/playstation'
import type { LibraryProviderAdapter } from '../library/libraryProvider'
import {
  gameRepository,
  type ProviderOwnedDelta
} from '../library/gameRepository'
import type { PlayStationAuthManager } from './playstationAuth'
import { playStationRemotePlayService } from './remotePlay'

const PAGE_SIZE = 100
const MAX_PAGES = 50

type PlayedTitle = UserPlayedGamesResponse['titles'][number]

interface ImportedGame extends ProviderOwnedDelta {
  metadata: GameMetadata
}

function safeTitleId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toUpperCase()
  return /^[A-Z0-9_.-]{3,120}$/.test(normalized) ? normalized : undefined
}

function safeName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const name = value.trim()
  return name && name.length <= 180 ? name : undefined
}

function trustedArtworkUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    if (
      url.protocol !== 'https:' ||
      !(
        host === 'playstation.com' ||
        host.endsWith('.playstation.com') ||
        host === 'playstation.net' ||
        host.endsWith('.playstation.net')
      )
    ) {
      return undefined
    }
    return url.toString()
  } catch {
    return undefined
  }
}

function timestamp(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function storeUrl(conceptId: unknown): string | undefined {
  const id = String(conceptId ?? '').trim()
  return /^\d{1,24}$/.test(id) ? `https://store.playstation.com/concept/${id}` : undefined
}

function purchasedGame(game: PurchasedGame): ImportedGame | undefined {
  const providerGameId = safeTitleId(game.titleId)
  const name = safeName(game.name)
  if (!providerGameId || !name) return undefined
  const image = trustedArtworkUrl(game.image?.url)
  return {
    providerGameId,
    name,
    metadata: {
      iconUrl: image,
      storeUrl: storeUrl(game.conceptId),
      features: [game.platform, game.membership === 'PS_PLUS' ? 'PlayStation Plus' : 'PlayStation'],
      controllerSupport: 'PlayStation Remote Play',
      artwork: image ? { vertical: [image], icon: [image] } : undefined
    }
  }
}

function playedGame(game: PlayedTitle): ImportedGame | undefined {
  const providerGameId = safeTitleId(game.titleId)
  const name = safeName(game.localizedName) ?? safeName(game.name)
  if (!providerGameId || !name) return undefined
  const icon = trustedArtworkUrl(game.localizedImageUrl) ?? trustedArtworkUrl(game.imageUrl)
  const conceptImages = (game.concept?.media?.images ?? [])
    .map((image) => ({ url: trustedArtworkUrl(image.url), type: image.type?.toUpperCase() ?? '' }))
    .filter((image): image is { url: string; type: string } => Boolean(image.url))
  const horizontal = conceptImages
    .filter((image) => /BANNER|HERO|BACKGROUND|SCREENSHOT/.test(image.type))
    .map((image) => image.url)
  const vertical = conceptImages
    .filter((image) => /PORTRAIT|COVER|MASTER/.test(image.type))
    .map((image) => image.url)
  const fallbackConceptImages = conceptImages.map((image) => image.url)
  return {
    providerGameId,
    name,
    playtimeSeconds: playStationDurationSeconds(game.playDuration),
    lastPlayedTimestamp: timestamp(game.lastPlayedDateTime),
    metadata: {
      iconUrl: icon,
      storeUrl: storeUrl(game.concept?.id),
      features: [game.category?.includes('ps5') ? 'PS5' : 'PS4'],
      controllerSupport: 'PlayStation Remote Play',
      artwork: {
        vertical: [...vertical, ...(icon ? [icon] : []), ...fallbackConceptImages],
        horizontal: [...horizontal, ...fallbackConceptImages],
        icon: icon ? [icon] : fallbackConceptImages
      }
    }
  }
}

function mergeMetadata(left: GameMetadata, right: GameMetadata): GameMetadata {
  const mergeImages = (a?: string[], b?: string[]): string[] | undefined => {
    const values = [...new Set([...(a ?? []), ...(b ?? [])])]
    return values.length > 0 ? values : undefined
  }
  return {
    ...left,
    ...right,
    iconUrl: right.iconUrl ?? left.iconUrl,
    storeUrl: right.storeUrl ?? left.storeUrl,
    features: [...new Set([...(left.features ?? []), ...(right.features ?? [])])],
    artwork: {
      vertical: mergeImages(left.artwork?.vertical, right.artwork?.vertical),
      horizontal: mergeImages(left.artwork?.horizontal, right.artwork?.horizontal),
      icon: mergeImages(left.artwork?.icon, right.artwork?.icon)
    }
  }
}

function mergeGames(groups: ImportedGame[][]): ImportedGame[] {
  const games = new Map<string, ImportedGame>()
  for (const group of groups) {
    for (const game of group) {
      const current = games.get(game.providerGameId)
      if (!current) {
        games.set(game.providerGameId, game)
        continue
      }
      games.set(game.providerGameId, {
        ...current,
        ...game,
        name: game.name ?? current.name,
        playtimeSeconds: game.playtimeSeconds ?? current.playtimeSeconds,
        lastPlayedTimestamp: Math.max(
          current.lastPlayedTimestamp ?? 0,
          game.lastPlayedTimestamp ?? 0
        ) || undefined,
        metadata: mergeMetadata(current.metadata, game.metadata)
      })
    }
  }
  return [...games.values()]
}

async function fetchPurchasedLibrary(
  accessToken: string,
  membership: 'NONE' | 'PS_PLUS'
): Promise<ImportedGame[]> {
  const games: ImportedGame[] = []
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await getPurchasedGames(
      { accessToken },
      { membership, size: PAGE_SIZE, start: page * PAGE_SIZE }
    )
    const entries = response.data.purchasedTitlesRetrieve.games ?? []
    games.push(...entries.map(purchasedGame).filter((game): game is ImportedGame => Boolean(game)))
    if (entries.length < PAGE_SIZE) return games
  }
  throw new Error('PlayStation purchased library exceeded the safe page limit')
}

async function fetchPlayedLibrary(accessToken: string): Promise<ImportedGame[]> {
  const games: ImportedGame[] = []
  let offset = 0
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await getUserPlayedGames({ accessToken }, 'me', {
      categories: 'ps4_game,ps5_native_game',
      limit: PAGE_SIZE,
      offset
    })
    games.push(
      ...response.titles.map(playedGame).filter((game): game is ImportedGame => Boolean(game))
    )
    offset += response.titles.length
    if (response.titles.length === 0 || offset >= response.totalItemCount) return games
  }
  throw new Error('PlayStation play history exceeded the safe page limit')
}

export class PlayStationLibraryService
  extends EventEmitter
  implements LibraryProviderAdapter<PlayStationAuthManager>
{
  readonly provider = 'playstation' as const
  private refreshInFlight: Promise<LibrarySnapshot> | null = null
  private providerStatus: LibraryProviderStatus = {
    provider: 'playstation',
    state: 'idle',
    connection: 'not-connected',
    methods: [],
    gameCount: 0,
    installedCount: 0,
    installableCount: 0
  }

  getProviderStatus(): LibraryProviderStatus {
    return {
      ...this.providerStatus,
      ...gameRepository.getProviderCounts('playstation'),
      methods: [...this.providerStatus.methods]
    }
  }

  getSnapshot(): LibrarySnapshot {
    return gameRepository.getSnapshot()
  }

  refresh(auth: PlayStationAuthManager): Promise<LibrarySnapshot> {
    if (this.refreshInFlight) return this.refreshInFlight
    const refresh = this.doRefresh(auth).finally(() => {
      if (this.refreshInFlight === refresh) this.refreshInFlight = null
    })
    this.refreshInFlight = refresh
    return refresh
  }

  private async doRefresh(auth: PlayStationAuthManager): Promise<LibrarySnapshot> {
    const account = auth.getAccount() ?? (await auth.restoreSession())
    this.setProviderStatus({
      state: 'scanning',
      connection: account ? 'connected' : 'not-connected',
      methods: []
    })

    const remotePlayPromise = playStationRemotePlayService.refresh(true)
    let onlineResults: PromiseSettledResult<ImportedGame[]>[] = []
    let authenticated = false
    if (account) {
      try {
        const accessToken = await auth.getAccessToken()
        authenticated = true
        onlineResults = await Promise.allSettled([
          fetchPurchasedLibrary(accessToken, 'NONE'),
          fetchPurchasedLibrary(accessToken, 'PS_PLUS'),
          fetchPlayedLibrary(accessToken)
        ])
        const successful = onlineResults.flatMap((result) =>
          result.status === 'fulfilled' ? [result.value] : []
        )
        const games = mergeGames(successful)
        if (onlineResults.every((result) => result.status === 'fulfilled')) {
          gameRepository.applyAuthoritativeProviderDelta('playstation', games)
        } else if (games.length > 0) {
          gameRepository.applyNonAuthoritativeProviderDelta('playstation', games)
        }
      } catch {
        authenticated = false
      }
    }

    const remotePlay = await remotePlayPromise
    const selectedExecutableName = await playStationRemotePlayService.selectedExecutableName()
    const knownGames = gameRepository.getGamesByProvider('playstation')
    gameRepository.applyInstalledProviderDelta(
      'playstation',
      selectedExecutableName
        ? knownGames.map((game) => ({
            providerGameId: game.providerGameId,
            name: game.name,
            installDir: '',
            playtimeSeconds: game.playtimeSeconds,
            lastPlayedTimestamp: game.lastPlayedTimestamp,
            metadata: { launchExecutable: selectedExecutableName }
          }))
        : []
    )

    const methods: LibraryDetectionMethod[] = []
    if (account && onlineResults[0]?.status === 'fulfilled') methods.push('psn-purchased-library')
    if (account && onlineResults[1]?.status === 'fulfilled' && !methods.includes('psn-purchased-library')) {
      methods.push('psn-purchased-library')
    }
    if (account && onlineResults[2]?.status === 'fulfilled') methods.push('psn-play-history')
    if (remotePlay.selectedApp) methods.push('remote-play-apps')
    const allOnlineSucceeded =
      account && onlineResults.length === 3 && onlineResults.every((result) => result.status === 'fulfilled')
    const someOnlineSucceeded = onlineResults.some((result) => result.status === 'fulfilled')
    const counts = gameRepository.getProviderCounts('playstation')
    this.setProviderStatus({
      state: !account
        ? remotePlay.selectedApp
          ? 'local-only'
          : 'idle'
        : !authenticated || (!someOnlineSucceeded && counts.gameCount === 0)
          ? 'error'
          : allOnlineSucceeded && remotePlay.selectedApp
            ? 'ready'
            : 'partial',
      connection: account ? 'connected' : 'not-connected',
      methods,
      issue: !account
        ? 'not-connected'
        : !authenticated
          ? 'authentication-failed'
          : !someOnlineSucceeded
            ? 'source-unavailable'
            : !remotePlay.selectedApp
              ? 'remote-play-app-unavailable'
              : !allOnlineSucceeded
                ? 'source-unavailable'
                : counts.gameCount === 0
                  ? 'no-games-found'
                  : undefined,
      lastCheckedAt: Date.now()
    })
    this.emitSnapshot()
    return this.getSnapshot()
  }

  private setProviderStatus(
    next: Omit<
      LibraryProviderStatus,
      'provider' | 'gameCount' | 'installedCount' | 'installableCount'
    >
  ): void {
    this.providerStatus = {
      provider: 'playstation',
      ...gameRepository.getProviderCounts('playstation'),
      ...next,
      methods: [...next.methods]
    }
    this.emitSnapshot()
  }

  private emitSnapshot(): void {
    this.emit('updated', this.getSnapshot())
  }
}

export const playStationLibraryService = new PlayStationLibraryService()
