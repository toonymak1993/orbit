import { app } from 'electron'
import { readFileSync } from 'fs'
import { join } from 'path'

interface ReleaseManifest {
  displayVersion: string
  packageVersion: string
}

const fallbackManifest: ReleaseManifest = {
  displayVersion: '0.0.0.3',
  packageVersion: '0.0.3'
}

let cachedManifest: ReleaseManifest | null = null

export function getReleaseManifest(): ReleaseManifest {
  if (cachedManifest) return cachedManifest

  const manifestPath = app.isPackaged
    ? join(process.resourcesPath, 'release-manifest.json')
    : join(app.getAppPath(), 'resources', 'release-manifest.json')

  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as Partial<ReleaseManifest>
    cachedManifest = {
      displayVersion: parsed.displayVersion || fallbackManifest.displayVersion,
      packageVersion: parsed.packageVersion || app.getVersion()
    }
  } catch {
    cachedManifest = {
      displayVersion: fallbackManifest.displayVersion,
      packageVersion: app.getVersion() || fallbackManifest.packageVersion
    }
  }

  return cachedManifest
}

export function getDisplayVersion(): string {
  return getReleaseManifest().displayVersion
}
