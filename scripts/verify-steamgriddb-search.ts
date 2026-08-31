import assert from 'node:assert/strict'
import {
  selectSteamGridDbGame,
  steamGridDbSearchKey,
  stripSteamGridDbEditionWords
} from '../src/main/steamGridDbSearch.ts'

const forzaResults = [
  { id: 1, name: 'Forza' },
  { id: 2, name: 'Forza Horizon 5' },
  { id: 3, name: 'Forza Horizon 4' }
]

assert.equal(selectSteamGridDbGame('Forza 4', forzaResults), undefined)
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

assert.equal(
  selectSteamGridDbGame('Gothic 1 Remake', [
    { id: 12, name: 'Gothic 1' },
    { id: 13, name: 'Gothic 1 Remake' }
  ])?.id,
  13
)

assert.equal(
  selectSteamGridDbGame('Gothic 1 Remake', [{ id: 12, name: 'Gothic 1' }]),
  undefined
)

assert.equal(
  selectSteamGridDbGame('God of War', [{ id: 14, name: 'God of War Ragnarok' }]),
  undefined
)

assert.equal(
  selectSteamGridDbGame("Assassin's Creed II", [{ id: 15, name: "Assassin's Creed III" }]),
  undefined
)

assert.equal(
  selectSteamGridDbGame('Resident Evil 4 Remake', [
    { id: 16, name: 'Resident Evil 4' },
    { id: 17, name: 'Resident Evil 4 Remake' }
  ])?.id,
  17
)

assert.equal(
  selectSteamGridDbGame('Resident Evil 4 Remake', [{ id: 16, name: 'Resident Evil 4' }]),
  undefined
)
assert.equal(
  selectSteamGridDbGame('Final Fantasy VII Remake', [{ id: 18, name: 'Final Fantasy VII' }]),
  undefined
)
assert.equal(
  selectSteamGridDbGame('Age of Empires II Definitive Edition', [
    { id: 19, name: 'Age of Empires II' }
  ]),
  undefined
)
assert.equal(
  selectSteamGridDbGame('Age of Empires II Definitive Edition', [
    { id: 19, name: 'Age of Empires II' },
    { id: 20, name: 'Age of Empires II Definitive Edition' }
  ])?.id,
  20
)

assert.equal(
  selectSteamGridDbGame('Middle Earth Shadow of Mordor', [
    { id: 21, name: 'Middle Earth Shadow of War' }
  ]),
  undefined
)
assert.equal(
  selectSteamGridDbGame("Tom Clancy's Rainbow Six Siege", [
    { id: 22, name: "Tom Clancy's Rainbow Six Extraction" }
  ]),
  undefined
)
assert.equal(
  selectSteamGridDbGame('The Lord of the Rings Gollum', [
    { id: 23, name: 'The Lord of the Rings Online' }
  ]),
  undefined
)

assert.equal(
  selectSteamGridDbGame('Pokemon', [{ id: 24, name: 'Pokémon' }])?.id,
  24
)
assert.equal(
  selectSteamGridDbGame('Final Fantasy II', [{ id: 25, name: 'Final Fantasy 2' }])?.id,
  25
)
assert.equal(
  selectSteamGridDbGame('Control', [{ id: 26, name: 'Control 2' }]),
  undefined
)
assert.equal(stripSteamGridDbEditionWords('Gold Rush The Game'), 'Gold Rush The Game')
assert.equal(selectSteamGridDbGame('Ultimate', [{ id: 27, name: 'Gold' }]), undefined)
assert.equal(selectSteamGridDbGame('Pokemon Gold', [{ id: 28, name: 'Pokemon' }]), undefined)
assert.equal(selectSteamGridDbGame('Heart of Gold', [{ id: 29, name: 'Heart of' }]), undefined)
assert.equal(
  selectSteamGridDbGame('Control Ultimate Edition', [{ id: 30, name: 'Control' }])?.id,
  30
)
assert.equal(selectSteamGridDbGame('F1 24', [{ id: 31, name: 'F1 Manager 24' }]), undefined)
assert.equal(selectSteamGridDbGame('Doom 3', [{ id: 32, name: 'Doom 3 BFG Edition' }]), undefined)
assert.equal(selectSteamGridDbGame('Quake 2', [{ id: 33, name: 'Quake 2 RTX' }]), undefined)
assert.equal(steamGridDbSearchKey('Pokémon'), steamGridDbSearchKey('Pokemon'))
assert.equal(
  selectSteamGridDbGame('Portal 2', [
    { id: 34, name: 'Portal II' },
    { id: 35, name: 'Portal 2' }
  ]),
  undefined
)
assert.equal(
  selectSteamGridDbGame('Forza 4', [
    { id: 36, name: 'Forza Horizon 4' },
    { id: 37, name: 'Forza Motorsport 4' }
  ]),
  undefined
)

console.log('SteamGridDB search verification passed.')
