import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { GameMetadata } from '@shared/ipc'

const UBISOFT_ASSET_BASE = 'https://ubistatic3-a.akamaihd.net/orbit/uplay_launcher_3_0/assets/'
const MAX_CACHE_BYTES = 16 * 1024 * 1024

export interface UbisoftCatalogGame {
  providerGameId: string
  name: string
  metadata: GameMetadata
}

export interface UbisoftCatalogSnapshot {
  available: boolean
  complete: boolean
  games: Map<string, UbisoftCatalogGame>
}

interface ProtobufCursor {
  offset: number
}

interface UbisoftCacheEntry {
  uplayId?: number
  gameInfo?: string
}

function readVarint(buffer: Buffer, cursor: ProtobufCursor): number {
  let value = 0
  let multiplier = 1
  for (let index = 0; index < 10; index++) {
    if (cursor.offset >= buffer.length) throw new Error('Truncated Ubisoft cache varint')
    const byte = buffer[cursor.offset++]
    value += (byte & 0x7f) * multiplier
    if ((byte & 0x80) === 0) {
      if (!Number.isSafeInteger(value)) throw new Error('Invalid Ubisoft cache varint')
      return value
    }
    multiplier *= 128
  }
  throw new Error('Oversized Ubisoft cache varint')
}

function readBytes(buffer: Buffer, cursor: ProtobufCursor): Buffer {
  const length = readVarint(buffer, cursor)
  const end = cursor.offset + length
  if (length < 0 || end > buffer.length) throw new Error('Truncated Ubisoft cache field')
  const value = buffer.subarray(cursor.offset, end)
  cursor.offset = end
  return value
}

function skipField(buffer: Buffer, cursor: ProtobufCursor, wireType: number): void {
  if (wireType === 0) {
    readVarint(buffer, cursor)
    return
  }
  if (wireType === 1) {
    cursor.offset += 8
  } else if (wireType === 2) {
    readBytes(buffer, cursor)
    return
  } else if (wireType === 5) {
    cursor.offset += 4
  } else {
    throw new Error('Unsupported Ubisoft cache field')
  }
  if (cursor.offset > buffer.length) throw new Error('Truncated Ubisoft cache field')
}

function parseCacheEntry(buffer: Buffer): UbisoftCacheEntry {
  const cursor = { offset: 0 }
  const entry: UbisoftCacheEntry = {}
  while (cursor.offset < buffer.length) {
    const tag = readVarint(buffer, cursor)
    const field = Math.floor(tag / 8)
    const wireType = tag & 7
    if (field === 1 && wireType === 0) entry.uplayId = readVarint(buffer, cursor)
    else if (field === 3 && wireType === 2) entry.gameInfo = readBytes(buffer, cursor).toString('utf8')
    else skipField(buffer, cursor, wireType)
  }
  return entry
}

function parseCacheEntries(buffer: Buffer): { entries: UbisoftCacheEntry[]; complete: boolean } {
  const cursor = { offset: 0 }
  const entries: UbisoftCacheEntry[] = []
  let complete = true
  while (cursor.offset < buffer.length) {
    try {
      const tag = readVarint(buffer, cursor)
      const field = Math.floor(tag / 8)
      const wireType = tag & 7
      if (field === 1 && wireType === 2) entries.push(parseCacheEntry(readBytes(buffer, cursor)))
      else skipField(buffer, cursor, wireType)
    } catch {
      complete = false
      break
    }
  }
  return { entries, complete }
}

function decodeYamlScalar(rawValue: string): string | undefined {
  const value = rawValue.trim()
  if (!value || value === "''" || value === '""' || value === '~' || value === 'null') {
    return undefined
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      const decoded = JSON.parse(value)
      return typeof decoded === 'string' ? decoded.trim() || undefined : undefined
    } catch {
      return value.slice(1, -1).trim() || undefined
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'").trim() || undefined
  }
  return value.replace(/\s+#.*$/, '').trim() || undefined
}

function rootValue(yaml: string, key: string): string | undefined {
  const match = new RegExp(`^ {2}${key}:\\s*(.+?)\\s*$`, 'm').exec(yaml)
  return match ? decodeYamlScalar(match[1]) : undefined
}

function rootHasNestedValue(yaml: string, key: string): boolean {
  const lines = yaml.replace(/\r\n/g, '\n').split('\n')
  const start = lines.findIndex((line) => new RegExp(`^ {2}${key}:\\s*$`).test(line))
  if (start < 0) return false
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index]
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    const indent = line.length - line.trimStart().length
    if (indent <= 2) return false
    return true
  }
  return false
}

