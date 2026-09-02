const STEAM_WEB_API_KEY = /^[a-f\d]{32}$/iu

export function normalizeSteamWebApiKey(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid Steam Web API key')
  const normalized = value.trim()
  if (!STEAM_WEB_API_KEY.test(normalized)) {
    throw new Error('Invalid Steam Web API key')
  }
  return normalized
}

export interface SteamWebApiCredentialVaultDependencies {
  encryptionAvailable: () => boolean
  encrypt: (value: string) => string
  decrypt: (payload: string) => string
  readEncrypted: () => unknown
  writeEncrypted: (payload: string) => void
  clearEncrypted: () => void
  readLegacy: () => unknown
  clearLegacy: () => void
}

/** Keeps Steam's optional Web API key inside the main-process credential
 * boundary and makes legacy plaintext migration independently testable. */
export class SteamWebApiCredentialVault {
  private readonly dependencies: SteamWebApiCredentialVaultDependencies

  constructor(dependencies: SteamWebApiCredentialVaultDependencies) {
    this.dependencies = dependencies
  }

  private encryptionAvailable(): boolean {
    try {
      return this.dependencies.encryptionAvailable()
    } catch {
      return false
    }
  }

  getApiKey(): string | undefined {
    const encryptionAvailable = this.encryptionAvailable()
    const encrypted = this.dependencies.readEncrypted()
    if (encryptionAvailable && typeof encrypted === 'string' && encrypted) {
      try {
        const apiKey = normalizeSteamWebApiKey(this.dependencies.decrypt(encrypted))
        if (this.dependencies.readLegacy() !== undefined) this.dependencies.clearLegacy()
        return apiKey
      } catch {
        this.dependencies.clearEncrypted()
      }
    }

    const legacy = this.dependencies.readLegacy()
    if (legacy === undefined) return undefined

    let apiKey: string
    try {
      apiKey = normalizeSteamWebApiKey(legacy)
    } catch {
      this.dependencies.clearLegacy()
      return undefined
    }

    // Do not remove the only usable copy until Windows can encrypt it. The
    // public settings snapshot hides this legacy field in every case.
    if (!encryptionAvailable) return undefined

    this.dependencies.writeEncrypted(this.dependencies.encrypt(apiKey))
    this.dependencies.clearLegacy()
    return apiKey
  }

  isConfigured(): boolean {
    return Boolean(this.getApiKey())
  }

  setApiKey(value: unknown): void {
    const apiKey = normalizeSteamWebApiKey(value)
    if (!this.encryptionAvailable()) {
      throw new Error('Secure credential storage is unavailable')
    }
    this.dependencies.writeEncrypted(this.dependencies.encrypt(apiKey))
    this.dependencies.clearLegacy()
  }

  clear(): void {
    this.dependencies.clearEncrypted()
    this.dependencies.clearLegacy()
  }
}
