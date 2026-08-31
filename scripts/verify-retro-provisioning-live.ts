import assert from 'node:assert/strict'
import { RETRO_SYSTEMS } from '../src/shared/retroSystems.ts'
import {
  RETRO_EMULATOR_PROVISIONERS,
  selectGithubReleaseAsset,
  validatedRetroDownloadUrl
} from '../src/main/retro/retroProvisionPolicy.ts'

const headers = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'ORBIT-emulator-live-verifier'
}

async function json<T>(url: string): Promise<T> {
  const response = await fetch(validatedRetroDownloadUrl(url), { headers })
  assert.ok(response.ok, `${url} returned HTTP ${response.status}`)
  return response.json() as Promise<T>
}

async function available(url: string): Promise<boolean> {
  const response = await fetch(validatedRetroDownloadUrl(url), {
    method: 'HEAD',
    headers: { 'User-Agent': headers['User-Agent'] },
    redirect: 'follow'
  })
  return response.ok
}

await Promise.all(
  Object.values(RETRO_EMULATOR_PROVISIONERS).map(async (provisioner) => {
    if (provisioner.kind !== 'github-release') return
    const release = await json<{
      assets?: Array<{
        name: string
        browser_download_url?: string
        size?: number
        digest?: string | null
      }>
    }>(`https://api.github.com/repos/${provisioner.repository}/releases/latest`)
    const asset = selectGithubReleaseAsset(provisioner, release.assets ?? [])
    assert.ok(asset.browser_download_url)
    assert.ok(await available(asset.browser_download_url), `${asset.name} is unavailable`)
  })
)

const retroArch = RETRO_EMULATOR_PROVISIONERS.retroarch
assert.equal(retroArch.kind, 'retroarch-stable')
if (retroArch.kind !== 'retroarch-stable') assert.fail('RetroArch provisioner is invalid')
assert.ok(
  await available(
    `https://buildbot.libretro.com/stable/${retroArch.version}/windows/x86_64/RetroArch.7z`
  )
)

const dolphin = RETRO_EMULATOR_PROVISIONERS.dolphin
assert.equal(dolphin.kind, 'dolphin-stable')
if (dolphin.kind !== 'dolphin-stable') assert.fail('Dolphin provisioner is invalid')
assert.ok(
  await available(
    `https://dl.dolphin-emu.org/releases/${dolphin.version}/dolphin-${dolphin.version}-x64.7z`
  )
)

const project64 = RETRO_EMULATOR_PROVISIONERS.project64
assert.equal(project64.kind, 'project64-stable')
if (project64.kind !== 'project64-stable') assert.fail('Project64 provisioner is invalid')
assert.ok(
  await available(
    `https://www.pj64-emu.com/file/project64-${project64.version.replace(/\./gu, '-')}/`
  )
)

await Promise.all(
  RETRO_SYSTEMS.filter((system) => system.retroArchCores.length > 0).map(async (system) => {
    for (const coreName of system.retroArchCores) {
      const coreUrl =
        `https://buildbot.libretro.com/nightly/windows/x86_64/latest/` +
        `${coreName}_libretro.dll.zip`
      if (await available(coreUrl)) return
    }
    assert.fail(`No official RetroArch core is available for ${system.id}`)
  })
)

console.log('Live retro emulator provisioning verification passed.')
