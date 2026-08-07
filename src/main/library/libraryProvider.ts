import type { GameProvider, LibrarySnapshot } from '@shared/ipc'

/**
 * Contract for future store adapters. A provider contributes only its game
 * delta; the shared repository, metadata queue, artwork queue and sync
 * coordinator remain unchanged.
 */
export interface LibraryProviderAdapter<TContext> {
  readonly provider: GameProvider
  refresh(context: TContext): Promise<LibrarySnapshot>
}

