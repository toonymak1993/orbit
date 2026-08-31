import type { LibraryGame } from './ipc'

function normalizeTitle(value: string): string {
  return value
    .replace(/[™®©]/g, '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLocaleLowerCase('en-US')
}

const ROMAN_TITLE_NUMERALS: Record<string, string> = {
  ii: '2',
  iii: '3',
  iv: '4',
  v: '5',
  vi: '6',
  vii: '7',
  viii: '8',
  ix: '9',
  x: '10'
}

/**
 * Canonical exact-match key for artwork shared across providers. Punctuation,
 * trademarks and apostrophe variants are ignored, while standalone series
 * numerals such as "II" and "2" resolve to the same conservative key.
 */
export function canonicalArtworkTitle(value: string): string {
  return normalizeTitle(value)
    .split(' ')
    .map((token) => ROMAN_TITLE_NUMERALS[token] ?? token)
    .join(' ')
}

function releaseYear(value: string | undefined): string | undefined {
  return value?.match(/\b(?:19|20)\d{2}\b/)?.[0]
}

function normalizedDevelopers(game: Pick<LibraryGame, 'metadata'>): Set<string> {
  return new Set(
    (game.metadata.developers ?? [])
      .map(canonicalArtworkTitle)
      .filter(Boolean)
  )
}

export function artworkIdentitySignature(game: Pick<LibraryGame, 'metadata'>): string {
  return JSON.stringify({
    releaseYear: releaseYear(game.metadata.releaseDateText) ?? '',
    developers: [...normalizedDevelopers(game)].sort()
  })
}

/**
 * Requires evidence beyond an equal display title before artwork is reused
 * across library records. This prevents homonymous originals and reboots from
 * borrowing each other's covers while still allowing strongly identified ports.
 */
export function shareArtworkIdentity(
  left: Pick<LibraryGame, 'name' | 'metadata'>,
  right: Pick<LibraryGame, 'name' | 'metadata'>
): boolean {
  if (canonicalArtworkTitle(left.name) !== canonicalArtworkTitle(right.name)) return false

  const leftYear = releaseYear(left.metadata.releaseDateText)
  const rightYear = releaseYear(right.metadata.releaseDateText)
  if (!leftYear || leftYear !== rightYear) return false

  const leftDevelopers = normalizedDevelopers(left)
  const rightDevelopers = normalizedDevelopers(right)
  return leftDevelopers.size > 0 && [...leftDevelopers].some((name) => rightDevelopers.has(name))
}

export type AutomaticArtworkOrientation = 'vertical' | 'horizontal' | 'icon'
export type LibretroArtworkFolder = 'Named_Boxarts' | 'Named_Snaps' | 'Named_Titles'

/**
 * Libretro folders describe semantic asset roles, not interchangeable images.
 * A title screen or gameplay snap must never become a portrait library cover.
 */
export function libretroArtworkFolders(
  orientation: AutomaticArtworkOrientation
): LibretroArtworkFolder[] {
  if (orientation === 'vertical') return ['Named_Boxarts']
  if (orientation === 'horizontal') return ['Named_Snaps', 'Named_Titles', 'Named_Boxarts']
  return []
}

export function libretroArtworkFolderPriority(
  orientation: AutomaticArtworkOrientation,
  folder: LibretroArtworkFolder
): number {
  const priority = libretroArtworkFolders(orientation).indexOf(folder)
  return priority >= 0 ? priority : Number.POSITIVE_INFINITY
}

const TARGET_RATIOS: Record<AutomaticArtworkOrientation, number> = {
  vertical: 2 / 3,
  horizontal: 16 / 9,
  icon: 1
}

const TARGET_DIMENSIONS: Record<AutomaticArtworkOrientation, { width: number; height: number }> = {
  vertical: { width: 600, height: 900 },
  // Steam's canonical library hero key art is 1920x620. After a 16:9 fill crop
  // it retains roughly 1100 useful horizontal pixels, which is ample beneath
  // ORBIT's Home treatment and must outrank larger gameplay screenshots.
  horizontal: { width: 1000, height: 500 },
  icon: { width: 128, height: 128 }
}

const MIN_HIGH_QUALITY_ASPECT_SUITABILITY: Record<AutomaticArtworkOrientation, number> = {
  // Square icons and landscape headers remain usable provisional fallbacks,
  // but they must not stop the search for an actual 2:3 cover.
  vertical: 0.75,
  horizontal: 0.55,
  icon: 0.65
}

function aspectSuitability(
  width: number,
  height: number,
  orientation: AutomaticArtworkOrientation
): number {
  const ratio = width / height
  const targetRatio = TARGET_RATIOS[orientation]
  return Math.min(ratio / targetRatio, targetRatio / ratio)
}

/**
 * Measures the pixels that remain after an image fills the requested slot.
 * A source is only final-quality when the visible crop still reaches ORBIT's
 * target resolution and the aspect mismatch is not extreme.
 */
export function automaticArtworkQuality(
  width: number,
  height: number,
  orientation: AutomaticArtworkOrientation
): 'high' | 'low' {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 'low'
  }
  const targetRatio = TARGET_RATIOS[orientation]
  const sourceRatio = width / height
  const visibleWidth = sourceRatio >= targetRatio ? height * targetRatio : width
  const visibleHeight = sourceRatio >= targetRatio ? height : width / targetRatio
  const target = TARGET_DIMENSIONS[orientation]
  return visibleWidth >= target.width &&
    visibleHeight >= target.height &&
    aspectSuitability(width, height, orientation) >=
      MIN_HIGH_QUALITY_ASPECT_SUITABILITY[orientation]
    ? 'high'
    : 'low'
}

