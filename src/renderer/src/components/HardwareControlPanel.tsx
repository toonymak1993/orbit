import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown, CircleAlert, Gamepad2, Loader2, Radio, Timer } from 'lucide-react'
import {
  HARDWARE_CONTROL_BUTTONS,
  HARDWARE_CONTROL_HOLD_SECONDS,
  type HardwareControlButton,
  type HardwareControlStatus
} from '@shared/ipc'
import { useT } from '@renderer/i18n/useT'
import type { TranslationKey } from '@renderer/i18n/translations'
import { useBackHandler } from '@renderer/hooks/useBackHandler'
import { focusElement } from '@renderer/lib/spatialNavigation'
import { usePreferencesStore } from '@renderer/state/preferencesStore'

export const HARDWARE_CONTROL_BUTTON_LABEL_KEYS: Record<
  HardwareControlButton,
  TranslationKey
> = {
  menu: 'settings.hardwareControl.button.menu',
  view: 'settings.hardwareControl.button.view',
  guide: 'settings.hardwareControl.button.guide',
  a: 'settings.hardwareControl.button.a',
  b: 'settings.hardwareControl.button.b',
  x: 'settings.hardwareControl.button.x',
  y: 'settings.hardwareControl.button.y',
  'dpad-up': 'settings.hardwareControl.button.dpadUp',
  'dpad-down': 'settings.hardwareControl.button.dpadDown',
  'dpad-left': 'settings.hardwareControl.button.dpadLeft',
  'dpad-right': 'settings.hardwareControl.button.dpadRight',
  'left-trigger': 'settings.hardwareControl.button.leftTrigger',
  'right-trigger': 'settings.hardwareControl.button.rightTrigger',
  'left-bumper': 'settings.hardwareControl.button.leftBumper',
  'right-bumper': 'settings.hardwareControl.button.rightBumper',
  'left-stick': 'settings.hardwareControl.button.leftStick',
  'right-stick': 'settings.hardwareControl.button.rightStick'
}

function statusCopy(
  status: HardwareControlStatus,
  t: ReturnType<typeof useT>
): { label: string; tone: string; icon: JSX.Element } {
  if (status.state === 'starting') {
    return {
      label: t('settings.hardwareControl.status.starting'),
      tone: 'border-accent/25 bg-accent/10 text-accent',
      icon: <Loader2 size={12} className="animate-spin" />
    }
  }
  if (status.state === 'unavailable') {
    return {
      label: t(
        status.reason === 'unsupported-platform'
          ? 'settings.hardwareControl.status.unsupported'
          : status.reason === 'service-not-running'
            ? 'settings.hardwareControl.status.serviceRequired'
          : 'settings.hardwareControl.status.unavailable'
      ),
      tone: 'border-amber-300/25 bg-amber-300/10 text-amber-200',
      icon: <CircleAlert size={12} />
    }
  }
  if (status.state === 'ready') {
    const label =
      status.connectedControllers === 0
        ? t('settings.hardwareControl.status.waiting')
        : status.connectedControllers === 1
          ? t('settings.hardwareControl.status.oneController')
          : t('settings.hardwareControl.status.controllers', {
              count: status.connectedControllers
            })
    return {
      label,
      tone:
        status.connectedControllers > 0
          ? 'border-emerald-300/25 bg-emerald-300/10 text-emerald-200'
          : 'border-white/10 bg-white/[0.05] text-white/50',
      icon: <Radio size={12} />
    }
  }
  return {
    label: t('settings.hardwareControl.status.disabled'),
    tone: 'border-white/10 bg-white/[0.04] text-white/42',
    icon: <Radio size={12} />
  }
}

