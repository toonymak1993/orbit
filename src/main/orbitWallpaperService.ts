import { execFile } from 'node:child_process'
import { copyFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import type { OrbitWallpaperApplyResult, OrbitWallpaperApplyState } from '@shared/ipc'

const WALLPAPER_FILE_NAME = 'orbit-horizon.png'
const WALLPAPER_SCRIPT_NAME = 'Set-OrbitWallpaper.ps1'
const RESULT_MARKER = 'ORBIT_WALLPAPER_RESULT:'
const APPLY_STATES = new Set<OrbitWallpaperApplyState>([
  'applied',
  'failed',
  'unsupported'
])
const execFileAsync = promisify(execFile)

let applyInFlight: Promise<OrbitWallpaperApplyResult> | null = null

function wallpaperResourcePath(fileName: string): string {
  const root = app.isPackaged ? process.resourcesPath : app.getAppPath()
  return app.isPackaged
    ? join(root, 'wallpapers', fileName)
    : join(root, 'resources', 'wallpapers', fileName)
}

function normalizedApplyState(value: unknown): OrbitWallpaperApplyState {
  return APPLY_STATES.has(value as OrbitWallpaperApplyState)
    ? (value as OrbitWallpaperApplyState)
    : 'failed'
}

function failureResult(): OrbitWallpaperApplyResult {
  return {
    platform: process.platform === 'win32' ? 'windows' : 'unsupported',
    desktop: process.platform === 'win32' ? 'failed' : 'unsupported',
    lockScreen: process.platform === 'win32' ? 'failed' : 'unsupported',
    appliedAt: Date.now()
  }
}

function parseApplyResult(stdout: string): OrbitWallpaperApplyResult {
  const markerIndex = stdout.lastIndexOf(RESULT_MARKER)
  if (markerIndex < 0) return failureResult()

  try {
    const payload = JSON.parse(stdout.slice(markerIndex + RESULT_MARKER.length).trim()) as {
      desktop?: unknown
      lockScreen?: unknown
    }
    return {
      platform: 'windows',
      desktop: normalizedApplyState(payload.desktop),
      lockScreen: normalizedApplyState(payload.lockScreen),
      appliedAt: Date.now()
    }
  } catch {
    return failureResult()
  }
}

async function applyOrbitWallpaperNow(): Promise<OrbitWallpaperApplyResult> {
  if (process.platform !== 'win32') return failureResult()

  try {
    const wallpaperDirectory = join(app.getPath('userData'), 'wallpapers')
    const installedWallpaperPath = join(wallpaperDirectory, WALLPAPER_FILE_NAME)
    await mkdir(wallpaperDirectory, { recursive: true })
    await copyFile(wallpaperResourcePath(WALLPAPER_FILE_NAME), installedWallpaperPath)

    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        wallpaperResourcePath(WALLPAPER_SCRIPT_NAME),
        '-ImagePath',
        installedWallpaperPath
      ],
      {
        windowsHide: true,
        timeout: 20_000,
        maxBuffer: 128 * 1024
      }
    )
    return parseApplyResult(stdout)
  } catch {
    return failureResult()
  }
}

export function applyOrbitWallpaper(): Promise<OrbitWallpaperApplyResult> {
  if (applyInFlight) return applyInFlight
  applyInFlight = applyOrbitWallpaperNow().finally(() => {
    applyInFlight = null
  })
  return applyInFlight
}
