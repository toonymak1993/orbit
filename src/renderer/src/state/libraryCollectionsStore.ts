import { create } from 'zustand'
import type { GameCollection, OrbitSettings } from '@shared/ipc'

const MAX_COLLECTION_NAME_LENGTH = 40

interface LibraryCollectionsState {
  favoriteGameIds: string[]
  collections: GameCollection[]
  hydrated: boolean
  hydrate: () => Promise<void>
  toggleFavorite: (gameId: string) => Promise<boolean>
  createCollection: (name: string, initialGameId?: string) => Promise<GameCollection | null>
  deleteCollection: (collectionId: string) => Promise<void>
  toggleGameInCollection: (collectionId: string, gameId: string) => Promise<boolean>
}

let mutationQueue: Promise<void> = Promise.resolve()

function normalizedGameIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((gameId): gameId is string => typeof gameId === 'string' && Boolean(gameId.trim())))]
}

function normalizedCollections(value: unknown): GameCollection[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: GameCollection[] = []
  for (const candidate of value) {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) continue
    const collection = candidate as Partial<GameCollection>
    const name = typeof collection.name === 'string' ? collection.name.trim() : ''
    if (
      typeof collection.id !== 'string' ||
      !collection.id ||
      seen.has(collection.id) ||
      !name ||
      name.length > MAX_COLLECTION_NAME_LENGTH
    ) {
      continue
    }
    seen.add(collection.id)
    result.push({
      id: collection.id,
      name,
      gameIds: normalizedGameIds(collection.gameIds),
      createdAt:
        typeof collection.createdAt === 'number' && Number.isFinite(collection.createdAt)
          ? collection.createdAt
          : Date.now()
    })
  }
  return result
}

function enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutationQueue.then(operation, operation)
  mutationQueue = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

function settingsPayload(state: LibraryCollectionsState): Pick<OrbitSettings, 'favoriteGameIds' | 'customLibraries'> {
  return {
    favoriteGameIds: state.favoriteGameIds,
    customLibraries: state.collections
  }
}

export const useLibraryCollectionsStore = create<LibraryCollectionsState>((set, get) => ({
  favoriteGameIds: [],
  collections: [],
  hydrated: false,

  hydrate: async () => {
    const settings = await window.api.settings.get()
    set({
      favoriteGameIds: normalizedGameIds(settings.favoriteGameIds),
      collections: normalizedCollections(settings.customLibraries),
      hydrated: true
    })
  },

  toggleFavorite: (gameId) =>
    enqueueMutation(async () => {
      const previous = get()
      const favorite = !previous.favoriteGameIds.includes(gameId)
      const favoriteGameIds = favorite
        ? [...previous.favoriteGameIds, gameId]
        : previous.favoriteGameIds.filter((candidate) => candidate !== gameId)
      set({ favoriteGameIds })
      try {
        await window.api.settings.set(settingsPayload(get()))
        return favorite
      } catch (error) {
        set({ favoriteGameIds: previous.favoriteGameIds })
        throw error
      }
    }),

  createCollection: (rawName, initialGameId) =>
    enqueueMutation(async () => {
      const name = rawName.trim()
      if (!name || name.length > MAX_COLLECTION_NAME_LENGTH) return null
      const previous = get()
      if (previous.collections.some((collection) => collection.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
        return null
      }
      const collection: GameCollection = {
        id: crypto.randomUUID(),
        name,
        gameIds: initialGameId ? [initialGameId] : [],
        createdAt: Date.now()
      }
      set({ collections: [...previous.collections, collection] })
      try {
        await window.api.settings.set(settingsPayload(get()))
        return collection
      } catch (error) {
        set({ collections: previous.collections })
        throw error
      }
    }),

  deleteCollection: (collectionId) =>
    enqueueMutation(async () => {
      const previous = get()
      const collections = previous.collections.filter((collection) => collection.id !== collectionId)
      if (collections.length === previous.collections.length) return
      set({ collections })
      try {
        await window.api.settings.set(settingsPayload(get()))
      } catch (error) {
        set({ collections: previous.collections })
        throw error
      }
    }),

  toggleGameInCollection: (collectionId, gameId) =>
    enqueueMutation(async () => {
      const previous = get()
      const target = previous.collections.find((collection) => collection.id === collectionId)
      if (!target) return false
      const included = !target.gameIds.includes(gameId)
      const collections = previous.collections.map((collection) =>
        collection.id === collectionId
          ? {
              ...collection,
              gameIds: included
                ? [...collection.gameIds, gameId]
                : collection.gameIds.filter((candidate) => candidate !== gameId)
            }
          : collection
      )
      set({ collections })
      try {
        await window.api.settings.set(settingsPayload(get()))
        return included
      } catch (error) {
        set({ collections: previous.collections })
        throw error
      }
    })
}))
