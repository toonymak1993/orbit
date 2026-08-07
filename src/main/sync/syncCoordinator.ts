import { EventEmitter } from 'node:events'
import type {
  SyncPipelineId,
  SyncPipelineProgress,
  SyncPipelineState,
  SystemSyncStatus
} from '@shared/ipc'

interface ProviderProgress {
  state: SyncPipelineState
  completed: number
  total: number
  detail?: string
}

function pipeline(id: SyncPipelineId): SyncPipelineProgress {
  return { id, state: 'idle', completed: 0, total: 0, updatedAt: Date.now() }
}

function cloneStatus(status: SystemSyncStatus): SystemSyncStatus {
  return {
    ...status,
    pipelines: {
      library: { ...status.pipelines.library },
      metadata: { ...status.pipelines.metadata },
      artwork: { ...status.pipelines.artwork },
      achievements: { ...status.pipelines.achievements },
      store: { ...status.pipelines.store }
    }
  }
}

/**
 * Store-neutral source of truth for startup synchronization. Each provider owns
 * its contribution; the UI receives aggregate totals, so concurrent Steam/Epic/
 * GOG adapters cannot overwrite one another's progress.
 */
export class SyncCoordinator extends EventEmitter {
  private emitTimer: ReturnType<typeof setTimeout> | undefined
  private status: SystemSyncStatus = {
    updatedAt: Date.now(),
    pipelines: {
      library: pipeline('library'),
      metadata: pipeline('metadata'),
      artwork: pipeline('artwork'),
      achievements: pipeline('achievements'),
      store: pipeline('store')
    }
  }

  private providers: Record<SyncPipelineId, Map<string, ProviderProgress>> = {
    library: new Map(),
    metadata: new Map(),
    artwork: new Map(),
    achievements: new Map(),
    store: new Map()
  }

  beginSession(): void {
    const now = Date.now()
    this.providers = {
      library: new Map(),
      metadata: new Map(),
      artwork: new Map(),
      achievements: new Map(),
      store: new Map()
    }
    this.status = {
      startedAt: now,
      updatedAt: now,
      pipelines: {
        library: pipeline('library'),
        metadata: pipeline('metadata'),
        artwork: pipeline('artwork'),
        achievements: pipeline('achievements'),
        store: pipeline('store')
      }
    }
    this.emitStatusImmediately()
  }

  begin(
    id: SyncPipelineId,
    total = 0,
    completed = 0,
    detail?: string,
    provider = 'system'
  ): void {
    this.providers[id].set(provider, {
      state: total === 0 || completed >= total ? 'complete' : 'running',
      completed: Math.max(0, completed),
      total: Math.max(0, total),
      detail
    })
    this.aggregate(id)
  }

  progress(
    id: SyncPipelineId,
    completed: number,
    total?: number,
    detail?: string,
    provider = 'system'
  ): void {
    const current = this.providers[id].get(provider) ?? {
      state: 'idle' as const,
      completed: 0,
      total: 0
    }
    this.providers[id].set(provider, {
      state: 'running',
      completed: Math.max(0, completed),
      total: Math.max(0, total ?? current.total),
      detail: detail ?? current.detail
    })
    this.aggregate(id)
  }

  complete(id: SyncPipelineId, detail?: string, provider = 'system'): void {
    const current = this.providers[id].get(provider) ?? {
      state: 'idle' as const,
      completed: 0,
      total: 0
    }
    this.providers[id].set(provider, {
      ...current,
      state: 'complete',
      completed: current.total,
      detail: detail ?? current.detail
    })
    this.aggregate(id)
  }

  fail(id: SyncPipelineId, detail?: string, provider = 'system'): void {
    const current = this.providers[id].get(provider) ?? {
      state: 'idle' as const,
      completed: 0,
      total: 0
    }
    this.providers[id].set(provider, { ...current, state: 'error', detail })
    this.aggregate(id)
  }

  getStatus(): SystemSyncStatus {
    return cloneStatus(this.status)
  }

  private aggregate(id: SyncPipelineId): void {
    const values = [...this.providers[id].values()]
    const now = Date.now()
    const completed = values.reduce((sum, value) => sum + value.completed, 0)
    const total = values.reduce((sum, value) => sum + value.total, 0)
    const state: SyncPipelineState = values.some((value) => value.state === 'running')
      ? 'running'
      : values.some((value) => value.state === 'error')
        ? 'error'
        : values.length > 0 && values.every((value) => value.state === 'complete')
          ? 'complete'
          : 'idle'
    const activeDetails = values
      .filter((value) => value.state === 'running')
      .map((value) => value.detail)
      .filter((value): value is string => Boolean(value))

    this.status.pipelines[id] = {
      id,
      state,
      completed,
      total,
      detail: activeDetails.join(', ') || undefined,
      updatedAt: now
    }
    this.status.updatedAt = now
    this.scheduleStatusEmit()
  }

  private scheduleStatusEmit(): void {
    if (this.emitTimer) return
    this.emitTimer = setTimeout(() => {
      this.emitTimer = undefined
      this.emit('updated', this.getStatus())
    }, 100)
    this.emitTimer.unref()
  }

  private emitStatusImmediately(): void {
    if (this.emitTimer) clearTimeout(this.emitTimer)
    this.emitTimer = undefined
    this.emit('updated', this.getStatus())
  }
}

export const syncCoordinator = new SyncCoordinator()
