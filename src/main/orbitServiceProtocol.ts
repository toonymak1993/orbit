import { createHash } from 'node:crypto'
import { createConnection, createServer, type Server } from 'node:net'
import type { HardwareControlStatus } from '@shared/ipc'

// Electron's Windows login-item inspection omits Chromium-style `--switches`
// from launchItems. A plain mode token keeps install/repair verification exact.
export const ORBIT_AGENT_ARGUMENT = 'orbit-background-agent'
export const ORBIT_AGENT_SHUTDOWN_ARGUMENT = 'orbit-background-agent-shutdown'

function normalizedProcessArgument(value: string): string {
  return value.trim().replace(/^"|"$/g, '').toLowerCase()
}

export function hasOrbitProcessArgument(arguments_: string[], expected: string): boolean {
  const normalizedExpected = normalizedProcessArgument(expected)
  return arguments_.some((value) => normalizedProcessArgument(value) === normalizedExpected)
}

export type OrbitAgentCommand = 'status' | 'reload-settings' | 'show-orbit' | 'shutdown'
export type OrbitAppCommand = 'show'

export interface OrbitPipeRequest<TCommand extends string = string> {
  command: TCommand
}

export interface OrbitPipeResponse<T = unknown> {
  ok: boolean
  value?: T
  error?: string
}

export interface OrbitServicePipeNames {
  agent: string
  app: string
}

export interface OrbitAgentSnapshot {
  protocolVersion: 2
  startedAt: number
  processId: number
  appVersion: string
  executablePath: string
  hardwareControl: HardwareControlStatus
  lastActivationAt?: number
  lastActivationResult?: 'focused' | 'launched' | 'failed'
}

const PIPE_MAX_MESSAGE_BYTES = 64 * 1024
const PIPE_IDLE_TIMEOUT_MS = 5_000

function isOptionalFiniteNumber(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value))
}

export function isHardwareControlStatus(value: unknown): value is HardwareControlStatus {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<HardwareControlStatus>
  if (!['disabled', 'starting', 'ready', 'unavailable'].includes(candidate.state ?? '')) {
    return false
  }
  if (
    !Number.isInteger(candidate.connectedControllers) ||
    (candidate.connectedControllers ?? -1) < 0 ||
    (candidate.connectedControllers ?? 17) > 16
  ) {
    return false
  }
  if (
    candidate.reason !== undefined &&
    !['unsupported-platform', 'monitor-failed', 'service-not-running'].includes(candidate.reason)
  ) {
    return false
  }
  return (
    isOptionalFiniteNumber(candidate.lastInputAt) &&
    isOptionalFiniteNumber(candidate.lastTriggerAt) &&
    isOptionalFiniteNumber(candidate.lastPressDurationMs) &&
    isOptionalFiniteNumber(candidate.lastAnyInputAt) &&
    isOptionalFiniteNumber(candidate.lastRawButtonMask)
  )
}

export function isOrbitAgentSnapshot(value: unknown): value is OrbitAgentSnapshot {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<OrbitAgentSnapshot>
  return (
    candidate.protocolVersion === 2 &&
    typeof candidate.startedAt === 'number' &&
    Number.isFinite(candidate.startedAt) &&
    candidate.startedAt > 0 &&
    typeof candidate.processId === 'number' &&
    Number.isInteger(candidate.processId) &&
    candidate.processId > 0 &&
    typeof candidate.appVersion === 'string' &&
    candidate.appVersion.length > 0 &&
    candidate.appVersion.length <= 80 &&
    typeof candidate.executablePath === 'string' &&
    candidate.executablePath.length > 0 &&
    candidate.executablePath.length <= 4_096 &&
    isHardwareControlStatus(candidate.hardwareControl) &&
    isOptionalFiniteNumber(candidate.lastActivationAt) &&
    (candidate.lastActivationResult === undefined ||
      ['focused', 'launched', 'failed'].includes(candidate.lastActivationResult))
  )
}

