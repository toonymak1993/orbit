import { randomUUID } from 'node:crypto'
import { readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const SUSPENSION_FILE_NAME = 'orbit-background-service.suspended.json'
export const BACKGROUND_AGENT_SUSPENSION_MS = 5 * 60_000

export interface BackgroundAgentSuspension {
  expiresAt: number
  transactionId: string
  recoverAgent: boolean
}

export interface BackgroundAgentSuspensionOptions {
  transactionId?: string
  recoverAgent: boolean
}

export function backgroundAgentSuspensionPath(userDataPath: string): string {
  return join(userDataPath, SUSPENSION_FILE_NAME)
}

export async function readBackgroundAgentSuspension(
  userDataPath: string
): Promise<BackgroundAgentSuspension | undefined> {
  try {
    const parsed = JSON.parse(
      await readFile(backgroundAgentSuspensionPath(userDataPath), 'utf8')
    ) as Partial<BackgroundAgentSuspension>
    if (
      typeof parsed.expiresAt !== 'number' ||
      !Number.isFinite(parsed.expiresAt) ||
      typeof parsed.transactionId !== 'string' ||
      !parsed.transactionId ||
      typeof parsed.recoverAgent !== 'boolean'
    ) {
      return undefined
    }
    return {
      expiresAt: parsed.expiresAt,
      transactionId: parsed.transactionId,
      recoverAgent: parsed.recoverAgent
    }
  } catch {
    return undefined
  }
}

export async function suspendBackgroundAgent(
  userDataPath: string,
  options?: BackgroundAgentSuspensionOptions
): Promise<BackgroundAgentSuspension> {
  // Maintenance helpers launched by the installer must extend the transaction
  // created by the UI instead of replacing its recovery authorization.
  const existing = await readBackgroundAgentSuspension(userDataPath)
  const transactionId = options
    ? options.transactionId ?? randomUUID()
    : existing?.transactionId ?? randomUUID()
  const inheritsExistingTransaction = existing?.transactionId === transactionId
  const suspension: BackgroundAgentSuspension = {
    expiresAt: inheritsExistingTransaction
      ? Math.max(existing.expiresAt, Date.now() + BACKGROUND_AGENT_SUSPENSION_MS)
      : Date.now() + BACKGROUND_AGENT_SUSPENSION_MS,
    transactionId,
    recoverAgent: options?.recoverAgent ?? existing?.recoverAgent ?? false
  }
  await writeFile(
    backgroundAgentSuspensionPath(userDataPath),
    JSON.stringify(suspension),
    'utf8'
  )
  return suspension
}

export async function renewBackgroundAgentSuspension(
  userDataPath: string,
  transactionId: string,
  durationMs = BACKGROUND_AGENT_SUSPENSION_MS
): Promise<boolean> {
  const suspension = await readBackgroundAgentSuspension(userDataPath)
  if (!suspension || suspension.transactionId !== transactionId) return false
  await writeFile(
    backgroundAgentSuspensionPath(userDataPath),
    JSON.stringify({
      ...suspension,
      expiresAt: Date.now() + Math.max(1_000, durationMs)
    }),
    'utf8'
  )
  return true
}

export async function clearBackgroundAgentSuspension(userDataPath: string): Promise<void> {
  await rm(backgroundAgentSuspensionPath(userDataPath), { force: true })
}

export async function isBackgroundAgentSuspended(userDataPath: string): Promise<boolean> {
  const path = backgroundAgentSuspensionPath(userDataPath)
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<BackgroundAgentSuspension>
    if (
      typeof parsed.expiresAt === 'number' &&
      Number.isFinite(parsed.expiresAt) &&
      parsed.expiresAt > Date.now()
    ) {
      return true
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    // A concurrent reader can observe an incomplete write. Treat malformed or
    // temporarily unreadable fresh markers as active instead of racing an update.
    try {
      const metadata = await stat(path)
      if (Date.now() - metadata.mtimeMs <= BACKGROUND_AGENT_SUSPENSION_MS) return true
    } catch (statError) {
      if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') return true
      return false
    }
  }

  // Corrupt and expired maintenance markers must not disable the service
  // indefinitely after an interrupted update.
  await rm(path, { force: true }).catch(() => undefined)
  return false
}
