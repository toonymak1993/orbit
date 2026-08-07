import { app } from 'electron'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const IGNORED_EXE_PATTERN = /uninstall|unins|redist|vcredist|directx|dxsetup|crashpad|anticheat|battleye|easyanticheat|helper|launcher|installer|setup/i

/** Picks the most likely "main" executable in a game's install folder by size — the
 * real game binary is almost always the largest .exe, while helpers/uninstallers are tiny. */
function findMainExecutable(installDir: string): string | null {
  let candidates: { path: string; size: number }[] = []

  function walk(dir: string, depth: number): void {
    if (depth > 2) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry)
      let stat: ReturnType<typeof statSync>
      try {
        stat = statSync(fullPath)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        walk(fullPath, depth + 1)
      } else if (entry.toLowerCase().endsWith('.exe') && !IGNORED_EXE_PATTERN.test(entry)) {
        candidates.push({ path: fullPath, size: stat.size })
      }
    }
  }

  walk(installDir, 0)
  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.size - a.size)
  return candidates[0].path
}

export async function resolveLocalIconDataUrl(installDir: string): Promise<string | null> {
  const exePath = findMainExecutable(installDir)
  if (!exePath) return null

  try {
    const icon = await app.getFileIcon(exePath, { size: 'large' })
    if (icon.isEmpty()) return null
    return icon.toDataURL()
  } catch {
    return null
  }
}
