import { createHash } from 'node:crypto'
import { createConnection, createServer, type Server } from 'node:net'
import type { HardwareControlStatus } from '@shared/ipc'

// Electron's Windows login-item inspection omits Chromium-style `--switches`
// from launchItems. A plain mode token keeps install/repair verification exact.
export const ORBIT_AGENT_ARGUMENT = 'orbit-background-agent'

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
  protocolVersion: 1
  startedAt: number
  hardwareControl: HardwareControlStatus
  lastActivationAt?: number
  lastActivationResult?: 'focused' | 'launched' | 'failed'
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
      let buffer = ''
      let handled = false
      socket.on('data', (chunk: string) => {
        if (handled) return
        buffer += chunk
        const newline = buffer.indexOf('\n')
        if (newline < 0) return
        handled = true
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
          socket.end(`${JSON.stringify(response)}\n`)
        })()
      })
    })
    server.once('error', reject)
    server.listen(pipeName, () => {
      server.removeListener('error', reject)
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
    socket.once('connect', () => socket.write(`${JSON.stringify(request)}\n`))
    socket.on('data', (chunk: string) => {
      buffer += chunk
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
