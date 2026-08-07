import type { TFunction } from '@renderer/i18n/useT'

export function formatPlaytime(minutes: number | undefined, t: TFunction): string | null {
  if (!minutes) return null
  const hours = minutes / 60
  if (hours >= 1) {
    return t('playtime.hours', { hours: hours.toFixed(hours < 10 ? 1 : 0) })
  }
  return t('playtime.minutes', { minutes })
}
