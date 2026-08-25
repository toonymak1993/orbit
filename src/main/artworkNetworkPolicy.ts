export type ArtworkNetworkAttempt<T> =
  | { state: 'success'; value: T }
  | { state: 'missing' }
  | { state: 'unavailable' }

interface CircuitState {
  consecutiveFailures: number
  retryAt: number
  probeInFlight: boolean
}

const FAILURE_THRESHOLD = 2
const BASE_BACKOFF_MS = 60 * 1000
const MAX_BACKOFF_MS = 30 * 60 * 1000
const circuits = new Map<string, CircuitState>()

/** HTTP failures which indicate provider trouble rather than a missing asset. */
export function isTransientArtworkStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

function beginAttempt(scope: string): boolean {
  const circuit = circuits.get(scope)
  if (!circuit || circuit.consecutiveFailures < FAILURE_THRESHOLD) return true
  if (circuit.retryAt > Date.now() || circuit.probeInFlight) return false
  circuit.probeInFlight = true
  return true
}

function recordAvailable(scope: string): void {
  circuits.delete(scope)
}

function recordUnavailable(scope: string): void {
  const previous = circuits.get(scope)
  const consecutiveFailures = (previous?.consecutiveFailures ?? 0) + 1
  const exponent = Math.max(0, consecutiveFailures - FAILURE_THRESHOLD)
  const backoffMs = Math.min(BASE_BACKOFF_MS * 2 ** exponent, MAX_BACKOFF_MS)
  circuits.set(scope, {
    consecutiveFailures,
    retryAt:
      consecutiveFailures >= FAILURE_THRESHOLD ? Date.now() + backoffMs : 0,
    probeInFlight: false
  })
}

/**
 * A small per-source circuit breaker. Two consecutive transport/server failures
 * open the source, so one provider outage cannot occupy ORBIT's entire artwork
 * queue. A successful response or a confirmed missing asset closes it again.
 */
export async function runArtworkNetworkAttempt<T>(
  scope: string,
  attempt: () => Promise<ArtworkNetworkAttempt<T>>
): Promise<ArtworkNetworkAttempt<T>> {
  if (!beginAttempt(scope)) return { state: 'unavailable' }

  try {
    const result = await attempt()
    if (result.state === 'unavailable') recordUnavailable(scope)
    else recordAvailable(scope)
    return result
  } catch {
    recordUnavailable(scope)
    return { state: 'unavailable' }
  }
}
