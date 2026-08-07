/**
 * Built-in fallback SteamGridDB key, used only when the user hasn't set their own
 * in Settings. Obfuscated (XOR + base64) so it isn't a plain grep-able string in
 * the repo — this is NOT real security. Electron ships readable JS, so anyone
 * with the built app can recover the key; treat it as "hidden", not "secret".
 */
const OBFUSCATION_KEY = 'orbit-launcher-2026'
const ENCODED_STEAMGRIDDB_KEY = 'VkQAWUJOWwRNXlYLV0NIVwQKVwlKW11BFVtQRFYAXAY='

function xor(text: string, key: string): string {
  let result = ''
  for (let i = 0; i < text.length; i++) {
    result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length))
  }
  return result
}

export function getBuiltinSteamGridDbKey(): string {
  return xor(Buffer.from(ENCODED_STEAMGRIDDB_KEY, 'base64').toString('binary'), OBFUSCATION_KEY)
}
