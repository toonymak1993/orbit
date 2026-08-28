export interface ParsedSteamReleaseDate {
  timestamp: number
  year: number
  month: number
  day: number
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

export function parseEnglishSteamDate(value: string): ParsedSteamReleaseDate | null {
  const normalized = value.trim().replace(/\s+/g, ' ')
  const dayFirst = /^(\d{1,2})\s+([a-z]{3,9}),?\s+(\d{4})$/i.exec(normalized)
  const monthFirst = /^([a-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/i.exec(normalized)
  if (!dayFirst && !monthFirst) return null

  const monthName = (dayFirst?.[2] ?? monthFirst?.[1] ?? '').slice(0, 3).toLowerCase()
  const month = MONTHS.indexOf(monthName)
  const day = Number(dayFirst?.[1] ?? monthFirst?.[2])
  const year = Number(dayFirst?.[3] ?? monthFirst?.[3])
  if (month < 0 || day < 1 || day > 31 || !Number.isInteger(year)) return null

  const timestamp = Date.UTC(year, month, day, 12)
  const parsed = new Date(timestamp)
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month ||
    parsed.getUTCDate() !== day
  ) return null
  return { timestamp, year, month, day }
}
