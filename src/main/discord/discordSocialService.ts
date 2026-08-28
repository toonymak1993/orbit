import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage, utilityProcess, type UtilityProcess } from 'electron'
import Store from 'electron-store'
import type { FriendPresence, OrbitFriend } from '@shared/ipc'
import type {
  DiscordSocialIssue,
  DiscordSocialSnapshot,
  DiscordSocialTokens,
  DiscordWorkerMessage,
  DiscordWorkerRequest,
  DiscordWorkerResponse
} from './discordSocialProtocol'

const DISCORD_APPLICATION_ID_PATTERN = /^\d{17,20}$/
const REQUEST_TIMEOUT_MS = 45_000
const REFRESH_TIMEOUT_MS = 15_000
const CONNECT_TIMEOUT_MS = 6 * 60_000
const MAX_TOKEN_LENGTH = 8_192
const MAX_DISCORD_FRIENDS = 1_000
const WORKER_ENTRY = 'discordSocialWorker.js'
const SDK_VERSION = '1.10.18687'

interface StoredDiscordAuth {
  applicationId: string
  accessToken: string
  refreshToken: string
  tokenType: number
  expiresAt: number
  scopes: string
}

interface DiscordAuthStore {
  auth?: StoredDiscordAuth
}

interface PendingRequest {
  resolve: (response: DiscordWorkerResponse) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const authStore = new Store<DiscordAuthStore>({
  name: 'discord-social-auth',
  defaults: {}
})

function initialSnapshot(): DiscordSocialSnapshot {
  return { state: 'not-connected', friends: [], updatedAt: 0 }
}

function errorSnapshot(issue: DiscordSocialIssue): DiscordSocialSnapshot {
  return { state: 'error', friends: [], updatedAt: Date.now(), issue }
}

function normalizedApplicationId(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return DISCORD_APPLICATION_ID_PATTERN.test(trimmed) ? trimmed : ''
}

function sanitizedText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return cleaned ? cleaned.slice(0, maxLength) : undefined
}

function sanitizedAvatarUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2_048) return undefined
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    if (
      url.protocol !== 'https:' ||
      (host !== 'cdn.discordapp.com' && host !== 'media.discordapp.net')
    ) {
      return undefined
    }
    return url.toString()
  } catch {
    return undefined
  }
}

function sanitizedFriend(value: unknown): OrbitFriend | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const friend = value as Partial<OrbitFriend>
  const providerUserId =
    typeof friend.providerUserId === 'string' && /^\d{17,20}$/.test(friend.providerUserId)
      ? friend.providerUserId
      : ''
  const displayName = sanitizedText(friend.displayName, 100)
  const presences: FriendPresence[] = ['online', 'away', 'busy', 'offline', 'unknown']
  if (
    friend.provider !== 'discord' ||
    !providerUserId ||
    !displayName ||
    !presences.includes(friend.presence as FriendPresence)
  ) {
    return null
  }
  return {
    id: `discord:${providerUserId}`,
    provider: 'discord',
    providerUserId,
    displayName,
    avatarUrl: sanitizedAvatarUrl(friend.avatarUrl),
    presence: friend.presence as FriendPresence,
    activity: sanitizedText(friend.activity, 100)
  }
}

function sanitizedSnapshot(value: unknown): DiscordSocialSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const snapshot = value as Partial<DiscordSocialSnapshot>
  const states: DiscordSocialSnapshot['state'][] = [
    'not-connected',
    'connecting',
    'ready',
    'error'
  ]
  const issues: DiscordSocialIssue[] = [
    'authentication-failed',
    'provider-unavailable',
    'sdk-unavailable'
  ]
  if (!states.includes(snapshot.state as DiscordSocialSnapshot['state'])) return null
  if (snapshot.issue && !issues.includes(snapshot.issue)) return null
  const friends = Array.isArray(snapshot.friends)
    ? snapshot.friends
        .slice(0, MAX_DISCORD_FRIENDS)
        .map(sanitizedFriend)
        .filter((friend): friend is OrbitFriend => friend !== null)
    : []
  const updatedAt =
    typeof snapshot.updatedAt === 'number' && Number.isFinite(snapshot.updatedAt)
      ? snapshot.updatedAt
      : Date.now()
  return {
    state: snapshot.state as DiscordSocialSnapshot['state'],
    friends,
    updatedAt,
    accountName: sanitizedText(snapshot.accountName, 100),
    issue: snapshot.issue
  }
}

function sanitizedTokens(value: unknown): DiscordSocialTokens | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const tokens = value as Partial<DiscordSocialTokens>
  if (
    typeof tokens.accessToken !== 'string' ||
    !tokens.accessToken ||
    tokens.accessToken.length > MAX_TOKEN_LENGTH ||
    typeof tokens.refreshToken !== 'string' ||
    tokens.refreshToken.length > MAX_TOKEN_LENGTH ||
    typeof tokens.tokenType !== 'number' ||
    !Number.isInteger(tokens.tokenType) ||
    typeof tokens.expiresAt !== 'number' ||
    !Number.isFinite(tokens.expiresAt) ||
    typeof tokens.scopes !== 'string' ||
    tokens.scopes.length > 1_024
  ) {
    return undefined
  }
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    tokenType: tokens.tokenType,
    expiresAt: tokens.expiresAt,
    scopes: tokens.scopes
  }
}

