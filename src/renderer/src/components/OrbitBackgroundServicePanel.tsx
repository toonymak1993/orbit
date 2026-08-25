import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { CheckCircle2, CircleAlert, Loader2, Power, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import type {
  OrbitBackgroundServiceAction,
  OrbitBackgroundServiceStatus
} from '@shared/ipc'
import { useT } from '@renderer/i18n/useT'
import { usePreferencesStore } from '@renderer/state/preferencesStore'

const INITIAL_STATUS: OrbitBackgroundServiceStatus = {
  installation: 'not-installed',
  runtime: 'stopped',
  hardwareControl: { state: 'disabled', connectedControllers: 0 }
}

function presentation(
  status: OrbitBackgroundServiceStatus,
  t: ReturnType<typeof useT>
): { label: string; tone: string; icon: JSX.Element } {
  if (status.installation === 'unsupported') {
    return {
      label: t('settings.backgroundService.status.unsupported'),
      tone: 'border-amber-300/25 bg-amber-300/10 text-amber-200',
      icon: <CircleAlert size={12} />
    }
  }
  if (status.installation === 'repair-needed') {
    return {
      label: t('settings.backgroundService.status.repairNeeded'),
      tone: 'border-amber-300/25 bg-amber-300/10 text-amber-200',
      icon: <CircleAlert size={12} />
    }
  }
  if (status.installation === 'not-installed') {
    return {
      label: t('settings.backgroundService.status.notInstalled'),
      tone: 'border-white/10 bg-white/[0.04] text-white/45',
      icon: <Power size={12} />
    }
  }
  if (status.runtime === 'running') {
    return {
      label: t('settings.backgroundService.status.running'),
      tone: 'border-emerald-300/25 bg-emerald-300/10 text-emerald-200',
      icon: <CheckCircle2 size={12} />
    }
  }
  return {
    label: t(
      status.runtime === 'starting'
        ? 'settings.backgroundService.status.starting'
        : 'settings.backgroundService.status.stopped'
    ),
    tone: 'border-accent/25 bg-accent/10 text-accent',
    icon:
      status.runtime === 'starting' ? (
        <Loader2 size={12} className="animate-spin" />
      ) : (
        <CircleAlert size={12} />
      )
  }
}

export function OrbitBackgroundServicePanel(): JSX.Element {
  const t = useT()
  const setHardwareControlEnabled = usePreferencesStore(
    (state) => state.setHardwareControlEnabled
  )
  const [status, setStatus] = useState(INITIAL_STATUS)
  const [busy, setBusy] = useState<OrbitBackgroundServiceAction | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let mounted = true
    const unsubscribe = window.api.backgroundService.onStatus((next) => {
      if (mounted) setStatus(next)
    })
    void window.api.backgroundService.getStatus().then((next) => {
      if (mounted) setStatus(next)
    })
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  const run = async (action: OrbitBackgroundServiceAction): Promise<void> => {
    setBusy(action)
    setFailed(false)
    try {
      if (action === 'remove') await setHardwareControlEnabled(false)
      setStatus(await window.api.backgroundService.control(action))
    } catch {
      setFailed(true)
    } finally {
      setBusy(null)
    }
  }

  const statusPresentation = presentation(status, t)
  const primaryAction: OrbitBackgroundServiceAction =
    status.installation === 'not-installed'
      ? 'install'
      : status.installation === 'repair-needed'
        ? 'repair'
        : 'restart'
  const primaryLabel =
    primaryAction === 'install'
      ? t('settings.backgroundService.install')
      : primaryAction === 'repair'
        ? t('settings.backgroundService.repair')
        : t('settings.backgroundService.restart')
  const disabled = busy !== null || status.installation === 'unsupported'

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-black/25 p-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent/12 text-accent">
            <ShieldCheck size={21} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-bold text-white/88">
                {t('settings.backgroundService.name')}
              </h3>
              <span
                role="status"
                className={
                  'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider ' +
                  statusPresentation.tone
                }
              >
                {statusPresentation.icon}
                {statusPresentation.label}
              </span>
            </div>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-white/45">
              {t('settings.backgroundService.body')}
            </p>
            <p className="mt-2 text-[10px] leading-relaxed text-white/32">
              {t('settings.backgroundService.noAdmin')}
            </p>
            {failed && (
              <p className="mt-2 flex items-center gap-1.5 text-[10px] font-semibold text-amber-200">
                <CircleAlert size={11} />
                {t('settings.backgroundService.failed')}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {status.installation === 'installed' && (
            <motion.button
              data-focusable
              type="button"
              disabled={busy !== null}
              onClick={() => void run('remove')}
              whileTap={{ scale: 0.96 }}
              className="flex min-h-10 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 text-xs font-bold text-white/48 disabled:opacity-40"
            >
              {busy === 'remove' ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              {t('settings.backgroundService.remove')}
            </motion.button>
          )}
          <motion.button
            data-focusable
            type="button"
            disabled={disabled}
            onClick={() => void run(primaryAction)}
            whileTap={{ scale: 0.96 }}
            className="flex min-h-10 items-center gap-2 rounded-full border border-accent/70 bg-accent px-4 text-xs font-bold text-black disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy === primaryAction ? (
              <Loader2 size={14} className="animate-spin" />
            ) : primaryAction === 'restart' ? (
              <RefreshCw size={14} />
            ) : (
              <ShieldCheck size={14} />
            )}
            {primaryLabel}
          </motion.button>
        </div>
      </div>
    </div>
  )
}
