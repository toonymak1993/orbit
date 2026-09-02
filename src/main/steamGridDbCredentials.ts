import { safeStorage } from 'electron'
import Store from 'electron-store'
import {
  clearLegacySteamGridDbToken,
  readLegacySteamGridDbToken
} from './settingsStore'
import { SteamGridDbCredentialVault } from './steamGridDbCredential'

interface EncryptedCredentialStore {
  payload?: string
}

const credentialStore = new Store<EncryptedCredentialStore>({
  name: 'orbit-steamgriddb-auth',
  defaults: {}
})

const vault = new SteamGridDbCredentialVault({
  encryptionAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (value) => safeStorage.encryptString(value).toString('base64'),
  decrypt: (payload) => safeStorage.decryptString(Buffer.from(payload, 'base64')),
  readEncrypted: () => credentialStore.get('payload'),
  writeEncrypted: (payload) => credentialStore.set('payload', payload),
  clearEncrypted: () => credentialStore.delete('payload'),
  readLegacy: readLegacySteamGridDbToken,
  clearLegacy: clearLegacySteamGridDbToken
})

try {
  // This module loads after app.whenReady(). Migrate legacy plaintext early;
  // every later read retries safely if Windows encryption was unavailable.
  vault.getToken()
} catch {
  // Keep the legacy value main-process-only until secure storage recovers.
}

export const steamGridDbCredentials = {
  getToken(): string | undefined {
    try {
      return vault.getToken()
    } catch {
      return undefined
    }
  },

  isConfigured(): boolean {
    return Boolean(this.getToken())
  },

  setToken(value: unknown): void {
    vault.setToken(value)
  },

  clear(): void {
    vault.clear()
  }
}
