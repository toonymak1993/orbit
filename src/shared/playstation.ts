import type {
  PlayStationRemotePlayAppId,
  PlayStationRemotePlayPreference
} from './ipc'

export function selectPlayStationRemotePlayApp(
  installedApps: Iterable<PlayStationRemotePlayAppId>,
  preference: PlayStationRemotePlayPreference
): PlayStationRemotePlayAppId | undefined {
  const installed = new Set(installedApps)
  if (preference !== 'auto') return installed.has(preference) ? preference : undefined
  return installed.has('chiaki')
    ? 'chiaki'
    : installed.has('ps-remote-play')
      ? 'ps-remote-play'
      : undefined
}

/** Parses the ISO-8601 duration returned by PlayStation's played-games API. */
export function playStationDurationSeconds(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(
    value.trim().toUpperCase()
  )
  if (!match) return undefined
  const seconds =
    Number(match[1] ?? 0) * 86_400 +
    Number(match[2] ?? 0) * 3_600 +
    Number(match[3] ?? 0) * 60 +
    Number(match[4] ?? 0)
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds) : undefined
}

/** Accepts either Sony's NPSSO value or the complete ssocookie JSON response. */
export function extractPlayStationNpsso(value: string): string {
  const trimmed = value.trim()
  let candidate = trimmed
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { npsso?: unknown }
      candidate = typeof parsed.npsso === 'string' ? parsed.npsso.trim() : ''
    } catch {
      candidate = ''
    }
  }
  if (!/^[a-z0-9._~-]{40,512}$/i.test(candidate)) {
    throw new Error('Invalid PlayStation session code')
  }
  return candidate
}
