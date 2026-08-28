import assert from 'node:assert/strict'
import { selectSteamGridDbGame } from '../src/main/steamGridDbSearch.ts'

const forzaResults = [
  { id: 1, name: 'Forza' },
  { id: 2, name: 'Forza Horizon 5' },
  { id: 3, name: 'Forza Horizon 4' }
]

assert.equal(selectSteamGridDbGame('Forza 4', forzaResults)?.id, 3)
assert.equal(selectSteamGridDbGame('Forza Horizon 4', forzaResults)?.id, 3)
assert.equal(selectSteamGridDbGame('Forza Horizon 4 Ultimate Edition', forzaResults)?.id, 3)
assert.equal(selectSteamGridDbGame('Forza Horizon 6', forzaResults), undefined)

assert.equal(
  selectSteamGridDbGame('Resident Evil 4', [
    { id: 4, name: 'Resident Evil 2' },
    { id: 5, name: 'Resident Evil 4' }
  ])?.id,
  5
)

assert.equal(
  selectSteamGridDbGame('Need for Speed', [
    { id: 6, name: 'Need for Speed Heat' },
    { id: 7, name: 'Need for Speed' }
  ])?.id,
  7
)

assert.equal(
  selectSteamGridDbGame('Portal 2', [
    { id: 8, name: 'Portal' },
    { id: 9, name: 'Portal 2' }
  ])?.id,
  9
)

assert.equal(
  selectSteamGridDbGame('F1 24', [
    { id: 10, name: 'F1 23' },
    { id: 11, name: 'F1 24' }
  ])?.id,
  11
)

console.log('SteamGridDB search verification passed.')
