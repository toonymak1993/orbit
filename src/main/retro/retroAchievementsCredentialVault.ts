const RETRO_ACHIEVEMENTS_API_KEY = /^[a-z\d]{16,128}$/iu

export function normalizeRetroAchievementsApiKey(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid RetroAchievements Web API key')
  const normalized = value.trim()
  if (!RETRO_ACHIEVEMENTS_API_KEY.test(normalized)) {
    throw new Error('Invalid RetroAchievements Web API key')
  }
  return normalized
}

export interface RetroAchievementsCredentialVaultDependencies {
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
 * the credential boundary can be regression-tested without touching a user's
 * real OS credential store.
 */
export class RetroAchievementsCredentialVault {
  private readonly dependencies: RetroAchievementsCredentialVaultDependencies

  constructor(dependencies: RetroAchievementsCredentialVaultDependencies) {
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
        const apiKey = normalizeRetroAchievementsApiKey(this.dependencies.decrypt(encrypted))
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
      apiKey = normalizeRetroAchievementsApiKey(legacy)
    } catch {
      this.dependencies.clearLegacy()
      return undefined
    }

    // Never delete the only usable copy until safeStorage can encrypt it. The
    // public settings snapshot still strips the legacy field from the renderer.
    if (!encryptionAvailable) return undefined

    const payload = this.dependencies.encrypt(apiKey)
    this.dependencies.writeEncrypted(payload)
    this.dependencies.clearLegacy()
    return apiKey
  }

  isConfigured(): boolean {
    return Boolean(this.getApiKey())
  }

  setApiKey(value: unknown): void {
    const apiKey = normalizeRetroAchievementsApiKey(value)
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