function localizedValue(yaml: string, value: string | undefined): string | undefined {
  if (!value) return undefined
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`^ {4}${escaped}:\\s*(.+?)\\s*$`, 'm').exec(yaml)
  return match ? decodeYamlScalar(match[1]) ?? value : value
}

function assetUrl(value: string | undefined): string | undefined {
  if (!value || !/^[a-z0-9_.-]+$/i.test(value)) return undefined
  return `${UBISOFT_ASSET_BASE}${value}`
}

function yes(value: string | undefined): boolean {
  return value === 'yes' || value === 'true' || value === '1'
}

function addonIds(yaml: string): number[] {
  const ids: number[] = []
  const rootAddons = /^ {2}addons:\s*$/m.exec(yaml)
  if (!rootAddons) return ids
  const tail = yaml.slice(rootAddons.index + rootAddons[0].length).replace(/^\r?\n/, '')
  for (const line of tail.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    const indent = line.length - line.trimStart().length
    if (indent <= 2) break
    const match = /^ {4}-\s+id:\s*(\d+)\s*$/.exec(line)
    if (match) ids.push(Number(match[1]))
  }
  return ids
}

function parseGame(entry: UbisoftCacheEntry): UbisoftCatalogGame | undefined {
  const id = entry.uplayId
  const yaml = entry.gameInfo
  if (!Number.isInteger(id) || !id || id < 1 || !yaml) return undefined
  if (yes(rootValue(yaml, 'is_ulc')) || rootHasNestedValue(yaml, 'third_party_platform')) {
    return undefined
  }
  if (!/^ {2}start_game:\s*$/m.test(yaml)) return undefined

  const rawName = localizedValue(yaml, rootValue(yaml, 'name'))
  const name = rawName?.replace(/[™®©]/g, '').trim()
  if (!name || /^GAMENAME$/i.test(name)) return undefined

  const background = assetUrl(localizedValue(yaml, rootValue(yaml, 'background_image')))
  const cover = assetUrl(localizedValue(yaml, rootValue(yaml, 'thumb_image')))
  const icon = assetUrl(localizedValue(yaml, rootValue(yaml, 'icon_image')))
  return {
    providerGameId: String(id),
    name,
    metadata: {
      platforms: ['windows'],
      launchUri: `uplay://launch/${id}/0`,
      backgroundUrl: background,
      iconUrl: icon,
      artwork: {
        vertical: cover ? [cover] : undefined,
        horizontal: background ? [background] : undefined,
        icon: icon ? [icon] : undefined
      }
    }
  }
}

/** Parses Ubisoft Connect's local protobuf envelope without loading credentials or web data. */
export function parseUbisoftCatalogBuffer(buffer: Buffer): UbisoftCatalogSnapshot {
  if (buffer.length === 0 || buffer.length > MAX_CACHE_BYTES) {
    return { available: true, complete: false, games: new Map() }
  }
  const parsed = parseCacheEntries(buffer)
  const dlcIds = new Set<number>()
  for (const entry of parsed.entries) {
    if (entry.gameInfo) for (const id of addonIds(entry.gameInfo)) dlcIds.add(id)
  }

  const games = new Map<string, UbisoftCatalogGame>()
  for (const entry of parsed.entries) {
    if (entry.uplayId && dlcIds.has(entry.uplayId)) continue
    const game = parseGame(entry)
    if (game) games.set(game.providerGameId, game)
  }
  return { available: true, complete: parsed.complete, games }
}

export async function scanUbisoftCatalog(): Promise<UbisoftCatalogSnapshot> {
  const localAppData = process.env.LOCALAPPDATA
  if (process.platform !== 'win32' || !localAppData) {
    return { available: false, complete: false, games: new Map() }
  }
  const cachePath = join(
    localAppData,
    'Ubisoft Game Launcher',
    'cache',
    'configuration',
    'configurations'
  )
  try {
    const buffer = await readFile(cachePath)
    return parseUbisoftCatalogBuffer(buffer)
  } catch {
    return { available: false, complete: false, games: new Map() }
  }
}
