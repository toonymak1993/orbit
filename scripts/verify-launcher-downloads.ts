import assert from 'node:assert/strict'
import {
  deriveEpicDownloadActivity,
  deriveSteamDownloadActivity,
  isSteamDownloadComplete,
  isSteamDownloadFailed,
  parseEpicDownloadSample,
  parseSteamDownloadSample
} from '../src/main/downloads/launcherDownloadParsers.ts'
import {
  clampLauncherProgress,
  orderedLauncherDownloads,
  shouldApplyLauncherDownloadSnapshot
} from '../src/shared/launcherDownloads.ts'
import type { LauncherDownloadActivity, LauncherDownloadSnapshot } from '../src/shared/ipc.ts'
import {
  parseXboxPackageProgressEvent,
  XboxPackageActivityMonitor
} from '../src/main/xbox/xboxPackageActivity.ts'

function steamManifest(fields: Record<string, string>): string {
  return `"AppState"
  {
    "appid" "${fields.appid ?? '10'}"
    "name" "${fields.name ?? 'Fixture Game'}"
    "StateFlags" "${fields.StateFlags ?? '4'}"
    "UpdateResult" "${fields.UpdateResult ?? '0'}"
    "BytesToDownload" "${fields.BytesToDownload ?? '1000'}"
    "BytesDownloaded" "${fields.BytesDownloaded ?? '0'}"
    "BytesToStage" "${fields.BytesToStage ?? '0'}"
    "BytesStaged" "${fields.BytesStaged ?? '0'}"
  }`
}

const idlePending = parseSteamDownloadSample(
  steamManifest({ StateFlags: '6', BytesDownloaded: '0' }),
  1_000
)
assert.ok(idlePending)
assert.equal(deriveSteamDownloadActivity(idlePending), null)

const firstDownload = parseSteamDownloadSample(
  steamManifest({ StateFlags: String(2 | 1_048_576), BytesDownloaded: '250' }),
  2_000
)
assert.ok(firstDownload)
const activeDownload = deriveSteamDownloadActivity(firstDownload)
assert.equal(activeDownload?.phase, 'downloading')
assert.equal(activeDownload?.progress, 0.25)

const resumedUpdate = parseSteamDownloadSample(
  steamManifest({ StateFlags: '6', BytesDownloaded: '500' }),
  3_000
)
assert.ok(resumedUpdate)
const progressedByDelta = deriveSteamDownloadActivity(resumedUpdate, firstDownload)
assert.equal(progressedByDelta?.phase, 'updating')
assert.equal(progressedByDelta?.bytesPerSecond, 250)
assert.equal(progressedByDelta?.etaSeconds, 2)

const paused = parseSteamDownloadSample(
  steamManifest({ StateFlags: String(2 | 4 | 512), BytesDownloaded: '500' }),
  4_000
)
assert.ok(paused)
assert.equal(deriveSteamDownloadActivity(paused, resumedUpdate)?.phase, 'paused')

const applying = parseSteamDownloadSample(
  steamManifest({
    StateFlags: String(2 | 4 | 2_097_152),
    BytesDownloaded: '1000',
    BytesToStage: '2000',
    BytesStaged: '500'
  }),
  5_000
)
assert.ok(applying)
assert.equal(deriveSteamDownloadActivity(applying, paused)?.phase, 'installing')
assert.equal(deriveSteamDownloadActivity(applying, paused)?.progress, 0.25)

const complete = parseSteamDownloadSample(
  steamManifest({ StateFlags: '4', BytesDownloaded: '1000' }),
  6_000
)
assert.ok(complete)
assert.equal(isSteamDownloadComplete(complete), true)
assert.equal(deriveSteamDownloadActivity(complete, applying), null)

const resetAfterComplete = parseSteamDownloadSample(
  steamManifest({
    StateFlags: '4',
    BytesToDownload: '0',
    BytesDownloaded: '0',
    BytesToStage: '0',
    BytesStaged: '0'
  }),
  7_000
)
assert.ok(resetAfterComplete)
assert.equal(isSteamDownloadComplete(resetAfterComplete), true)

