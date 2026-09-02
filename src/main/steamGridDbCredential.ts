import { Buffer } from 'node:buffer'

const MAX_STEAM_GRID_DB_TOKEN_LENGTH = 4_096

export function normalizeSteamGridDbToken(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid SteamGridDB API token')
  const normalized = value.trim()
  if (
    !normalized ||
    normalized.length > MAX_STEAM_GRID_DB_TOKEN_LENGTH ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new Error('Invalid SteamGridDB API token')
  }
  return normalized
}

export interface SteamGridDbCredentialVaultDependencies {
  encryptionAvailable: () => boolean
  encrypt: (value: string) => string
  decrypt: (payload: string) => string
  readEncrypted: () => unknown
  writeEncrypted: (payload: string) => void
  clearEncrypted: () => void
  readLegacy: () => unknown
  clearLegacy: () => void
}

/**
 * Keeps the migration and fail-closed behavior independent from Electron so
 * the credential boundary can be verified without reading a user's real
 * Windows credential store.
 */
export class SteamGridDbCredentialVault {
  private readonly dependencies: SteamGridDbCredentialVaultDependencies

  constructor(dependencies: SteamGridDbCredentialVaultDependencies) {
    this.dependencies = dependencies
  }

  private encryptionAvailable(): boolean {
    try {
      return this.dependencies.encryptionAvailable()
    } catch {
      return false
    }
  }

  getToken(): string | undefined {
    const encryptionAvailable = this.encryptionAvailable()
    const encrypted = this.dependencies.readEncrypted()
    if (encryptionAvailable && typeof encrypted === 'string' && encrypted) {
      try {
        const token = normalizeSteamGridDbToken(this.dependencies.decrypt(encrypted))
        if (this.dependencies.readLegacy() !== undefined) this.dependencies.clearLegacy()
        return token
      } catch {
        this.dependencies.clearEncrypted()
      }
    }

    const legacy = this.dependencies.readLegacy()
    if (legacy === undefined) return undefined

    let token: string
    try {
      token = normalizeSteamGridDbToken(legacy)
    } catch {
      this.dependencies.clearLegacy()
      return undefined
    }

    // Keep the only usable legacy copy until Windows credential encryption is
    // available. The public settings snapshot never exposes this value.
    if (!encryptionAvailable) return undefined

    this.dependencies.writeEncrypted(this.dependencies.encrypt(token))
    this.dependencies.clearLegacy()
    return token
  }

  isConfigured(): boolean {
    return Boolean(this.getToken())
  }

  setToken(value: unknown): void {
    const token = normalizeSteamGridDbToken(value)
    if (!this.encryptionAvailable()) {
      throw new Error('Secure credential storage is unavailable')
    }
    this.dependencies.writeEncrypted(this.dependencies.encrypt(token))
    this.dependencies.clearLegacy()
  }

  clear(): void {
    this.dependencies.clearEncrypted()
    this.dependencies.clearLegacy()
  }
}

/**
 * SteamGridDB keys are commonly JWT-shaped. When the provider includes the
 * standard `exp` claim, expose only that timestamp to the renderer; malformed
 * and opaque keys intentionally return no inferred expiry.
 */
export function steamGridDbTokenExpiresAt(token: string): number | undefined {
  const parts = token.trim().split('.')
  if (parts.length !== 3 || !parts[1]) return undefined

  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as unknown
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      return undefined
    }
    const expiresAtSeconds = (payload as Record<string, unknown>).exp
    if (
      typeof expiresAtSeconds !== 'number' ||
      !Number.isFinite(expiresAtSeconds) ||
      expiresAtSeconds <= 0 ||
      expiresAtSeconds > Number.MAX_SAFE_INTEGER / 1_000
    ) {
      return undefined
    }
    return Math.trunc(expiresAtSeconds * 1_000)
  } catch {
    return undefined
  }
}
