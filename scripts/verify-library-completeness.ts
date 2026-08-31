import assert from 'node:assert/strict'
import {
  epicEntitlementFallbackName,
  projectVisibleLibraryRecords,
  shouldPruneProviderRecord,
  shouldRemoveEpicEntitlement
} from '../src/shared/libraryProjection.ts'
import { decideSteamSyncHealth } from '../src/shared/steamSyncPolicy.ts'
import { projectLibraryVisibility } from '../src/shared/libraryVisibility.ts'
import {
  auxiliaryLibraryTitleKind,
  isAutomaticLibraryTitleAllowed,
  isConfirmedNonGameSteamAppType
} from '../src/shared/libraryContentPolicy.ts'
import { scanXboxAppLibrary } from '../src/main/xbox/xboxAppLibrary.ts'
import { parseXboxCatalogProducts } from '../src/main/xbox/xboxCatalogParser.ts'

const sameTitleCopies = projectVisibleLibraryRecords([
  { id: 'steam:10', name: 'Same Game', provider: 'steam', owned: true, installed: false },
  { id: 'epic:same', name: 'Same Game', provider: 'epic', owned: true, installed: false },
  { id: 'xbox:EDITION00001', name: 'Same Game', provider: 'xbox', owned: true, installed: false }
])
assert.deepEqual(
  sameTitleCopies.map((game) => game.id),
  ['steam:10', 'epic:same', 'xbox:EDITION00001'],
  'same titles from different providers must remain separate licenses'
)

const playStationCrossGen = projectVisibleLibraryRecords([
  {
    id: 'playstation:CUSA00001_00',
    provider: 'playstation',
    name: 'Same Cross-Gen Game',
    owned: true,
    installed: false,
    metadata: { features: ['PS4'] }
  },
  {
    id: 'playstation:PPSA00001_00',
    provider: 'playstation',
    name: 'Same Cross-Gen Game',
    owned: true,
    installed: false,
    metadata: { features: ['PS5'] }
  }
])
assert.deepEqual(
  playStationCrossGen.map((game) => game.id),
  ['playstation:PPSA00001_00'],
  'provider-local cross-gen duplicates must prefer the PS5 representative'
)

assert.equal(
  projectVisibleLibraryRecords([
    {
      id: 'playstation:CUSA00002_00',
      provider: 'playstation',
      name: 'Localized PS4 Name',
      owned: true,
      installed: false,
      metadata: { features: ['PS4'], storeUrl: 'https://store.playstation.com/concept/12345' }
    },
    {
      id: 'playstation:PPSA00002_00',
      provider: 'playstation',
      name: 'Localized PS5 Name',
      owned: true,
      installed: false,
      metadata: { features: ['PS5'], storeUrl: 'https://store.playstation.com/concept/12345' }
    }
  ]).length,
  1,
  'PlayStation concept IDs must collapse differently labelled platform variants'
)

const installedSteamRepresentative = projectVisibleLibraryRecords([
  {
    id: 'steam:10',
    provider: 'steam',
    name: 'Split Launcher Game',
    owned: true,
    installed: false
  },
  {
    id: 'steam:20',
    provider: 'steam',
    name: 'Split Launcher Game',
    owned: true,
    installed: true
  }
])
assert.deepEqual(
  installedSteamRepresentative.map((game) => game.id),
  ['steam:20'],
  'an installed provider-local duplicate must remain the launchable representative'
)

assert.equal(auxiliaryLibraryTitleKind('steam', 'Example Game Demo'), 'demo')
assert.equal(auxiliaryLibraryTitleKind('playstation', 'Example Game - PS5 Upgrade'), 'utility')
assert.equal(auxiliaryLibraryTitleKind('xbox', 'Example Game Dedicated Server'), 'server')
assert.equal(auxiliaryLibraryTitleKind('epic', 'Example Game Digital Soundtrack'), 'soundtrack')
assert.equal(isAutomaticLibraryTitleAllowed('xbox', 'Test Drive Unlimited - Solar Crown'), true)
assert.equal(isAutomaticLibraryTitleAllowed('steam', 'The Trial of the Century'), true)
assert.equal(isAutomaticLibraryTitleAllowed('steam', 'Wallpaper Engine'), true)
assert.equal(isAutomaticLibraryTitleAllowed('local', 'My Demo Build'), true)
assert.equal(isConfirmedNonGameSteamAppType('dlc'), true)
assert.equal(isConfirmedNonGameSteamAppType('demo'), true)
assert.equal(isConfirmedNonGameSteamAppType('game'), false)
assert.equal(isConfirmedNonGameSteamAppType('missing'), false)

