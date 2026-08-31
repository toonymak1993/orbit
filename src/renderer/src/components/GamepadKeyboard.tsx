import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
  ArrowRight,
  CaseUpper,
  CornerDownLeft,
  Delete,
  Keyboard,
  LockKeyhole,
  Search,
  X
} from 'lucide-react'
import { useBackHandler } from '@renderer/hooks/useBackHandler'
import { useT } from '@renderer/i18n/useT'
import {
  applyTextEdit,
  editableTextLabel,
  GAMEPAD_KEYBOARD_CLOSE_EVENT,
  GAMEPAD_KEYBOARD_OPEN_EVENT,
  GAMEPAD_KEYBOARD_SHORTCUT_EVENT,
  isEditableTextElement,
  setGamepadKeyboardOpen,
  type EditableTextControl,
  type GamepadKeyboardShortcut,
  type TextEdit,
  type TextSelectionState
} from '@renderer/lib/gamepadKeyboard'
import { focusElement } from '@renderer/lib/spatialNavigation'
import { useControllerButtonLabels } from '@renderer/state/controllerStore'
import { usePreferencesStore } from '@renderer/state/preferencesStore'

type KeyboardMode = 'letters' | 'symbols' | 'numbers'

interface KeyboardSession extends TextSelectionState {
  target: EditableTextControl
  initialValue: string
  label?: string
}

const ENGLISH_LETTER_ROWS = [
  [...'qwertyuiop'],
  [...'asdfghjkl'],
  [...'zxcvbnm']
]
const GERMAN_LETTER_ROWS = [
  [...'qwertzuiop'],
  [...'asdfghjkl'],
  [...'yxcvbnm']
]
const PRIMARY_SYMBOL_ROWS = [
  [...'1234567890'],
  ['@', '#', '€', '_', '&', '-', '+', '(', ')', '/'],
  ['*', '"', "'", ':', ';', '!', '?', '.', ',']
]
const SECONDARY_SYMBOL_ROWS = [
  ['~', '`', '|', '•', '√', 'π', '÷', '×', '§', '°'],
  ['^', '%', '=', '{', '}', '[', ']', '<', '>', '\\'],
  ['$', '£', '¥', '¢', '©', '®', '™', '…', '—']
]
const NUMBER_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['-', '0', '.']
]

function safeSelection(control: EditableTextControl): Pick<TextSelectionState, 'selectionStart' | 'selectionEnd'> {
  try {
    const fallback = control.value.length
    return {
      selectionStart: control.selectionStart ?? fallback,
      selectionEnd: control.selectionEnd ?? fallback
    }
  } catch {
    return { selectionStart: control.value.length, selectionEnd: control.value.length }
  }
}

function setNativeValue(control: EditableTextControl, value: string): void {
  const prototype =
    control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  if (setter) setter.call(control, value)
  else control.value = value
}

function restoreSelection(control: EditableTextControl, start: number, end: number): void {
  try {
    control.setSelectionRange(start, end)
  } catch {
    // Email and number inputs do not expose a writable DOM selection on every Chromium version.
  }
}

function initialMode(control: EditableTextControl): KeyboardMode {
  return control.inputMode === 'numeric' || control.inputMode === 'decimal' || control.type === 'number'
    ? 'numbers'
    : 'letters'
}

interface KeyboardKeyProps {
  children: ReactNode
  label: string
  onPress: () => void
  weight?: number
  active?: boolean
  primary?: boolean
  defaultFocus?: boolean
  quiet?: boolean
}

function KeyboardKey({
  children,
  label,
  onPress,
  weight = 1,
  active = false,
  primary = false,
  defaultFocus = false,
  quiet = false
}: KeyboardKeyProps): JSX.Element {
  return (
    <button
      data-focusable
      data-keyboard-default={defaultFocus ? 'true' : undefined}
      type="button"
      aria-label={label}
      aria-pressed={active || undefined}
      onClick={onPress}
      style={{ flex: `${weight} 1 0%` }}
      className="gamepad-keyboard-key"
      data-active={active ? 'true' : undefined}
      data-primary={primary ? 'true' : undefined}
      data-quiet={quiet ? 'true' : undefined}
    >
      {children}
    </button>
  )
}

