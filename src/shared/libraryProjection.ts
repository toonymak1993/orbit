const LEGACY_APP_NAME = /^App\s+\d+$/i

export interface VisibleLibraryRecord {
  id: string
  name: string
  owned: boolean
  installed: boolean
}

export function isUsableLibraryName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.trim().length > 0 &&
    !LEGACY_APP_NAME.test(name.trim())
  )
}

/**
 * Builds the public library without guessing equivalence from display text.
 * Only the durable provider record ID may collapse two records.
 */
export function projectVisibleLibraryRecords<T extends VisibleLibraryRecord>(
  records: Iterable<T>
): T[] {
  const byId = new Map<string, T>()
  for (const record of records) {
    if (!isUsableLibraryName(record.name) || (!record.owned && !record.installed)) continue
    byId.set(record.id, record)
  }
  return [...byId.values()]
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
