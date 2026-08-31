import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { RetroGameConfig } from '@shared/ipc'

function escapedRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function preferredNewline(content: string): '\r\n' | '\n' {
  return content.includes('\r\n') ? '\r\n' : '\n'
}

export function upsertIniSetting(
  content: string,
  section: string,
  key: string,
  value: string
): string {
  const newline = preferredNewline(content)
  const lines = content.split(/\r?\n/u)
  const sectionPattern = new RegExp(`^\\s*\\[${escapedRegExp(section)}\\]\\s*$`, 'iu')
  const keyPattern = new RegExp(`^\\s*${escapedRegExp(key)}\\s*=`, 'iu')
  let sectionIndex = lines.findIndex((line) => sectionPattern.test(line))

  if (sectionIndex < 0) {
    if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('')
    sectionIndex = lines.length
    lines.push(`[${section}]`, `${key}=${value}`)
    return lines.join(newline)
  }

  let sectionEnd = lines.length
  for (let index = sectionIndex + 1; index < lines.length; index++) {
    if (/^\s*\[[^\]]+\]\s*$/u.test(lines[index])) {
      sectionEnd = index
      break
    }
  }
  const settingIndex = lines.findIndex(
    (line, index) => index > sectionIndex && index < sectionEnd && keyPattern.test(line)
  )
  if (settingIndex >= 0) lines[settingIndex] = `${key}=${value}`
  else lines.splice(sectionIndex + 1, 0, `${key}=${value}`)
  return lines.join(newline)
}

export function upsertFlatSetting(content: string, key: string, value: string): string {
  const newline = preferredNewline(content)
  const lines = content.split(/\r?\n/u)
  const keyPattern = new RegExp(`^\\s*${escapedRegExp(key)}\\s*=`, 'iu')
  const settingIndex = lines.findIndex((line) => keyPattern.test(line))
  if (settingIndex >= 0) lines[settingIndex] = `${key} = ${value}`
  else {
    if (lines.length === 1 && lines[0] === '') lines.length = 0
    lines.push(`${key} = ${value}`)
  }
  return lines.join(newline)
}

async function updateTextFile(filePath: string, update: (content: string) => string): Promise<void> {
  let content = ''
  try {
    content = await readFile(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const updated = update(content)
  if (updated !== content) await writeFile(filePath, updated, 'utf8')
}

/**
 * Enforces the persistent fullscreen preference for emulators without a
 * reliable command-line flag. The boolean asks the session handoff to verify
 * the real window bounds and press Alt+Enter only when the emulator still
 * opened windowed (some Project64 versions ignore the preference on startup).
 */
export async function prepareRetroFullscreen(game: RetroGameConfig): Promise<boolean> {
  const executable = game.emulatorPath?.trim()
  if (!executable) return false
  const verifyWithHotkey = game.emulatorId === 'project64' || game.emulatorId === 'snes9x'

  try {
    if (game.emulatorId === 'project64') {
      const configPath = join(dirname(executable), 'Config', 'Project64.cfg')
      await updateTextFile(configPath, (content) =>
        upsertIniSetting(content, 'Settings', 'Auto Full Screen', '1')
      )
    } else if (game.emulatorId === 'snes9x') {
      const configPath = join(dirname(executable), 'snes9x.conf')
      await updateTextFile(configPath, (content) => {
        const fullscreenOnOpen = upsertFlatSetting(
          content,
          'Fullscreen:FullscreenOnOpen',
          'TRUE'
        )
        return upsertFlatSetting(
          fullscreenOnOpen,
          'Fullscreen:EmulateFullscreen',
          'TRUE'
        )
      })
    }
    return verifyWithHotkey
  } catch {
    // Project64 and Snes9x lock their config while running. The session manager
    // falls back to their shared Alt+Enter fullscreen shortcut after the game
    // window becomes visible, instead of rejecting an otherwise valid launch.
    return verifyWithHotkey
  }
}
