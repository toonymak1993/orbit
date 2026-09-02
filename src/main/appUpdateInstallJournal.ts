export const PENDING_INSTALL_LAUNCH_GRACE_MS = 60_000
export const PENDING_INSTALL_EXIT_GRACE_MS = 30_000
export const PENDING_INSTALL_MAX_RUNTIME_MS = 15 * 60_000

export interface PendingInstallJournal {
  targetVersion: string
  createdAt: number
  transactionId: string
  phase: 'launching'
}

export interface PendingInstallConfirmation {
  transactionId: string
  installerPath: string
  processId: number
  startedAt: number
}

export function isPendingInstallJournal(value: unknown): value is PendingInstallJournal {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<PendingInstallJournal>
  return (
    typeof candidate.targetVersion === 'string' &&
    candidate.targetVersion.length > 0 &&
    typeof candidate.createdAt === 'number' &&
    Number.isFinite(candidate.createdAt) &&
    typeof candidate.transactionId === 'string' &&
    candidate.transactionId.length > 0 &&
    candidate.phase === 'launching'
  )
}

export function isPendingInstallConfirmation(
  value: unknown
): value is PendingInstallConfirmation {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<PendingInstallConfirmation>
  return (
    typeof candidate.transactionId === 'string' &&
    candidate.transactionId.length > 0 &&
    typeof candidate.installerPath === 'string' &&
    candidate.installerPath.length > 0 &&
    typeof candidate.processId === 'number' &&
    Number.isInteger(candidate.processId) &&
    candidate.processId > 0 &&
    typeof candidate.startedAt === 'number' &&
    Number.isFinite(candidate.startedAt)
  )
}

export function shouldWaitForPendingInstall(
  journal: PendingInstallJournal,
  confirmation: PendingInstallConfirmation | undefined,
  installerProcessRunning: boolean,
  matchingSuspensionActive: boolean,
  now = Date.now()
): boolean {
  if (now - journal.createdAt >= PENDING_INSTALL_MAX_RUNTIME_MS) return false
  // The transaction marker is the durable ownership boundary. It is armed
  // before the irreversible installer spawn, so it remains authoritative even
  // when the optional PID confirmation cannot be persisted or the bootstrap
  // process hands work to a different installer process and exits.
  if (matchingSuspensionActive) return true
  if (!confirmation || confirmation.transactionId !== journal.transactionId) {
    return now - journal.createdAt < PENDING_INSTALL_LAUNCH_GRACE_MS
  }
  if (installerProcessRunning) return true
  return now - confirmation.startedAt < PENDING_INSTALL_EXIT_GRACE_MS
}
