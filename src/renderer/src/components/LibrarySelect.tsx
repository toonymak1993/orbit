import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown } from 'lucide-react'
import { useBackHandler } from '@renderer/hooks/useBackHandler'
import { focusElement } from '@renderer/lib/spatialNavigation'

export interface LibrarySelectOption<T extends string> {
  value: T
  label: string
}

interface LibrarySelectProps<T extends string> {
  label: string
  value: T
  options: LibrarySelectOption<T>[]
  onChange: (value: T) => void
  className?: string
}

export function LibrarySelect<T extends string>({
  label,
  value,
  options,
  onChange,
  className = ''
}: LibrarySelectProps<T>): JSX.Element {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listboxId = useId()
  const selectedOption = options.find((option) => option.value === value) ?? options[0]

  return (
    <>
      <motion.button
        ref={buttonRef}
        data-focusable
        type="button"
        role="combobox"
        aria-label={label}
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen(true)}
        whileTap={{ scale: 0.985 }}
        className={`flex min-h-11 min-w-0 items-center justify-between gap-4 rounded-full border border-white/[0.1] bg-white/[0.92] px-5 py-2.5 text-left text-sm font-semibold text-black shadow-[0_10px_28px_rgba(0,0,0,0.14)] transition-colors hover:bg-white data-[focused=true]:border-accent data-[focused=true]:shadow-[0_0_0_3px_rgb(var(--color-accent)/0.3),0_10px_28px_rgba(0,0,0,0.18)] ${className}`}
      >
        <span className="truncate">{selectedOption?.label ?? label}</span>
        <ChevronDown
          size={18}
          strokeWidth={2.4}
          className={`shrink-0 text-black/60 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </motion.button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <LibrarySelectMenu
              anchor={buttonRef.current}
              id={listboxId}
              label={label}
              value={value}
              options={options}
              onChange={onChange}
              onClose={() => setOpen(false)}
            />
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  )
}

function menuPosition(anchor: HTMLElement | null): CSSProperties {
  if (!anchor) return { left: 12, right: 12, top: 80, maxHeight: 'calc(100vh - 92px)' }
  const rect = anchor.getBoundingClientRect()
  const viewportPadding = 12
  const width = Math.min(Math.max(rect.width, 240), window.innerWidth - viewportPadding * 2)
  const left = Math.min(
    Math.max(viewportPadding, rect.left),
    window.innerWidth - width - viewportPadding
  )
  const spaceBelow = window.innerHeight - rect.bottom - viewportPadding
  const spaceAbove = rect.top - viewportPadding
  const openAbove = spaceBelow < 280 && spaceAbove > spaceBelow
  const availableHeight = Math.max(
    160,
    Math.min(360, openAbove ? spaceAbove - 8 : spaceBelow - 8)
  )

  return openAbove
    ? { left, bottom: window.innerHeight - rect.top + 8, width, maxHeight: availableHeight }
    : { left, top: rect.bottom + 8, width, maxHeight: availableHeight }
}

function LibrarySelectMenu<T extends string>({
  anchor,
  id,
  label,
  value,
  options,
  onChange,
  onClose
}: {
  anchor: HTMLButtonElement | null
  id: string
  label: string
  value: T
  options: LibrarySelectOption<T>[]
  onChange: (value: T) => void
  onClose: () => void
}): JSX.Element {
  const selectedRef = useRef<HTMLButtonElement>(null)

  useBackHandler(onClose)

  useEffect(() => {
    const focusFrame = requestAnimationFrame(() => focusElement(selectedRef.current))
    return () => {
      cancelAnimationFrame(focusFrame)
      if (anchor?.isConnected) requestAnimationFrame(() => focusElement(anchor))
    }
  }, [anchor])

  useEffect(() => {
    const closeOnResize = (): void => onClose()
    window.addEventListener('resize', closeOnResize)
    return () => window.removeEventListener('resize', closeOnResize)
  }, [onClose])

  return (
    <motion.div
      data-focus-scope="active"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      className="fixed inset-0 z-[95] bg-black/25"
    >
      <motion.div
        id={id}
        role="listbox"
        aria-label={label}
        initial={{ opacity: 0, y: -6, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -4, scale: 0.985 }}
        transition={{ duration: 0.14 }}
        style={menuPosition(anchor)}
        className="fixed overflow-y-auto rounded-2xl border border-white/[0.12] bg-[rgb(var(--color-surface-2)/0.98)] p-2 shadow-2xl backdrop-blur-2xl"
      >
        {options.map((option) => {
          const selected = option.value === value
          return (
            <button
              key={option.value}
              ref={selected ? selectedRef : undefined}
              data-focusable
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => {
                onChange(option.value)
                onClose()
              }}
              className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-xs font-semibold transition-colors data-[focused=true]:bg-accent/[0.16] data-[focused=true]:text-white ${
                selected ? 'bg-accent/12 text-white' : 'text-white/60 hover:bg-white/[0.06]'
              }`}
            >
              <span className="truncate">{option.label}</span>
              {selected && <Check size={14} className="shrink-0 text-accent" strokeWidth={3} />}
            </button>
          )
        })}
      </motion.div>
    </motion.div>
  )
}