const failed = parseSteamDownloadSample(
  steamManifest({ StateFlags: '6', UpdateResult: '6', BytesDownloaded: '500' }),
  8_000
)
assert.ok(failed)
assert.equal(isSteamDownloadFailed(failed), true)

const epic = parseEpicDownloadSample(
  JSON.stringify({
    AppName: 'epic-fixture',
    DisplayName: 'Epic Fixture',
    InstallLocation: 'C:\\Games\\Fixture',
    InstallSize: '5000',
    bIsIncompleteInstall: true
  }),
  10_000
)
assert.ok(epic)
assert.equal(deriveEpicDownloadActivity(epic, 19_000, 20_000)?.phase, 'downloading')
assert.equal(deriveEpicDownloadActivity(epic, 10_000, 50_000)?.phase, 'paused')
assert.equal(deriveEpicDownloadActivity(epic, 10_000, 1_000_000), null)
assert.equal(
  parseEpicDownloadSample(JSON.stringify({ AppName: 'done', bIsIncompleteInstall: false })),
  null
)

assert.equal(clampLauncherProgress(-2), 0)
assert.equal(clampLauncherProgress(2), 1)
assert.equal(clampLauncherProgress(Number.NaN), undefined)

const baseActivity: LauncherDownloadActivity = {
  id: 'steam:10',
  provider: 'steam',
  providerGameId: '10',
  title: 'Fixture',
  phase: 'completed',
  confidence: 'exact',
  updatedAt: 1
}
assert.deepEqual(
  orderedLauncherDownloads([
    baseActivity,
    { ...baseActivity, id: 'steam:20', providerGameId: '20', phase: 'downloading' }
  ]).map((activity) => activity.id),
  ['steam:20', 'steam:10']
)

const snapshot = (revision: number): LauncherDownloadSnapshot => ({
  revision,
  updatedAt: revision,
  activities: []
})
assert.equal(shouldApplyLauncherDownloadSnapshot(snapshot(4), snapshot(3)), false)
assert.equal(shouldApplyLauncherDownloadSnapshot(snapshot(4), snapshot(4)), false)
assert.equal(shouldApplyLauncherDownloadSnapshot(snapshot(4), snapshot(5)), true)

const xboxEvent = parseXboxPackageProgressEvent(
  JSON.stringify({
    type: 'package-progress',
    operation: 'install',
    activityId: '00112233-4455-6677-8899-aabbccddeeff',
    packageFamilyName: 'Fixture.Game_8wekyb3d8bbwe',
    progress: 0.42,
    isComplete: false,
    errorHResult: 0,
    isFramework: false,
    isResourcePackage: false,
    isOptional: false
  })
)
assert.equal(xboxEvent?.progress, 0.42)
assert.equal(
  parseXboxPackageProgressEvent(
    JSON.stringify({
      type: 'package-progress',
      operation: 'update',
      activityId: '10112233-4455-6677-8899-aabbccddeeff',
      packageFamilyName: '2K-Gearbox.Borderlands3_5c2m1mad6jpnr',
      progress: 0.2,
      isComplete: false,
      errorHResult: 0,
      isFramework: false,
      isResourcePackage: false,
      isOptional: false
    })
  )?.packageFamilyName,
  '2K-Gearbox.Borderlands3_5c2m1mad6jpnr'
)
assert.equal(
  parseXboxPackageProgressEvent(
    JSON.stringify({
      type: 'package-progress',
      operation: 'install',
      activityId: '00112233-4455-6677-8899-aabbccddeeff',
      packageFamilyName: 'Microsoft.Framework_8wekyb3d8bbwe',
      progress: 0.1,
      isComplete: false,
      errorHResult: 0,
      isFramework: true,
      isResourcePackage: false,
      isOptional: false
    })
  ),
  null
)

if (process.platform === 'win32') {
  const helper = new XboxPackageActivityMonitor()
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      helper.stop()
      reject(new Error('Xbox PackageCatalog helper did not become ready'))
    }, 5_000)
    helper.once('ready', () => {
      clearTimeout(timeout)
      helper.stop()
      resolve()
    })
    helper.start()
  })
}

console.log('Launcher download parser and selector checks passed')
