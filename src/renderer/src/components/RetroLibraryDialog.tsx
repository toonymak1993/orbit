import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import {
  CheckCircle2,
  CircleAlert,
  FolderPlus,
  Gamepad2,
  Loader2,
  RefreshCw,
  Trash2,
  Trophy,
  X
} from 'lucide-react'
import type { RetroLibraryResult, RetroLibraryStatus } from '@shared/ipc'
import { retroSystemById } from '@shared/retroSystems'
import { useBackHandler } from '@renderer/hooks/useBackHandler'
import { useT } from '@renderer/i18n/useT'
import { focusElement } from '@renderer/lib/spatialNavigation'
import { useLibraryStore } from '@renderer/state/libraryStore'

interface Props {
  onClose: () => void
  onCompleted: () => void
}

export function RetroLibraryDialog({ onClose, onCompleted }: Props): JSX.Element {
  const t = useT()
  const applySnapshot = useLibraryStore((state) => state.applySnapshot)
  const [status, setStatus] = useState<RetroLibraryStatus | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [credentialsConfigured, setCredentialsConfigured] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const addRef = useRef<HTMLButtonElement>(null)

  const close = useCallback((): void => {
    onClose()
  }, [onClose])

  useBackHandler(close)

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    const appRoot = document.getElementById('root')
    const rootWasInert = appRoot?.hasAttribute('inert') ?? false
    const previousAriaHidden = appRoot?.getAttribute('aria-hidden') ?? null
    appRoot?.setAttribute('inert', '')
    appRoot?.setAttribute('aria-hidden', 'true')
    return () => {
      if (!rootWasInert) appRoot?.removeAttribute('inert')
      if (previousAriaHidden === null) appRoot?.removeAttribute('aria-hidden')
      else appRoot?.setAttribute('aria-hidden', previousAriaHidden)
      if (previousFocus?.isConnected) requestAnimationFrame(() => focusElement(previousFocus))
    }
  }, [])

  const applyResult = useCallback((result: RetroLibraryResult): void => {
    applySnapshot(result.snapshot)
    setStatus(result.status)
    if (result.status.gameCount > 0) onCompleted()
  }, [applySnapshot, onCompleted])

  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    const origin = document.activeElement as HTMLElement | null
    setBusy(true)
    setError(null)
    try {
      return await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('retro.error'))
      return undefined
    } finally {
      setBusy(false)
      requestAnimationFrame(() => focusElement(origin?.isConnected ? origin : addRef.current))
    }
  }, [t])

  useEffect(() => {
    let active = true
    void Promise.all([
      window.api.settings.get(),
      window.api.retroAchievements.credentials.get()
    ]).then(([settings, credentialStatus]) => {
      if (active) {
        setCredentialsConfigured(
          Boolean(settings.retroAchievementsUsername && credentialStatus.configured)
        )
      }
    })
    void window.api.library.retro
      .refresh()
      .then((result) => {
        if (!active) return
        applySnapshot(result.snapshot)
        setStatus(result.status)
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : t('retro.error'))
      })
      .finally(() => {
        if (!active) return
        setBusy(false)
        requestAnimationFrame(() => focusElement(addRef.current))
      })
    return () => {
      active = false
    }
  }, [applySnapshot, t])

  const addDirectory = async (): Promise<void> => {
    const result = await run(() => window.api.library.retro.addDirectory())
    if (result) applyResult(result)
  }

  const refresh = async (): Promise<void> => {
    const result = await run(() => window.api.library.retro.refresh())
    if (result) applyResult(result)
  }

  const removeDirectory = async (directory: string): Promise<void> => {
    if (confirmRemove !== directory) {
      setConfirmRemove(directory)
      return
    }
    const result = await run(() => window.api.library.retro.removeDirectory(directory))
    setConfirmRemove(null)
    if (result) applyResult(result)
  }

  return createPortal(
    <motion.div
      data-focus-scope="active"
      role="dialog"
      aria-modal="true"
      aria-labelledby="retro-library-title"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onPointerDown={(event) => {
        if (event.currentTarget === event.target) close()
      }}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 px-[clamp(1rem,4vw,4rem)] py-[clamp(1rem,4vh,3rem)] backdrop-blur-md"
    >
      <motion.section
        initial={{ y: 24, scale: 0.98 }}
        animate={{ y: 0, scale: 1 }}
        exit={{ y: 18, scale: 0.985 }}
        transition={{ type: 'spring', stiffness: 320, damping: 30 }}
        onPointerDown={(event) => event.stopPropagation()}
        aria-busy={busy}
        className="relative flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-[clamp(1.4rem,2.4vw,2.4rem)] border border-white/10 bg-surface shadow-[0_30px_100px_rgba(0,0,0,0.7)]"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgb(var(--color-accent)/0.11),transparent_35%)]" />
        <header className="relative border-b border-white/[0.08] px-[clamp(4.5rem,10vw,7rem)] py-[clamp(1.15rem,2.8vh,1.9rem)] text-center">
          <div className="mx-auto max-w-3xl">
            <h1 id="retro-library-title" className="text-[clamp(1.35rem,2.5vw,2.2rem)] font-bold text-white">
              {t('retro.title')}
            </h1>
            <p className="mt-1 text-sm leading-relaxed text-white/50">
              {t('retro.body')}
            </p>
          </div>
          <button
            data-focusable
            type="button"
            onClick={close}
            aria-label={t('retro.close')}
            className="absolute right-[clamp(1rem,2.5vw,1.75rem)] top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-white/70 transition-colors hover:bg-white/15 hover:text-white"
          >
            <X size={19} />
          </button>
        </header>

        <div className="relative min-h-0 flex-1 overflow-y-auto p-[clamp(1.25rem,3vw,2.5rem)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-semibold text-white/70">
                {t('retro.gamesCount', { count: status?.gameCount ?? 0 })}
              </span>
              <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-semibold text-white/70">
                {t('retro.emulatorsCount', { count: status?.emulators.length ?? 0 })}
              </span>
              {credentialsConfigured && (
                <span className="flex items-center gap-1.5 rounded-full border border-accent/20 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent">
                  <Trophy size={13} />
                  {t('retro.achievementsMatched', { count: status?.matchedAchievementsCount ?? 0 })}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                data-focusable
                type="button"
                disabled={busy}
                data-disabled={busy ? 'true' : undefined}
                onClick={() => void refresh()}
                className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-4 py-2.5 text-sm font-semibold text-white/70 transition-colors hover:bg-white/10 hover:text-white"
              >
                <RefreshCw size={16} className={busy ? 'animate-spin' : undefined} />
                {t('retro.refresh')}
              </button>
              <button
                ref={addRef}
                data-focusable
                type="button"
                disabled={busy}
                data-disabled={busy ? 'true' : undefined}
                onClick={() => void addDirectory()}
                className="flex items-center gap-2 rounded-full bg-accent px-4 py-2.5 text-sm font-bold text-black shadow-[0_10px_28px_rgb(var(--color-accent)/0.18)]"
              >
                <FolderPlus size={17} />
                {t('retro.addFolder')}
              </button>
            </div>
          </div>

          {!credentialsConfigured && (
            <div className="mt-4 flex items-start gap-3 rounded-xl2 border border-amber-200/15 bg-amber-100/[0.06] p-4 text-amber-50/80">
              <Trophy size={18} className="mt-0.5 shrink-0 text-amber-200" />
              <div>
                <p className="text-sm font-semibold">{t('retro.achievementsSetupTitle')}</p>
                <p className="mt-1 text-xs leading-relaxed text-amber-50/55">
                  {t('retro.achievementsSetupBody')}
                </p>
              </div>
            </div>
          )}

          <section className="mt-5">
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.14em] text-white/55">
              <Gamepad2 size={17} className="text-accent" />
              {t('retro.emulatorsTitle')}
            </h2>
            {status?.emulators.length ? (
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {status.emulators.map((emulator) => (
                  <article key={emulator.id} className="rounded-xl2 border border-white/[0.08] bg-black/25 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-bold text-white">{emulator.name}</p>
                        <p className="mt-1 text-xs text-white/45">
                          {emulator.kind === 'retroarch'
                            ? t('retro.retroArchCores', { count: emulator.coreCount ?? 0 })
                            : t('retro.standalone')}
                        </p>
                      </div>
                      {emulator.readySystems.length > 0 ? (
                        <CheckCircle2 size={18} className="shrink-0 text-emerald-300" />
                      ) : (
                        <CircleAlert size={18} className="shrink-0 text-amber-200" />
                      )}
                    </div>
                    <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-white/60">
                      {emulator.readySystems.length > 0
                        ? emulator.readySystems.map((id) => retroSystemById(id).name).join(' · ')
                        : t('retro.noReadySystems')}
                    </p>
                    {emulator.achievementsSupported && (
                      <p className="mt-3 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-accent">
                        <Trophy size={12} />
                        {t('retro.achievementsCapable')}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <div className="mt-3 rounded-xl2 border border-dashed border-white/10 bg-white/[0.025] p-5 text-sm text-white/50">
                {t('retro.noEmulators')}
              </div>
            )}
          </section>

          <section className="mt-6">
            <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-white/55">
              {t('retro.foldersTitle')}
            </h2>
            {status?.directories.length ? (
              <div className="mt-3 space-y-2">
                {status.directories.map((directory) => (
                  <article key={directory.path} className="flex flex-wrap items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.035] px-4 py-3">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${directory.state === 'ready' ? 'bg-emerald-300' : 'bg-amber-300'}`} />
                    <div className="min-w-[12rem] flex-1">
                      <p className="truncate text-sm font-semibold text-white/75" title={directory.path}>{directory.path}</p>
                      <p className="mt-0.5 text-xs text-white/35">
                        {directory.state === 'ready'
                          ? t('retro.folderGames', { count: directory.gameCount })
                          : t('retro.folderMissing')}
                        {directory.issue === 'scan-limit-reached' ? ` · ${t('retro.scanLimited')}` : ''}
                        {directory.issue === 'scan-failed' ? ` · ${t('retro.scanFailed')}` : ''}
                      </p>
                    </div>
                    <button
                      data-focusable
                      type="button"
                      disabled={busy}
                      data-disabled={busy ? 'true' : undefined}
                      onClick={() => void removeDirectory(directory.path)}
                      className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold transition-colors ${
                        confirmRemove === directory.path
                          ? 'bg-rose-300/15 text-rose-200'
                          : 'text-white/45 hover:bg-white/[0.07] hover:text-white'
                      }`}
                    >
                      <Trash2 size={14} />
                      {confirmRemove === directory.path ? t('retro.confirmRemove') : t('retro.removeFolder')}
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <div className="mt-3 rounded-xl2 border border-dashed border-white/10 bg-white/[0.025] p-5 text-sm text-white/50">
                {t('retro.noFolders')}
              </div>
            )}
          </section>
        </div>

        {error && (
          <p role="alert" className="relative border-t border-rose-300/15 bg-rose-300/[0.08] px-6 py-3 text-sm text-rose-200">
            {error}
          </p>
        )}
        {busy && !status && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35 backdrop-blur-[2px]">
            <div className="flex items-center gap-3 rounded-full border border-white/10 bg-black/65 px-5 py-3 text-sm font-semibold text-white/75">
              <Loader2 size={18} className="animate-spin text-accent" />
              {t('retro.scanning')}
            </div>
          </div>
        )}
      </motion.section>
    </motion.div>,
    document.body
  )
}
