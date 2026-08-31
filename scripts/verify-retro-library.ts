import assert from 'node:assert/strict'
import {
  cleanRetroGameName,
  detectRetroSystemId,
  enforceRetroFullscreenArguments,
  RETRO_EMULATOR_DOWNLOADS,
  retroEmulatorDownloadsForSystem,
  matchingRetroArchCore,
  recommendedRetroEmulatorDownload,
  RETRO_SYSTEMS,
  RETRO_LAUNCH_PROFILE_IDS,
  retroDefaultLaunchArguments,
  retroLaunchArguments,
  selectRetroEmulator
} from '../src/shared/retroSystems.ts'
import type { RetroGameConfig } from '../src/shared/ipc.ts'
import {
  upsertFlatSetting,
  upsertIniSetting
} from '../src/main/retro/retroLaunchPreparation.ts'

assert.equal(detectRetroSystemId('D:\\ROMs\\NES\\Super Mario Bros. (USA).nes'), 'nes')
assert.equal(detectRetroSystemId('D:\\ROMs\\PlayStation 2\\Shadow of the Colossus.cue'), 'ps2')
assert.equal(detectRetroSystemId('D:\\ROMs\\Wii\\Mario Kart.wbfs'), 'wii')
assert.equal(detectRetroSystemId('D:\\ROMs\\Arcade\\galaga.7z'), 'arcade')
assert.equal(detectRetroSystemId('D:\\Downloads\\readme.txt'), undefined)
assert.equal(cleanRetroGameName('D:\\ROMs\\SNES\\Chrono Trigger (USA) [!].sfc'), 'Chrono Trigger')
assert.equal(
  matchingRetroArchCore('snes', ['mesen_libretro.dll', 'snes9x_libretro.dll']),
  'snes9x_libretro.dll'
)

const emulatorCandidates = [
  { id: 'ppsspp', readySystems: ['psp'] as const },
  { id: 'retroarch', readySystems: ['psp', 'snes'] as const }
]
assert.equal(selectRetroEmulator('psp', emulatorCandidates)?.id, 'ppsspp')
assert.equal(selectRetroEmulator('psp', emulatorCandidates, 'retroarch')?.id, 'retroarch')
assert.equal(selectRetroEmulator('psp', emulatorCandidates, 'missing'), undefined)

assert.deepEqual(
  RETRO_EMULATOR_DOWNLOADS.map((emulator) => emulator.id),
  [
    'retroarch',
    'duckstation',
    'pcsx2',
    'dolphin',
    'ppsspp',
    'cemu',
    'mgba',
    'melonds',
    'snes9x',
    'project64',
    'flycast',
    'mame'
  ]
)
for (const system of RETRO_SYSTEMS) {
  const managed = retroEmulatorDownloadsForSystem(system.id)
  const recommended = recommendedRetroEmulatorDownload(system.id)
  assert.ok(managed.length > 0, `${system.id} has no guided emulator download`)
  assert.equal(managed[0].id, recommended.id)
  assert.ok(recommended.systems.includes(system.id))
  assert.ok(system.folderAliases.includes(system.id), `${system.id} managed folder is not detectable`)
  assert.equal(detectRetroSystemId(`D:\\ORBIT\\ROMs\\${system.id}\\fixture.zip`), system.id)
}

