import { safeStorage } from 'electron'
import Store from 'electron-store'
import type { RetroAchievementsCredentialStatus } from '@shared/ipc'
import {
  clearLegacyRetroAchievementsApiKey,
  readLegacyRetroAchievementsApiKey
} from '../settingsStore'
import { RetroAchievementsCredentialVault } from './retroAchievementsCredentialVault'

interface EncryptedCredentialStore {
  payload?: string
}

const credentialStore = new Store<EncryptedCredentialStore>({
  name: 'orbit-retroachievements-auth',
  defaults: {}
})

const vault = new RetroAchievementsCredentialVault({
  encryptionAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (value) => safeStorage.encryptString(value).toString('base64'),
  decrypt: (payload) => safeStorage.decryptString(Buffer.from(payload, 'base64')),
  readEncrypted: () => credentialStore.get('payload'),
  writeEncrypted: (payload) => credentialStore.set('payload', payload),
  clearEncrypted: () => credentialStore.delete('payload'),
  readLegacy: readLegacyRetroAchievementsApiKey,
  clearLegacy: clearLegacyRetroAchievementsApiKey
})

try {
  // This module is loaded after app.whenReady(), so migrate old plaintext as
  // early as possible. A temporarily unavailable credential backend is retried
  // by every later status/read operation without exposing the legacy value.
  vault.getApiKey()
} catch {
  // Keep the legacy value main-process-only until secure storage recovers.
}

export const retroAchievementsCredentials = {
  getApiKey(): string | undefined {
    try {
      return vault.getApiKey()
    } catch {
      // Credential reads are fail-closed: a damaged or temporarily unavailable
      // OS credential store must not prevent the rest of Settings from loading.
      return undefined
    }
  },

  getStatus(): RetroAchievementsCredentialStatus {
    return { configured: Boolean(this.getApiKey()) }
  },

  setApiKey(value: unknown): RetroAchievementsCredentialStatus {
    vault.setApiKey(value)
    return { configured: true }
  },

  clear(): RetroAchievementsCredentialStatus {
    vault.clear()
    return { configured: false }
  }
}