/**
 * Ranks low-resolution or cross-orientation fallbacks by how naturally they
 * can fill the requested slot. Aspect suitability deliberately outweighs raw
 * pixel count: a square 512px cover makes a much better poster than a 4K
 * widescreen screenshot, even though the screenshot contains more pixels.
 */
export function automaticArtworkScore(
  width: number,
  height: number,
  orientation: AutomaticArtworkOrientation
): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return Number.NEGATIVE_INFINITY
  }
  const target = TARGET_DIMENSIONS[orientation]
  const resolutionSuitability = Math.min(
    1,
    Math.sqrt((width * height) / (target.width * target.height))
  )
  return aspectSuitability(width, height, orientation) * 1_000 + resolutionSuitability * 100
}

function withoutExtension(value: string): string {
  return value.replace(/\.[a-z0-9]{1,8}$/i, '')
}

function moveTrailingArticle(value: string): string {
  const trimmed = value.trim()
  const segmentMatch = /^(.+),\s*(the|a|an)(?=\s*(?:-|:)|$)(.*)$/i.exec(trimmed)
  return segmentMatch
    ? `${segmentMatch[2]} ${segmentMatch[1]}${segmentMatch[3]}`
    : trimmed
}

const RELEASE_LANGUAGE_CODES = new Set([
  'ar',
  'cs',
  'da',
  'de',
  'en',
  'es',
  'fi',
  'fr',
  'he',
  'hu',
  'it',
  'ja',
  'jp',
  'ko',
  'nl',
  'no',
  'pl',
  'pt',
  'ru',
  'sv',
  'tr',
  'zh'
])

type ArtworkRegion = 'usa' | 'europe' | 'world' | 'japan'

const REGION_ALIASES: Readonly<Record<string, ArtworkRegion>> = {
  usa: 'usa',
  u: 'usa',
  canada: 'usa',
  europe: 'europe',
  e: 'europe',
  germany: 'europe',
  france: 'europe',
  italy: 'europe',
  spain: 'europe',
  netherlands: 'europe',
  sweden: 'europe',
  australia: 'europe',
  pal: 'europe',
  japan: 'japan',
  j: 'japan',
  world: 'world'
}

function artworkRegions(value: string | undefined): Set<ArtworkRegion> {
  const regions = new Set<ArtworkRegion>()
  for (const match of value?.matchAll(/\(([^()]*)\)/gu) ?? []) {
    const normalized = match[1].trim().toLocaleLowerCase('en-US')
    const compactRegions = /^[jue]{2,3}$/u.test(normalized)
      ? [...new Set(normalized.split(''))]
      : []
    if (compactRegions.length > 0) {
      for (const code of compactRegions) {
        const region = REGION_ALIASES[code]
        if (region) regions.add(region)
      }
      if (normalized === 'jue') regions.add('world')
      continue
    }
    for (const token of normalized.split(/\s*(?:,|\/|\+|-)\s*/u)) {
      const region = REGION_ALIASES[token]
      if (region) regions.add(region)
    }
  }
  return regions
}

