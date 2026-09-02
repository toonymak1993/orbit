import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import type { LibraryGame } from '../src/shared/ipc.ts'
import {
  parseSteamCommunityAchievements,
  parseSteamWebApiAchievements
} from '../src/main/achievements/steamAchievementParsers.ts'
import {
  normalizeRetroAchievementsApiKey,
  RetroAchievementsCredentialVault
} from '../src/main/retro/retroAchievementsCredentialVault.ts'
import {
  normalizeSteamWebApiKey,
  SteamWebApiCredentialVault
} from '../src/main/steam/steamWebApiCredentialVault.ts'

const game = {
  id: 'steam:620',
  provider: 'steam',
  providerGameId: '620',
  appId: 620,
  name: 'Portal 2',
  metadata: {},
  installed: true,
  owned: true,
  addedAt: 0,
  updatedAt: 0
} as LibraryGame

const community = parseSteamCommunityAchievements(
  game,
  `<?xml version="1.0"?><playerstats><achievements>
    <achievement closed="1"><apiname>ACH_WIN</apiname><name><![CDATA[Victory &amp; Beyond]]></name><description>Win once</description><unlockTimestamp>1700000000</unlockTimestamp><iconClosed>https://cdn.example/unlocked.jpg</iconClosed><iconOpen>https://cdn.example/locked.jpg</iconOpen></achievement>
    <achievement closed="0"><apiname>ACH_NEXT</apiname><name>Next</name><hidden>1</hidden></achievement>
  </achievements></playerstats>`
)
assert.equal(community.state, 'available')
assert.equal(community.source, 'steam-community')
assert.equal(community.total, 2)
assert.equal(community.unlocked, 1)
assert.equal(community.achievements[0]?.name, 'Victory & Beyond')
assert.equal(community.achievements[0]?.unlockedAt, 1_700_000_000_000)
assert.equal(community.achievements[1]?.hidden, true)

assert.equal(
  parseSteamCommunityAchievements(game, '<playerstats><privacyMessage>Private</privacyMessage></playerstats>').reason,
  'private'
)
assert.equal(
  parseSteamCommunityAchievements(game, '<html><body>Sign in</body></html>').reason,
  'unavailable',
  'an HTML/session response must stay retryable instead of becoming a long-lived unsupported result'
)

const webApi = parseSteamWebApiAchievements(game, {
  playerstats: {
    success: true,
    achievements: [
      {
        apiname: 'ACH_API',
        achieved: 1,
        unlocktime: 1_710_000_000,
        name: 'API Achievement',
        description: 'Fetched through Web API'
      }
    ]
  }
})
assert.equal(webApi.state, 'available')
assert.equal(webApi.source, 'steam-web-api')
assert.equal(webApi.unlocked, 1)
assert.equal(webApi.achievements[0]?.unlockedAt, 1_710_000_000_000)

assert.equal(
  parseSteamWebApiAchievements(game, {
    playerstats: { success: false, error: 'Profile is private' }
  }).reason,
  'private'
)
assert.equal(
  parseSteamWebApiAchievements(game, {
    playerstats: { success: false, error: 'Requested app has no stats' }
  }).reason,
  'unsupported'
)

const credentialMemory: {
  encryptionAvailable: boolean
  encrypted?: string
  legacy?: unknown
} = {
  encryptionAvailable: false,
  legacy: 'a'.repeat(32)
}
const credentialVault = new RetroAchievementsCredentialVault({
  encryptionAvailable: () => credentialMemory.encryptionAvailable,
  encrypt: (value) => Buffer.from(`encrypted:${value}`, 'utf8').toString('base64'),
  decrypt: (payload) => Buffer.from(payload, 'base64').toString('utf8').replace(/^encrypted:/u, ''),
  readEncrypted: () => credentialMemory.encrypted,
  writeEncrypted: (payload) => {
    credentialMemory.encrypted = payload
  },
  clearEncrypted: () => {
    delete credentialMemory.encrypted
  },
  readLegacy: () => credentialMemory.legacy,
  clearLegacy: () => {
    delete credentialMemory.legacy
  }
})

