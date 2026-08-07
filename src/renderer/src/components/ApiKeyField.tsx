import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { FocusableButton } from './FocusableButton'
import { useT } from '@renderer/i18n/useT'

interface Props {
  label: string
  value: string
  placeholder: string
  getKeyLabel: string
  getKeyUrl: string
  onSave: (value: string) => Promise<void>
}

export function ApiKeyField({ label, value, placeholder, getKeyLabel, getKeyUrl, onSave }: Props): JSX.Element {
  const t = useT()
  const [draft, setDraft] = useState(value)
  const [saved, setSaved] = useState(false)

  async function handleSave(): Promise<void> {
    await onSave(draft.trim())
    setSaved(true)
    setTimeout(() => setSaved(false), 1800)
  }

  return (
    <div>
      <label className="mb-1 block text-xs text-muted">{label}</label>
      <div className="flex items-center gap-3">
        <input
          data-focusable
          type="password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          className="flex-1 rounded-full bg-black/30 px-4 py-2.5 text-sm outline-none placeholder:text-muted"
        />
        <FocusableButton onClick={() => void handleSave()} className="shrink-0 px-5 py-2.5 text-xs">
          {saved ? t('settings.images.saved') : t('settings.images.save')}
        </FocusableButton>
      </div>
      <button
        data-focusable
        onClick={() => void window.api.app.openExternal(getKeyUrl)}
        className="mt-3 flex items-center gap-1.5 text-xs text-accent"
      >
        <ExternalLink size={12} />
        {getKeyLabel}
      </button>
    </div>
  )
}
