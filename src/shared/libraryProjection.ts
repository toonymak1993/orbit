import {
  canonicalLibraryDuplicateTitle,
  isAutomaticLibraryProvider,
  isAutomaticLibraryTitleAllowed
} from './libraryContentPolicy'

const LEGACY_APP_NAME = /^App\s+\d+$/i

export interface VisibleLibraryRecord {
  id: string
  name: string
  provider?: string
  owned: boolean
  installed: boolean
  lastPlayedTimestamp?: number
  lastStartedAt?: number
  playtimeSeconds?: number
  updatedAt?: number
  metadataRevision?: number
  metadata?: {
    features?: string[]
    storeUrl?: string
  }
}

function latestActivity(record: VisibleLibraryRecord): number {
  return Math.max(record.lastStartedAt ?? 0, record.lastPlayedTimestamp ?? 0)
}

function metadataScore(record: VisibleLibraryRecord): number {
  return (record.metadataRevision ?? 0) + Object.keys(record.metadata ?? {}).length
}

function prefersPlayStation5(record: VisibleLibraryRecord): boolean {
  return (
    record.provider === 'playstation' &&
    (record.metadata?.features ?? []).some((feature) => feature.toLocaleUpperCase('en-US') === 'PS5')
  )
}

function providerDuplicateKey(record: VisibleLibraryRecord): string | undefined {
  if (!record.provider || !isAutomaticLibraryProvider(record.provider)) return undefined
  if (record.provider === 'playstation') {
    const conceptId = /\/concept\/(\d+)/i.exec(record.metadata?.storeUrl ?? '')?.[1]
    if (conceptId) return `playstation:concept:${conceptId}`
  }
  const title = canonicalLibraryDuplicateTitle(record.name)
  return title ? `${record.provider}:title:${title}` : undefined
}

function preferVisibleRecord<T extends VisibleLibraryRecord>(left: T, right: T): T {
  const comparisons = [
    Number(right.installed) - Number(left.installed),
    latestActivity(right) - latestActivity(left),
    Number(prefersPlayStation5(right)) - Number(prefersPlayStation5(left)),
    Number(right.owned) - Number(left.owned),
    (right.playtimeSeconds ?? 0) - (left.playtimeSeconds ?? 0),
    metadataScore(right) - metadataScore(left),
    (right.updatedAt ?? 0) - (left.updatedAt ?? 0)
  ]
  const decision = comparisons.find((comparison) => comparison !== 0)
  if (decision !== undefined) return decision > 0 ? right : left
  return right.id.localeCompare(left.id, 'en-US') < 0 ? right : left
}

export function isUsableLibraryName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.trim().length > 0 &&
    !LEGACY_APP_NAME.test(name.trim())
  )
}

/**
 * Builds the public game library while keeping durable records untouched in
 * storage. Provider concepts and exact-title aliases collapse only within one
 * automatic provider; cross-provider licenses and user-managed local/retro
 * records stay separate.
 */
export function projectVisibleLibraryRecords<T extends VisibleLibraryRecord>(
  records: Iterable<T>
): T[] {
  const byId = new Map<string, T>()
  for (const record of records) {
    if (
      !isUsableLibraryName(record.name) ||
      (!record.owned && !record.installed) ||
      (record.provider !== undefined &&
        !isAutomaticLibraryTitleAllowed(record.provider, record.name))
    ) {
      continue
    }
    byId.set(record.id, record)
  }

  const projected = new Map<string, T>()
  for (const record of byId.values()) {
    const key = providerDuplicateKey(record)
    if (!key) {
      projected.set(`id:${record.id}`, record)
      continue
    }
    const current = projected.get(key)
    projected.set(key, current ? preferVisibleRecord(current, record) : record)
  }
  return [...projected.values()]
}

export interface ProviderOwnedRecord {
  id: string
  provider: string
  ownershipSource?: string
}

export function shouldPruneProviderRecord(
  record: ProviderOwnedRecord,
  provider: string,
  seenIds: ReadonlySet<string>,
  ownershipSource?: string
): boolean {
  return (
    record.provider === provider &&
    !seenIds.has(record.id) &&
    (ownershipSource === undefined || record.ownershipSource === ownershipSource)
  )
}

export type EpicCatalogResolutionKind = 'game' | 'skip' | 'missing'

export function shouldRemoveEpicEntitlement(kind: EpicCatalogResolutionKind): boolean {
  return kind === 'skip'
}

export function epicEntitlementFallbackName(appName: unknown): string {
  return typeof appName === 'string' ? appName.trim() : ''
}
