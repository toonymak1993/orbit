import { useEffect, useRef, useState } from 'react'
import { CircleAlert, Eye, EyeOff, ExternalLink, Loader2 } from 'lucide-react'
import { FocusableButton } from './FocusableButton'
import { useT } from '@renderer/i18n/useT'

interface Props {
  label: string
  value: string
  placeholder: string
  getKeyLabel: string
  getKeyUrl: string
  onSave: (value: string) => Promise<void>
  configured?: boolean
  configuredLabel?: string
  notConfiguredLabel?: string
  clearLabel?: string
  onClear?: () => Promise<void>
}

export function ApiKeyField({
  label,
  value,
  placeholder,
  getKeyLabel,
  getKeyUrl,
  onSave,
  configured,
  configuredLabel,
  notConfiguredLabel,
  clearLabel,
  onClear
}: Props): JSX.Element {
  const t = useT()
  const [draft, setDraft] = useState(value)
  const [revealed, setRevealed] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const resetTimer = useRef<ReturnType<typeof setTimeout>>()
  const normalizedDraft = draft.trim()
  const isDirty = normalizedDraft !== value.trim()

  useEffect(() => setDraft(value), [value])

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current)
    },
    []
  )

  async function handleSave(): Promise<void> {
    if (!isDirty || saveState === 'saving') return
    if (resetTimer.current) clearTimeout(resetTimer.current)
    setSaveState('saving')
    try {
      await onSave(normalizedDraft)
      if (configured !== undefined) {
        setDraft('')
        setRevealed(false)
      }
      setSaveState('saved')
      resetTimer.current = setTimeout(() => setSaveState('idle'), 1800)
    } catch {
      setSaveState('error')
    }
  }

  async function handleClear(): Promise<void> {
    if (!onClear || saveState === 'saving') return
    if (resetTimer.current) clearTimeout(resetTimer.current)
    setSaveState('saving')
    try {
      await onClear()
      setDraft('')
      setRevealed(false)
      setSaveState('saved')
      resetTimer.current = setTimeout(() => setSaveState('idle'), 1800)
    } catch {
      setSaveState('error')
    }
  }

  return (
    <div>
      <label className="mb-1 block text-xs text-muted">{label}</label>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-[16rem] flex-1 items-center rounded-full border border-white/[0.07] bg-black/30 pr-1">
          <input
            data-focusable
            type={revealed ? 'text' : 'password'}
            autoComplete="off"
            spellCheck={false}
            aria-label={label}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value)
              if (saveState !== 'saving') setSaveState('idle')
            }}
            placeholder={placeholder}
            className="min-w-0 flex-1 bg-transparent px-4 py-2.5 text-sm outline-none placeholder:text-muted"
          />
          <button
            data-focusable
            type="button"
            aria-label={t(revealed ? 'settings.images.hideKey' : 'settings.images.showKey')}
            aria-pressed={revealed}
            onClick={() => setRevealed((current) => !current)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-white/[0.07] hover:text-white"
          >
            {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        <FocusableButton
          data-disabled={!isDirty || saveState === 'saving' ? 'true' : undefined}
          disabled={!isDirty || saveState === 'saving'}
          onClick={() => void handleSave()}
          className="shrink-0 px-5 py-2.5 text-xs disabled:cursor-not-allowed disabled:opacity-45"
        >
          <span className="flex items-center gap-2" aria-live="polite">
            {saveState === 'saving' && <Loader2 size={13} className="animate-spin" />}
            {saveState === 'saved'
              ? t('settings.images.saved')
              : saveState === 'saving'
                ? t('settings.saving')
                : t('settings.images.save')}
          </span>
        </FocusableButton>
      </div>
      {saveState === 'error' && (
        <p className="mt-2 flex items-center gap-2 text-xs text-amber-300" role="status">
          <CircleAlert size={13} />
          {t('settings.images.saveError')}
        </p>
      )}
      {configured !== undefined && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
          <span className={configured ? 'text-emerald-200/80' : 'text-white/45'}>
            {configured ? configuredLabel : notConfiguredLabel}
          </span>
          {configured && onClear && clearLabel && (
            <FocusableButton
              variant="ghost"
              disabled={saveState === 'saving'}
              data-disabled={saveState === 'saving' ? 'true' : undefined}
              onClick={() => void handleClear()}
              className="px-3 py-1.5 text-[11px] disabled:opacity-45"
            >
              {clearLabel}
            </FocusableButton>
          )}
        </div>
      )}
      <button
        data-focusable
        type="button"
        onClick={() => void window.api.app.openExternal(getKeyUrl)}
        className="mt-3 flex items-center gap-1.5 text-xs text-accent"
      >
        <ExternalLink size={12} />
        {getKeyLabel}
      </button>
    </div>
  )
}