const retroArchGame: RetroGameConfig = {
  romPath: 'D:\\ROMs\\NES\\Mega Man 2.nes',
  sourceDirectory: 'D:\\ROMs',
  systemId: 'nes',
  systemName: 'Nintendo Entertainment System',
  emulatorId: 'retroarch',
  emulatorName: 'RetroArch',
  emulatorPath: 'C:\\RetroArch\\retroarch.exe',
  corePath: 'C:\\RetroArch\\cores\\mesen_libretro.dll',
  retroAchievementsMatch: 'not-configured'
}
assert.deepEqual(retroLaunchArguments(retroArchGame), [
  '-f',
  '-L',
  retroArchGame.corePath,
  retroArchGame.romPath
])
assert.deepEqual(
  retroLaunchArguments({ ...retroArchGame, emulatorId: 'dolphin', corePath: undefined }),
  ['-C', 'Dolphin.Display.Fullscreen=True', '-b', '-e', retroArchGame.romPath]
)
assert.deepEqual(
  retroLaunchArguments({
    ...retroArchGame,
    emulatorId: 'mame',
    romPath: 'D:\\ROMs\\Arcade\\galaga.zip',
    corePath: undefined
  }),
  ['-nowindow', '-rompath', 'D:\\ROMs\\Arcade', 'galaga']
)
assert.throws(
  () => retroLaunchArguments({ ...retroArchGame, corePath: undefined }),
  /RetroArch core/
)

const profileExpectations: Record<(typeof RETRO_LAUNCH_PROFILE_IDS)[number], string[]> = {
  retroarch: ['-f', '-L', retroArchGame.corePath as string, retroArchGame.romPath],
  duckstation: ['-batch', '-fullscreen', '--', retroArchGame.romPath],
  pcsx2: ['-batch', '-fullscreen', '--', retroArchGame.romPath],
  dolphin: ['-b', '-C', 'Dolphin.Display.Fullscreen=True', '-e', retroArchGame.romPath],
  ppsspp: ['--fullscreen', retroArchGame.romPath],
  cemu: ['-f', '-g', retroArchGame.romPath],
  mgba: ['-f', retroArchGame.romPath],
  melonds: ['-f', retroArchGame.romPath],
  snes9x: [retroArchGame.romPath],
  project64: [retroArchGame.romPath],
  flycast: ['-config', 'window:fullscreen=yes', retroArchGame.romPath],
  mame: ['-nowindow', '-rompath', 'D:\\ROMs\\NES', 'Mega Man 2']
}
for (const emulatorId of RETRO_LAUNCH_PROFILE_IDS) {
  const game = {
    ...retroArchGame,
    emulatorId,
    corePath: emulatorId === 'retroarch' ? retroArchGame.corePath : undefined
  }
  assert.deepEqual(retroDefaultLaunchArguments(game), profileExpectations[emulatorId])
}

assert.deepEqual(
  enforceRetroFullscreenArguments('duckstation', [
    '-nofullscreen',
    '--custom-setting',
    retroArchGame.romPath
  ]),
  ['-fullscreen', '--custom-setting', retroArchGame.romPath]
)
assert.deepEqual(
  enforceRetroFullscreenArguments('dolphin', [
    '--config',
    'Dolphin.Display.Fullscreen=False',
    '-C=Dolphin.Display.Fullscreen=False',
    '-b',
    '-e',
    retroArchGame.romPath
  ]),
  ['-C', 'Dolphin.Display.Fullscreen=True', '-b', '-e', retroArchGame.romPath]
)
assert.deepEqual(
  enforceRetroFullscreenArguments('flycast', [
    '-config',
    'window:fullscreen=no',
    retroArchGame.romPath
  ]),
  ['-config', 'window:fullscreen=yes', retroArchGame.romPath]
)

assert.equal(
  upsertIniSetting('[Settings]\r\nVersion=2\r\n\r\n[Recent]\r\nGame=x\r\n', 'Settings', 'Auto Full Screen', '1'),
  '[Settings]\r\nAuto Full Screen=1\r\nVersion=2\r\n\r\n[Recent]\r\nGame=x\r\n'
)
assert.equal(
  upsertIniSetting('[Settings]\nAuto Full Screen=0\n', 'Settings', 'Auto Full Screen', '1'),
  '[Settings]\nAuto Full Screen=1\n'
)
assert.equal(
  upsertFlatSetting('Fullscreen:FullscreenOnOpen = FALSE\r\n', 'Fullscreen:FullscreenOnOpen', 'TRUE'),
  'Fullscreen:FullscreenOnOpen = TRUE\r\n'
)

console.log('Retro library verification passed.')
