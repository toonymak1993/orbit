import assert from 'node:assert/strict'
import type { StoreProduct } from '../src/shared/ipc.ts'
import {
  hasStoreArtwork,
  isStoreDiscoverProductVisible
} from '../src/shared/storeVisibility.ts'

const featuredPreview: StoreProduct = {
  id: 'steam:10',
  steamAppId: 10,
  name: 'Cold Cache Game',
  headerUrl: 'https://example.test/header.jpg',
  steamWishlisted: false,
  orbitWishlisted: false,
  offers: [],
  recommendationScore: 35,
  updatedAt: 1
}

assert.equal(hasStoreArtwork(featuredPreview), true)
assert.equal(
  isStoreDiscoverProductVisible(featuredPreview, new Set()),
  true,
  'featured previews must render before detail hydration'
)
assert.equal(isStoreDiscoverProductVisible(featuredPreview, new Set([10])), false)
assert.equal(
  isStoreDiscoverProductVisible({ ...featuredPreview, artworkStatus: 'missing' }, new Set()),
  false
)
assert.equal(
  isStoreDiscoverProductVisible({ ...featuredPreview, headerUrl: undefined }, new Set()),
  false
)
assert.equal(
  isStoreDiscoverProductVisible({ ...featuredPreview, searchOnly: true }, new Set()),
  false
)
assert.equal(
  isStoreDiscoverProductVisible({ ...featuredPreview, discoverEligible: false }, new Set()),
  false
)
assert.equal(
  isStoreDiscoverProductVisible({ ...featuredPreview, name: 'テスト' }, new Set()),
  false
)
assert.equal(
  isStoreDiscoverProductVisible(
    {
      ...featuredPreview,
      headerUrl: undefined,
      steamWishlisted: true
    },
    new Set()
  ),
  true,
  'wishlist entries retain their fallback card while details load'
)

console.log('Store catalog visibility verification passed.')
