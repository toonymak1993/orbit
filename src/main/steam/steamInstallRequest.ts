import { existsSync } from 'node:fs'
import { join } from 'node:path'

const MAX_STEAM_APP_ID = 0xffff_ffff
const DEFAULT_START_TIMEOUT_MS = 8_000
const DEFAULT_POLL_INTERVAL_MS = 250

type PathExists = (path: string) => boolean
type Delay = (milliseconds: number) => Promise<void>

export interface SteamInstallProbeOptions {
  timeoutMs?: number
  pollIntervalMs?: number
  pathExists?: PathExists
  delay?: Delay
}

function validatedSteamAppId(appId: number): number {
  if (!Number.isSafeInteger(appId) || appId <= 0 || appId > MAX_STEAM_APP_ID) {
    throw new Error('Invalid Steam app identifier')
  }
  return appId
}

/** Uses Steam's client-console command to enqueue an owned app without its install dialog. */
export function steamDirectInstallArguments(appId: number): string[] {
  return ['-silent', '+app_install', String(validatedSteamAppId(appId))]
}

export function hasSteamInstallStarted(
  appId: number,
  steamAppsDirectories: readonly string[],
  pathExists: PathExists = existsSync
): boolean {
  const id = String(validatedSteamAppId(appId))
  return steamAppsDirectories.some(
    (directory) =>
      pathExists(join(directory, `appmanifest_${id}.acf`)) ||
      pathExists(join(directory, 'downloading', id))
  )
}

export async function waitForSteamInstallStart(
  appId: number,
  steamAppsDirectories: readonly string[],
  options: SteamInstallProbeOptions = {}
): Promise<boolean> {
  const timeoutMs = Math.max(0, options.timeoutMs ?? DEFAULT_START_TIMEOUT_MS)
  const pollIntervalMs = Math.max(1, options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS)
  const pathExists = options.pathExists ?? existsSync
  const delay = options.delay ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))

  if (hasSteamInstallStarted(appId, steamAppsDirectories, pathExists)) return true

  let elapsedMs = 0
  while (elapsedMs < timeoutMs) {
    const waitMs = Math.min(pollIntervalMs, timeoutMs - elapsedMs)
    await delay(waitMs)
    elapsedMs += waitMs
    if (hasSteamInstallStarted(appId, steamAppsDirectories, pathExists)) return true
  }
  return false
}
