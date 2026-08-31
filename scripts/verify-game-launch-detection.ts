import assert from 'node:assert/strict'
import { GAME_LAUNCH_CANCEL_WINDOW_MS } from '../src/shared/ipc.ts'
import {
  LaunchStartupTracker,
  GAME_PROCESS_CANDIDATE_STABILITY_MS,
  ancestryIncludesTrackedPid,
  hasEligibleGameProcessIdentity,
  launchNoEvidenceTimeoutMs,
  provisionalHandoffGraceMs,
  windowsPackageIdentityMatches
} from '../src/main/gameLaunchDetectionPolicy.ts'

const startedAt = 10_000
const noIdentity = {
  directlySpawnedGame: false,
  exactExecutable: false,
  insideInstallDir: false,
  packageFamilyMatches: false,
  idMatches: false,
  executableHintMatches: false,
  fromTrackedGame: false,
  fromLauncher: false,
  visible: false,
  nameMatches: false,
  windowsAppsProcess: false
}

assert.equal(hasEligibleGameProcessIdentity({ ...noIdentity, visible: true }), false)
assert.equal(
  hasEligibleGameProcessIdentity({
    ...noIdentity,
    visible: true,
    windowsAppsProcess: true
  }),
  false
)
assert.equal(
  hasEligibleGameProcessIdentity({ ...noIdentity, visible: true, nameMatches: true }),
  true
)
assert.equal(
  hasEligibleGameProcessIdentity({ ...noIdentity, visible: true, fromLauncher: true }),
  true
)
assert.equal(hasEligibleGameProcessIdentity({ ...noIdentity, insideInstallDir: true }), true)
assert.equal(hasEligibleGameProcessIdentity({ ...noIdentity, exactExecutable: true }), true)
assert.equal(hasEligibleGameProcessIdentity({ ...noIdentity, packageFamilyMatches: true }), true)
assert.equal(hasEligibleGameProcessIdentity({ ...noIdentity, executableHintMatches: true }), true)
assert.equal(hasEligibleGameProcessIdentity({ ...noIdentity, directlySpawnedGame: true }), true)
assert.equal(
  windowsPackageIdentityMatches(
    'shell:AppsFolder\\Microsoft.198377053870B_8wekyb3d8bbwe!AppHaloCampaignEvolvedShipping',
    'C:\\Program Files\\WindowsApps\\Microsoft.198377053870B_2.0.0.0_x64__8wekyb3d8bbwe\\Meteorite\\Binaries\\WinGDK\\HaloCampaignEvolved.exe'
  ),
  true
)
assert.equal(
  windowsPackageIdentityMatches(
    'shell:AppsFolder\\Microsoft.198377053870B_8wekyb3d8bbwe!AppHaloCampaignEvolvedShipping',
    'C:\\Program Files\\WindowsApps\\Microsoft.OtherGame_2.0.0.0_x64__8wekyb3d8bbwe\\OtherGame.exe'
  ),
  false
)
assert.equal(GAME_LAUNCH_CANCEL_WINDOW_MS, 3_000)
assert.equal(GAME_PROCESS_CANDIDATE_STABILITY_MS, 650)

assert.equal(ancestryIncludesTrackedPid(42, new Set([42]), () => undefined), true)
assert.equal(
  ancestryIncludesTrackedPid(52, new Set([42]), (pid) => (pid === 52 ? 42 : undefined)),
  true
)
assert.equal(ancestryIncludesTrackedPid(52, new Set([99]), () => undefined), false)

assert.equal(launchNoEvidenceTimeoutMs('local'), 20_000)
assert.equal(launchNoEvidenceTimeoutMs('steam'), 60_000)
assert.equal(launchNoEvidenceTimeoutMs('epic'), 75_000)
assert.equal(launchNoEvidenceTimeoutMs('xbox'), 75_000)
assert.equal(launchNoEvidenceTimeoutMs('ea'), 90_000)
assert.equal(launchNoEvidenceTimeoutMs('ubisoft'), 90_000)
assert.equal(provisionalHandoffGraceMs('local'), 8_000)
assert.equal(provisionalHandoffGraceMs('xbox'), 15_000)

const noEvidence = new LaunchStartupTracker(startedAt, 'local')
assert.equal(noEvidence.failureReason(startedAt + 19_999), undefined)
assert.equal(noEvidence.failureReason(startedAt + 20_000), 'not-started')

const shortLivedLocalProcess = new LaunchStartupTracker(startedAt, 'local')
shortLivedLocalProcess.noteCandidateSeen()
shortLivedLocalProcess.noteCandidateMissing(startedAt + 1_000)
assert.equal(shortLivedLocalProcess.failureReason(startedAt + 19_999), undefined)
assert.equal(shortLivedLocalProcess.failureReason(startedAt + 20_000), 'startup-ended')

const validHandoff = new LaunchStartupTracker(startedAt, 'steam')
validHandoff.noteCandidateSeen()
validHandoff.noteCandidateMissing(startedAt + 2_000)
validHandoff.noteCandidateSeen()
assert.equal(
  validHandoff.failureReason(startedAt + 10_000, startedAt + 9_800),
  undefined
)
validHandoff.noteCandidateStabilized()
assert.equal(validHandoff.failureReason(startedAt + 10_500), undefined)

const flappingReplacement = new LaunchStartupTracker(startedAt, 'local')
flappingReplacement.noteCandidateSeen()
flappingReplacement.noteCandidateMissing(startedAt + 1_000)
assert.equal(
  flappingReplacement.failureReason(startedAt + 20_400, startedAt + 19_900),
  undefined
)
assert.equal(
  flappingReplacement.failureReason(startedAt + 20_551, startedAt + 19_900),
  'startup-ended'
)

const slowStoreHandoff = new LaunchStartupTracker(startedAt, 'xbox')
slowStoreHandoff.noteCandidateSeen()
slowStoreHandoff.noteCandidateMissing(startedAt + 2_000)
assert.equal(slowStoreHandoff.failureReason(startedAt + 16_999), undefined)
assert.equal(slowStoreHandoff.failureReason(startedAt + 74_999), undefined)
assert.equal(slowStoreHandoff.failureReason(startedAt + 75_000), 'startup-ended')

const restartLoop = new LaunchStartupTracker(startedAt, 'local')
restartLoop.noteCandidateSeen()
assert.equal(restartLoop.absoluteFailureReason(startedAt + 32_999), undefined)
assert.equal(restartLoop.absoluteFailureReason(startedAt + 33_000), 'startup-ended')

console.log('Game launch detection policy verified.')
