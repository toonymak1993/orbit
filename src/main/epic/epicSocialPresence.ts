import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { FriendPresence } from '@shared/ipc'

const EPIC_XMPP_URL = 'wss://xmpp-service-prod.ol.epicgames.com'
const EPIC_XMPP_DOMAIN = 'prod.ol.epicgames.com'
const EPIC_ACCOUNT_ID = /^[a-f0-9]{32}$/i
const INITIAL_PRESENCE_WAIT_MS = 2_500
const CONNECTION_TIMEOUT_MS = 10_000

export interface EpicLivePresence {
  presence: FriendPresence
  activity?: string
}

export interface EpicPresenceSnapshot {
  accountId: string
  connected: boolean
  presences: Record<string, EpicLivePresence>
}

interface ResourcePresence extends EpicLivePresence {
  resource: string
}

function decodeXml(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}

function cleanActivity(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const activity = value.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  if (!activity || /^(online|away|offline|busy)$/i.test(activity)) return undefined
  return activity.slice(0, 100)
}

function parsePresence(stanza: string): {
  accountId: string
  resource: string
  unavailable: boolean
  presence: ResourcePresence
} | null {
  const from = stanza.match(/\bfrom=["']([^"']+)["']/i)?.[1]
  if (!from) return null
  const [bareJid, resource = 'default'] = from.split('/', 2)
  const accountId = bareJid.split('@', 1)[0]
  if (!EPIC_ACCOUNT_ID.test(accountId)) return null

  const unavailable = /\btype=["']unavailable["']/i.test(stanza)
  const show = decodeXml(stanza.match(/<show\b[^>]*>([\s\S]*?)<\/show>/i)?.[1] ?? '').trim()
  let presence: FriendPresence = show === 'away' ? 'away' : show === 'dnd' ? 'busy' : 'online'
  let activity: string | undefined
  const statusSource = decodeXml(
    stanza.match(/<status\b[^>]*>([\s\S]*?)<\/status>/i)?.[1] ?? ''
  ).trim()
  if (statusSource) {
    try {
      const status = JSON.parse(statusSource) as Record<string, unknown>
      activity = cleanActivity(status.ProductName) ?? cleanActivity(status.Status)
      const statusName = typeof status.Status === 'string' ? status.Status.toLowerCase() : ''
      if (statusName === 'away') presence = 'away'
      if (statusName === 'busy' || statusName === 'dnd') presence = 'busy'
    } catch {
      activity = cleanActivity(statusSource)
    }
  }

  return {
    accountId,
    resource,
    unavailable,
    presence: { resource, presence, activity }
  }
}

function aggregatePresence(resources: Map<string, ResourcePresence>): EpicLivePresence | null {
  const entries = [...resources.values()]
  if (entries.length === 0) return null
  const activity = entries.find((entry) => entry.activity)?.activity
  const presence = entries.some((entry) => entry.presence === 'online')
    ? 'online'
    : entries.some((entry) => entry.presence === 'busy')
      ? 'busy'
      : 'away'
  return { presence, activity }
}

class EpicSocialPresence extends EventEmitter {
  private socket: WebSocket | null = null
  private accountId: string | null = null
  private friendIds = new Set<string>()
  private resources = new Map<string, Map<string, ResourcePresence>>()
  private connected = false
  private ready = false
  private generation = 0
  private connectionInFlight: Promise<EpicPresenceSnapshot> | null = null
  private heartbeat: ReturnType<typeof setInterval> | null = null

  getSnapshot(): EpicPresenceSnapshot {
    const presences: Record<string, EpicLivePresence> = {}
    for (const [accountId, resources] of this.resources) {
      const presence = aggregatePresence(resources)
      if (presence && this.friendIds.has(accountId)) presences[accountId] = presence
    }
    return { accountId: this.accountId ?? '', connected: this.connected, presences }
  }

  connect(
    accountId: string,
    accessToken: string,
    friendIds: string[]
  ): Promise<EpicPresenceSnapshot> {
    this.friendIds = new Set(friendIds.filter((id) => EPIC_ACCOUNT_ID.test(id)))
    if (
      this.accountId === accountId &&
      this.socket?.readyState === WebSocket.OPEN &&
      this.ready
    ) {
      this.pruneResources()
      return Promise.resolve(this.getSnapshot())
    }
    if (this.accountId === accountId && this.connectionInFlight) return this.connectionInFlight

    this.closeConnection()
    this.accountId = accountId
    const generation = this.generation
    this.connectionInFlight = this.open(accountId, accessToken, generation).finally(() => {
      if (generation === this.generation) this.connectionInFlight = null
    })
    return this.connectionInFlight
  }

  disconnect(): void {
    this.closeConnection()
    this.accountId = null
    this.friendIds.clear()
    this.resources.clear()
  }

  private open(
    accountId: string,
    accessToken: string,
    generation: number
  ): Promise<EpicPresenceSnapshot> {
    return new Promise((resolve) => {
      const socket = new WebSocket(EPIC_XMPP_URL, 'xmpp')
      this.socket = socket
      const resource = `V2:launcher:WIN::${randomUUID().replaceAll('-', '')}`
      const auth = Buffer.from(`\0${accountId}\0${accessToken}`).toString('base64')
      let phase: 'opening' | 'authenticating' | 'binding' | 'bind-requested' | 'ready' =
        'opening'
      let settled = false
      let collectionTimer: ReturnType<typeof setTimeout> | null = null

      const finish = (): void => {
        if (settled || generation !== this.generation) return
        settled = true
        clearTimeout(timeout)
        if (collectionTimer) clearTimeout(collectionTimer)
        resolve(this.getSnapshot())
      }
      const timeout = setTimeout(finish, CONNECTION_TIMEOUT_MS)

      socket.addEventListener('open', () => {
        if (generation !== this.generation) return
        socket.send(
          `<open xmlns="urn:ietf:params:xml:ns:xmpp-framing" to="${EPIC_XMPP_DOMAIN}" version="1.0"/>`
        )
      })
      socket.addEventListener('error', finish)
      socket.addEventListener('close', () => {
        if (generation !== this.generation) return
        this.connected = false
        this.ready = false
        this.stopHeartbeat()
        this.resources.clear()
        this.publish()
        finish()
      })
      socket.addEventListener('message', (event) => {
        void this.handleMessage(event, {
          generation,
          accountId,
          auth,
          resource,
          get phase() {
            return phase
          },
          set phase(value) {
            phase = value
          },
          onReady: () => {
            if (!collectionTimer) collectionTimer = setTimeout(finish, INITIAL_PRESENCE_WAIT_MS)
          },
          finish
        })
      })
    })
  }

  private async handleMessage(
    event: MessageEvent,
    state: {
      generation: number
      accountId: string
      auth: string
      resource: string
      phase: 'opening' | 'authenticating' | 'binding' | 'bind-requested' | 'ready'
      onReady: () => void
      finish: () => void
    }
  ): Promise<void> {
    if (state.generation !== this.generation || !this.socket) return
    const source =
      typeof event.data === 'string'
        ? event.data
        : event.data instanceof Blob
          ? await event.data.text()
          : Buffer.from(event.data as ArrayBuffer).toString('utf8')
    if (/<failure\b/i.test(source)) {
      this.socket.close()
      state.finish()
      return
    }
    if (state.phase === 'opening' && /<stream:features\b|<features\b/i.test(source)) {
      state.phase = 'authenticating'
      this.socket.send(
        `<auth xmlns="urn:ietf:params:xml:ns:xmpp-sasl" mechanism="PLAIN">${state.auth}</auth>`
      )
      return
    }
    if (state.phase === 'authenticating' && /<success\b/i.test(source)) {
      state.phase = 'binding'
      this.socket.send(
        `<open xmlns="urn:ietf:params:xml:ns:xmpp-framing" to="${EPIC_XMPP_DOMAIN}" version="1.0"/>`
      )
      return
    }
    if (state.phase === 'binding' && /<stream:features\b|<features\b/i.test(source)) {
      state.phase = 'bind-requested'
      this.socket.send(
        `<iq id="orbit-bind" type="set"><bind xmlns="urn:ietf:params:xml:ns:xmpp-bind"><resource>${state.resource}</resource></bind></iq>`
      )
      return
    }
    if (
      state.phase === 'bind-requested' &&
      /<iq\b[^>]*id=["']orbit-bind["'][^>]*type=["']result["']|<iq\b[^>]*type=["']result["'][^>]*id=["']orbit-bind["']/i.test(
        source
      )
    ) {
      state.phase = 'ready'
      this.connected = true
      this.ready = true
      this.socket.send(
        '<iq id="orbit-session" type="set"><session xmlns="urn:ietf:params:xml:ns:xmpp-session"/></iq>'
      )
      this.socket.send('<iq id="orbit-roster" type="get"><query xmlns="jabber:iq:roster"/></iq>')
      this.socket.send(
        '<presence><status>{"Status":"online","bIsPlaying":false,"bIsJoinable":false,"bHasVoiceSupport":false}</status></presence>'
      )
      this.startHeartbeat()
      state.onReady()
    }

    let changed = false
    for (const match of source.matchAll(/<presence\b[^>]*(?:\/>|>[\s\S]*?<\/presence>)/gi)) {
      const parsed = parsePresence(match[0])
      if (!parsed || parsed.accountId === state.accountId || !this.friendIds.has(parsed.accountId)) {
        continue
      }
      const resources = this.resources.get(parsed.accountId) ?? new Map<string, ResourcePresence>()
      if (parsed.unavailable) resources.delete(parsed.resource)
      else resources.set(parsed.resource, parsed.presence)
      if (resources.size > 0) this.resources.set(parsed.accountId, resources)
      else this.resources.delete(parsed.accountId)
      changed = true
    }
    if (changed) this.publish()
  }

  private publish(): void {
    this.emit('updated', this.getSnapshot())
  }

  private pruneResources(): void {
    for (const accountId of this.resources.keys()) {
      if (!this.friendIds.has(accountId)) this.resources.delete(accountId)
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeat = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(
          `<iq id="orbit-ping-${Date.now()}" type="get"><ping xmlns="urn:xmpp:ping"/></iq>`
        )
      }
    }, 45_000)
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
  }

  private closeConnection(): void {
    this.generation += 1
    this.stopHeartbeat()
    this.connected = false
    this.ready = false
    this.connectionInFlight = null
    this.resources.clear()
    const socket = this.socket
    this.socket = null
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close()
  }
}

export const epicSocialPresence = new EpicSocialPresence()
