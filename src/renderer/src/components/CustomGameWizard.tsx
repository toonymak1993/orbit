import { forwardRef, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import {
  FileInput,
  FolderOpen,
  Gamepad2,
  ImagePlus,
  Loader2,
  Save,
  ShieldCheck,
  Trash2,
  X
} from 'lucide-react'
import type {
  CustomGameDraft,
  CustomGameImportSource,
  CustomGameSaveSource
} from '@shared/ipc'
import { useBackHandler } from '@renderer/hooks/useBackHandler'
import { useT } from '@renderer/i18n/useT'
import { focusElement } from '@renderer/lib/spatialNavigation'
import { useLibraryStore } from '@renderer/state/libraryStore'

interface Props {
  onClose: () => void
  onCompleted: () => void
}

export function CustomGameWizard({ onClose, onCompleted }: Props): JSX.Element {
  const t = useT()
  const applySnapshot = useLibraryStore((state) => state.applySnapshot)
  const [draft, setDraft] = useState<CustomGameDraft | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const firstActionRef = useRef<HTMLButtonElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  const close = useCallback((): void => {
    if (draft) void window.api.library.custom.cancel(draft.id).catch(() => undefined)
    onClose()
  }, [draft, onClose])

  useBackHandler(close)

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    const frame = requestAnimationFrame(() => focusElement(firstActionRef.current))
    return () => {
      cancelAnimationFrame(frame)
      if (previousFocus?.isConnected) requestAnimationFrame(() => focusElement(previousFocus))
    }
  }, [])

  useEffect(() => {
    if (!draft) return
    const frame = requestAnimationFrame(() => focusElement(nameRef.current))
    return () => cancelAnimationFrame(frame)
  }, [draft?.id])

  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true)
    setError(null)
    try {
      return await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('customGame.error.generic'))
      return undefined
    } finally {
      setBusy(false)
    }
  }, [t])

  const beginImport = async (source: CustomGameImportSource): Promise<void> => {
    const result = await run(() => window.api.library.custom.beginImport(source))
    if (!result) return
    setDraft(result)
    setName(result.name)
  }

  const selectArtwork = async (): Promise<void> => {
    if (!draft) return
    const result = await run(() => window.api.library.custom.selectArtwork(draft.id))
    if (result) setDraft(result)
  }

  const selectSave = async (source: CustomGameSaveSource): Promise<void> => {
    if (!draft) return
    const result = await run(() => window.api.library.custom.selectSave(draft.id, source))
    if (result) setDraft(result)
  }

  const clearSave = async (): Promise<void> => {
    if (!draft) return
    const result = await run(() => window.api.library.custom.clearSave(draft.id))
    if (result) setDraft(result)
  }

  const commit = async (): Promise<void> => {
    if (!draft || !name.trim()) return
    const snapshot = await run(() =>
      window.api.library.custom.commit({ draftId: draft.id, name: name.trim() })
    )
    if (!snapshot) return
    applySnapshot(snapshot)
    onCompleted()
  }

  return (
    <motion.div
      data-focus-scope="active"
      role="dialog"
      aria-modal="true"
      aria-labelledby="custom-game-title"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onPointerDown={(event) => {
        if (event.currentTarget === event.target && !busy) close()
      }}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 px-[clamp(1rem,4vw,4rem)] py-[clamp(1rem,4vh,3rem)] backdrop-blur-md"
    >
      <motion.section
        initial={{ y: 24, scale: 0.98 }}
        animate={{ y: 0, scale: 1 }}
        exit={{ y: 18, scale: 0.985 }}
        transition={{ type: 'spring', stiffness: 320, damping: 30 }}
        onPointerDown={(event) => event.stopPropagation()}
        aria-busy={busy}
        className="relative flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-[clamp(1.4rem,2.4vw,2.4rem)] border border-white/10 bg-surface shadow-[0_30px_100px_rgba(0,0,0,0.7)]"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_0%,rgb(var(--color-accent)/0.13),transparent_35%)]" />
        <header className="relative flex items-start justify-between gap-4 border-b border-white/[0.08] px-[clamp(1.25rem,3vw,2.5rem)] py-[clamp(1rem,2.5vh,1.75rem)]">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-accent">ORBIT · LOCAL</p>
            <h1 id="custom-game-title" className="mt-1 text-[clamp(1.35rem,2.5vw,2.2rem)] font-bold text-white">
              {t('customGame.title')}
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-white/50">
              {draft ? t('customGame.configureBody') : t('customGame.chooseBody')}
            </p>
          </div>
          <button
            data-focusable
            type="button"
            disabled={busy}
            data-disabled={busy ? 'true' : undefined}
            onClick={close}
            aria-label={t('customGame.close')}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-white/70 transition-colors hover:bg-white/15 hover:text-white"
          >
            <X size={19} />
          </button>
        </header>

        {!draft ? (
          <div className="relative grid flex-1 grid-cols-1 gap-3 overflow-y-auto p-[clamp(1.25rem,3vw,2.5rem)] md:grid-cols-2">
            <ChoiceButton
              ref={firstActionRef}
              icon={<FileInput size={30} />}
              title={t('customGame.chooseExe')}
              body={t('customGame.chooseExeBody')}
              disabled={busy}
              onClick={() => void beginImport('executable')}
            />
            <ChoiceButton
              icon={<FolderOpen size={30} />}
              title={t('customGame.chooseFolder')}
              body={t('customGame.chooseFolderBody')}
              disabled={busy}
              onClick={() => void beginImport('folder')}
            />
          </div>
        ) : (
          <div className="relative grid min-h-0 flex-1 grid-cols-1 gap-[clamp(1rem,2.5vw,2rem)] overflow-y-auto p-[clamp(1.25rem,3vw,2.5rem)] lg:grid-cols-[minmax(13rem,0.72fr)_minmax(22rem,1.4fr)]">
            <div className="flex min-w-0 flex-col gap-3">
              <div className="aspect-[2/3] max-h-[42vh] overflow-hidden rounded-xl2 border border-white/10 bg-black/30 shadow-card">
                {draft.artworkPreviewUrl || draft.iconPreviewUrl ? (
                  <img
                    src={draft.artworkPreviewUrl ?? draft.iconPreviewUrl}
                    alt=""
                    className={`h-full w-full ${draft.artworkPreviewUrl ? 'object-cover' : 'object-contain p-8'}`}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center bg-gradient-to-br from-accent/35 to-accent-2/35 text-accent">
                    <Gamepad2 size={56} />
                  </div>
                )}
              </div>
              <button
                data-focusable
                type="button"
                disabled={busy}
                data-disabled={busy ? 'true' : undefined}
                onClick={() => void selectArtwork()}
                className="flex items-center justify-center gap-2 rounded-full border border-white/12 bg-white/[0.06] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/12"
              >
                <ImagePlus size={17} />
                {draft.artworkPreviewUrl ? t('customGame.changeCover') : t('customGame.chooseCover')}
              </button>
            </div>

            <div className="flex min-w-0 flex-col gap-4">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-white/55">
                  {t('customGame.name')}
                </span>
                <input
                  ref={nameRef}
                  data-focusable
                  type="text"
                  maxLength={120}
                  value={name}
                  disabled={busy}
                  onChange={(event) => setName(event.target.value)}
                  className="w-full rounded-xl2 border border-white/10 bg-black/25 px-4 py-3 text-base font-semibold text-white outline-none transition-colors focus:border-accent/60"
                />
              </label>

              <InfoRow label={t('customGame.executable')} value={draft.executablePath} />

              <section className="rounded-xl2 border border-white/10 bg-black/20 p-4">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/12 text-accent">
                    <ShieldCheck size={20} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-bold text-white">{t('customGame.backupTitle')}</h2>
                    <p className="mt-1 text-xs leading-relaxed text-white/50">{t('customGame.backupBody')}</p>
                    {draft.savePath && <p className="mt-3 truncate text-xs font-medium text-accent" title={draft.savePath}>{draft.savePath}</p>}
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    data-focusable
                    type="button"
                    disabled={busy}
                    data-disabled={busy ? 'true' : undefined}
                    onClick={() => void selectSave('folder')}
                    className="flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.06] px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/12"
                  >
                    <FolderOpen size={15} />
                    {t('customGame.saveFolder')}
                  </button>
                  <button
                    data-focusable
                    type="button"
                    disabled={busy}
                    data-disabled={busy ? 'true' : undefined}
                    onClick={() => void selectSave('file')}
                    className="flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.06] px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/12"
                  >
                    <Save size={15} />
                    {t('customGame.saveFile')}
                  </button>
                  {draft.savePath && (
                    <button
                      data-focusable
                      type="button"
                      disabled={busy}
                      data-disabled={busy ? 'true' : undefined}
                      onClick={() => void clearSave()}
                      className="flex items-center gap-2 rounded-full px-3.5 py-2 text-xs font-semibold text-white/45 transition-colors hover:text-white"
                    >
                      <Trash2 size={15} />
                      {t('customGame.clearSave')}
                    </button>
                  )}
                </div>
              </section>

              <div className="mt-auto flex flex-wrap items-center justify-end gap-2 pt-2">
                <button
                  data-focusable
                  type="button"
                  disabled={busy}
                  data-disabled={busy ? 'true' : undefined}
                  onClick={close}
                  className="rounded-full px-5 py-3 text-sm font-semibold text-white/55 transition-colors hover:text-white"
                >
                  {t('customGame.cancel')}
                </button>
                <button
                  data-focusable
                  type="button"
                  disabled={busy || !name.trim()}
                  data-disabled={busy || !name.trim() ? 'true' : undefined}
                  onClick={() => void commit()}
                  className="flex min-w-[10rem] items-center justify-center gap-2 rounded-full bg-accent px-5 py-3 text-sm font-bold text-black shadow-[0_12px_35px_rgb(var(--color-accent)/0.2)] disabled:opacity-45"
                >
                  {busy ? <Loader2 size={17} className="animate-spin" /> : <Gamepad2 size={17} />}
                  {t('customGame.add')}
                </button>
              </div>
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="relative border-t border-rose-300/15 bg-rose-300/[0.08] px-6 py-3 text-sm text-rose-200">
            {error}
          </p>
        )}
        {busy && !draft && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/30 backdrop-blur-[2px]">
            <Loader2 size={28} className="animate-spin text-accent" />
          </div>
        )}
      </motion.section>
    </motion.div>
  )
}

const ChoiceButton = forwardRef<
  HTMLButtonElement,
  {
    icon: ReactNode
    title: string
    body: string
    disabled: boolean
    onClick: () => void
  }
>(function ChoiceButton(
  {
    icon,
    title,
    body,
    disabled,
    onClick
  },
  ref
): JSX.Element {
  return (
    <button
      ref={ref}
      data-focusable
      type="button"
      disabled={disabled}
      data-disabled={disabled ? 'true' : undefined}
      onClick={onClick}
      className="group flex min-h-[13rem] flex-col items-start justify-end rounded-xl2 border border-white/10 bg-white/[0.045] p-[clamp(1.25rem,3vw,2.25rem)] text-left transition-colors hover:border-accent/40 hover:bg-accent/[0.08]"
    >
      <span className="mb-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/12 text-accent transition-transform group-hover:scale-105">
        {icon}
      </span>
      <span className="mt-6 text-lg font-bold text-white">{title}</span>
      <span className="mt-2 max-w-md text-sm leading-relaxed text-white/50">{body}</span>
    </button>
  )
})

function InfoRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.035] px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/35">{label}</p>
      <p className="mt-1 truncate text-xs font-medium text-white/65" title={value}>{value}</p>
    </div>
  )
}
