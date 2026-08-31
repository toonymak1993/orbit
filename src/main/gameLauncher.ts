import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { win32 as path } from 'node:path'
import { shell } from 'electron'
import type { LibraryGame } from '@shared/ipc'
import { retroLaunchArguments } from '@shared/retroSystems'
import { prepareRetroFullscreen } from './retro/retroLaunchPreparation'
import { playStationRemotePlayService } from './playstation/remotePlay'
import { getSteamAppsDirectories, getSteamInstallPath } from './steam/steamInstall'
import {
  steamDirectInstallArguments,
  waitForSteamInstallStart
} from './steam/steamInstallRequest'

export interface GameLaunchReceipt {
  /** Present only when ORBIT spawned the configured game executable itself. */
  spawnedGamePid?: number
  /** Config-driven emulators use this to verify fullscreen and fall back to Alt+Enter. */
  ensureFullscreenWithHotkey?: boolean
}

function epicGameId(value: string): string {
  const id = value.trim()
  if (!id || id.length > 512 || !/^[a-z0-9_.-]+$/i.test(id)) {
    throw new Error('Invalid Epic game identifier')
  }
  return id
}

function providerId(value: string, provider: string): string {
  const id = value.trim()
  if (!id || id.length > 512 || !/^[a-z0-9_.:-]+$/i.test(id)) {
    throw new Error(`Invalid ${provider} game identifier`)
  }
  return id
}

function xboxApplicationId(value: string): string {
  const id = value.trim()
  if (!id || id.length > 512 || !/^[a-z0-9_.-]+![a-z0-9_.-]+$/i.test(id)) {
    throw new Error('Invalid Xbox application identifier')
  }
  return id
}

function xboxProductId(value: string): string {
  const id = value.trim().toUpperCase()
  if (!/^[A-Z0-9]{12}$/.test(id)) throw new Error('Invalid Xbox product identifier')
  return id
}

function installedXboxApplicationId(game: LibraryGame): string | undefined {
  const prefix = 'shell:AppsFolder\\'
  const launchUri = game.metadata.launchUri?.trim()
  if (launchUri?.startsWith(prefix)) return xboxApplicationId(launchUri.slice(prefix.length))
  if (game.providerGameId.includes('!')) return xboxApplicationId(game.providerGameId)
  return undefined
}

function launchWindowsApplication(applicationId: string): Promise<number> {
  return launchDetached('explorer.exe', [`shell:AppsFolder\\${applicationId}`], undefined, true)
}

function launchDetached(
  executable: string,
  args: readonly string[],
  cwd?: string,
  hideLauncherWindow = false
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      detached: true,
      shell: false,
      stdio: 'ignore',
      // Direct game launches must remain visible. Only known helper/launcher
      // processes opt in to a hidden window at their call site.
      windowsHide: hideLauncherWindow
    })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve(child.pid ?? 0)
    })
  })
}

function providerLaunchArguments(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 128) {
    throw new Error('Invalid provider launch arguments')
  }
  let totalLength = 0
  const result: string[] = []
  for (const argument of value) {
    if (
      typeof argument !== 'string' ||
      argument.length > 2_048 ||
      /[\u0000-\u001f\u007f-\u009f]/.test(argument)
    ) {
      throw new Error('Invalid provider launch arguments')
    }
    totalLength += argument.length + 1
    if (totalLength > 4_096) throw new Error('Invalid provider launch arguments')
    result.push(argument)
  }
  return result
}

function installedProviderExecutable(game: LibraryGame): { executable: string; cwd: string } {
  const installDir = game.installDir?.trim()
  const executable = game.metadata.launchExecutable?.trim()
  if (!installDir || !path.isAbsolute(installDir) || !existsSync(installDir)) {
    throw new Error('The game installation is no longer available')
  }
  if (!executable || !path.isAbsolute(executable) || !executable.toLowerCase().endsWith('.exe')) {
    throw new Error('The provider game executable is invalid')
  }
  const relativePath = path.relative(path.resolve(installDir), path.resolve(executable))
  if (
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath) ||
    !existsSync(executable)
  ) {
    throw new Error('The provider game executable is no longer available')
  }
  return { executable, cwd: path.dirname(executable) }
}

