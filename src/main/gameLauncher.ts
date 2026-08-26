import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { win32 as path } from 'node:path'
import { shell } from 'electron'
import type { LibraryGame } from '@shared/ipc'

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

function launchWindowsApplication(applicationId: string): Promise<void> {
  return launchDetached('explorer.exe', [`shell:AppsFolder\\${applicationId}`])
}

function launchDetached(executable: string, args: readonly string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      detached: true,
      shell: false,
      stdio: 'ignore',
      windowsHide: true
    })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
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

  const programFilesX86 = process.env['ProgramFiles(x86)']
  const programFiles = process.env.ProgramFiles
  if (programFilesX86) candidates.push(path.join(programFilesX86, 'Steam', 'steam.exe'))
  if (programFiles) candidates.push(path.join(programFiles, 'Steam', 'steam.exe'))
  candidates.push('C:\\Program Files (x86)\\Steam\\steam.exe')

  return candidates.find((candidate, index) => candidates.indexOf(candidate) === index && existsSync(candidate))
}

/** Delegates launch/install actions to the owning local store client. */
export async function launchGame(game: LibraryGame): Promise<void> {
  if (game.provider === 'local' && game.installed) {
    const executable = game.local?.executablePath?.trim()
    if (!executable || !executable.toLocaleLowerCase('en-US').endsWith('.exe') || !existsSync(executable)) {
      throw new Error('The custom game executable is no longer available')
    }
    const installDir = game.installDir?.trim()
    const cwd = installDir && existsSync(installDir) ? installDir : path.dirname(executable)
    await launchDetached(executable, game.local?.launchArguments ?? [], cwd)
    return
  }

  if (game.provider === 'steam' && game.appId) {
    if (game.installed) {
      const executable = steamExecutable(game)
      if (executable) {
        await launchDetached(executable, ['-silent', '-applaunch', String(game.appId)])
        return
      }
    }
    await shell.openExternal(game.installed ? `steam://rungameid/${game.appId}` : `steam://install/${game.appId}`)
    return
  }

  if (game.provider === 'epic') {
    const id = epicGameId(game.providerGameId)
    const action = game.installed ? 'launch&silent=true' : 'install'
    await shell.openExternal(`com.epicgames.launcher://apps/${id}?action=${action}`)
    return
  }

  if (game.provider === 'xbox') {
    if (game.installed) {
      const applicationId = installedXboxApplicationId(game)
      if (applicationId) {
        await launchWindowsApplication(applicationId)
        return
      }
    }

    // Xbox-app product links show the install action and handle Game Pass,
    // Microsoft Store, EA and Ubisoft hand-offs themselves.
    const productId = xboxProductId(game.providerGameId)
    await shell.openExternal(`msxbox://game/?productId=${productId}`)
    return
  }

  if (game.provider === 'ea' && game.installed) {
    const id = providerId(game.providerGameId, 'EA')
    await shell.openExternal(`origin2://game/launch?offerIds=${encodeURIComponent(id)}`)
    return
  }

  if (game.provider === 'ubisoft' && game.installed) {
    const id = providerId(game.providerGameId, 'Ubisoft')
    await shell.openExternal(`uplay://launch/${encodeURIComponent(id)}/0`)
    return
  }

  throw new Error('Game provider is not launchable')
}
