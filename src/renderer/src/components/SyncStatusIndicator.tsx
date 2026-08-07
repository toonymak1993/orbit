import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Database, FileText, ImageIcon, Loader2, ShoppingBag, Trophy } from 'lucide-react'
import type { SyncPipelineId, SyncPipelineProgress } from '@shared/ipc'
import { SYNC_PIPELINE_ORDER, useSyncStore } from '@renderer/state/syncStore'
import { useT } from '@renderer/i18n/useT'
import type { TranslationKey } from '@renderer/i18n/translations'

const PIPELINES: Record<
  SyncPipelineId,
  { icon: typeof Database; labelKey: TranslationKey }
> = {
  library: { icon: Database, labelKey: 'sync.library' },
  metadata: { icon: FileText, labelKey: 'sync.metadata' },
  artwork: { icon: ImageIcon, labelKey: 'sync.artwork' },
  achievements: { icon: Trophy, labelKey: 'sync.achievements' },
  store: { icon: ShoppingBag, labelKey: 'sync.store' }
}

function ProgressText({ progress }: { progress: SyncPipelineProgress }): JSX.Element {
  const t = useT()
  if (progress.state === 'complete') return <span>{t('sync.complete')}</span>
  if (progress.state === 'error') return <span>{t('sync.error')}</span>
  if (progress.total > 0) return <span>{progress.completed}/{progress.total}</span>
  return <span>{t('sync.waiting')}</span>
}

export function SyncStatusIndicator({ detailed = false }: { detailed?: boolean }): JSX.Element | null {
  const status = useSyncStore((state) => state.status)
  const t = useT()
  const [activeIndex, setActiveIndex] = useState(0)
  const pipelines = SYNC_PIPELINE_ORDER.map((id) => status.pipelines[id])
  const hasStarted = Boolean(status.startedAt)

  useEffect(() => {
    const runningCount = pipelines.filter((progress) => progress.state === 'running').length
    if (detailed || runningCount < 2) return undefined
    const timer = setInterval(() => setActiveIndex((index) => index + 1), 2500)
    return () => clearInterval(timer)
  }, [detailed, pipelines.map((progress) => progress.state).join(':')])

  if (!hasStarted && !detailed) return null

  if (detailed) {
    return (
      <div className="w-full max-w-lg space-y-2 rounded-2xl bg-white/5 p-4 text-left">
        {pipelines.map((progress) => {
          const config = PIPELINES[progress.id]
          const Icon = config.icon
          const percentage = progress.total > 0 ? (progress.completed / progress.total) * 100 : 0
          return (
            <div key={progress.id} className="space-y-1.5">
              <div className="flex items-center gap-2 text-xs">
                {progress.state === 'running' ? (
                  <Loader2 size={14} className="animate-spin text-accent" />
                ) : progress.state === 'complete' ? (
                  <Check size={14} className="text-emerald-400" />
                ) : progress.state === 'error' ? (
                  <AlertTriangle size={14} className="text-amber-400" />
                ) : (
                  <Icon size={14} className="text-muted" />
                )}
                <span className="flex-1 font-medium text-text">{t(config.labelKey)}</span>
                <span className="text-muted"><ProgressText progress={progress} /></span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-300"
                  style={{ width: `${progress.state === 'complete' ? 100 : percentage}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  const active = pipelines.filter((progress) => progress.state === 'running')
  const failed = pipelines.find((progress) => progress.state === 'error')
  if (active.length === 0) {
    if (failed) {
      return (
        <div className="flex items-center gap-2 rounded-full bg-amber-400/10 px-3 py-1.5 text-xs text-amber-300">
          <AlertTriangle size={13} />
          {t('sync.error')}
        </div>
      )
    }
    return (
      <div className="flex items-center gap-2 rounded-full bg-emerald-400/10 px-3 py-1.5 text-xs text-emerald-300">
        <Check size={13} />
        {t('sync.allComplete')}
      </div>
    )
  }

  const current = active[activeIndex % active.length]
  const config = PIPELINES[current.id]
  return (
    <div className="flex min-w-40 items-center gap-1.5 whitespace-nowrap rounded-full bg-white/5 px-3 py-1.5 text-xs text-muted">
      <Loader2 size={12} className="animate-spin text-accent" />
      <span className="text-text/80">{t(config.labelKey)}</span>
      <span className="ml-auto"><ProgressText progress={current} /></span>
    </div>
  )
}