function PreviewValue({ session, emptyLabel }: { session: KeyboardSession; emptyLabel: string }): JSX.Element {
  const { value, selectionStart, selectionEnd, target } = session
  const renderedValue = target.type === 'password' ? value.split('').map(() => '•').join('') : value
  const before = renderedValue.slice(0, selectionStart)
  const selected = renderedValue.slice(selectionStart, selectionEnd)
  const after = renderedValue.slice(selectionEnd)

  if (!value) {
    return (
      <span className="gamepad-keyboard-preview-empty">
        <span data-keyboard-caret className="gamepad-keyboard-caret" />
        {target.placeholder || emptyLabel}
      </span>
    )
  }

  return (
    <span className="whitespace-pre">
      {before}
      {selected ? (
        <span data-keyboard-caret className="gamepad-keyboard-selection">
          {selected}
        </span>
      ) : (
        <span data-keyboard-caret className="gamepad-keyboard-caret" />
      )}
      {after}
    </span>
  )
}

export function GamepadKeyboard(): JSX.Element {
  const t = useT()
  const language = usePreferencesStore((state) => state.language)
  const buttons = useControllerButtonLabels()
  const panelRef = useRef<HTMLElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const focusGeneration = useRef(0)
  const sessionRef = useRef<KeyboardSession | null>(null)
  const [session, setSession] = useState<KeyboardSession | null>(null)
  const [mode, setMode] = useState<KeyboardMode>('letters')
  const [shift, setShift] = useState(false)
  const [caps, setCaps] = useState(false)
  const [secondarySymbols, setSecondarySymbols] = useState(false)

  const close = useCallback((): void => {
    const current = sessionRef.current
    if (current?.target.isConnected && current.target.value !== current.initialValue) {
      current.target.dispatchEvent(new Event('change', { bubbles: true }))
    }
    if (current) {
      window.dispatchEvent(
        new CustomEvent<EditableTextControl>(GAMEPAD_KEYBOARD_CLOSE_EVENT, {
          detail: current.target
        })
      )
    }
    setGamepadKeyboardOpen(false)
    sessionRef.current = null
    setSession(null)
  }, [])

  useBackHandler(close, session !== null)

  useEffect(() => {
    const open = (event: Event): void => {
      const control = (event as CustomEvent<EditableTextControl>).detail
      if (!isEditableTextElement(control)) return
      const selection = safeSelection(control)
      const nextSession = {
        target: control,
        initialValue: control.value,
        value: control.value,
        selectionStart: selection.selectionStart,
        selectionEnd: selection.selectionEnd,
        label: editableTextLabel(control)
      }
      sessionRef.current = nextSession
      setGamepadKeyboardOpen(true)
      setSession(nextSession)
      setMode(initialMode(control))
      setShift(false)
      setCaps(false)
      setSecondarySymbols(false)
    }

    window.addEventListener(GAMEPAD_KEYBOARD_OPEN_EVENT, open)
    return () => {
      setGamepadKeyboardOpen(false)
      window.removeEventListener(GAMEPAD_KEYBOARD_OPEN_EVENT, open)
    }
  }, [])

  useEffect(() => {
    if (!session) return
    const { target } = session
    const appContent = document.querySelector<HTMLElement>('[data-orbit-app-content]')
    const contentWasInert = appContent?.hasAttribute('inert') ?? false
    const previousAriaHidden = appContent?.getAttribute('aria-hidden')
    const generation = ++focusGeneration.current

    target.dataset.gamepadKeyboardActive = 'true'
    appContent?.setAttribute('inert', '')
    appContent?.setAttribute('aria-hidden', 'true')
    document.documentElement.dataset.gamepadKeyboardOpen = 'true'
    document.documentElement.style.setProperty('--gamepad-keyboard-offset', '0px')

    const positionTarget = (): void => {
      const panelTop = panelRef.current?.getBoundingClientRect().top ?? window.innerHeight * 0.5
      const targetRect = target.getBoundingClientRect()
      const desiredBottom = panelTop - Math.max(18, window.innerHeight * 0.025)
      const currentOffset = Number.parseFloat(
        document.documentElement.style.getPropertyValue('--gamepad-keyboard-offset')
      ) || 0
      const offset = Math.min(
        Math.max(0, currentOffset + targetRect.bottom - desiredBottom),
        window.innerHeight * 0.42
      )
      document.documentElement.style.setProperty('--gamepad-keyboard-offset', `${offset}px`)
    }

    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        positionTarget()
        const firstKey = panelRef.current?.querySelector<HTMLElement>('[data-keyboard-default="true"]')
        focusElement(firstKey ?? panelRef.current?.querySelector<HTMLElement>('[data-focusable]') ?? null)
      })
    })
    const settleTimer = window.setTimeout(positionTarget, 500)

    const handleResize = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(positionTarget)
    }
    window.addEventListener('resize', handleResize)

    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(settleTimer)
      window.removeEventListener('resize', handleResize)
      delete target.dataset.gamepadKeyboardActive
      delete document.documentElement.dataset.gamepadKeyboardOpen
      document.documentElement.style.removeProperty('--gamepad-keyboard-offset')
      if (appContent) {
        if (!contentWasInert) appContent.removeAttribute('inert')
        if (previousAriaHidden == null) appContent.removeAttribute('aria-hidden')
        else appContent.setAttribute('aria-hidden', previousAriaHidden)
      }
      window.setTimeout(() => {
        if (
          focusGeneration.current === generation &&
          target.isConnected &&
          !target.disabled
        ) focusElement(target)
      }, 0)
    }
  }, [session?.target])

  useEffect(() => {
    const preview = previewRef.current
    const caret = preview?.querySelector<HTMLElement>('[data-keyboard-caret]')
    if (!preview || !caret) return
    preview.scrollLeft = Math.max(0, caret.offsetLeft - preview.clientWidth * 0.55)
  }, [session?.selectionStart, session?.selectionEnd, session?.value])

  const edit = useCallback(
    (operation: TextEdit): void => {
      const current = sessionRef.current
      if (!current?.target.isConnected || !isEditableTextElement(current.target)) {
        setGamepadKeyboardOpen(false)
        sessionRef.current = null
        setSession(null)
        return
      }
      const selection = safeSelection(current.target)
      const next = applyTextEdit(
        {
          value: current.target.value,
          selectionStart: selection.selectionStart,
          selectionEnd: selection.selectionEnd
        },
        operation,
        current.target.maxLength
      )

      if (next.value !== current.target.value) {
        setNativeValue(current.target, next.value)
        restoreSelection(current.target, next.selectionStart, next.selectionEnd)
        const inputType =
          operation.type === 'backspace'
            ? 'deleteContentBackward'
            : operation.type === 'delete'
              ? 'deleteContentForward'
              : 'insertText'
        const data = operation.type === 'insert' ? operation.text : null
        current.target.dispatchEvent(
          new InputEvent('input', { bubbles: true, inputType, data })
        )
      } else {
        restoreSelection(current.target, next.selectionStart, next.selectionEnd)
      }

      requestAnimationFrame(() => {
        if (current.target.isConnected) {
          restoreSelection(current.target, next.selectionStart, next.selectionEnd)
        }
      })
      const nextSession = { ...current, ...next }
      sessionRef.current = nextSession
      setSession(nextSession)
    },
    []
  )

  const insertCharacter = useCallback(
    (character: string): void => {
      const renderedCharacter = mode === 'letters' && caps !== shift ? character.toUpperCase() : character
      edit({ type: 'insert', text: renderedCharacter })
      if (mode === 'letters' && shift && !caps) setShift(false)
    },
    [caps, edit, mode, shift]
  )

  const toggleLayout = useCallback((): void => {
    setMode((current) => (current === 'letters' ? 'symbols' : 'letters'))
    setSecondarySymbols(false)
    setShift(false)
  }, [])

  const complete = useCallback((): void => {
    const current = sessionRef.current
    if (!current?.target.isConnected) {
      close()
      return
    }
    if (current.target instanceof HTMLTextAreaElement) {
      edit({ type: 'insert', text: '\n' })
      return
    }

    const keydown = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      bubbles: true,
      cancelable: true
    })
    const accepted = current.target.dispatchEvent(keydown)
    if (accepted && current.target.form) current.target.form.requestSubmit()
    current.target.dispatchEvent(
      new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    close()
  }, [close, edit])

  useEffect(() => {
    const handleShortcut = (event: Event): void => {
      const shortcut = (event as CustomEvent<GamepadKeyboardShortcut>).detail
      if (shortcut === 'backspace') edit({ type: 'backspace' })
      else if (shortcut === 'space') edit({ type: 'insert', text: ' ' })
      else if (shortcut === 'cursor-left') edit({ type: 'cursor', direction: -1 })
      else if (shortcut === 'cursor-right') edit({ type: 'cursor', direction: 1 })
      else if (shortcut === 'shift') {
        if (mode === 'letters') setShift((current) => !current)
      } else if (shortcut === 'layout') toggleLayout()
      else if (shortcut === 'done') complete()
    }
    window.addEventListener(GAMEPAD_KEYBOARD_SHORTCUT_EVENT, handleShortcut)
    return () => window.removeEventListener(GAMEPAD_KEYBOARD_SHORTCUT_EVENT, handleShortcut)
  }, [complete, edit, mode, toggleLayout])

  useEffect(() => {
    if (!session) return
    const handlePhysicalKeyboard = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.key === 'Backspace') {
        event.preventDefault()
        event.stopImmediatePropagation()
        edit({ type: 'backspace' })
      } else if (event.key === 'Delete') {
        event.preventDefault()
        event.stopImmediatePropagation()
        edit({ type: 'delete' })
      } else if (event.key.length === 1) {
        event.preventDefault()
        event.stopImmediatePropagation()
        edit({ type: 'insert', text: event.key })
      }
    }
    window.addEventListener('keydown', handlePhysicalKeyboard, true)
    return () => window.removeEventListener('keydown', handlePhysicalKeyboard, true)
  }, [edit, session])

  const rows = useMemo(() => {
    if (mode === 'numbers') return NUMBER_ROWS
    if (mode === 'symbols') return secondarySymbols ? SECONDARY_SYMBOL_ROWS : PRIMARY_SYMBOL_ROWS
    return language === 'de' ? GERMAN_LETTER_ROWS : ENGLISH_LETTER_ROWS
  }, [language, mode, secondarySymbols])

  const isSearch = session?.target.type === 'search' || session?.target.enterKeyHint === 'search'
  const completionLabel = isSearch ? t('keyboard.search') : t('keyboard.done')
  const modeLabel =
    mode === 'letters'
      ? t('keyboard.layout.letters')
      : mode === 'numbers'
        ? t('keyboard.layout.numbers')
        : t('keyboard.layout.symbols')

  return (
    <AnimatePresence>
      {session && (
        <motion.div
          data-gamepad-keyboard="open"
          data-focus-scope="active"
          role="dialog"
          aria-modal="true"
          aria-labelledby="gamepad-keyboard-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onPointerDown={(event) => {
            if (event.currentTarget === event.target) close()
          }}
          className="gamepad-keyboard-overlay"
        >
          <motion.section
            ref={panelRef}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 390, damping: 38, mass: 0.85 }}
            onPointerDown={(event) => event.stopPropagation()}
            className="gamepad-keyboard-panel"
          >
            <div className="gamepad-keyboard-inner">
              <header className="gamepad-keyboard-header">
                <span className="gamepad-keyboard-icon" aria-hidden="true">
                  {session.target.type === 'password' ? (
                    <LockKeyhole size={20} />
                  ) : isSearch ? (
                    <Search size={20} />
                  ) : (
                    <Keyboard size={20} />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 id="gamepad-keyboard-title" className="truncate text-xs font-bold text-white/80">
                      {session.label || t('keyboard.fieldFallback')}
                    </h2>
                    <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.13em] text-white/40">
                      {modeLabel}
                    </span>
                  </div>
                  <div
                    ref={previewRef}
                    aria-label={`${session.label || t('keyboard.fieldFallback')}: ${session.target.type === 'password' ? t('keyboard.passwordHidden') : session.value}`}
                    className="gamepad-keyboard-preview"
                  >
                    <PreviewValue session={session} emptyLabel={t('keyboard.empty')} />
                  </div>
                </div>
                <button
                  data-focusable
                  type="button"
                  onClick={close}
                  aria-label={t('keyboard.close')}
                  className="gamepad-keyboard-close"
                >
                  <X size={18} />
                </button>
              </header>

              <div className="gamepad-keyboard-rows" data-mode={mode}>
                {rows.map((row, rowIndex) => (
                  <div key={`${mode}-${rowIndex}`} className="gamepad-keyboard-row">
                    {mode === 'letters' && rowIndex === 2 && (
                      <KeyboardKey
                        label={t('keyboard.shift')}
                        onPress={() => setShift((current) => !current)}
                        active={shift}
                        weight={1.45}
                      >
                        <CaseUpper size={20} />
                        <span className="hidden text-[10px] font-bold xl:inline">{t('keyboard.shift')}</span>
                      </KeyboardKey>
                    )}
                    {row.map((character, characterIndex) => {
                      const displayed =
                        mode === 'letters' && caps !== shift ? character.toUpperCase() : character
                      return (
                        <KeyboardKey
                          key={`${character}-${characterIndex}`}
                          label={displayed}
                          onPress={() => insertCharacter(character)}
                          defaultFocus={rowIndex === 0 && characterIndex === 0}
                        >
                          {displayed}
                        </KeyboardKey>
                      )
                    })}
                    {((mode === 'letters' && rowIndex === 2) ||
                      (mode === 'symbols' && rowIndex === rows.length - 1)) && (
                      <KeyboardKey
                        label={t('keyboard.backspace')}
                        onPress={() => edit({ type: 'backspace' })}
                        weight={1.45}
                      >
                        <Delete size={21} />
                      </KeyboardKey>
                    )}
                  </div>
                ))}

                <div className="gamepad-keyboard-row gamepad-keyboard-actions">
                  {mode === 'numbers' ? (
                    <KeyboardKey label={t('keyboard.letters')} onPress={() => setMode('letters')} weight={1.15}>
                      ABC
                    </KeyboardKey>
                  ) : (
                    <KeyboardKey label={mode === 'letters' ? t('keyboard.symbols') : t('keyboard.letters')} onPress={toggleLayout} weight={1.15}>
                      {mode === 'letters' ? '123' : 'ABC'}
                    </KeyboardKey>
                  )}
                  {mode === 'symbols' && (
                    <KeyboardKey
                      label={t('keyboard.moreSymbols')}
                      onPress={() => setSecondarySymbols((current) => !current)}
                      active={secondarySymbols}
                      weight={1.1}
                    >
                      #+=
                    </KeyboardKey>
                  )}
                  {mode === 'letters' && (
                    <KeyboardKey
                      label={t('keyboard.caps')}
                      onPress={() => {
                        setCaps((current) => !current)
                        setShift(false)
                      }}
                      active={caps}
                      weight={1.1}
                    >
                      ⇪
                    </KeyboardKey>
                  )}
                  <KeyboardKey label={t('keyboard.cursorLeft')} onPress={() => edit({ type: 'cursor', direction: -1 })} quiet>
                    <ArrowLeft size={20} />
                  </KeyboardKey>
                  <KeyboardKey label={t('keyboard.space')} onPress={() => edit({ type: 'insert', text: ' ' })} weight={4.2}>
                    <span className="text-xs font-semibold text-white/60">{t('keyboard.space')}</span>
                  </KeyboardKey>
                  <KeyboardKey label={t('keyboard.cursorRight')} onPress={() => edit({ type: 'cursor', direction: 1 })} quiet>
                    <ArrowRight size={20} />
                  </KeyboardKey>
                  <KeyboardKey label={completionLabel} onPress={complete} weight={1.65} primary>
                    {isSearch ? <Search size={19} /> : <CornerDownLeft size={19} />}
                    <span className="text-[10px] font-bold xl:text-xs">{completionLabel}</span>
                  </KeyboardKey>
                </div>
              </div>

              <p className="gamepad-keyboard-hint">
                <span><b>{buttons.south}</b> {t('keyboard.hint.select')}</span>
                <span><b>{buttons.east}</b> {t('keyboard.hint.close')}</span>
                <span><b>{buttons.west}</b> {t('keyboard.hint.delete')}</span>
                <span><b>{buttons.north}</b> {t('keyboard.hint.space')}</span>
                <span><b>{buttons.leftBumper}/{buttons.rightBumper}</b> {t('keyboard.hint.cursor')}</span>
              </p>
            </div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
