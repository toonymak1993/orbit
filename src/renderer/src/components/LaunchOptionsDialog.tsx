import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { AlertTriangle, Loader2, Save, X } from 'lucide-react'
import type { LibrarySnapshot } from '@shared/ipc'
import { useBackHandler } from '@renderer/hooks/useBackHandler'
import { useT } from '@renderer/i18n/useT'
import { focusElement } from '@renderer/lib/spatialNavigation'

interface Props {
  gameId: string
  gameName: string
  initialArguments?: string[]
  onSaved: (snapshot: LibrarySnapshot) => void
  onClose: () => void
}

function formatWindowsArgument(value: string): string {
  if (value && !/[\s"]/u.test(value)) return value

  let output = '"'
  let backslashes = 0
  for (const character of value) {
    if (character === '\\') {
      backslashes++
      continue
    }
    if (character === '"') {
      output += '\\'.repeat(backslashes * 2 + 1) + '"'
      backslashes = 0
      continue
    }
    output += '\\'.repeat(backslashes) + character
    backslashes = 0
  }
  return output + '\\'.repeat(backslashes * 2) + '"'
}

function formatWindowsArguments(values: string[] | undefined): string {
  return (values ?? []).map(formatWindowsArgument).join(' ')
}

export function LaunchOptionsDialog({
  gameId,
  gameName,
  initialArguments,
  onSaved,
  onClose
}: Props): JSX.Element {
  const t = useT()
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(() => formatWindowsArguments(initialArguments))
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  useBackHandler(() => {
    if (!busy) onClose()
  })

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    const frame = requestAnimationFrame(() => focusElement(inputRef.current))
    return () => {
      cancelAnimationFrame(frame)
      if (previousFocus?.isConnected) requestAnimationFrame(() => focusElement(previousFocus))
    }
  }, [])

  const save = async (): Promise<void> => {
    if (busy) return
    const actionOrigin = document.activeElement as HTMLElement | null
    setBusy(true)
    setFailed(false)
    try {
      const snapshot = await window.api.library.custom.setLaunchArguments({
        gameId,
        launchArguments: value.trim() || undefined
      })
      onSaved(snapshot)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
      requestAnimationFrame(() => {
        if (actionOrigin?.isConnected) focusElement(actionOrigin)
      })
    }
  }

  return createPortal(
    <motion.div
      data-focus-scope="active"
      role="dialog"
      aria-modal="true"
      aria-labelledby="launch-options-title"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/75 p-[clamp(1rem,4vw,3rem)] backdrop-blur-xl"
    >
      <motion.section
        aria-busy={busy}
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 14, scale: 0.985 }}
        transition={{ type: 'spring', stiffness: 330, damping: 29 }}
        onPointerDown={(event) => event.stopPropagation()}
        className="relative w-full max-w-2xl overflow-hidden rounded-[2rem] border border-white/10 bg-surface shadow-[0_36px_120px_rgba(0,0,0,0.75)]"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgb(var(--color-accent)/0.14),transparent_40%)]" />
        <header className="relative flex items-start justify-between gap-5 border-b border-white/[0.07] px-7 py-5">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-accent">
              ORBIT · LOCAL
            </p>
            <h2 id="launch-options-title" className="mt-1 text-2xl font-bold text-white">
              {t('launchOptions.title')}
            </h2>
            <p className="mt-1 truncate text-sm text-white/45" title={gameName}>
              {gameName}
            </p>
          </div>
          <button
            data-focusable
            data-disabled={busy ? 'true' : undefined}
            disabled={busy}
            type="button"
            onClick={onClose}
            aria-label={t('launchOptions.close')}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-white/55 transition-colors hover:bg-white/15 hover:text-white disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </header>

        <div className="relative px-7 py-6">
          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-white/55">
              {t('customGame.launchArguments')}
            </span>
            <input
              ref={inputRef}
              data-focusable
              type="text"
              maxLength={4096}
              value={value}
              disabled={busy}
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              placeholder={t('customGame.launchArgumentsPlaceholder')}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void save()
              }}
              className="w-full rounded-xl2 border border-white/10 bg-black/25 px-4 py-3.5 font-mono text-sm text-white outline-none transition-colors placeholder:text-white/25 focus:border-accent/60"
            />
            <span className="mt-2 block text-xs leading-relaxed text-white/40">
              {t('launchOptions.hint')}
            </span>
          </label>

          {failed && (
            <p role="alert" className="mt-4 flex items-center gap-2 rounded-xl border border-rose-300/15 bg-rose-300/[0.08] px-3.5 py-3 text-sm text-rose-100">
              <AlertTriangle size={16} className="shrink-0" />
              {t('launchOptions.failed')}
            </p>
          )}
        </div>

        <footer className="relative flex items-center justify-end gap-2 border-t border-white/[0.07] px-7 py-4">
          <button
            data-focusable
            data-disabled={busy ? 'true' : undefined}
            disabled={busy}
            type="button"
            onClick={onClose}
            className="rounded-full px-5 py-3 text-sm font-semibold text-white/55 transition-colors hover:text-white disabled:opacity-40"
          >
            {t('launchOptions.cancel')}
          </button>
          <button
            data-focusable
            data-disabled={busy ? 'true' : undefined}
            disabled={busy}
            type="button"
            onClick={() => void save()}
            className="flex min-w-[9rem] items-center justify-center gap-2 rounded-full bg-accent px-5 py-3 text-sm font-bold text-black shadow-[0_12px_35px_rgb(var(--color-accent)/0.2)] disabled:opacity-45"
          >
            {busy ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} />}
            {t('launchOptions.save')}
          </button>
        </footer>
      </motion.section>
    </motion.div>,
    document.body
  )
}
