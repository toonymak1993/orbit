import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import {
  Check,
  CircleAlert,
  Cpu,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
  Sparkles,
  X
} from 'lucide-react'
import type {
  OrbitSettings,
  RetroEmulatorInstallPhase,
  RetroEmulatorInstallProgress,
  RetroLibraryStatus,
  RetroSystemId
} from '@shared/ipc'
import {
  recommendedRetroEmulatorDownload,
  retroEmulatorDownloadsForSystem
} from '@shared/retroSystems'
import { useBackHandler } from '@renderer/hooks/useBackHandler'
import { useT } from '@renderer/i18n/useT'
import type { TranslationKey } from '@renderer/i18n/translations'
import { focusElement } from '@renderer/lib/spatialNavigation'
import { useLibraryStore } from '@renderer/state/libraryStore'

interface Props {
  systemId: RetroSystemId
  systemName: string
  onApplied: (emulatorName?: string) => void
  onClose: () => void
}

const AUTOMATIC = '__automatic__'

const INSTALL_PHASE_KEYS = {
  checking: 'retro.setup.phase.checking',
  resolving: 'retro.setup.phase.resolving',
  downloading: 'retro.setup.phase.downloading',
  extracting: 'retro.setup.phase.extracting',
  'installing-core': 'retro.setup.phase.installingCore',
  verifying: 'retro.setup.phase.verifying',
  complete: 'retro.setup.phase.complete'
} satisfies Record<RetroEmulatorInstallPhase, TranslationKey>

