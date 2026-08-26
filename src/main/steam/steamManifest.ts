import { getVdfValue, parseVdf, vdfObject, vdfString } from './vdf'

function finiteNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

export interface SteamAppManifest {
  appId?: number
  name?: string
  installDirName?: string
  stateFlags?: number
  updateResult?: number
  bytesToDownload?: number
  bytesDownloaded?: number
  bytesToStage?: number
  bytesStaged?: number
}

/** Parses only the path-free fields ORBIT needs from Steam's AppState manifest. */
export function parseSteamAppManifest(source: string): SteamAppManifest {
  const parsed = parseVdf(source)
  const manifest = vdfObject(getVdfValue(parsed, 'AppState')) ?? parsed
  const userConfig = vdfObject(getVdfValue(manifest, 'UserConfig'))
  const appId = finiteNumber(vdfString(getVdfValue(manifest, 'appid')))
  const stateFlags = finiteNumber(vdfString(getVdfValue(manifest, 'StateFlags')))
  const updateResult = finiteNumber(vdfString(getVdfValue(manifest, 'UpdateResult')))
  const name =
    vdfString(getVdfValue(manifest, 'name')) ?? vdfString(getVdfValue(userConfig, 'name'))

  return {
    appId: appId && Number.isSafeInteger(appId) ? appId : undefined,
    name: name?.trim() || undefined,
    installDirName: vdfString(getVdfValue(manifest, 'installdir'))?.trim() || undefined,
    stateFlags:
      stateFlags !== undefined && Number.isSafeInteger(stateFlags) ? stateFlags : undefined,
    updateResult:
      updateResult !== undefined && Number.isSafeInteger(updateResult) ? updateResult : undefined,
    bytesToDownload: finiteNumber(vdfString(getVdfValue(manifest, 'BytesToDownload'))),
    bytesDownloaded: finiteNumber(vdfString(getVdfValue(manifest, 'BytesDownloaded'))),
    bytesToStage: finiteNumber(vdfString(getVdfValue(manifest, 'BytesToStage'))),
    bytesStaged: finiteNumber(vdfString(getVdfValue(manifest, 'BytesStaged')))
  }
}