export function orbitServicePipeNames(userDataPath: string): OrbitServicePipeNames {
  const identity = createHash('sha256')
    .update(userDataPath.toLocaleLowerCase())
    .digest('hex')
    .slice(0, 16)
  return {
    agent: `\\\\.\\pipe\\orbit-background-agent-${identity}`,
    app: `\\\\.\\pipe\\orbit-app-${identity}`
  }
}

export function closePipeServer(server: Server | null): Promise<void> {
  if (!server?.listening) return Promise.resolve()
  return new Promise((resolve) => server.close(() => resolve()))
}

export function createOrbitPipeServer(
  pipeName: string,
  handler: (request: OrbitPipeRequest) => Promise<unknown> | unknown
): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer((socket) => {
      socket.setEncoding('utf8')
      socket.setTimeout(PIPE_IDLE_TIMEOUT_MS, () => socket.destroy())
      socket.on('error', () => socket.destroy())
      let buffer = ''
      let handled = false
      socket.on('data', (chunk: string) => {
        if (handled) return
        buffer += chunk
        if (Buffer.byteLength(buffer, 'utf8') > PIPE_MAX_MESSAGE_BYTES) {
          handled = true
          socket.end(`${JSON.stringify({ ok: false, error: 'ORBIT service request is too large' })}\n`)
          return
        }
        const newline = buffer.indexOf('\n')
        if (newline < 0) return
        handled = true
        // The request is complete. Long-running handlers such as window
        // activation own their own deadline and must not inherit the idle
        // timeout that protects half-written requests.
        socket.setTimeout(0)
        void (async () => {
          let response: OrbitPipeResponse
          try {
            const request = JSON.parse(buffer.slice(0, newline)) as OrbitPipeRequest
            if (!request || typeof request.command !== 'string') {
              throw new Error('Invalid ORBIT service command')
            }
            response = { ok: true, value: await handler(request) }
          } catch (error) {
            response = {
              ok: false,
              error: error instanceof Error ? error.message : 'ORBIT service command failed'
            }
          }
          if (!socket.destroyed) socket.end(`${JSON.stringify(response)}\n`)
        })()
      })
    })
    const rejectStartup = (error: Error): void => reject(error)
    server.once('error', rejectStartup)
    server.listen(pipeName, () => {
      server.removeListener('error', rejectStartup)
      server.on('error', (error) => {
        console.warn('[orbit-service] pipe server error:', error.message)
      })
      resolve(server)
    })
  })
}

export function requestOrbitPipe<T>(
  pipeName: string,
  request: OrbitPipeRequest,
  timeoutMs = 1_200
): Promise<T> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(pipeName)
    let settled = false
    let buffer = ''
    const finish = (error?: Error, value?: T): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      if (error) reject(error)
      else resolve(value as T)
    }
    const timer = setTimeout(() => finish(new Error('ORBIT service request timed out')), timeoutMs)

    socket.setEncoding('utf8')
    socket.once('error', (error) => finish(error))
    socket.once('end', () => finish(new Error('ORBIT service closed the connection')))
    socket.once('connect', () => socket.write(`${JSON.stringify(request)}\n`))
    socket.on('data', (chunk: string) => {
      buffer += chunk
      if (Buffer.byteLength(buffer, 'utf8') > PIPE_MAX_MESSAGE_BYTES) {
        finish(new Error('ORBIT service response is too large'))
        return
      }
      const newline = buffer.indexOf('\n')
      if (newline < 0) return
      try {
        const response = JSON.parse(buffer.slice(0, newline)) as OrbitPipeResponse<T>
        if (!response.ok) {
          finish(new Error(response.error || 'ORBIT service request failed'))
          return
        }
        finish(undefined, response.value)
      } catch {
        finish(new Error('ORBIT service returned an invalid response'))
      }
    })
  })
}
