import assert from 'node:assert/strict'
import {
  parseSteamOwnedGamesPayload,
  parseSteamUserTokenFromHtml
} from '../src/main/steam/steamWebParsers.ts'

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

console.log('Steam sync parser checks passed')
