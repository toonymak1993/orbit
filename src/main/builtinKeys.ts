/**
 * Public desktop builds must not contain a shared SteamGridDB credential.
 * Users can provide their own key in Settings; the image pipeline keeps its
 * provider fallbacks when no key is configured.
 */
export function getBuiltinSteamGridDbKey(): string {
  return ''
}
