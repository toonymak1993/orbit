import { app } from 'electron'
import { readFileSync } from 'fs'
import { join } from 'path'

export interface ReleaseManifest {
  displayVersion: string
  packageVersion: string
  channel: 'stable' | 'beta'
  updateMode: 'manual-package' | 'github-release'
  automaticUpdatesEnabled: boolean
  updates: {
    owner: string
    repository: string
    startupDelaySeconds: number
    checkIntervalHours: number
    autoDownload: boolean
    signerThumbprints: string[]
  }
}

const fallbackManifest: ReleaseManifest = {
  displayVersion: '0.1.0',
  packageVersion: '0.1.0',
  channel: 'stable',
  updateMode: 'manual-package',
  automaticUpdatesEnabled: false,
  updates: {
    owner: 'toonymak1993',
    repository: 'orbit',
    startupDelaySeconds: 12,
    checkIntervalHours: 6,
    autoDownload: true,
    signerThumbprints: []
  }
}

let cachedManifest: ReleaseManifest | null = null

export function getReleaseManifest(): ReleaseManifest {
  if (cachedManifest) return cachedManifest

  const manifestPath = app.isPackaged
    ? join(process.resourcesPath, 'release-manifest.json')
    : join(app.getAppPath(), 'resources', 'release-manifest.json')

  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as Partial<ReleaseManifest>
    const updates = parsed.updates
    cachedManifest = {
      displayVersion: parsed.displayVersion || fallbackManifest.displayVersion,
      packageVersion: parsed.packageVersion || app.getVersion(),
      channel: parsed.channel === 'beta' ? 'beta' : 'stable',
      updateMode: parsed.updateMode === 'github-release' ? 'github-release' : 'manual-package',
      automaticUpdatesEnabled: parsed.automaticUpdatesEnabled === true,
      updates: {
        owner:
          typeof updates?.owner === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(updates.owner)
            ? updates.owner
            : fallbackManifest.updates.owner,
        repository:
          typeof updates?.repository === 'string' && /^[a-zA-Z0-9._-]{1,100}$/.test(updates.repository)
            ? updates.repository
            : fallbackManifest.updates.repository,
        startupDelaySeconds:
          typeof updates?.startupDelaySeconds === 'number' &&
          updates.startupDelaySeconds >= 5 &&
          updates.startupDelaySeconds <= 120
            ? updates.startupDelaySeconds
            : fallbackManifest.updates.startupDelaySeconds,
        checkIntervalHours:
          typeof updates?.checkIntervalHours === 'number' &&
          updates.checkIntervalHours >= 1 &&
          updates.checkIntervalHours <= 48
            ? updates.checkIntervalHours
            : fallbackManifest.updates.checkIntervalHours,
        autoDownload: updates?.autoDownload !== false,
        signerThumbprints: Array.isArray(updates?.signerThumbprints)
          ? updates.signerThumbprints
              .filter(
                (thumbprint): thumbprint is string =>
                  typeof thumbprint === 'string' && /^[a-fA-F0-9]{40,64}$/.test(thumbprint)
              )
              .map((thumbprint) => thumbprint.toUpperCase())
              .slice(0, 4)
          : []
      }
    }
  } catch {
    cachedManifest = {
      ...fallbackManifest,
      displayVersion: app.getVersion() || fallbackManifest.displayVersion,
      packageVersion: app.getVersion() || fallbackManifest.packageVersion
    }
  }

  return cachedManifest
}

export function getDisplayVersion(): string {
  return getReleaseManifest().displayVersion
}
