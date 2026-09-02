import { safeStorage } from 'electron'
import Store from 'electron-store'
import type { SteamWebApiCredentialStatus } from '@shared/ipc'
import {
  clearLegacySteamWebApiKey,
  readLegacySteamWebApiKey
} from '../settingsStore'
import { SteamWebApiCredentialVault } from './steamWebApiCredentialVault'

interface EncryptedCredentialStore {
  payload?: string
}

const credentialStore = new Store<EncryptedCredentialStore>({
  name: 'orbit-steam-web-api-auth',
  defaults: {}
})

const vault = new SteamWebApiCredentialVault({
  encryptionAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (value) => safeStorage.encryptString(value).toString('base64'),
  decrypt: (payload) => safeStorage.decryptString(Buffer.from(payload, 'base64')),
  readEncrypted: () => credentialStore.get('payload'),
  writeEncrypted: (payload) => credentialStore.set('payload', payload),
  clearEncrypted: () => credentialStore.delete('payload'),
  readLegacy: readLegacySteamWebApiKey,
  clearLegacy: clearLegacySteamWebApiKey
})

try {
  vault.getApiKey()
} catch {
  // Fail closed and retry when the credential is next requested.
}

export const steamWebApiCredentials = {
  getApiKey(): string | undefined {
    try {
      return vault.getApiKey()
    } catch {
      return undefined
    }
  },

  getStatus(): SteamWebApiCredentialStatus {
    return { configured: Boolean(this.getApiKey()) }
  },

  setApiKey(value: unknown): SteamWebApiCredentialStatus {
    vault.setApiKey(value)
    return { configured: true }
  },

  clear(): SteamWebApiCredentialStatus {
    vault.clear()
    return { configured: false }
  }
}