export function RetroSystemEmulatorDialog({
  systemId,
  systemName,
  onApplied,
  onClose
}: Props): JSX.Element {
  const t = useT()
  const applySnapshot = useLibraryStore((state) => state.applySnapshot)
  const [status, setStatus] = useState<RetroLibraryStatus | null>(null)
  const [settings, setSettings] = useState<OrbitSettings | null>(null)
  const [selectedId, setSelectedId] = useState(AUTOMATIC)
  const [busy, setBusy] = useState(true)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [installingId, setInstallingId] = useState<string | null>(null)
  const [installProgress, setInstallProgress] = useState<RetroEmulatorInstallProgress | null>(null)
  const [failedInstallId, setFailedInstallId] = useState<string | null>(null)
  const [openedId, setOpenedId] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const checkRef = useRef<HTMLButtonElement>(null)
  const cancelRequestedRef = useRef(false)

  const close = useCallback((): void => {
    if (installingId) {
      cancelRequestedRef.current = true
      setNotice(t('retro.setup.canceling'))
      void window.api.library.retro.cancelEmulatorInstall()
      return
    }
    if (!busy) onClose()
  }, [busy, installingId, onClose, t])

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

  useEffect(() => {
    let active = true
    void Promise.all([window.api.library.retro.getStatus(), window.api.settings.get()])
      .then(([nextStatus, nextSettings]) => {
        if (!active) return
        setStatus(nextStatus)
        setSettings(nextSettings)
        setSelectedId(nextSettings.retroSystemEmulators?.[systemId] ?? AUTOMATIC)
      })
      .catch((cause) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : t('retro.emulator.error'))
        }
      })
      .finally(() => {
        if (!active) return
        setBusy(false)
        requestAnimationFrame(() => {
          const selected = document.querySelector<HTMLElement>(
            '[data-emulator-option][aria-checked="true"]'
          )
          focusElement(selected ?? closeRef.current)
        })
      })
    return () => {
      active = false
    }
  }, [systemId, t])

  useEffect(
    () =>
      window.api.library.retro.onInstallProgress((progress) => {
        if (progress.systemId === systemId) setInstallProgress(progress)
      }),
    [systemId]
  )

  const compatibleEmulators = useMemo(
    () => status?.emulators.filter((emulator) => emulator.readySystems.includes(systemId)) ?? [],
    [status, systemId]
  )
  const downloadEmulators = useMemo(
    () =>
      retroEmulatorDownloadsForSystem(systemId).filter(
        (managed) =>
          !compatibleEmulators.some((detected) => detected.id === managed.id)
      ),
    [compatibleEmulators, systemId]
  )
  const recommendedId = recommendedRetroEmulatorDownload(systemId).id
  const configuredId = settings?.retroSystemEmulators?.[systemId]
  const configuredUnavailable = Boolean(
    configuredId && !compatibleEmulators.some((emulator) => emulator.id === configuredId)
  )
  const hasChanged = (configuredId ?? AUTOMATIC) !== selectedId

  const save = async (): Promise<void> => {
    if (!hasChanged || busy) return
    setBusy(true)
    setError(null)
    let previousSelections: OrbitSettings['retroSystemEmulators'] | undefined
    try {
      const latest = await window.api.settings.get()
      previousSelections = latest.retroSystemEmulators ?? {}
      const nextSelections = { ...previousSelections }
      if (selectedId === AUTOMATIC) delete nextSelections[systemId]
      else nextSelections[systemId] = selectedId
      await window.api.settings.set({ retroSystemEmulators: nextSelections })
      try {
        const result = await window.api.library.retro.refresh()
        applySnapshot(result.snapshot)
      } catch (cause) {
        await window.api.settings.set({ retroSystemEmulators: previousSelections })
        throw cause
      }
      onApplied(
        selectedId === AUTOMATIC
          ? undefined
          : compatibleEmulators.find((emulator) => emulator.id === selectedId)?.name ?? selectedId
      )
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('retro.emulator.error'))
      setBusy(false)
    }
  }

  const refreshEmulators = useCallback(async (): Promise<void> => {
    if (checking) return
    setChecking(true)
    setError(null)
    try {
      const result = await window.api.library.retro.refresh()
      applySnapshot(result.snapshot)
      setStatus(result.status)
      const detected = openedId
        ? result.status.emulators.find(
            (emulator) => emulator.id === openedId && emulator.readySystems.includes(systemId)
          )
        : undefined
      if (detected) {
        setNotice(t('retro.setup.detected', { emulator: detected.name }))
        setOpenedId(null)
        requestAnimationFrame(() => focusElement(checkRef.current ?? closeRef.current))
      } else if (openedId) {
        const emulatorName = retroEmulatorDownloadsForSystem(systemId).find(
          (emulator) => emulator.id === openedId
        )?.name
        setNotice(t('retro.setup.notDetected', { emulator: emulatorName ?? openedId }))
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('retro.setup.refreshError'))
    } finally {
      setChecking(false)
    }
  }, [applySnapshot, checking, openedId, systemId, t])

  useEffect(() => {
    if (!openedId) return
    const refreshOnReturn = (): void => {
      void refreshEmulators()
    }
    window.addEventListener('focus', refreshOnReturn)
    return () => window.removeEventListener('focus', refreshOnReturn)
  }, [openedId, refreshEmulators])

  const openDownload = async (emulatorId: string): Promise<void> => {
    if (busy || openingId) return
    setOpeningId(emulatorId)
    setError(null)
    try {
      const result = await window.api.library.retro.openEmulatorDownload({ systemId, emulatorId })
      setOpenedId(result.emulatorId)
      setNotice(
        result.emulatorId === 'retroarch'
          ? result.firmwareMayBeRequired
            ? t('retro.setup.openedWithCoreAndFirmware', { emulator: result.emulatorName })
            : t('retro.setup.openedWithCore', { emulator: result.emulatorName })
          : result.firmwareMayBeRequired
            ? t('retro.setup.openedWithFirmware', { emulator: result.emulatorName })
            : t('retro.setup.opened', { emulator: result.emulatorName })
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('retro.setup.error'))
    } finally {
      setOpeningId(null)
    }
  }

  const installEmulator = async (emulatorId: string): Promise<void> => {
    if (busy || installingId || openingId) return
    setBusy(true)
    setInstallingId(emulatorId)
    setInstallProgress(null)
    setFailedInstallId(null)
    setError(null)
    setNotice(null)
    cancelRequestedRef.current = false
    try {
      const result = await window.api.library.retro.installEmulator({ systemId, emulatorId })
      applySnapshot(result.snapshot)
      setStatus(result.status)
      setSelectedId(result.emulatorId)
      setSettings((current) =>
        current
          ? {
              ...current,
              retroSystemEmulators: {
                ...current.retroSystemEmulators,
                [systemId]: result.emulatorId
              }
            }
          : current
      )
      setNotice(
        result.alreadyInstalled
          ? t('retro.setup.alreadyInstalled', { emulator: result.emulatorName })
          : result.emulatorInstalled
            ? result.firmwareMayBeRequired
              ? t('retro.setup.installedWithFirmware', { emulator: result.emulatorName })
              : t('retro.setup.installed', { emulator: result.emulatorName })
            : result.firmwareMayBeRequired
              ? t('retro.setup.coreInstalledWithFirmware', { emulator: result.emulatorName })
              : t('retro.setup.coreInstalled', { emulator: result.emulatorName })
      )
      requestAnimationFrame(() => focusElement(closeRef.current))
    } catch {
      if (cancelRequestedRef.current) {
        setNotice(t('retro.setup.canceled'))
      } else {
        setFailedInstallId(emulatorId)
        setError(t('retro.setup.installError'))
      }
    } finally {
      cancelRequestedRef.current = false
      setBusy(false)
      setInstallingId(null)
      setInstallProgress(null)
    }
  }

  const progressPercent =
    installProgress?.receivedBytes !== undefined &&
    installProgress.totalBytes !== undefined &&
    installProgress.totalBytes > 0
      ? Math.min(100, Math.round((installProgress.receivedBytes / installProgress.totalBytes) * 100))
      : undefined

  return createPortal(
    <motion.div
      data-focus-scope="active"
      role="dialog"
      aria-modal="true"
      aria-labelledby="retro-emulator-title"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onPointerDown={(event) => {
        if (event.currentTarget === event.target) close()
      }}
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 px-[clamp(1rem,4vw,4rem)] py-[clamp(1rem,4vh,3rem)] backdrop-blur-md"
    >
      <motion.section
        initial={{ y: 22, scale: 0.98 }}
        animate={{ y: 0, scale: 1 }}
        exit={{ y: 16, scale: 0.985 }}
        transition={{ type: 'spring', stiffness: 320, damping: 30 }}
        onPointerDown={(event) => event.stopPropagation()}
        aria-busy={busy}
        className="relative flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-[clamp(1.4rem,2.4vw,2.2rem)] border border-white/10 bg-surface shadow-[0_30px_100px_rgba(0,0,0,0.75)]"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgb(var(--color-accent)/0.12),transparent_38%)]" />
        <header className="relative border-b border-white/[0.08] px-[clamp(4.5rem,10vw,7rem)] py-[clamp(1.15rem,2.8vh,1.8rem)] text-center">
          <div className="mx-auto max-w-2xl">
            <h1
              id="retro-emulator-title"
              className="truncate text-[clamp(1.3rem,2.4vw,2rem)] font-bold text-white"
            >
              {systemName}
            </h1>
            <p className="mt-1 text-sm font-medium text-white/45">
              {t('retro.emulator.title')}
            </p>
          </div>
          <button
            ref={closeRef}
            data-focusable
            type="button"
            disabled={busy}
            data-disabled={busy ? 'true' : undefined}
            onClick={close}
            aria-label={t('retro.emulator.close')}
            className="absolute right-[clamp(1rem,2.5vw,1.75rem)] top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-white/70 transition-colors hover:bg-white/15 hover:text-white disabled:opacity-40"
          >
            <X size={19} />
          </button>
        </header>

        <div className="relative min-h-0 flex-1 overflow-y-auto p-[clamp(1.25rem,3vw,2.25rem)]">
          <div
            role="radiogroup"
            aria-label={t('retro.emulator.detected')}
            data-navigation-grid
            data-grid-columns="2"
            className="grid grid-cols-1 gap-3 sm:grid-cols-2"
          >
            <button
              data-focusable
              data-emulator-option
              data-grid-index="0"
              type="button"
              role="radio"
              aria-checked={selectedId === AUTOMATIC}
              onClick={() => setSelectedId(AUTOMATIC)}
              className={`flex min-h-28 items-start gap-4 rounded-xl2 border p-4 text-left transition-colors ${
                selectedId === AUTOMATIC
                  ? 'border-accent/60 bg-accent/10'
                  : 'border-white/[0.08] bg-black/25 hover:border-white/20'
              }`}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/12 text-accent">
                <Sparkles size={20} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2 font-bold text-white">
                  {t('retro.emulator.automatic')}
                  {selectedId === AUTOMATIC && <Check size={18} className="text-accent" />}
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-white/50">
                  {t('retro.emulator.automaticBody')}
                </span>
              </span>
            </button>

            {compatibleEmulators.map((emulator, index) => (
              <button
                key={emulator.id}
                data-focusable
                data-emulator-option
                data-grid-index={index + 1}
                type="button"
                role="radio"
                aria-checked={selectedId === emulator.id}
                onClick={() => setSelectedId(emulator.id)}
                className={`flex min-h-28 items-start gap-4 rounded-xl2 border p-4 text-left transition-colors ${
                  selectedId === emulator.id
                    ? 'border-accent/60 bg-accent/10'
                    : 'border-white/[0.08] bg-black/25 hover:border-white/20'
                }`}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-white/65">
                  <Cpu size={20} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2 font-bold text-white">
                    {emulator.name}
                    {selectedId === emulator.id && <Check size={18} className="text-accent" />}
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-white/50">
                    {emulator.kind === 'retroarch'
                      ? t('retro.emulator.retroArch')
                      : t('retro.emulator.standalone')}
                  </span>
                </span>
              </button>
            ))}
          </div>

          {!busy && compatibleEmulators.length === 0 && (
            <div className="mt-4 flex items-start gap-3 rounded-xl2 border border-amber-200/15 bg-amber-100/[0.06] p-4 text-amber-50/75">
              <CircleAlert size={18} className="mt-0.5 shrink-0 text-amber-200" />
              <p className="text-sm leading-relaxed">{t('retro.emulator.none')}</p>
            </div>
          )}
          {configuredUnavailable && selectedId === configuredId && (
            <div className="mt-4 flex items-start gap-3 rounded-xl2 border border-amber-200/15 bg-amber-100/[0.06] p-4 text-amber-50/75">
              <CircleAlert size={18} className="mt-0.5 shrink-0 text-amber-200" />
              <p className="text-sm leading-relaxed">
                {t('retro.emulator.unavailable', { emulator: configuredId })}
              </p>
            </div>
          )}
          {downloadEmulators.length > 0 && (
            <section className="mt-6 border-t border-white/[0.08] pt-5">
              <div className="mb-3">
                <h2 className="text-sm font-extrabold text-white">
                  {t('retro.setup.availableTitle')}
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-white/45">
                  {t('retro.setup.availableBody')}
                </p>
              </div>
              <div
                data-navigation-grid
                data-grid-columns="2"
                className="grid grid-cols-1 gap-3 sm:grid-cols-2"
              >
                {downloadEmulators.map((emulator, index) => (
                  <button
                    key={emulator.id}
                    data-focusable
                    data-grid-index={index}
                    type="button"
                    disabled={busy || Boolean(openingId)}
                    data-disabled={busy || openingId ? 'true' : undefined}
                    onClick={() => void installEmulator(emulator.id)}
                    className="flex min-h-24 items-start gap-3 rounded-xl2 border border-white/[0.08] bg-black/25 p-4 text-left transition-colors hover:border-accent/40 hover:bg-accent/[0.07] disabled:opacity-50"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/12 text-accent">
                      {installingId === emulator.id ? (
                        <Loader2 size={19} className="animate-spin" />
                      ) : (
                        <Download size={19} />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2 font-bold text-white">
                        {emulator.name}
                        {emulator.id === recommendedId && (
                          <span className="rounded-full bg-accent/12 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-accent">
                            {t('retro.setup.recommended')}
                          </span>
                        )}
                      </span>
                      <span className="mt-1 block text-xs leading-relaxed text-white/50">
                        {emulator.id === 'retroarch'
                          ? emulator.firmwareSystems.includes(systemId)
                            ? t('retro.setup.retroArchFirmwareBody')
                            : t('retro.setup.retroArchBody')
                          : emulator.firmwareSystems.includes(systemId)
                            ? t('retro.setup.firmware')
                            : t('retro.setup.downloadBody')}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              {installProgress && installingId && (
                <div
                  role="status"
                  aria-live="polite"
                  className="mt-3 rounded-xl2 border border-accent/20 bg-accent/[0.07] px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-3 text-xs font-bold text-white/75">
                    <span>{t(INSTALL_PHASE_KEYS[installProgress.phase])}</span>
                    {progressPercent !== undefined && <span>{progressPercent}%</span>}
                  </div>
                  {progressPercent !== undefined && (
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-accent transition-[width] duration-200"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
          {notice && (
            <div
              role="status"
              className="mt-4 flex flex-wrap items-center gap-3 rounded-xl2 border border-accent/20 bg-accent/[0.07] p-4 text-white/75"
            >
              <CircleAlert size={18} className="shrink-0 text-accent" />
              <p className="min-w-[12rem] flex-1 text-sm leading-relaxed">{notice}</p>
              {openedId && (
                <button
                  ref={checkRef}
                  data-focusable
                  type="button"
                  disabled={checking}
                  data-disabled={checking ? 'true' : undefined}
                  onClick={() => void refreshEmulators()}
                  className="flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3.5 py-2 text-xs font-bold text-white/70 transition-colors hover:border-accent/35 hover:text-accent disabled:opacity-45"
                >
                  {checking ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <RefreshCw size={15} />
                  )}
                  {t('retro.setup.checkAgain')}
                </button>
              )}
            </div>
          )}
          {error && (
            <div
              role="alert"
              className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-rose-300/15 bg-rose-300/[0.08] px-4 py-3 text-sm text-rose-200"
            >
              <p className="min-w-[12rem] flex-1">{error}</p>
              {failedInstallId && (
                <button
                  data-focusable
                  type="button"
                  disabled={Boolean(openingId)}
                  onClick={() => void openDownload(failedInstallId)}
                  className="flex items-center gap-2 rounded-full border border-rose-200/20 bg-black/20 px-3 py-2 text-xs font-bold text-rose-100"
                >
                  {openingId === failedInstallId ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <ExternalLink size={14} />
                  )}
                  {t('retro.setup.officialFallback')}
                </button>
              )}
            </div>
          )}
        </div>

        <footer className="relative flex flex-wrap items-center justify-end gap-3 border-t border-white/[0.08] px-[clamp(1.25rem,3vw,2.25rem)] py-4">
          <button
            data-focusable
            type="button"
            disabled={busy && !installingId}
            data-disabled={busy && !installingId ? 'true' : undefined}
            onClick={close}
            className="rounded-full px-4 py-2.5 text-sm font-semibold text-white/55 transition-colors hover:bg-white/[0.07] hover:text-white disabled:opacity-40"
          >
            {installingId ? t('retro.setup.cancelInstallation') : t('retro.emulator.cancel')}
          </button>
          <button
            data-focusable
            type="button"
            disabled={busy || !hasChanged}
            data-disabled={busy || !hasChanged ? 'true' : undefined}
            onClick={() => void save()}
            className="flex min-w-36 items-center justify-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-bold text-black shadow-[0_10px_28px_rgb(var(--color-accent)/0.18)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy && <Loader2 size={16} className="animate-spin" />}
            {installingId
              ? t('retro.setup.inProgress')
              : busy
                ? t('retro.emulator.saving')
                : t('retro.emulator.apply')}
          </button>
        </footer>

        {busy && !status && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35 backdrop-blur-[2px]">
            <div className="flex items-center gap-3 rounded-full border border-white/10 bg-black/65 px-5 py-3 text-sm font-semibold text-white/75">
              <Loader2 size={18} className="animate-spin text-accent" />
              {t('retro.emulator.loading')}
            </div>
          </div>
        )}
      </motion.section>
    </motion.div>,
    document.body
  )
}
