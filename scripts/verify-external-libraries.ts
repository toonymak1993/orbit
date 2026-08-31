import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  normalizeWindowsLauncherGames,
  scanWindowsLauncherLibraries
} from '../src/main/library/windowsLauncherDiscovery'
import {
  parseUbisoftCatalogBuffer,
  scanUbisoftCatalog
} from '../src/main/ubisoft/ubisoftCatalog'

function varint(value: number): Buffer {
  const bytes: number[] = []
  let remaining = value
  do {
    let byte = remaining & 0x7f
    remaining = Math.floor(remaining / 128)
    if (remaining > 0) byte |= 0x80
    bytes.push(byte)
  } while (remaining > 0)
  return Buffer.from(bytes)
}

function field(tag: number, value: Buffer): Buffer {
  return Buffer.concat([varint((tag << 3) | 2), varint(value.length), value])
}

function ubisoftEntry(id: number, yaml: string): Buffer {
  return Buffer.concat([
    varint(1 << 3),
    varint(id),
    field(3, Buffer.from(yaml, 'utf8'))
  ])
}

function ubisoftEnvelope(entries: Buffer[]): Buffer {
  return Buffer.concat(entries.map((entry) => field(1, entry)))
}

const mainYaml = `game:
  name: GAME_NAME_MAIN
  background_image: hero.jpg
  thumb_image: cover.jpg
  icon_image: icon.png
  start_game:
    executable: game.exe
  addons:
    - id: 43
localizations:
    GAME_NAME_MAIN: Test Adventure
`
const dlcYaml = `game:
  name: DLC_NAME
  is_ulc: yes
  start_game:
    executable: dlc.exe
localizations:
    DLC_NAME: Test DLC
`

const parsedCatalog = parseUbisoftCatalogBuffer(
  ubisoftEnvelope([ubisoftEntry(42, mainYaml), ubisoftEntry(43, dlcYaml)])
)
assert.equal(parsedCatalog.complete, true)
assert.deepEqual([...parsedCatalog.games.keys()], ['42'])
assert.equal(parsedCatalog.games.get('42')?.name, 'Test Adventure')
assert.equal(
  parsedCatalog.games.get('42')?.metadata.artwork?.vertical?.[0],
  'https://ubistatic3-a.akamaihd.net/orbit/uplay_launcher_3_0/assets/cover.jpg'
)
assert.equal(parseUbisoftCatalogBuffer(Buffer.from([0x0a, 0xff])).complete, false)

const fixtureRoot = await mkdtemp(join(tmpdir(), 'orbit-external-libraries-'))
try {
  const gogDir = join(fixtureRoot, 'GOG Test')
  const invalidGogDir = join(fixtureRoot, 'Invalid GOG')
  await Promise.all([mkdir(gogDir), mkdir(invalidGogDir)])
  await writeFile(join(gogDir, 'game.exe'), '')
  await writeFile(join(fixtureRoot, 'escape.exe'), '')
  await writeFile(
    join(gogDir, 'goggame-123.info'),
    JSON.stringify({
      rootGameId: '123',
      name: 'GOG Test™',
      playTasks: [
        {
          isPrimary: true,
          type: 'FileTask',
          path: 'game.exe',
          arguments: '--safe "two words"'
        }
      ]
    })
  )
  await writeFile(
    join(invalidGogDir, 'goggame-124.info'),
    JSON.stringify({
      rootGameId: '124',
      playTasks: [{ isPrimary: true, type: 'FileTask', path: '..\\escape.exe' }]
    })
  )

  const discovery = normalizeWindowsLauncherGames([
    { provider: 'gog', providerGameId: '123', name: 'Fallback', installDir: gogDir },
    { provider: 'gog', providerGameId: '124', name: 'Unsafe', installDir: invalidGogDir },
    { provider: 'ea', providerGameId: 'OFFER-1', name: 'EA Test', installDir: fixtureRoot },
    { provider: 'ubisoft', providerGameId: '42', name: 'Ubisoft Test', installDir: fixtureRoot }
  ])
  assert.equal(discovery.games.gog.size, 1)
  assert.equal(discovery.games.gog.get('123')?.name, 'GOG Test')
  assert.deepEqual(discovery.games.gog.get('123')?.metadata.launchArguments, [
    '--safe',
    'two words'
  ])
  assert.equal(discovery.games.ea.get('OFFER-1')?.metadata.launchUri, 'origin2://game/launch?offerIds=OFFER-1')
  assert.equal(discovery.games.ubisoft.get('42')?.metadata.launchUri, 'uplay://launch/42/0')
} finally {
  await rm(fixtureRoot, { recursive: true, force: true })
}

const [localInstallDiscovery, localUbisoftCatalog] = await Promise.all([
  scanWindowsLauncherLibraries(),
  scanUbisoftCatalog()
])
assert.equal(localInstallDiscovery.complete, process.platform === 'win32')
console.log(
  `External library verification passed (local installs: GOG ${localInstallDiscovery.games.gog.size}, EA ${localInstallDiscovery.games.ea.size}, Ubisoft ${localInstallDiscovery.games.ubisoft.size}; Ubisoft cache: ${localUbisoftCatalog.available ? localUbisoftCatalog.games.size : 'unavailable'}).`
)