function steamExecutable(game: LibraryGame): string | undefined {
  const candidates: string[] = []
  const installDir = game.installDir?.trim()
  if (installDir) {
    const normalized = installDir.replace(/\//g, '\\')
    const marker = '\\steamapps\\common\\'
    const markerIndex = normalized.toLowerCase().indexOf(marker)
    if (markerIndex > 0) candidates.push(path.join(normalized.slice(0, markerIndex), 'steam.exe'))
  }

  const steamPath = getSteamInstallPath()
  if (steamPath) candidates.push(path.join(steamPath, 'steam.exe'))

  const programFilesX86 = process.env['ProgramFiles(x86)']
  const programFiles = process.env.ProgramFiles
  if (programFilesX86) candidates.push(path.join(programFilesX86, 'Steam', 'steam.exe'))
  if (programFiles) candidates.push(path.join(programFiles, 'Steam', 'steam.exe'))
  candidates.push('C:\\Program Files (x86)\\Steam\\steam.exe')

  return candidates.find((candidate, index) => candidates.indexOf(candidate) === index && existsSync(candidate))
}

async function installSteamGame(game: LibraryGame): Promise<void> {
  const appId = game.appId
  if (!appId) throw new Error('Invalid Steam app identifier')

  const fallbackUrl = `steam://install/${appId}`
  const executable = steamExecutable(game)
  if (!executable) {
    await shell.openExternal(fallbackUrl)
    return
  }

  try {
    const steamAppsDirectories = getSteamAppsDirectories()
    await launchDetached(
      executable,
      steamDirectInstallArguments(appId),
      path.dirname(executable),
      true
    )
    if (await waitForSteamInstallStart(appId, steamAppsDirectories)) return
  } catch {
    // Steam's direct console command is intentionally best-effort. The public
    // protocol remains the reliable fallback when the client rejects it.
  }

  await shell.openExternal(fallbackUrl)
}

/** Delegates launch/install actions to the owning local store client. */
export async function launchGame(game: LibraryGame): Promise<GameLaunchReceipt> {
  if (game.provider === 'local' && game.installed) {
    const executable = game.local?.executablePath?.trim()
    if (!executable || !executable.toLocaleLowerCase('en-US').endsWith('.exe') || !existsSync(executable)) {
      throw new Error('The custom game executable is no longer available')
    }
    const installDir = game.installDir?.trim()
    const cwd = installDir && existsSync(installDir) ? installDir : path.dirname(executable)
    const spawnedGamePid = await launchDetached(executable, game.local?.launchArguments ?? [], cwd)
    return spawnedGamePid > 0 ? { spawnedGamePid } : {}
  }

  if (game.provider === 'steam' && game.appId) {
    if (game.installed) {
      const executable = steamExecutable(game)
      if (executable) {
        await launchDetached(executable, ['-silent', '-applaunch', String(game.appId)], undefined, true)
        return {}
      }
    } else {
      await installSteamGame(game)
      return {}
    }
    await shell.openExternal(`steam://rungameid/${game.appId}`)
    return {}
  }

  if (game.provider === 'epic') {
    const id = epicGameId(game.providerGameId)
    const action = game.installed ? 'launch&silent=true' : 'install'
    await shell.openExternal(`com.epicgames.launcher://apps/${id}?action=${action}`)
    return {}
  }

  if (game.provider === 'xbox') {
    if (game.installed) {
      const applicationId = installedXboxApplicationId(game)
      if (applicationId) {
        await launchWindowsApplication(applicationId)
        return {}
      }
    }

    // Xbox-app product links show the install action and handle Game Pass,
    // Microsoft Store, EA and Ubisoft hand-offs themselves.
    const productId = xboxProductId(game.providerGameId)
    await shell.openExternal(`msxbox://game/?productId=${productId}`)
    return {}
  }

  if (game.provider === 'gog' && game.installed) {
    const { executable, cwd } = installedProviderExecutable(game)
    const spawnedGamePid = await launchDetached(
      executable,
      providerLaunchArguments(game.metadata.launchArguments ?? []),
      cwd
    )
    return spawnedGamePid > 0 ? { spawnedGamePid } : {}
  }

  if (game.provider === 'retro' && game.installed) {
    const retro = game.retro
    const executable = retro?.emulatorPath?.trim()
    const romPath = retro?.romPath?.trim()
    if (!retro || !executable || !executable.toLocaleLowerCase('en-US').endsWith('.exe')) {
      throw new Error('No compatible emulator is available for this ROM')
    }
    if (!existsSync(executable)) throw new Error('The assigned emulator is no longer available')
    if (!romPath || !existsSync(romPath)) throw new Error('The ROM file is no longer available')
    if (retro.corePath && !existsSync(retro.corePath)) {
      throw new Error('The assigned RetroArch core is no longer available')
    }
    const ensureFullscreenWithHotkey = await prepareRetroFullscreen(retro)
    const spawnedGamePid = await launchDetached(
      executable,
      retroLaunchArguments(retro),
      path.dirname(executable)
    )
    return spawnedGamePid > 0 ? { spawnedGamePid, ensureFullscreenWithHotkey } : {}
  }

  if (game.provider === 'playstation') {
    const spawnedGamePid = await playStationRemotePlayService.launch()
    return spawnedGamePid && spawnedGamePid > 0 ? { spawnedGamePid } : {}
  }

  if (game.provider === 'ea' && game.installed) {
    const id = providerId(game.providerGameId, 'EA')
    await shell.openExternal(`origin2://game/launch?offerIds=${encodeURIComponent(id)}`)
    return {}
  }

  if (game.provider === 'ubisoft') {
    const id = providerId(game.providerGameId, 'Ubisoft')
    const action = game.installed ? `launch/${encodeURIComponent(id)}/0` : `install/${encodeURIComponent(id)}`
    await shell.openExternal(`uplay://${action}`)
    return {}
  }

  throw new Error('Game provider is not launchable')
}
