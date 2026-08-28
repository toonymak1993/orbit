import assert from 'node:assert/strict'
import {
  epicEntitlementFallbackName,
  projectVisibleLibraryRecords,
  shouldPruneProviderRecord,
  shouldRemoveEpicEntitlement
} from '../src/shared/libraryProjection.ts'
import { decideSteamSyncHealth } from '../src/shared/steamSyncPolicy.ts'
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
  'display titles must never collapse durable provider records'
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
