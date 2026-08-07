import { HowLongToBeatService, SearchModifier } from 'howlongtobeat-ts'
import type { GameCompletionTimes, LibraryGame } from '@shared/ipc'

const POSITIVE_TTL_MS = 120 * 24 * 60 * 60 * 1000
const NEGATIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000

const hltb = new HowLongToBeatService({
  minSimilarity: 0.72,
  timeout: 15_000,
  retries: 1
})

function isFresh(value: GameCompletionTimes): boolean {
  const ttl = value.state === 'available' ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS
  return Date.now() - value.fetchedAt < ttl
}

function secondsToMinutes(seconds: number | undefined): number | undefined {
  if (!seconds || seconds <= 0) return undefined
  return Math.max(1, Math.round(seconds / 60))
}

function hasEstimate(value: GameCompletionTimes): boolean {
  return Boolean(
    value.mainStoryMinutes ||
      value.mainExtraMinutes ||
      value.completionistMinutes ||
      value.allStylesMinutes
  )
}

/**
 * On-demand completion-time enrichment. Results live inside ORBIT's unified
 * game record; this service only de-duplicates concurrent lookups and never
 * runs as a library-wide scraping job.
 */
export class CompletionTimesService {
  private inFlight = new Map<string, Promise<GameCompletionTimes | null>>()

  resolve(game: LibraryGame): Promise<GameCompletionTimes | null> {
    const cached = game.metadata.completionTimes
    if (cached && isFresh(cached)) return Promise.resolve(cached)

    const current = this.inFlight.get(game.id)
    if (current) return current

    const request = this.fetch(game)
      .catch(() => cached ?? null)
      .finally(() => this.inFlight.delete(game.id))
    this.inFlight.set(game.id, request)
    return request
  }

  private async fetch(game: LibraryGame): Promise<GameCompletionTimes | null> {
    const result = await hltb.searchOne(game.name, { modifier: SearchModifier.HIDE_DLC })
    if (!result.success) return game.metadata.completionTimes ?? null

    const fetchedAt = Date.now()
    if (!result.data) {
      return { state: 'unavailable', provider: 'howlongtobeat', fetchedAt }
    }

    const entry = result.data
    const completionTimes: GameCompletionTimes = {
      state: 'available',
      provider: 'howlongtobeat',
      mainStoryMinutes: secondsToMinutes(entry.mainTime),
      mainExtraMinutes: secondsToMinutes(entry.mainExtraTime),
      completionistMinutes: secondsToMinutes(entry.completionistTime),
      allStylesMinutes: secondsToMinutes(entry.allStylesTime),
      sourceGameId: entry.id,
      sourceTitle: entry.name,
      sourceUrl: `https://howlongtobeat.com/game/${entry.id}`,
      confidence: entry.similarity,
      fetchedAt
    }

    return hasEstimate(completionTimes)
      ? completionTimes
      : { state: 'unavailable', provider: 'howlongtobeat', fetchedAt }
  }
}

export const completionTimesService = new CompletionTimesService()
