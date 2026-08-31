import type { GameProvider } from './ipc'

export type AutomaticLibraryProvider = Exclude<GameProvider, 'local' | 'retro'>

export type AuxiliaryLibraryContentKind =
  | 'demo'
  | 'dlc'
  | 'soundtrack'
  | 'test-build'
  | 'server'
  | 'digital-extra'
  | 'utility'

const AUTOMATIC_LIBRARY_PROVIDERS = new Set<GameProvider>([
  'steam',
  'epic',
  'gog',
  'xbox',
  'playstation',
  'ea',
  'ubisoft'
])

const AUXILIARY_TITLE_PATTERNS: ReadonlyArray<{
  kind: AuxiliaryLibraryContentKind
  pattern: RegExp
}> = [
  { kind: 'demo', pattern: /\b(?:demo|playtest|testversion)\b|\btrial\s*$/iu },
  {
    kind: 'dlc',
    pattern: /\b(?:dlc|downloadable\s+content|add[\s-]?on|season\s+pass|saisonpass|zusatzinhalt|bonus(?:\s+content|inhalt))\b/iu
  },
  {
    kind: 'soundtrack',
    pattern: /\b(?:(?:original|official|digital)\s+)?soundtrack\b/iu
  },
  {
    kind: 'server',
    pattern: /\b(?:dedicated|public\s+test|experimental|test)[\s-]*server\b/iu
  },
  {
    kind: 'test-build',
    pattern: /\b(?:staging|test|experimental)\s+branch\b/iu
  },
  {
    kind: 'test-build',
    pattern: /\b(?:open|closed|public|technical|offene|geschlossene)\s+(?:alpha|beta)\b/iu
  },
  {
    kind: 'test-build',
    pattern: /(?:^|[:([\-\u2013\u2014]\s*)(?:alpha|beta)(?:\s+(?:test|branch|client))?\s*[)\]]?$/iu
  },
  {
    kind: 'digital-extra',
    pattern: /\b(?:(?:digital\s+)?art[\s-]?book|digital\s+wallpapers?|(?:wallpapers?|press\s+kit)\s*$)/iu
  },
  {
    kind: 'digital-extra',
    pattern: /\b(?:costume|skin|weapon|item|language|texture|currency|credits?|points)\s+pack\b/iu
  },
  { kind: 'utility', pattern: /\bbenchmark\b/iu },
  {
    kind: 'utility',
    pattern: /\b(?:ps4|ps5|next[\s-]?gen|60\s*fps)\s+(?:upgrade|update)\b/iu
  }
]

const UNKNOWN_STEAM_APP_TYPES = new Set(['', 'missing', 'unknown'])

export function isAutomaticLibraryProvider(
  provider: GameProvider | string
): provider is AutomaticLibraryProvider {
  return AUTOMATIC_LIBRARY_PROVIDERS.has(provider as GameProvider)
}

/**
 * A deliberately conservative title fallback for providers that do not expose
 * a reliable content kind. Generic words such as "pack", "episode", "test"
 * or "update" are not enough on their own, so real games such as Test Drive
 * remain visible.
 */
export function auxiliaryLibraryTitleKind(
  provider: GameProvider | string,
  name: string
): AuxiliaryLibraryContentKind | undefined {
  if (!isAutomaticLibraryProvider(provider)) return undefined
  const title = name.replace(/[\u2122\u00ae\u00a9]/g, '').replace(/\s+/g, ' ').trim()
  if (!title) return undefined
  return AUXILIARY_TITLE_PATTERNS.find(({ pattern }) => pattern.test(title))?.kind
}

export function isAutomaticLibraryTitleAllowed(
  provider: GameProvider | string,
  name: string
): boolean {
  return auxiliaryLibraryTitleKind(provider, name) === undefined
}

/** Exact provider-local grouping key; editions with different names stay apart. */
export function canonicalLibraryDuplicateTitle(name: string): string {
  return name
    .replace(/[\u2122\u00ae\u00a9]/g, '')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLocaleLowerCase('en-US')
}

/**
 * Steam's Store metadata uses "missing" for delisted or temporarily
 * unavailable apps. Only a positive, non-game type is safe to purge.
 */
export function isConfirmedNonGameSteamAppType(type: unknown): boolean {
  if (typeof type !== 'string') return false
  const normalized = type.trim().toLocaleLowerCase('en-US')
  return !UNKNOWN_STEAM_APP_TYPES.has(normalized) && normalized !== 'game'
}
