import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import koffi from 'koffi'

const EXPECTED_VERSION = '1.10.18687'
const EXPECTED_SHA256 = 'e2db188f962c6586feb65e6c31a5db435fe00c4bc196d4e29bb712be72d62bff'
const dllPath = resolve(
  process.cwd(),
  'resources',
  'discord-social-sdk',
  'win32-x64',
  'discord_partner_sdk.dll'
)

const bytes = readFileSync(dllPath)
const hash = createHash('sha256').update(bytes).digest('hex')
if (hash !== EXPECTED_SHA256) {
  throw new Error(`Discord Social SDK hash mismatch: ${hash}`)
}

const library = koffi.load(dllPath)
const handle = koffi.struct('Orbit_Discord_VerifyClient', { opaque: 'void *' })
const span = koffi.struct('Orbit_Discord_VerifyRelationshipSpan', {
  ptr: 'void *',
  size: 'size_t'
})
const init = library.func('Discord_Client_Init', 'void', [koffi.pointer(handle)])
const drop = library.func('Discord_Client_Drop', 'void', [koffi.pointer(handle)])
const getStatus = library.func('Discord_Client_GetStatus', 'int', [koffi.pointer(handle)])
const getRelationships = library.func('Discord_Client_GetRelationships', 'void', [
  koffi.pointer(handle),
  koffi.out(koffi.pointer(span))
])
// Resolve the DM inbox exports as part of the pinned runtime contract. The
// callback itself requires an authenticated Discord session.
library.func('Discord_Client_GetUserMessageSummaries', 'void', [
  koffi.pointer(handle),
  'void *',
  'void *',
  'void *'
])
const messageSummary = koffi.struct('Orbit_Discord_VerifyMessageSummary', {
  opaque: 'void *'
})
library.func('Discord_UserMessageSummary_UserId', 'uint64_t', [
  koffi.pointer(messageSummary)
])
library.func('Discord_UserMessageSummary_LastMessageId', 'uint64_t', [
  koffi.pointer(messageSummary)
])
library.func('Discord_UserMessageSummary_Drop', 'void', [koffi.pointer(messageSummary)])
const free = library.func('Discord_Free', 'void', ['void *'])
const major = library.func('Discord_Client_GetVersionMajor', 'int32_t', [])
const minor = library.func('Discord_Client_GetVersionMinor', 'int32_t', [])
const patch = library.func('Discord_Client_GetVersionPatch', 'int32_t', [])
const version = `${major()}.${minor()}.${patch()}`
if (version !== EXPECTED_VERSION) {
  throw new Error(`Unexpected Discord Social SDK version: ${version}`)
}

const client = koffi.alloc(handle, 1)
try {
  init(client)
  if (getStatus(client) !== 0) throw new Error('Fresh Discord client was not disconnected')
  const relationships: { ptr?: bigint; size?: number } = {}
  getRelationships(client, relationships)
  if ((relationships.size ?? 0) !== 0) {
    throw new Error('Unauthenticated Discord client unexpectedly returned relationships')
  }
  if (relationships.ptr) free(relationships.ptr)
} finally {
  drop(client)
}

console.log(
  `Discord Social SDK ${version} verified (${statSync(dllPath).size} bytes, Windows x64 friends runtime)`
)
