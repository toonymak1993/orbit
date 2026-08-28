import assert from 'node:assert/strict'
import { parseEnglishSteamDate } from '../src/main/store/steamReleaseDate.ts'

const expected = Date.UTC(2026, 7, 28, 12)

for (const value of ['28 Aug, 2026', '28 August 2026', 'Aug 28, 2026', 'August 28, 2026']) {
  assert.equal(parseEnglishSteamDate(value)?.timestamp, expected, value)
}

assert.equal(parseEnglishSteamDate('31 Feb, 2026'), null)
assert.equal(parseEnglishSteamDate('Coming soon'), null)
assert.equal(parseEnglishSteamDate(''), null)

console.log('Store release date verification passed.')
