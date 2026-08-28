import assert from 'node:assert/strict'
import {
  parseSteamCommunityFriendsHtml,
  parseSteamOwnedGamesPayload,
  parseSteamUserTokenFromHtml
} from '../src/main/steam/steamWebParsers.ts'
import {
  canPruneSteamOwnedRecords,
  decideSteamSyncHealth,
  shouldShowSteamSyncNotice
} from '../src/shared/steamSyncPolicy.ts'

const communityFriends = parseSteamCommunityFriendsHtml(`
  <div class="selectable friend_block_v2 persona in-game" data-steamid="76561198000000001" data-search="Player One ; Portal 2 ;">
    <a class="selectable_overlay" href="https://steamcommunity.com/id/player-one"></a>
    <div class="player_avatar"><img src="https://avatars.akamai.steamstatic.com/one_medium.jpg"></div>
    <div class="friend_block_content">Player &amp; One<br>
      <span class="friend_small_text">Portal 2</span>
    </div>
  </div>
  <div class="selectable friend_block_v2 persona offline" data-steamid="76561198000000002" data-search="Player Two ;  ;">
    <a class="selectable_overlay" href="https://steamcommunity.com/profiles/76561198000000002"></a>
    <div class="player_avatar"><img src="https://avatars.akamai.steamstatic.com/two_medium.jpg"></div>
    <div class="friend_block_content">Player Two<br><span class="friend_small_text"></span></div>
  </div>
`)
assert.deepEqual(communityFriends, [
  {
    steamId: '76561198000000001',
    displayName: 'Player & One',
    avatarUrl: 'https://avatars.akamai.steamstatic.com/one_medium.jpg',
    profileUrl: 'https://steamcommunity.com/id/player-one',
    presence: 'online',
    activity: 'Portal 2'
  },
  {
    steamId: '76561198000000002',
    displayName: 'Player Two',
    avatarUrl: 'https://avatars.akamai.steamstatic.com/two_medium.jpg',
    profileUrl: 'https://steamcommunity.com/profiles/76561198000000002',
    presence: 'offline',
    activity: undefined
  }
])

const token = parseSteamUserTokenFromHtml(`
  <div
    data-store_user_config="{&quot;webapi_token&quot;:&quot;library-token&quot;}"
    id="application_config"
    data-userinfo="{&quot;logged_in&quot;:true,&quot;steamid&quot;:&quot;76561198000000000&quot;}"
  ></div>
`)
assert.deepEqual(token, {
  steamId: '76561198000000000',
  accessToken: 'library-token'
})

assert.equal(
  parseSteamUserTokenFromHtml(
    '<div id="application_config" data-userinfo="{&quot;logged_in&quot;:false}"></div>'
  ),
  null
)

const owned = parseSteamOwnedGamesPayload({
  response: {
    game_count: 2,
    games: [
      {
        appid: 10,
        name: 'Counter-Strike',
        playtime_forever: 125,
        rtime_last_played: 1_700_000_000
      },
      { appid: 20 }
    ]
  }
})
assert.equal(owned.reportedCount, 2)
assert.equal(owned.games.length, 2)
assert.equal(owned.games[1]?.appId, 20)
assert.equal(owned.games[1]?.name, undefined)

assert.throws(
  () =>
    parseSteamOwnedGamesPayload({
      response: { game_count: 2, games: [{ appid: 10, name: 'Only one record' }] }
    }),
  /incomplete game list/
)

assert.deepEqual(
  decideSteamSyncHealth({
    primaryLibraryAvailable: true,
    fallbackLibraryAvailable: false,
    cachedGameCount: 250,
    pendingMetadataCount: 0,
    ownedResponseWasEmpty: false,
    supplementalSourcesComplete: false,
    localLibraryComplete: true
  }),
  { state: 'partial', issue: 'source-unavailable' },
  'missing session sources can hide borrowed games and must remain visible as partial'
)

assert.deepEqual(
  decideSteamSyncHealth({
    primaryLibraryAvailable: true,
    fallbackLibraryAvailable: false,
    cachedGameCount: 250,
    pendingMetadataCount: 0,
    ownedResponseWasEmpty: false,
    supplementalSourcesComplete: true,
    localLibraryComplete: true
  }),
  { state: 'ready' }
)

assert.deepEqual(
  decideSteamSyncHealth({
    primaryLibraryAvailable: false,
    fallbackLibraryAvailable: false,
    cachedGameCount: 250,
    pendingMetadataCount: 0,
    ownedResponseWasEmpty: false,
    supplementalSourcesComplete: false,
    localLibraryComplete: true
  }),
  { state: 'partial', issue: 'online-library-unavailable' }
)

assert.deepEqual(
  decideSteamSyncHealth({
    primaryLibraryAvailable: true,
    fallbackLibraryAvailable: true,
    cachedGameCount: 250,
    pendingMetadataCount: 3,
    ownedResponseWasEmpty: false,
    supplementalSourcesComplete: true,
    localLibraryComplete: true
  }),
  { state: 'partial', issue: 'metadata-pending' }
)

assert.equal(canPruneSteamOwnedRecords(true, false, true), false)
assert.equal(canPruneSteamOwnedRecords(true, true, false), false)
assert.equal(canPruneSteamOwnedRecords(false, true, true), false)
assert.equal(canPruneSteamOwnedRecords(true, true, true), true)

assert.equal(
  shouldShowSteamSyncNotice({
    provider: 'steam',
    state: 'partial',
    connection: 'connected',
    methods: ['local-manifests', 'cached-data'],
    gameCount: 252,
    installedCount: 8,
    installableCount: 244,
    issue: 'online-library-unavailable'
  }),
  false,
  'a retained online library must stay unobstructed during a transient refresh failure'
)

assert.equal(
  shouldShowSteamSyncNotice({
    provider: 'steam',
    state: 'error',
    connection: 'connected',
    methods: ['local-manifests'],
    gameCount: 8,
    installedCount: 8,
    installableCount: 0,
    issue: 'online-library-unavailable'
  }),
  true,
  'an incomplete first sync with only local installs must remain actionable'
)

console.log('Steam sync checks passed')
