import type {
  LibraryProviderIssue,
  LibraryProviderState,
  LibraryProviderStatus
} from './ipc'

export interface SteamSyncHealthInput {
  primaryLibraryAvailable: boolean
  fallbackLibraryAvailable: boolean
  cachedGameCount: number
  pendingMetadataCount: number
  ownedResponseWasEmpty: boolean
  supplementalSourcesComplete: boolean
  localLibraryComplete: boolean
}

export interface SteamSyncHealthDecision {
  state: Extract<LibraryProviderState, 'ready' | 'partial' | 'error'>
  issue?: Exclude<LibraryProviderIssue, 'not-connected'>
}

/**
 * Steam's account response is not guaranteed to cover borrowed/session-only
 * games. A sync is only complete when the additive sources and every local
 * library folder were readable too.
 */
export function decideSteamSyncHealth(input: SteamSyncHealthInput): SteamSyncHealthDecision {
  if (input.pendingMetadataCount > 0) {
    return { state: 'partial', issue: 'metadata-pending' }
  }
  if (input.primaryLibraryAvailable) {
    return input.supplementalSourcesComplete && input.localLibraryComplete
      ? { state: 'ready' }
      : { state: 'partial', issue: 'source-unavailable' }
  }

  const hasUsableLibrary = input.fallbackLibraryAvailable || input.cachedGameCount > 0
  if (input.ownedResponseWasEmpty) {
    return { state: hasUsableLibrary ? 'partial' : 'error', issue: 'no-games-found' }
  }
  return {
    state: hasUsableLibrary ? 'partial' : 'error',
    issue: input.fallbackLibraryAvailable ? 'source-unavailable' : 'online-library-unavailable'
  }
}

/** Missing records are pruned only when every current ownership source was readable. */
export function canPruneSteamOwnedRecords(
  primaryLibraryAvailable: boolean,
  clientSourceAvailable: boolean,
  dynamicSourceAvailable: boolean
): boolean {
  return primaryLibraryAvailable && clientSourceAvailable && dynamicSourceAvailable
}

/**
 * A retained online library stays usable during a transient account outage.
 * Missing additive sources are different: they can hide borrowed games and
 * remain actionable in the library until coverage is complete again.
 */
export function shouldShowSteamSyncNotice(status?: LibraryProviderStatus): boolean {
  if (!status || (status.state !== 'partial' && status.state !== 'error')) return false
  if (status.issue === 'metadata-pending') return false
  const retainedOnlineLibrary =
    status.methods.includes('cached-data') && status.installableCount > 0
  return status.issue === 'source-unavailable' || !retainedOnlineLibrary
}