function isRegionMetadataTag(value: string): boolean {
  const normalized = value.trim().toLocaleLowerCase('en-US')
  if (/^[jue]{2,3}$/u.test(normalized)) return true
  const tokens = normalized.split(/\s*(?:,|\/|\+|-)\s*/u)
  return (
    tokens.length > 0 &&
    tokens.every((token) => Boolean(REGION_ALIASES[token]) || token === 'ntsc')
  )
}

function isReleaseMetadataTag(value: string): boolean {
  const normalized = value.trim().toLocaleLowerCase('en-US')
  if (isRegionMetadataTag(normalized)) return true
  if (
    /^(?:rev(?:ision)?(?:\s+|[-_.])(?:[a-z]|\d[\w.-]*)|v(?:ersion)?\s*[-_.]?\s*\d[\w.-]*)$/iu.test(
      normalized
    )
  ) {
    return true
  }
  if (/^m\d+$/iu.test(normalized)) return true
  if (/^(?:disc|disk|side)\s*[a-z0-9]+(?:\s+of\s+\d+)?$/iu.test(normalized)) return true
  const languageCodes = normalized.split(/\s*,\s*/u)
  return (
    languageCodes.length > 0 &&
    languageCodes.every((code) => RELEASE_LANGUAGE_CODES.has(code))
  )
}

function stripReleaseMetadata(value: string): string {
  return value
    .replace(/\s*\(([^()]*)\)/gu, (group, tag: string) =>
      isReleaseMetadataTag(tag) ? ' ' : group
    )
    .replace(/\s*\[((?:!|[abho][0-9]*))\]/giu, ' ')
}

function normalizedThumbnailTitle(value: string, stripTags: boolean): string {
  const prepared = stripTags ? stripReleaseMetadata(value) : value
  return normalizeTitle(moveTrailingArticle(prepared))
}

function hasIdentityQualifier(value: string): boolean {
  const stripped = stripReleaseMetadata(value)
  return ['(', ')', '[', ']'].some((delimiter) => stripped.includes(delimiter))
}

function preferredRegionBonus(
  fileName: string,
  rawRomName: string | undefined,
  language: 'de' | 'en'
): number {
  const candidateRegions = artworkRegions(fileName)
  const rawRegions = artworkRegions(rawRomName)
  const matchesRom = [...candidateRegions].some((region) => rawRegions.has(region))
  let score = matchesRom ? 60 : 0
  if (language === 'de' && candidateRegions.has('europe')) score += 35
  else if (candidateRegions.has('usa')) score += 30
  else if (candidateRegions.has('world')) score += 25
  else if (candidateRegions.has('japan')) score += 5
  else score += 10
  return score
}

/** Exact/short-name matching modeled after RetroArch's own thumbnail rules. */
export function matchLibretroThumbnail(
  files: readonly string[],
  gameName: string,
  rawRomName: string | undefined,
  language: 'de' | 'en'
): string | undefined {
  // A raw qualifier that is not release metadata (hack, beta, prototype,
  // expansion, etc.) is identity evidence. Do not let a cleaned display title
  // silently route that ROM back to the retail game's artwork.
  const sourceNames = [
    rawRomName,
    ...(rawRomName && hasIdentityQualifier(rawRomName) ? [] : [gameName])
  ].filter((value): value is string => Boolean(value))
  const fullNames = new Set(sourceNames.map((value) => normalizedThumbnailTitle(value, false)))
  const shortNames = new Set(sourceNames.map((value) => normalizedThumbnailTitle(value, true)))
  let best: { fileName: string; score: number } | undefined
  for (const fileName of files) {
    const title = withoutExtension(fileName)
    const full = normalizedThumbnailTitle(title, false)
    const short = normalizedThumbnailTitle(title, true)
    const exact = fullNames.has(full)
    const shortExact = shortNames.has(short)
    if (!exact && !shortExact) continue
    const score =
      (exact ? 1_000 : 800) +
      preferredRegionBonus(fileName, rawRomName, language) -
      Math.min(10, Math.floor(Math.max(0, full.length - short.length) / 10))
    if (!best || score > best.score) best = { fileName, score }
  }
  return best?.fileName
}
