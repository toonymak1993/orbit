import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, Loader2, LogOut, Moon, Power, RefreshCw, RotateCcw, X } from 'lucide-react'
import type { AppControlAction, SystemPowerAction } from '@shared/ipc'
import { useBackHandler } from '@renderer/hooks/useBackHandler'
import { useT } from '@renderer/i18n/useT'
import type { TranslationKey } from '@renderer/i18n/translations'
import { focusElement } from '@renderer/lib/spatialNavigation'

interface PowerOption {
  id: SystemPowerAction | AppControlAction
  scope: 'app' | 'system'
  icon: typeof Power
  labelKey: TranslationKey
  bodyKey: TranslationKey
  color: string
}

const APP_OPTIONS: PowerOption[] = [
  {
    id: 'relaunch',
    scope: 'app',
    icon: RefreshCw,
    labelKey: 'system.power.appRestart',
    bodyKey: 'system.power.appRestartBody',
    color: 'from-violet-400/25 to-fuchsia-500/10 text-violet-200'
  },
  {
    id: 'quit',
    scope: 'app',
    icon: LogOut,
    labelKey: 'system.power.appQuit',
    bodyKey: 'system.power.appQuitBody',
    color: 'from-slate-300/20 to-slate-500/10 text-slate-100'
  }
]

const DEVICE_OPTIONS: PowerOption[] = [
  {
    id: 'sleep',
    scope: 'system',
    icon: Moon,
    labelKey: 'system.power.sleep',
    bodyKey: 'system.power.sleepBody',
    color: 'from-sky-400/25 to-indigo-500/10 text-sky-200'
  },
  {
    id: 'restart',
    scope: 'system',
    icon: RotateCcw,
    labelKey: 'system.power.restart',
    bodyKey: 'system.power.restartBody',
    color: 'from-amber-400/25 to-orange-500/10 text-amber-200'
  },
  {
    id: 'shutdown',
    scope: 'system',
    icon: Power,
    labelKey: 'system.power.shutdown',
    bodyKey: 'system.power.shutdownBody',
    color: 'from-rose-400/25 to-red-500/10 text-rose-200'
  }
]
const POWER_OPTIONS = [...APP_OPTIONS, ...DEVICE_OPTIONS]

export function PowerMenu(): JSX.Element {
  const [open, setOpen] = useState(false)
  const t = useT()

  return (
    <>
      <motion.button
        data-focusable
        type="button"
        aria-label={t('system.power.open')}
        aria-expanded={open}
        onClick={() => setOpen(true)}
        whileHover={{ scale: 1.07 }}
        whileTap={{ scale: 0.92 }}
        animate={open ? { rotate: 90, scale: 1.05 } : { rotate: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 420, damping: 28 }}
        className="group relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-white/10 hover:text-white data-[focused=true]:bg-white/10 data-[focused=true]:text-accent"
      >
        <span className="absolute inset-1 rounded-full bg-accent/0 blur-md transition-colors group-data-[focused=true]:bg-accent/25" />
        <Power size={17} className="relative" />
      </motion.button>

      {createPortal(
        <AnimatePresence>
          {open && <PowerMenuDialog onClose={() => setOpen(false)} />}
        </AnimatePresence>,
        document.body
      )}
    </>
  )
}

function PowerMenuDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const t = useT()
  const firstOptionRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const [pendingAction, setPendingAction] = useState<
    SystemPowerAction | AppControlAction | null
  >(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)

  useBackHandler(() => {
    if (busy) return
    if (pendingAction) {
      setPendingAction(null)
      setError(false)
    } else {
      onClose()
    }
  })

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    const frame = requestAnimationFrame(() => focusElement(firstOptionRef.current))
    return () => {
      cancelAnimationFrame(frame)
      if (previousFocus?.isConnected) requestAnimationFrame(() => focusElement(previousFocus))
    }
  }, [])

  useEffect(() => {
    if (!pendingAction) return
    const frame = requestAnimationFrame(() => focusElement(cancelRef.current))
    return () => cancelAnimationFrame(frame)
  }, [pendingAction])

  const selected = POWER_OPTIONS.find((option) => option.id === pendingAction)

  const confirm = async (): Promise<void> => {
    if (!pendingAction || busy) return
    setBusy(true)
    setError(false)
    try {
      if (selected?.scope === 'app') {
        await window.api.app.control(pendingAction as AppControlAction)
      } else {
        await window.api.system.power(pendingAction as SystemPowerAction)
      }
      onClose()
    } catch {
      setBusy(false)
      setError(true)
    }
  }

  return (
    <motion.div
      data-focus-scope="active"
      role="dialog"
      aria-modal="true"
      aria-label={t('system.power.title')}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
      className="fixed inset-0 z-[90] bg-black/45"
    >
      <motion.section
        initial={{ opacity: 0, y: -18, x: 16, scale: 0.92, filter: 'blur(8px)' }}
        animate={{ opacity: 1, y: 0, x: 0, scale: 1, filter: 'blur(0px)' }}
        exit={{ opacity: 0, y: -12, x: 12, scale: 0.95, filter: 'blur(6px)' }}
        transition={{ type: 'spring', stiffness: 390, damping: 31, mass: 0.82 }}
        onPointerDown={(event) => event.stopPropagation()}
        className="scrollbar-none absolute right-4 top-[4.5rem] max-h-[calc(100vh-5.25rem)] w-[min(21rem,calc(100vw-2rem))] overflow-y-auto rounded-[1.4rem] border border-white/10 bg-[#090c12] p-1.5 shadow-[0_28px_80px_rgba(0,0,0,0.72)] xl:right-8"
      >
        <div className="pointer-events-none absolute -right-16 -top-20 h-40 w-40 rounded-full bg-accent/10 blur-3xl" />
        <div className="relative rounded-[1.05rem] border border-white/[0.06] bg-[#10151d] p-3">
          <AnimatePresence mode="wait" initial={false}>
            {!selected ? (
              <motion.div
                key="options"
                initial={{ opacity: 0, x: -14 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -14 }}
                transition={{ duration: 0.16 }}
              >
                <div className="mb-3 flex items-start justify-between gap-3 px-1">
                  <div>
                    <p className="text-base font-bold text-white">{t('system.power.title')}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-white/45">
                      {t('system.power.subtitle')}
                    </p>
                  </div>
                  <button
                    data-focusable
                    type="button"
                    onClick={onClose}
                    aria-label={t('system.power.cancel')}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#1a202b] text-white/55 transition-colors hover:bg-[#242c39] hover:text-white"
                  >
                    <X size={16} />
                  </button>
                </div>

                <p className="mb-2 px-1 text-[9px] font-bold uppercase tracking-[0.2em] text-accent">
                  {t('system.power.application')}
                </p>
                <div className="space-y-1.5">
                  {APP_OPTIONS.map((option, index) => {
                    const Icon = option.icon
                    return (
                      <motion.button
                        key={option.id}
                        ref={index === 0 ? firstOptionRef : undefined}
                        data-focusable
                        type="button"
                        onClick={() => {
                          setError(false)
                          setPendingAction(option.id)
                        }}
                        whileHover={{ x: 4 }}
                        whileFocus={{ x: 4 }}
                        whileTap={{ scale: 0.985 }}
                        transition={{ type: 'spring', stiffness: 440, damping: 31 }}
                        className="group flex w-full items-center gap-2.5 rounded-xl border border-white/[0.07] bg-[#151b25] p-2.5 text-left transition-colors hover:bg-[#1d2532]"
                      >
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${option.color}`}
                        >
                          <Icon size={17} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-white">
                            {t(option.labelKey)}
                          </span>
                          <span className="mt-0.5 block text-[10px] leading-snug text-white/42">
                            {t(option.bodyKey)}
                          </span>
                        </span>
                        <span className="mr-1 text-lg text-white/20 transition-all group-hover:translate-x-1 group-hover:text-white/55">
                          ›
                        </span>
                      </motion.button>
                    )
                  })}
                </div>

                <p className="mb-2 mt-3 px-1 text-[9px] font-bold uppercase tracking-[0.2em] text-white/35">
                  {t('system.power.device')}
                </p>
                <div className="space-y-1.5">
                  {DEVICE_OPTIONS.map((option) => {
                    const Icon = option.icon
                    return (
                      <motion.button
                        key={option.id}
                        data-focusable
                        type="button"
                        onClick={() => {
                          setError(false)
                          setPendingAction(option.id)
                        }}
                        whileHover={{ x: 4 }}
                        whileFocus={{ x: 4 }}
                        whileTap={{ scale: 0.985 }}
                        transition={{ type: 'spring', stiffness: 440, damping: 31 }}
                        className="group flex w-full items-center gap-2.5 rounded-xl border border-white/[0.07] bg-[#151b25] p-2.5 text-left transition-colors hover:bg-[#1d2532]"
                      >
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${option.color}`}
                        >
                          <Icon size={17} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-white">
                            {t(option.labelKey)}
                          </span>
                          <span className="mt-0.5 block text-[10px] leading-snug text-white/42">
                            {t(option.bodyKey)}
                          </span>
                        </span>
                        <span className="mr-1 text-lg text-white/20 transition-all group-hover:translate-x-1 group-hover:text-white/55">
                          ›
                        </span>
                      </motion.button>
                    )
                  })}
                </div>
              </motion.div>
            ) : (
              <motion.div
                key={`confirm-${selected.id}`}
                initial={{ opacity: 0, x: 18 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 18 }}
                transition={{ duration: 0.16 }}
                className="px-1 py-1"
              >
                <div
                  className={`mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${selected.color}`}
                >
                  <selected.icon size={25} />
                </div>
                <h2 className="text-xl font-bold text-white">
                  {t('system.power.confirmTitle', { action: t(selected.labelKey) })}
                </h2>
                <p className="mt-2 text-xs leading-relaxed text-white/50">
                  {t('system.power.confirmBody')}
                </p>

                {error && (
                  <motion.p
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-3 flex items-center gap-2 rounded-xl bg-rose-400/10 px-3 py-2 text-xs text-rose-200"
                  >
                    <AlertTriangle size={14} />
                    {t('system.power.failed')}
                  </motion.p>
                )}

                <div className="mt-5 grid grid-cols-2 gap-2">
                  <button
                    ref={cancelRef}
                    data-focusable
                    data-disabled={busy ? 'true' : undefined}
                    disabled={busy}
                    type="button"
                    onClick={() => {
                      setPendingAction(null)
                      setError(false)
                    }}
                    className="rounded-full border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/[0.12] disabled:opacity-40"
                  >
                    {t('system.power.cancel')}
                  </button>
                  <button
                    data-focusable
                    data-disabled={busy ? 'true' : undefined}
                    disabled={busy}
                    type="button"
                    onClick={() => void confirm()}
                    className="flex items-center justify-center gap-2 rounded-full bg-accent px-4 py-3 text-sm font-bold text-black shadow-[0_10px_30px_rgb(var(--color-accent)/0.22)] transition-transform hover:scale-[1.02] disabled:opacity-60"
                  >
                    {busy && <Loader2 size={15} className="animate-spin" />}
                    {busy ? t('system.power.working') : t('system.power.confirm')}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.section>
    </motion.div>
  )
}
