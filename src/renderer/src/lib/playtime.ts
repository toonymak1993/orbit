import type { TFunction } from '@renderer/i18n/useT'
import type { LibraryGame } from '@shared/ipc'

export function formatPlaytime(
  game: Pick<LibraryGame, 'playtimeSeconds' | 'playtimeMinutes'>,
  t: TFunction
): string | null {
  const totalSeconds = Math.max(
    0,
    Math.round(game.playtimeSeconds ?? (game.playtimeMinutes ?? 0) * 60)
  )
  if (totalSeconds <= 0) return null

  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) {
    return minutes > 0
      ? t('playtime.hoursMinutes', { hours, minutes })
      : t('playtime.hours', { hours })
  }
  if (minutes > 0) {
    return seconds > 0
      ? t('playtime.minutesSeconds', { minutes, seconds })
      : t('playtime.minutes', { minutes })
  }
  return t('playtime.seconds', { seconds })
}
