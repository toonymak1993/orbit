import assert from 'node:assert/strict'
import {
  extractPlayStationNpsso,
  playStationDurationSeconds,
  selectPlayStationRemotePlayApp
} from '../src/shared/playstation.ts'

assert.equal(playStationDurationSeconds('PT228H56M33S'), 824_193)
assert.equal(playStationDurationSeconds('P1DT2H3M4.5S'), 93_785)
assert.equal(playStationDurationSeconds('PT0S'), 0)
assert.equal(playStationDurationSeconds('not-a-duration'), undefined)

const sample = 'a'.repeat(64)
assert.equal(extractPlayStationNpsso(sample), sample)
assert.equal(extractPlayStationNpsso(JSON.stringify({ npsso: sample })), sample)
assert.throws(() => extractPlayStationNpsso('too-short'))
assert.throws(() => extractPlayStationNpsso('{"npsso":123}'))

assert.equal(
  selectPlayStationRemotePlayApp(['ps-remote-play', 'chiaki'], 'auto'),
  'chiaki',
  'automatic mode must prefer Chiaki-ng'
)
assert.equal(
  selectPlayStationRemotePlayApp(['ps-remote-play'], 'auto'),
  'ps-remote-play',
  'automatic mode must fall back to Sony PS Remote Play'
)
assert.equal(selectPlayStationRemotePlayApp(['chiaki'], 'ps-remote-play'), undefined)

console.log('PlayStation import parsing checks passed.')