assert.equal(
  projectVisibleLibraryRecords([
    { id: 'local:one', provider: 'local', name: 'My Game', owned: true, installed: true },
    { id: 'local:two', provider: 'local', name: 'My Game', owned: true, installed: true }
  ]).length,
  2,
  'user-managed local records must never be collapsed automatically'
)

const visibility = projectLibraryVisibility(sameTitleCopies, ['epic:same'])
assert.deepEqual(
  visibility.visibleGames.map((game) => game.id),
  ['steam:10', 'xbox:EDITION00001'],
  'exclusions must match only the exact durable provider identity'
)
assert.deepEqual(
  visibility.excludedGames.map((game) => game.id),
  ['epic:same'],
  'excluded records must remain available for restoration'
)

const seen = new Set(['xbox:CURRENT00001'])
assert.equal(
  shouldPruneProviderRecord(
    { id: 'xbox:OLDPASS00001', provider: 'xbox', ownershipSource: 'game-pass-cache' },
    'xbox',
    seen,
    'game-pass-cache'
  ),
  true
)
assert.equal(
  shouldPruneProviderRecord(
    { id: 'xbox:PURCHASE0001', provider: 'xbox' },
    'xbox',
    seen,
    'game-pass-cache'
  ),
  false,
  'a subscription refresh must not prune purchases or legacy ownership'
)

assert.equal(epicEntitlementFallbackName('  TechnicalArtifact  '), 'TechnicalArtifact')
assert.equal(shouldRemoveEpicEntitlement('skip'), true)
assert.equal(shouldRemoveEpicEntitlement('missing'), false)
assert.equal(shouldRemoveEpicEntitlement('game'), false)

assert.deepEqual(
  decideSteamSyncHealth({
    primaryLibraryAvailable: true,
    fallbackLibraryAvailable: true,
    cachedGameCount: 250,
    pendingMetadataCount: 0,
    ownedResponseWasEmpty: false,
    supplementalSourcesComplete: true,
    localLibraryComplete: false
  }),
  { state: 'partial', issue: 'source-unavailable' },
  'an unreadable secondary Steam library must not be reported as complete'
)

const xboxCache = await scanXboxAppLibrary()
if (xboxCache.available && xboxCache.activeSubscription) {
  assert.equal(xboxCache.games.size, xboxCache.resolvedProductCount)
  assert.ok(xboxCache.resolvedProductCount <= xboxCache.eligibleProductCount)
  if (xboxCache.unresolvedProductCount > 0) assert.equal(xboxCache.complete, false)
  assert.equal(
    new Set([...xboxCache.games.values()].map((game) => game.providerGameId)).size,
    xboxCache.games.size,
    'Xbox records may only deduplicate exact Store product IDs'
  )
}

const catalogFallback = parseXboxCatalogProducts(
  {
    Products: [{
      ProductId: 'CATALOG00001',
      ProductFamily: 'Games',
      LocalizedProperties: [{
        ProductTitle: 'Catalog fallback game',
        ShortDescription: 'Resolved without the Xbox app summary.',
        Images: [{
          Uri: '//store-images.example.test/poster.jpg',
          ImagePurpose: 'Poster',
          Width: 1000,
          Height: 1500
        }]
      }],
      Properties: { Category: 'Action' },
      MarketProperties: []
    }]
  },
  new Set(['CATALOG00001'])
)
assert.equal(catalogFallback.get('CATALOG00001')?.name, 'Catalog fallback game')
assert.deepEqual(catalogFallback.get('CATALOG00001')?.metadata.genres, ['Action'])
assert.equal(
  catalogFallback.get('CATALOG00001')?.metadata.artwork?.vertical?.[0],
  'https://store-images.example.test/poster.jpg'
)

console.log('Library completeness checks passed')
