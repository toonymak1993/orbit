export interface AppUpdateAssetCandidate {
  id: number
  name: string
  size: number
  digest: string
  downloadUrl: string
}

export interface AppUpdateReleaseCandidate {
  version: string
  name: string
  notes: string
  pageUrl: string
  publishedAt?: string
  asset: AppUpdateAssetCandidate
}

export interface GitHubReleasePayload {
  tag_name?: unknown
  name?: unknown
  body?: unknown
  html_url?: unknown
  published_at?: unknown
  draft?: unknown
  prerelease?: unknown
  assets?: unknown
}

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/
const SHA256_PATTERN = /^sha256:([a-fA-F0-9]{64})$/
const MAX_RELEASE_NOTES_LENGTH = 6_000
const MAX_RELEASE_NAME_LENGTH = 160
const MAX_UPDATE_SIZE = 1_073_741_824
const MIN_UPDATE_SIZE = 1_048_576

interface ParsedVersion {
  major: number
  minor: number
  patch: number
  prerelease: string[]
}

function parsedVersion(value: string): ParsedVersion | null {
  const match = VERSION_PATTERN.exec(value.trim())
  if (!match) return null
  const core = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (core.some((part) => !Number.isSafeInteger(part))) return null
  const prerelease = match[4] ? match[4].split('.') : []
  if (
    prerelease.some(
      (part) =>
        part.length === 0 ||
        !/^[0-9A-Za-z-]+$/.test(part) ||
        (/^\d+$/.test(part) && part.length > 1 && part.startsWith('0'))
    )
  ) {
    return null
  }
  return {
    major: core[0],
    minor: core[1],
    patch: core[2],
    prerelease
  }
}

function compareIdentifier(left: string, right: string): number {
  const leftNumeric = /^\d+$/.test(left)
  const rightNumeric = /^\d+$/.test(right)
  if (leftNumeric && rightNumeric) {
    if (left.length !== right.length) return left.length - right.length
    return left === right ? 0 : left < right ? -1 : 1
  }
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
  return left.localeCompare(right)
}

/** SemVer ordering without accepting loose or partial versions from release tags. */
export function compareAppVersions(leftValue: string, rightValue: string): number | null {
  const left = parsedVersion(leftValue)
  const right = parsedVersion(rightValue)
  if (!left || !right) return null
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (left[key] !== right[key]) return left[key] - right[key]
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    if (left.prerelease.length === right.prerelease.length) return 0
    return left.prerelease.length === 0 ? 1 : -1
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < length; index++) {
    const leftPart = left.prerelease[index]
    const rightPart = right.prerelease[index]
    if (leftPart === undefined || rightPart === undefined) {
      return leftPart === rightPart ? 0 : leftPart === undefined ? -1 : 1
    }
    const result = compareIdentifier(leftPart, rightPart)
    if (result !== 0) return result
  }
  return 0
}

function safeWebUrl(value: unknown, hosts: readonly string[]): string | null {
  if (typeof value !== 'string' || value.length > 2_048) return null
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'https:' || !hosts.includes(parsed.hostname.toLowerCase())) return null
    return parsed.toString()
  } catch {
    return null
  }
}

function sanitizedText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return ''
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, maxLength)
}

function expectedAssetName(version: string, channel: 'stable' | 'beta'): string {
  const prefix = channel === 'beta' ? 'ORBIT-Beta' : 'ORBIT'
  return `${prefix}-XboxMode-Setup-${version}-x64.exe`
}

export function parseGitHubAppUpdateRelease(
  value: unknown,
  channel: 'stable' | 'beta'
): AppUpdateReleaseCandidate | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const release = value as GitHubReleasePayload
  if (release.draft === true) return null
  if (channel === 'stable' && release.prerelease === true) return null
  if (channel === 'beta' && release.prerelease !== true) return null

  const tag = typeof release.tag_name === 'string' ? release.tag_name.trim() : ''
  const version = tag.startsWith('v') ? tag.slice(1) : tag
  const parsed = parsedVersion(version)
  if (!parsed) return null
  if (channel === 'stable' && parsed.prerelease.length > 0) return null
  if (channel === 'beta' && parsed.prerelease.length === 0) return null

  if (!Array.isArray(release.assets)) return null
  const assetName = expectedAssetName(version, channel)
  const assetValue = release.assets.find(
    (candidate) =>
      candidate &&
      typeof candidate === 'object' &&
      !Array.isArray(candidate) &&
      (candidate as { name?: unknown }).name === assetName
  )
  if (!assetValue || typeof assetValue !== 'object' || Array.isArray(assetValue)) return null
  const asset = assetValue as Record<string, unknown>
  const digestMatch = typeof asset.digest === 'string' ? SHA256_PATTERN.exec(asset.digest) : null
  const downloadUrl = safeWebUrl(asset.browser_download_url, ['github.com'])
  if (
    !Number.isSafeInteger(asset.id) ||
    Number(asset.id) <= 0 ||
    typeof asset.size !== 'number' ||
    !Number.isSafeInteger(asset.size) ||
    asset.size < MIN_UPDATE_SIZE ||
    asset.size > MAX_UPDATE_SIZE ||
    asset.state !== 'uploaded' ||
    !digestMatch ||
    !downloadUrl
  ) {
    return null
  }

  const pageUrl = safeWebUrl(release.html_url, ['github.com'])
  if (!pageUrl) return null
  const publishedAt =
    typeof release.published_at === 'string' && Number.isFinite(Date.parse(release.published_at))
      ? new Date(release.published_at).toISOString()
      : undefined

  return {
    version,
    name: sanitizedText(release.name, MAX_RELEASE_NAME_LENGTH) || `ORBIT ${version}`,
    notes: sanitizedText(release.body, MAX_RELEASE_NOTES_LENGTH),
    pageUrl,
    publishedAt,
    asset: {
      id: Number(asset.id),
      name: assetName,
      size: asset.size,
      digest: digestMatch[1].toLowerCase(),
      downloadUrl
    }
  }
}

export function selectLatestBetaRelease(value: unknown): AppUpdateReleaseCandidate | null {
  if (!Array.isArray(value)) return null
  const candidates = value
    .map((release) => parseGitHubAppUpdateRelease(release, 'beta'))
    .filter((release): release is AppUpdateReleaseCandidate => Boolean(release))
  return candidates.reduce<AppUpdateReleaseCandidate | null>((latest, candidate) => {
    if (!latest) return candidate
    const comparison = compareAppVersions(candidate.version, latest.version)
    return comparison !== null && comparison > 0 ? candidate : latest
  }, null)
}

/** Rejects ambiguous or mismatched range responses before a partial installer is resumed. */
export function isValidAppUpdateContentRange(
  value: string | null,
  expectedOffset: number,
  expectedTotal: number
): boolean {
  if (!value || !Number.isSafeInteger(expectedOffset) || !Number.isSafeInteger(expectedTotal)) {
    return false
  }
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value.trim())
  if (!match) return false
  const start = Number(match[1])
  const end = Number(match[2])
  const total = Number(match[3])
  return (
    Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    Number.isSafeInteger(total) &&
    start === expectedOffset &&
    end >= start &&
    end < total &&
    total === expectedTotal
  )
}
