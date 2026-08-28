import { AlertCircle, CheckCircle2, DownloadCloud, ShieldCheck } from 'lucide-react'
import { motion } from 'framer-motion'
import { useT } from '@renderer/i18n/useT'
import { useAppUpdateStore } from '@renderer/state/appUpdateStore'

export function AppUpdateStatusChip(): JSX.Element | null {
  const t = useT()
  const snapshot = useAppUpdateStore((state) => state.snapshot)
  const showBanner = useAppUpdateStore((state) => state.showBanner)
  const check = useAppUpdateStore((state) => state.check)
  const download = useAppUpdateStore((state) => state.download)

  if (
    snapshot.stage !== 'available' &&
    snapshot.stage !== 'downloading' &&
    snapshot.stage !== 'verifying' &&
    snapshot.stage !== 'ready' &&
    snapshot.stage !== 'error'
  ) {
    return null
  }

  if (snapshot.stage === 'downloading' || snapshot.stage === 'verifying') {
    const verifying = snapshot.stage === 'verifying'
    const statusKey = verifying
      ? 'appUpdate.status.verifying'
      : snapshot.downloadPausedReason
        ? 'appUpdate.status.downloadPaused'
        : 'appUpdate.status.downloading'
    return (
      <div
        role="status"
        aria-label={t(statusKey, { percent: Math.round(snapshot.percent ?? 0) })}
        className="hidden min-w-24 items-center gap-2 rounded-full border border-white/[0.08] bg-black/20 px-3 py-1.5 text-[10px] font-bold text-white/55 xl:flex"
      >
        {verifying ? (
          <ShieldCheck size={13} className="text-emerald-300" />
        ) : (
          <DownloadCloud size={13} className="text-accent" />
        )}
        <span className="whitespace-nowrap">
          {t(statusKey, { percent: Math.round(snapshot.percent ?? 0) })}
        </span>
        {!verifying && (
          <span className="h-1 w-10 overflow-hidden rounded-full bg-white/10">
            <span
              className="block h-full rounded-full bg-accent transition-[width] duration-300"
              style={{ width: `${Math.max(2, snapshot.percent ?? 0)}%` }}
            />
          </span>
        )}
      </div>
    )
  }

  const failed = snapshot.stage === 'error'
  const available = snapshot.stage === 'available'
  return (
    <motion.button
      data-focusable
      type="button"
      onClick={() => (failed ? void check() : available ? void download() : showBanner())}
      whileTap={{ scale: 0.96 }}
      aria-label={t(
        failed
          ? 'appUpdate.status.retry'
          : available
            ? 'appUpdate.status.downloadAvailable'
            : 'appUpdate.status.ready', {
        version: snapshot.targetVersion ?? ''
      })}
      className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-black transition-colors ${
        failed
          ? 'border-rose-300/20 bg-rose-300/[0.08] text-rose-100 hover:bg-rose-300/[0.14]'
          : 'border-accent/30 bg-accent/10 text-accent hover:bg-accent/16'
      }`}
    >
      {failed ? <AlertCircle size={13} /> : available ? <DownloadCloud size={13} /> : <CheckCircle2 size={13} />}
      <span className="hidden whitespace-nowrap xl:inline">
        {t(failed ? 'appUpdate.status.retry' : available ? 'appUpdate.status.downloadAvailable' : 'appUpdate.status.ready', {
          version: snapshot.targetVersion ?? ''
        })}
      </span>
    </motion.button>
  )
}
