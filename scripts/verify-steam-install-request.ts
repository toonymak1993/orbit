import assert from 'node:assert/strict'
import { win32 as path } from 'node:path'
import {
  hasSteamInstallStarted,
  steamDirectInstallArguments,
  waitForSteamInstallStart
} from '../src/main/steam/steamInstallRequest.ts'

assert.deepEqual(steamDirectInstallArguments(570), ['-silent', '+app_install', '570'])
assert.throws(() => steamDirectInstallArguments(0), /Invalid Steam app identifier/)
assert.throws(() => steamDirectInstallArguments(1.5), /Invalid Steam app identifier/)

const steamAppsDirectory = 'D:\\SteamLibrary\\steamapps'
const manifestPath = path.join(steamAppsDirectory, 'appmanifest_570.acf')
const downloadPath = path.join(steamAppsDirectory, 'downloading', '570')

assert.equal(
  hasSteamInstallStarted(570, [steamAppsDirectory], (candidate) => candidate === manifestPath),
  true
)
assert.equal(
  hasSteamInstallStarted(570, [steamAppsDirectory], (candidate) => candidate === downloadPath),
  true
)
assert.equal(hasSteamInstallStarted(570, [steamAppsDirectory], () => false), false)

let probes = 0
assert.equal(
  await waitForSteamInstallStart(570, [steamAppsDirectory], {
    timeoutMs: 1_000,
    pollIntervalMs: 250,
    pathExists: () => ++probes >= 3,
    delay: async () => undefined
  }),
  true
)

assert.equal(
  await waitForSteamInstallStart(570, [steamAppsDirectory], {
    timeoutMs: 500,
    pollIntervalMs: 250,
    pathExists: () => false,
    delay: async () => undefined
  }),
  false
)

console.log('Steam direct-install request verification passed.')
