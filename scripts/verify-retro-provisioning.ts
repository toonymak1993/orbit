import assert from 'node:assert/strict'
import type { DetectedRetroEmulator } from '../src/shared/ipc.ts'
import {
  RETRO_EMULATOR_DOWNLOADS,
  recommendedRetroEmulatorDownload,
  retroEmulatorDownloadsForSystem
} from '../src/shared/retroSystems.ts'
import {
  RETRO_EMULATOR_EXECUTABLES,
  RETRO_EMULATOR_PROVISIONERS,
  decideRetroProvisioning,
  selectGithubReleaseAsset,
  validateArchiveEntryPath,
  validatedRetroDownloadUrl
} from '../src/main/retro/retroProvisionPolicy.ts'

const expectedAssets: Readonly<Record<string, string>> = {
  duckstation: 'duckstation-windows-x64-release.zip',
  pcsx2: 'PCSX2-v2.8.0-windows-x64-Qt.7z',
  ppsspp: 'PPSSPP-v1.20.4-Windows-x64.zip',
  cemu: 'cemu-2.6-windows-x64.zip',
  mgba: 'mGBA-0.10.5-win64.7z',
  melonds: 'melonDS-1.1-windows-x86_64.zip',
  snes9x: 'snes9x-1.63-win32-x64.zip',
  flycast: 'flycast-win64-2.7.zip',
  mame: 'mame0289b_x64.exe'
}

const emulatorIds = new Set<string>()
for (const emulator of RETRO_EMULATOR_DOWNLOADS) {
  assert.ok(!emulatorIds.has(emulator.id), `Duplicate emulator: ${emulator.id}`)
  emulatorIds.add(emulator.id)
  assert.ok(RETRO_EMULATOR_PROVISIONERS[emulator.id], `Missing provisioner: ${emulator.id}`)
  assert.ok(RETRO_EMULATOR_EXECUTABLES[emulator.id]?.length, `Missing executable: ${emulator.id}`)
  assert.equal(new URL(emulator.downloadUrl).protocol, 'https:')
  assert.ok(emulator.systems.length > 0)

  for (const systemId of emulator.systems) {
    assert.ok(
      retroEmulatorDownloadsForSystem(systemId).some((candidate) => candidate.id === emulator.id)
    )
    assert.ok(recommendedRetroEmulatorDownload(systemId))

    const installed: DetectedRetroEmulator = {
      id: emulator.id,
      name: emulator.name,
      kind: emulator.id === 'retroarch' ? 'retroarch' : 'standalone',
      supportedSystems: [...emulator.systems],
      readySystems: [systemId],
      achievementsSupported: false
    }
    assert.equal(decideRetroProvisioning(systemId, emulator.id, [installed]), 'use-existing')
    assert.equal(decideRetroProvisioning(systemId, emulator.id, []), 'install-emulator')
  }
}

assert.deepEqual(
  new Set(Object.keys(RETRO_EMULATOR_PROVISIONERS)),
  new Set(RETRO_EMULATOR_DOWNLOADS.map((emulator) => emulator.id))
)

const pinnedPackages = {
  retroarch: {
    version: '1.22.2',
    sha256: 'b2139b1d0f9d4526dc6b5ce23cbb3efdc766096fa6f2c3df016818b486ac6372'
  },
  dolphin: {
    version: '2606a',
    sha256: '4c58045f9821cb63913f4df08ea86ece3cdda9f9e646154516000fa1547e0c37'
  },
  project64: {
    version: '3.0.1-5664-2df3434',
    sha256: 'f8be471f105e844e32589d21f3c1ee466d5ff4d93b8b7aff69e1badf511faf7f'
  }
} as const

for (const [emulatorId, expected] of Object.entries(pinnedPackages)) {
  const provisioner = RETRO_EMULATOR_PROVISIONERS[emulatorId]
  assert.notEqual(provisioner.kind, 'github-release')
  if (provisioner.kind === 'github-release') continue
  assert.equal(provisioner.version, expected.version)
  assert.equal(provisioner.sha256, expected.sha256)
  assert.match(provisioner.sha256, /^[a-f\d]{64}$/u)
}

for (const [emulatorId, assetName] of Object.entries(expectedAssets)) {
  const provisioner = RETRO_EMULATOR_PROVISIONERS[emulatorId]
  assert.equal(provisioner.kind, 'github-release')
  if (provisioner.kind !== 'github-release') continue
  const selected = selectGithubReleaseAsset(provisioner, [
    { name: `${assetName}.symbols`, browser_download_url: 'https://github.com/invalid' },
    { name: assetName, browser_download_url: 'https://github.com/official' }
  ])
  assert.equal(selected.name, assetName)
}

const retroArchMissingCore: DetectedRetroEmulator = {
  id: 'retroarch',
  name: 'RetroArch',
  kind: 'retroarch',
  supportedSystems: ['psp'],
  readySystems: [],
  achievementsSupported: true
}
assert.equal(decideRetroProvisioning('psp', 'retroarch', [retroArchMissingCore]), 'install-core')

assert.equal(
  validatedRetroDownloadUrl('https://buildbot.libretro.com/nightly/windows/x86_64/latest/ppsspp_libretro.dll.zip'),
  'https://buildbot.libretro.com/nightly/windows/x86_64/latest/ppsspp_libretro.dll.zip'
)
assert.throws(() => validatedRetroDownloadUrl('http://github.com/package.zip'), /Untrusted/)
assert.throws(() => validatedRetroDownloadUrl('https://example.com/package.zip'), /Untrusted/)
assert.equal(validateArchiveEntryPath('Dolphin-x64/Dolphin.exe'), 'Dolphin-x64/Dolphin.exe')
assert.throws(() => validateArchiveEntryPath('../outside.exe'), /Unsafe/)
assert.throws(() => validateArchiveEntryPath('C:\\Windows\\outside.exe'), /Unsafe/)
assert.throws(() => validateArchiveEntryPath('/absolute/outside.exe'), /Unsafe/)

assert.equal(recommendedRetroEmulatorDownload('psp').id, 'ppsspp')
assert.equal(recommendedRetroEmulatorDownload('ps2').id, 'pcsx2')
assert.equal(recommendedRetroEmulatorDownload('nes').id, 'retroarch')

console.log('Retro emulator provisioning verification passed.')