export class DiscordSocialService extends EventEmitter {
  private snapshot = initialSnapshot()
  private worker: UtilityProcess | null = null
  private workerReady: Promise<void> | null = null
  private workerVersion = ''
  private nextRequestId = 1
  private pending = new Map<number, PendingRequest>()
  private sessionAuth?: { applicationId: string; tokens: DiscordSocialTokens }
  private operationChain: Promise<void> = Promise.resolve()
  private disposed = false

  getSnapshot(): DiscordSocialSnapshot {
    return structuredClone(this.snapshot)
  }

  private publish(snapshot: DiscordSocialSnapshot): DiscordSocialSnapshot {
    this.snapshot = snapshot
    this.emit('updated', this.getSnapshot())
    return this.getSnapshot()
  }

  private sdkPath(): string {
    return app.isPackaged
      ? join(process.resourcesPath, 'discord-social-sdk', 'win32-x64', 'discord_partner_sdk.dll')
      : join(app.getAppPath(), 'resources', 'discord-social-sdk', 'win32-x64', 'discord_partner_sdk.dll')
  }

  private workerPath(): string {
    return join(app.getAppPath(), 'out', 'main', WORKER_ENTRY)
  }

  private decodeSecret(value: string): string | undefined {
    if (!safeStorage.isEncryptionAvailable()) return undefined
    try {
      return safeStorage.decryptString(Buffer.from(value, 'base64'))
    } catch {
      return undefined
    }
  }

  private readTokens(applicationId: string): DiscordSocialTokens | undefined {
    if (this.sessionAuth && this.sessionAuth.applicationId !== applicationId) {
      this.sessionAuth = undefined
    }
    if (this.sessionAuth?.applicationId === applicationId) {
      return structuredClone(this.sessionAuth.tokens)
    }
    const stored = authStore.get('auth')
    if (!stored) return undefined
    if (stored.applicationId !== applicationId) {
      authStore.delete('auth')
      return undefined
    }
    const accessToken = this.decodeSecret(stored.accessToken)
    const refreshToken = this.decodeSecret(stored.refreshToken)
    if (!accessToken || refreshToken === undefined) {
      authStore.delete('auth')
      return undefined
    }
    const tokens = sanitizedTokens({ ...stored, accessToken, refreshToken })
    if (!tokens) {
      authStore.delete('auth')
      return undefined
    }
    this.sessionAuth = { applicationId, tokens }
    return structuredClone(tokens)
  }

  private saveTokens(applicationId: string, tokens: DiscordSocialTokens): void {
    this.sessionAuth = { applicationId, tokens: structuredClone(tokens) }
    if (!safeStorage.isEncryptionAvailable()) {
      authStore.delete('auth')
      return
    }
    authStore.set('auth', {
      applicationId,
      accessToken: safeStorage.encryptString(tokens.accessToken).toString('base64'),
      refreshToken: safeStorage.encryptString(tokens.refreshToken).toString('base64'),
      tokenType: tokens.tokenType,
      expiresAt: tokens.expiresAt,
      scopes: tokens.scopes
    })
  }

  private clearTokens(): void {
    this.sessionAuth = undefined
    authStore.delete('auth')
  }

  private stopWorker(): void {
    const worker = this.worker
    this.worker = null
    this.workerReady = null
    this.workerVersion = ''
    if (worker) worker.kill()
    for (const request of this.pending.values()) {
      clearTimeout(request.timer)
      request.reject(new Error('Discord Social SDK service stopped'))
    }
    this.pending.clear()
  }

  private handleWorkerMessage(message: DiscordWorkerMessage): void {
    if (message.type === 'ready') {
      this.workerVersion = message.version
      return
    }
    if (message.type === 'updated') {
      const snapshot = sanitizedSnapshot(message.snapshot)
      if (snapshot) this.publish(snapshot)
      return
    }
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    clearTimeout(pending.timer)
    pending.resolve(message)
  }

  private handleWorkerExit(worker: UtilityProcess): void {
    if (this.worker !== worker) return
    this.worker = null
    this.workerReady = null
    this.workerVersion = ''
    for (const request of this.pending.values()) {
      clearTimeout(request.timer)
      request.reject(new Error('Discord Social SDK worker stopped'))
    }
    this.pending.clear()
    if (!this.disposed && this.snapshot.state !== 'not-connected') {
      this.publish(errorSnapshot('sdk-unavailable'))
    }
  }

