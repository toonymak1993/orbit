import type { GameLaunchFailureReason, GameProvider } from '@shared/ipc'

const NO_EVIDENCE_TIMEOUT_MS: Record<GameProvider, number> = {
  local: 20_000,
  steam: 60_000,
  epic: 75_000,
  xbox: 75_000,
  ea: 90_000,
  ubisoft: 90_000,
  gog: 60_000
}

const PROVISIONAL_HANDOFF_GRACE_MS: Record<GameProvider, number> = {
  local: 8_000,
  steam: 8_000,
  epic: 15_000,
  xbox: 15_000,
  ea: 15_000,
  ubisoft: 15_000,
  gog: 12_000
}

export const GAME_PROCESS_CANDIDATE_STABILITY_MS = 650
const PROCESS_SAMPLE_GRACE_MS = 500

export interface GameProcessIdentitySignals {
  directlySpawnedGame: boolean
  exactLocalExecutable: boolean
  insideInstallDir: boolean
  idMatches: boolean
  executableHintMatches: boolean
  fromTrackedGame: boolean
  fromLauncher: boolean
  visible: boolean
  nameMatches: boolean
  windowsAppsProcess: boolean
}

/** A window by itself is never enough to identify a game process. */
export function hasEligibleGameProcessIdentity(signals: GameProcessIdentitySignals): boolean {
  const hasStrongIdentity =
    signals.directlySpawnedGame ||
    signals.exactLocalExecutable ||
    signals.insideInstallDir ||
    signals.idMatches ||
    signals.executableHintMatches ||
    signals.fromTrackedGame
  const hasCorroboratedIdentity =
    (signals.fromLauncher &&
      (signals.visible || signals.nameMatches || signals.windowsAppsProcess)) ||
    (signals.visible && signals.nameMatches)

  return hasStrongIdentity || hasCorroboratedIdentity
}

export function ancestryIncludesTrackedPid(
  initialParentId: number | undefined,
  trackedProcessIds: ReadonlySet<number>,
  parentProcessIdOf: (processId: number) => number | undefined
): boolean {
  let parentId = initialParentId ?? 0
  const visited = new Set<number>()
  for (let depth = 0; depth < 14 && parentId > 0 && !visited.has(parentId); depth += 1) {
    if (trackedProcessIds.has(parentId)) return true
    visited.add(parentId)
    parentId = parentProcessIdOf(parentId) ?? 0
  }
  return false
}

export function launchNoEvidenceTimeoutMs(provider: GameProvider): number {
  return NO_EVIDENCE_TIMEOUT_MS[provider]
}

export function provisionalHandoffGraceMs(provider: GameProvider): number {
  return PROVISIONAL_HANDOFF_GRACE_MS[provider]
}

/**
 * Keeps negative startup evidence separate from the process scorer. A short-lived
 * launcher/anti-cheat hand-off may be replaced, but it must not reset ORBIT to a
 * fresh multi-minute wait.
 */
export class LaunchStartupTracker {
  readonly deadline: number
  readonly absoluteDeadline: number
  private readonly handoffGraceMs: number
  private sawCandidate = false
  private provisionalMissingSince: number | undefined

  constructor(startedAt: number, provider: GameProvider) {
    this.deadline = startedAt + launchNoEvidenceTimeoutMs(provider)
    this.handoffGraceMs = provisionalHandoffGraceMs(provider)
    this.absoluteDeadline = this.deadline + this.handoffGraceMs + 5_000
  }

  noteCandidateSeen(): void {
    this.sawCandidate = true
  }

  noteCandidateStabilized(): void {
    this.sawCandidate = true
    this.provisionalMissingSince = undefined
  }

  noteCandidateMissing(now: number): void {
    if (!this.sawCandidate) return
    this.provisionalMissingSince ??= now
  }

  failureReason(now: number, candidateSeenAt?: number): GameLaunchFailureReason | undefined {
    const absoluteFailure = this.absoluteFailureReason(now)
    if (absoluteFailure) return absoluteFailure

    const evidenceDeadline = this.provisionalMissingSince
      ? this.provisionalMissingSince + this.handoffGraceMs
      : this.deadline
    const candidateCanStillStabilize =
      candidateSeenAt !== undefined &&
      candidateSeenAt <= evidenceDeadline + PROCESS_SAMPLE_GRACE_MS &&
      now < candidateSeenAt + GAME_PROCESS_CANDIDATE_STABILITY_MS

    if (candidateCanStillStabilize) return undefined

    if (this.provisionalMissingSince !== undefined) {
      return now >= this.provisionalMissingSince + this.handoffGraceMs
        ? 'startup-ended'
        : undefined
    }

    if (now < this.deadline) return undefined
    return this.sawCandidate ? 'startup-ended' : 'not-started'
  }

  absoluteFailureReason(now: number): GameLaunchFailureReason | undefined {
    if (now < this.absoluteDeadline) return undefined
    return this.sawCandidate ? 'startup-ended' : 'not-started'
  }
}