assert.equal(
  credentialVault.getApiKey(),
  undefined,
  'legacy credentials must stay hidden until OS encryption is available'
)
assert.equal(credentialMemory.legacy, 'a'.repeat(32))
credentialMemory.encryptionAvailable = true
assert.equal(credentialVault.getApiKey(), 'a'.repeat(32))
assert.equal(credentialMemory.legacy, undefined, 'successful migration must remove plaintext')
assert.notEqual(credentialMemory.encrypted, 'a'.repeat(32))
assert.equal(credentialVault.isConfigured(), true)
assert.throws(() => credentialVault.setApiKey('too-short'), /Invalid RetroAchievements/)
credentialVault.setApiKey('b'.repeat(32))
assert.equal(credentialVault.getApiKey(), 'b'.repeat(32))
credentialVault.clear()
assert.equal(credentialVault.isConfigured(), false)
assert.equal(normalizeRetroAchievementsApiKey(`  ${'c'.repeat(32)}  `), 'c'.repeat(32))

const steamCredentialMemory: {
  encryptionAvailable: boolean
  encrypted?: string
  legacy?: unknown
} = {
  encryptionAvailable: false,
  legacy: 'd'.repeat(32)
}
const steamCredentialVault = new SteamWebApiCredentialVault({
  encryptionAvailable: () => steamCredentialMemory.encryptionAvailable,
  encrypt: (value) => `encrypted:${value}`,
  decrypt: (payload) => payload.replace(/^encrypted:/u, ''),
  readEncrypted: () => steamCredentialMemory.encrypted,
  writeEncrypted: (payload) => {
    steamCredentialMemory.encrypted = payload
  },
  clearEncrypted: () => {
    delete steamCredentialMemory.encrypted
  },
  readLegacy: () => steamCredentialMemory.legacy,
  clearLegacy: () => {
    delete steamCredentialMemory.legacy
  }
})
assert.equal(steamCredentialVault.getApiKey(), undefined)
assert.equal(steamCredentialMemory.legacy, 'd'.repeat(32))
steamCredentialMemory.encryptionAvailable = true
assert.equal(steamCredentialVault.getApiKey(), 'd'.repeat(32))
assert.equal(steamCredentialMemory.legacy, undefined)
assert.notEqual(steamCredentialMemory.encrypted, 'd'.repeat(32))
steamCredentialVault.setApiKey('e'.repeat(32))
assert.equal(steamCredentialVault.getApiKey(), 'e'.repeat(32))
assert.throws(() => steamCredentialVault.setApiKey('invalid'), /Invalid Steam Web API key/u)
steamCredentialVault.clear()
assert.equal(steamCredentialVault.isConfigured(), false)
assert.equal(normalizeSteamWebApiKey(`  ${'f'.repeat(32)}  `), 'f'.repeat(32))

const sharedIpcSource = await readFile(
  new URL('../src/shared/ipc.ts', import.meta.url),
  'utf8'
)
const orbitSettingsContract = sharedIpcSource.match(
  /export interface OrbitSettings \{[\s\S]*?\n\}/u
)?.[0]
assert.ok(orbitSettingsContract)
assert.doesNotMatch(
  orbitSettingsContract,
  /retroAchievementsWebApiKey/u,
  'renderer settings must not expose the RetroAchievements secret'
)
assert.doesNotMatch(
  orbitSettingsContract,
  /steamWebApiKey/u,
  'renderer settings must not expose the Steam Web API secret'
)
assert.match(sharedIpcSource, /retroAchievementsCredentialSet/u)
assert.match(sharedIpcSource, /retroAchievementsCredentialClear/u)
assert.match(sharedIpcSource, /steamWebApiCredentialSet/u)
assert.match(sharedIpcSource, /steamWebApiCredentialClear/u)

const settingsStoreSource = await readFile(
  new URL('../src/main/settingsStore.ts', import.meta.url),
  'utf8'
)
assert.match(settingsStoreSource, /delete snapshot\[LEGACY_STEAM_WEB_API_KEY\]/u)

console.log('Achievement sync checks passed')