  private ensureWorker(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Discord Social SDK service is disposed'))
    if (process.platform !== 'win32' || process.arch !== 'x64') {
      return Promise.reject(new Error('Discord Social SDK is unavailable on this platform'))
    }
    if (this.worker && this.workerReady) return this.workerReady
    const sdkPath = this.sdkPath()
    const workerPath = this.workerPath()
    if (!existsSync(sdkPath) || !existsSync(workerPath)) {
      return Promise.reject(new Error('Discord Social SDK runtime is missing'))
    }
    const worker = utilityProcess.fork(workerPath, [sdkPath, String(process.pid)], {
      serviceName: 'ORBIT Discord Social',
      stdio: 'ignore'
    })
    this.worker = worker
    this.workerReady = new Promise<void>((resolve, reject) => {
      let settled = false
      const failStart = (error: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        worker.off('message', onMessage)
        if (this.worker === worker) this.stopWorker()
        reject(error)
      }
      const timer = setTimeout(
        () => failStart(new Error('Discord worker did not start')),
        10_000
      )
      const onMessage = (message: DiscordWorkerMessage): void => {
        this.handleWorkerMessage(message)
        if (message.type === 'ready') {
          if (message.version !== SDK_VERSION) {
            failStart(new Error('Discord worker runtime is unavailable or has the wrong version'))
            return
          }
          settled = true
          clearTimeout(timer)
          worker.off('message', onMessage)
          worker.on('message', (next: DiscordWorkerMessage) => this.handleWorkerMessage(next))
          resolve()
        }
      }
      worker.on('message', onMessage)
      worker.once('error', () => failStart(new Error('Discord worker failed to start')))
      worker.once('exit', () => {
        this.handleWorkerExit(worker)
        failStart(new Error('Discord worker stopped before it was ready'))
      })
    })
    return this.workerReady
  }

  private async request(
    command: DiscordWorkerRequest['command'],
    applicationId?: string,
    tokens?: DiscordSocialTokens
  ): Promise<DiscordWorkerResponse> {
    await this.ensureWorker()
    if (!this.worker) {
      throw new Error('Discord Social SDK worker is unavailable')
    }
    if (this.workerVersion !== SDK_VERSION) {
      this.stopWorker()
      throw new Error('Discord Social SDK version does not match ORBIT')
    }
    const id = this.nextRequestId++
    const timeoutMs =
      command === 'connect'
        ? CONNECT_TIMEOUT_MS
        : command === 'refresh'
          ? REFRESH_TIMEOUT_MS
          : REQUEST_TIMEOUT_MS
    const response = new Promise<DiscordWorkerResponse>((resolve, reject) => {
      this.pending.set(id, {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.pending.delete(id)
          reject(new Error('Discord Social SDK request timed out'))
        }, timeoutMs)
      })
    })
    this.worker.postMessage({ type: 'request', id, command, applicationId, tokens })
    return response
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.operationChain.then(operation, operation)
    this.operationChain = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  private applyResponse(
    applicationId: string,
    response: DiscordWorkerResponse
  ): DiscordSocialSnapshot {
    if (response.clearTokens) this.clearTokens()
    const tokens = sanitizedTokens(response.tokens)
    if (tokens) this.saveTokens(applicationId, tokens)
    if (!response.ok) return this.publish(errorSnapshot(response.error ?? 'provider-unavailable'))
    const snapshot = sanitizedSnapshot(response.snapshot)
    return this.publish(snapshot ?? errorSnapshot('provider-unavailable'))
  }

  refresh(applicationIdInput: unknown): Promise<DiscordSocialSnapshot> {
    return this.runExclusive(async () => {
      const applicationId = normalizedApplicationId(applicationIdInput)
      if (!applicationId) {
        this.clearTokens()
        this.stopWorker()
        return this.publish(initialSnapshot())
      }
      const tokens = this.readTokens(applicationId)
      if (!tokens) {
        return this.publish(initialSnapshot())
      }
      this.publish({
        state: 'connecting',
        friends: this.snapshot.friends,
        accountName: this.snapshot.accountName,
        updatedAt: Date.now()
      })
      try {
        const response = await this.request('refresh', applicationId, tokens)
        return this.applyResponse(applicationId, response)
      } catch {
        this.stopWorker()
        return this.publish(errorSnapshot('sdk-unavailable'))
      }
    })
  }

  connect(applicationIdInput: unknown): Promise<DiscordSocialSnapshot> {
    return this.runExclusive(async () => {
      const applicationId = normalizedApplicationId(applicationIdInput)
      if (!applicationId) return this.publish(errorSnapshot('authentication-failed'))
      this.publish({ state: 'connecting', friends: [], updatedAt: Date.now() })
      try {
        const response = await this.request('connect', applicationId, this.readTokens(applicationId))
        return this.applyResponse(applicationId, response)
      } catch {
        this.stopWorker()
        return this.publish(errorSnapshot('sdk-unavailable'))
      }
    })
  }

  disconnect(applicationIdInput: unknown): Promise<DiscordSocialSnapshot> {
    return this.runExclusive(async () => {
      const applicationId = normalizedApplicationId(applicationIdInput)
      const tokens = applicationId ? this.readTokens(applicationId) : undefined
      try {
        if (applicationId && this.worker) {
          await this.request('disconnect', applicationId, tokens)
        }
      } catch {
        // Clearing the local encrypted session is always allowed to complete.
      }
      this.clearTokens()
      return this.publish(initialSnapshot())
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.stopWorker()
  }
}

export const discordSocialService = new DiscordSocialService()