export function HardwareControlPanel(): JSX.Element {
  const t = useT()
  const {
    hardwareControlEnabled,
    hardwareControlButton,
    hardwareControlHoldSeconds,
    setHardwareControlEnabled,
    setHardwareControlButton,
    setHardwareControlHoldSeconds
  } = usePreferencesStore()
  const [status, setStatus] = useState<HardwareControlStatus>({
    state: hardwareControlEnabled ? 'starting' : 'disabled',
    connectedControllers: 0
  })
  const [toggleBusy, setToggleBusy] = useState(false)

  useEffect(() => {
    let mounted = true
    const unsubscribe = window.api.hardwareControl.onStatus((next) => {
      if (mounted) setStatus(next)
    })
    void window.api.hardwareControl.getStatus().then((next) => {
      if (mounted) setStatus(next)
    })
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  const statusPresentation = statusCopy(status, t)
  const inputDiagnostic = status.lastTriggerAt
    ? {
        copy: t('settings.hardwareControl.input.triggered', {
          time: new Date(status.lastTriggerAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          })
        }),
        tone: 'border-emerald-300/20 bg-emerald-300/[0.07] text-emerald-100/75'
      }
    : status.lastInputAt
      ? {
          copy:
            status.lastPressDurationMs === undefined
              ? t('settings.hardwareControl.input.detected', {
                  seconds: hardwareControlHoldSeconds
                })
              : t('settings.hardwareControl.input.short', {
                  duration: (status.lastPressDurationMs / 1_000).toFixed(1),
                  seconds: hardwareControlHoldSeconds
                }),
          tone: 'border-amber-300/20 bg-amber-300/[0.07] text-amber-100/75'
        }
      : status.lastAnyInputAt && status.lastRawButtonMask !== undefined
        ? {
            copy: t('settings.hardwareControl.input.otherButton', {
              mask: `0x${status.lastRawButtonMask.toString(16).toUpperCase().padStart(4, '0')}`
            }),
            tone: 'border-amber-300/20 bg-amber-300/[0.07] text-amber-100/75'
          }
      : {
          copy: t('settings.hardwareControl.input.none'),
          tone: 'border-white/[0.06] bg-white/[0.025] text-white/38'
        }
  const toggleHardwareControl = async (): Promise<void> => {
    setToggleBusy(true)
    try {
      if (!hardwareControlEnabled) {
        const service = await window.api.backgroundService.getStatus()
        if (service.installation === 'not-installed') {
          await window.api.backgroundService.control('install')
        } else if (service.installation === 'repair-needed') {
          await window.api.backgroundService.control('repair')
        }
      }
      await setHardwareControlEnabled(!hardwareControlEnabled)
    } catch {
      setStatus({
        state: 'unavailable',
        connectedControllers: 0,
        reason: 'service-not-running'
      })
    } finally {
      setToggleBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 rounded-2xl border border-white/[0.07] bg-black/25 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent/12 text-accent">
            <Gamepad2 size={21} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-bold text-white/88">
                {t('settings.hardwareControl.enabled')}
              </h3>
              <span
                className={
                  'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider ' +
                  statusPresentation.tone
                }
                role="status"
              >
                {statusPresentation.icon}
                {statusPresentation.label}
              </span>
            </div>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-white/45">
              {t('settings.hardwareControl.enabledBody')}
            </p>
          </div>
        </div>

        <motion.button
          data-focusable
          type="button"
          role="switch"
          aria-checked={hardwareControlEnabled}
          disabled={toggleBusy}
          onClick={() => void toggleHardwareControl()}
          whileTap={{ scale: 0.96 }}
          className={
            'flex min-w-36 items-center justify-between gap-3 rounded-full border px-4 py-2.5 text-xs font-bold transition-colors ' +
            (hardwareControlEnabled
              ? 'border-accent/70 bg-accent text-black'
              : 'border-white/10 bg-white/[0.05] text-white/55')
          }
        >
          <span>
            {t(
              hardwareControlEnabled
                ? 'settings.hardwareControl.on'
                : 'settings.hardwareControl.off'
            )}
          </span>
          <span
            className={
              'flex h-5 w-5 items-center justify-center rounded-full border ' +
              (hardwareControlEnabled
                ? 'border-black/25 bg-black/15'
                : 'border-white/15 bg-black/20')
            }
          >
            {toggleBusy ? (
              <Loader2 size={12} className="animate-spin" />
            ) : hardwareControlEnabled ? (
              <Check size={12} strokeWidth={3} />
            ) : null}
          </span>
        </motion.button>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <HardwareChoiceGroup
          icon={<Gamepad2 size={15} />}
          title={t('settings.hardwareControl.buttonTitle')}
          description={t('settings.hardwareControl.buttonBody')}
          contentClassName="mt-3"
        >
          <HardwareButtonSelect
            value={hardwareControlButton}
            onChange={(button) => void setHardwareControlButton(button)}
          />
        </HardwareChoiceGroup>

        <HardwareChoiceGroup
          icon={<Timer size={15} />}
          title={t('settings.hardwareControl.holdTitle')}
          description={t('settings.hardwareControl.holdBody')}
        >
          {HARDWARE_CONTROL_HOLD_SECONDS.map((seconds) => (
            <HardwareChoice
              key={seconds}
              active={hardwareControlHoldSeconds === seconds}
              onClick={() => void setHardwareControlHoldSeconds(seconds)}
            >
              {t('settings.hardwareControl.seconds', { seconds })}
            </HardwareChoice>
          ))}
        </HardwareChoiceGroup>
      </div>

      <p className="flex items-start gap-2 rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-2.5 text-[10px] leading-relaxed text-white/38">
        <CircleAlert size={13} className="mt-0.5 shrink-0 text-white/45" />
        {t('settings.hardwareControl.compatibility')}
      </p>
      {hardwareControlEnabled && status.state === 'ready' && (
        <p
          className={
            'flex items-start gap-2 rounded-xl border px-3 py-2.5 text-[10px] font-semibold leading-relaxed ' +
            inputDiagnostic.tone
          }
          role="status"
        >
          <Radio size={13} className="mt-0.5 shrink-0" />
          {inputDiagnostic.copy}
        </p>
      )}
    </div>
  )
}

function HardwareChoiceGroup({
  icon,
  title,
  description,
  contentClassName = 'mt-3 grid grid-cols-2 gap-2',
  children
}: {
  icon: JSX.Element
  title: string
  description: string
  contentClassName?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <section className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-accent">{icon}</span>
        <div>
          <h4 className="text-xs font-bold text-white/75">{title}</h4>
          <p className="mt-1 text-[10px] leading-relaxed text-white/38">{description}</p>
        </div>
      </div>
      <div className={contentClassName}>{children}</div>
    </section>
  )
}

function HardwareButtonSelect({
  value,
  onChange
}: {
  value: HardwareControlButton
  onChange: (value: HardwareControlButton) => void
}): JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listboxId = useId()

  return (
    <>
      <motion.button
        ref={buttonRef}
        data-focusable
        type="button"
        role="combobox"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setOpen(true)
          }
        }}
        whileTap={{ scale: 0.98 }}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-white/[0.09] bg-black/25 px-3.5 py-2.5 text-left text-xs font-semibold text-white/75 transition-colors hover:bg-white/[0.05] data-[focused=true]:border-accent/70 data-[focused=true]:bg-accent/10 data-[focused=true]:text-white"
      >
        <span className="truncate">{t(HARDWARE_CONTROL_BUTTON_LABEL_KEYS[value])}</span>
        <ChevronDown
          size={15}
          className={`shrink-0 text-accent transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </motion.button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <HardwareButtonMenu
              anchor={buttonRef.current}
              id={listboxId}
              value={value}
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
  const width = Math.min(Math.max(rect.width, 280), window.innerWidth - viewportPadding * 2)
  const left = Math.min(
    Math.max(viewportPadding, rect.left),
    window.innerWidth - width - viewportPadding
  )
  const spaceBelow = window.innerHeight - rect.bottom - viewportPadding
  const spaceAbove = rect.top - viewportPadding
  const openAbove = spaceBelow < 300 && spaceAbove > spaceBelow
  const availableHeight = Math.max(160, Math.min(360, openAbove ? spaceAbove - 8 : spaceBelow - 8))

  return openAbove
    ? { left, bottom: window.innerHeight - rect.top + 8, width, maxHeight: availableHeight }
    : { left, top: rect.bottom + 8, width, maxHeight: availableHeight }
}

function HardwareButtonMenu({
  anchor,
  id,
  value,
  onChange,
  onClose
}: {
  anchor: HTMLButtonElement | null
  id: string
  value: HardwareControlButton
  onChange: (value: HardwareControlButton) => void
  onClose: () => void
}): JSX.Element {
  const t = useT()
  const selectedRef = useRef<HTMLButtonElement>(null)

  useBackHandler(onClose)

  useEffect(() => {
    const frame = requestAnimationFrame(() => focusElement(selectedRef.current))
    return () => {
      cancelAnimationFrame(frame)
      if (anchor?.isConnected) requestAnimationFrame(() => focusElement(anchor))
    }
  }, [anchor])

  useEffect(() => {
    const handleResize = (): void => onClose()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
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
      className="fixed inset-0 z-[95] bg-black/20"
    >
      <motion.div
        id={id}
        role="listbox"
        aria-label={t('settings.hardwareControl.buttonTitle')}
        initial={{ opacity: 0, y: -6, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -4, scale: 0.985 }}
        transition={{ duration: 0.14 }}
        style={menuPosition(anchor)}
        className="fixed overflow-y-auto rounded-2xl border border-white/[0.12] bg-[rgb(var(--color-surface-2)/0.98)] p-2 shadow-2xl backdrop-blur-2xl"
      >
        {HARDWARE_CONTROL_BUTTONS.map((button) => {
          const selected = button === value
          return (
            <button
              key={button}
              ref={selected ? selectedRef : undefined}
              data-focusable
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => {
                onChange(button)
                onClose()
              }}
              className={`flex min-h-10 w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-xs font-semibold transition-colors data-[focused=true]:bg-accent/[0.16] data-[focused=true]:text-white ${
                selected ? 'bg-accent/12 text-white' : 'text-white/55 hover:bg-white/[0.06]'
              }`}
            >
              <span>{t(HARDWARE_CONTROL_BUTTON_LABEL_KEYS[button])}</span>
              {selected && <Check size={13} className="shrink-0 text-accent" strokeWidth={3} />}
            </button>
          )
        })}
      </motion.div>
    </motion.div>
  )
}

function HardwareChoice({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <motion.button
      data-focusable
      type="button"
      aria-pressed={active}
      onClick={onClick}
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.97 }}
      className={
        'flex min-h-11 items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-xs font-semibold transition-colors ' +
        (active
          ? 'border-accent/65 bg-accent/14 text-white'
          : 'border-white/[0.07] bg-black/20 text-white/48 hover:bg-white/[0.05]')
      }
    >
      <span>{children}</span>
      <span
        className={
          'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ' +
          (active ? 'border-accent bg-accent text-black' : 'border-white/15 text-transparent')
        }
      >
        <Check size={9} strokeWidth={3} />
      </span>
    </motion.button>
  )
}
