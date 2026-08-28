import { forwardRef, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  Battery,
  BatteryCharging,
  BatteryFull,
  BatteryLow,
  BatteryMedium,
  BatteryWarning,
  Bluetooth,
  BluetoothOff,
  Cable,
  ChevronRight,
  RefreshCw,
  Wifi,
  WifiOff,
  X,
  type LucideIcon
} from 'lucide-react'
import type { SystemSettingsTarget, SystemStatusSnapshot } from '@shared/ipc'
import { useBackHandler } from '@renderer/hooks/useBackHandler'
import { useT } from '@renderer/i18n/useT'
import type { TranslationKey } from '@renderer/i18n/translations'
import { focusElement } from '@renderer/lib/spatialNavigation'

const INITIAL_STATUS: SystemStatusSnapshot = {
  platform: 'windows',
  state: 'loading',
  checkedAt: 0,
  battery: {
    present: false,
    charging: false,
    powerSource: 'unknown'
  },
  network: {
    connected: false,
    type: 'unknown'
  },
  bluetooth: {
    available: false,
    enabled: false
  }
}

function batteryIcon(status: SystemStatusSnapshot): LucideIcon {
  if (status.battery.charging) return BatteryCharging
  const level = status.battery.level
  if (!status.battery.present || level === undefined) return Battery
  if (level <= 15) return BatteryWarning
  if (level <= 35) return BatteryLow
  if (level <= 75) return BatteryMedium
  return BatteryFull
}

function networkIcon(status: SystemStatusSnapshot): LucideIcon {
  if (!status.network.connected) return WifiOff
  return status.network.type === 'ethernet' ? Cable : Wifi
}

function bluetoothIcon(status: SystemStatusSnapshot): LucideIcon {
  return status.bluetooth.enabled ? Bluetooth : BluetoothOff
}

interface SystemQuickMenuProps {
  compact?: boolean
  onOpenChange?: (open: boolean) => void
}

export function SystemQuickMenu({
  compact = false,
  onOpenChange
}: SystemQuickMenuProps): JSX.Element {
  const t = useT()
  const prefersReducedMotion = useReducedMotion()
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<SystemStatusSnapshot>(INITIAL_STATUS)
  const BatteryIcon = batteryIcon(status)
  const NetworkIcon = networkIcon(status)
  const BluetoothIcon = bluetoothIcon(status)

  useEffect(() => {
    let active = true
    const unsubscribe = window.api.system.status.onUpdated((next) => {
      if (active) setStatus(next)
    })
    void window.api.system.status.get().then((next) => {
      if (active) setStatus(next)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const batteryLevel =
    status.battery.present && status.battery.level !== undefined
      ? `${status.battery.level}%`
      : '–'

  const openMenu = (): void => {
    setOpen(true)
    onOpenChange?.(true)
  }

  const closeMenu = (): void => {
    setOpen(false)
    onOpenChange?.(false)
  }

  return (
    <>
      <motion.button
        data-focusable
        type="button"
        aria-label={t('system.quick.open')}
        title={t('system.quick.open')}
        aria-expanded={open}
        onClick={openMenu}
        whileHover={{ scale: 1.035 }}
        whileTap={{ scale: 0.96 }}
        className={`group flex h-9 shrink-0 items-center rounded-full border border-white/[0.08] bg-black/20 text-white/70 shadow-[0_8px_24px_rgba(0,0,0,0.18)] backdrop-blur-xl transition-[gap,padding,color,background-color] duration-300 hover:bg-white/10 hover:text-white data-[focused=true]:border-accent/60 data-[focused=true]:bg-white/10 data-[focused=true]:text-accent ${
          compact ? 'gap-1 px-2' : 'gap-1.5 px-2.5'
        }`}
      >
        <span className="flex items-center gap-0.5" aria-hidden="true">
          <BatteryIcon size={16} strokeWidth={status.battery.present ? 2.2 : 1.7} />
          <AnimatePresence initial={false}>
            {!compact && (
              <motion.span
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 'auto', opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={
                  prefersReducedMotion
                    ? { duration: 0 }
                    : { duration: 0.24, ease: [0.22, 1, 0.36, 1] }
                }
                className="min-w-[1.55rem] overflow-hidden text-[10px] font-semibold tabular-nums"
              >
                {batteryLevel}
              </motion.span>
            )}
          </AnimatePresence>
        </span>
        <span aria-hidden="true" className="h-4 w-px bg-white/10" />
        <NetworkIcon
          aria-hidden="true"
          size={15}
          strokeWidth={status.network.connected ? 2.2 : 1.7}
        />
        <BluetoothIcon
          aria-hidden="true"
          size={15}
          strokeWidth={status.bluetooth.enabled ? 2.2 : 1.7}
        />
      </motion.button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <SystemQuickMenuDialog
              status={status}
              onStatus={setStatus}
              onClose={closeMenu}
            />
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  )
}

interface QuickMenuDialogProps {
  status: SystemStatusSnapshot
  onStatus: (status: SystemStatusSnapshot) => void
  onClose: () => void
}

function SystemQuickMenuDialog({ status, onStatus, onClose }: QuickMenuDialogProps): JSX.Element {
  const t = useT()
  const firstCardRef = useRef<HTMLButtonElement>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [actionFailed, setActionFailed] = useState(false)

  useBackHandler(onClose)

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    const appRoot = document.getElementById('root')
    appRoot?.setAttribute('inert', '')
    const frame = requestAnimationFrame(() => focusElement(firstCardRef.current))
    return () => {
      cancelAnimationFrame(frame)
      appRoot?.removeAttribute('inert')
      if (previousFocus?.isConnected) requestAnimationFrame(() => focusElement(previousFocus))
    }
  }, [])

  const refresh = async (): Promise<void> => {
    if (refreshing) return
    setRefreshing(true)
    setActionFailed(false)
    try {
      onStatus(await window.api.system.status.refresh())
    } catch {
      setActionFailed(true)
    } finally {
      setRefreshing(false)
    }
  }

  const openSettings = async (target: SystemSettingsTarget): Promise<void> => {
    setActionFailed(false)
    try {
      await window.api.system.status.openSettings(target)
    } catch {
      setActionFailed(true)
    }
  }

  const networkTarget: SystemSettingsTarget =
    status.network.type === 'ethernet' ? 'ethernet' : 'wifi'

  return (
    <motion.div
      data-focus-scope="active"
      role="dialog"
      aria-modal="true"
      aria-label={t('system.quick.title')}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      className="fixed inset-0 z-[90] bg-black/45"
    >
      <motion.section
        initial={{ opacity: 0, y: -16, x: 14, scale: 0.94, filter: 'blur(8px)' }}
        animate={{ opacity: 1, y: 0, x: 0, scale: 1, filter: 'blur(0px)' }}
        exit={{ opacity: 0, y: -10, x: 10, scale: 0.96, filter: 'blur(5px)' }}
        transition={{ type: 'spring', stiffness: 390, damping: 31, mass: 0.82 }}
        onPointerDown={(event) => event.stopPropagation()}
        className="scrollbar-none absolute right-4 top-[4.5rem] max-h-[calc(100vh-5.25rem)] w-[min(29rem,calc(100vw-2rem))] overflow-y-auto rounded-[1.4rem] border border-white/10 bg-[#090c12] p-1.5 shadow-[0_28px_80px_rgba(0,0,0,0.72)] xl:right-8"
      >
        <div className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full bg-accent/10 blur-3xl" />
        <div className="relative rounded-[1.05rem] border border-white/[0.06] bg-[#10151d] p-3">
          <div className="mb-3 flex items-start justify-between gap-3 px-1">
            <div>
              <p className="text-base font-bold text-white">{t('system.quick.title')}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-white/45">
                {t('system.quick.subtitle')}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <motion.button
                data-focusable
                data-disabled={refreshing ? 'true' : undefined}
                type="button"
                onClick={() => void refresh()}
                disabled={refreshing}
                aria-label={t('system.quick.refresh')}
                whileTap={{ scale: 0.9 }}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1a202b] text-white/55 transition-colors hover:bg-[#242c39] hover:text-white disabled:opacity-50 data-[focused=true]:text-accent"
              >
                <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
              </motion.button>
              <button
                data-focusable
                type="button"
                onClick={onClose}
                aria-label={t('system.quick.close')}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1a202b] text-white/55 transition-colors hover:bg-[#242c39] hover:text-white data-[focused=true]:text-accent"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 max-[720px]:grid-cols-1">
            <StatusCard
              ref={firstCardRef}
              icon={batteryIcon(status)}
              label={t('system.quick.battery')}
              value={batteryValue(status, t)}
              detail={batteryDetail(status, t)}
              active={status.battery.present}
              onClick={() => void openSettings('power')}
            />
            <StatusCard
              icon={networkIcon(status)}
              label={networkLabel(status, t)}
              value={networkValue(status, t)}
              detail={networkDetail(status, t)}
              active={status.network.connected}
              onClick={() => void openSettings(networkTarget)}
            />
            <StatusCard
              icon={bluetoothIcon(status)}
              label={t('system.quick.bluetooth')}
              value={bluetoothValue(status, t)}
              detail={t('system.quick.bluetoothDetail')}
              active={status.bluetooth.enabled}
              onClick={() => void openSettings('bluetooth')}
            />
          </div>

          {(status.state === 'partial' || status.state === 'error' || actionFailed) && (
            <p className="mt-2 rounded-xl border border-amber-300/15 bg-amber-300/[0.06] px-3 py-2 text-[10px] leading-relaxed text-amber-100/65">
              {actionFailed ? t('system.quick.actionFailed') : t('system.quick.stale')}
            </p>
          )}

          <p className="mt-3 px-1 text-[9px] font-medium uppercase tracking-[0.16em] text-white/30">
            {t('system.quick.settingsHint')}
          </p>
        </div>
      </motion.section>
    </motion.div>
  )
}

interface StatusCardProps {
  icon: LucideIcon
  label: string
  value: string
  detail: string
  active: boolean
  onClick: () => void
}

const StatusCard = forwardRef<HTMLButtonElement, StatusCardProps>(function StatusCard(
  {
    icon: Icon,
    label,
    value,
    detail,
    active,
    onClick
  }: StatusCardProps,
  ref
): JSX.Element {
  return (
    <motion.button
      ref={ref}
      data-focusable
      type="button"
      onClick={onClick}
      whileHover={{ y: -3 }}
      whileFocus={{ y: -3 }}
      whileTap={{ scale: 0.975 }}
      transition={{ type: 'spring', stiffness: 430, damping: 30 }}
      className="group relative flex min-h-[10.5rem] min-w-0 flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#151b25] p-3 text-left transition-colors hover:bg-[#1d2532] data-[focused=true]:border-accent/60 max-[720px]:min-h-0 max-[720px]:flex-row max-[720px]:items-center max-[720px]:gap-3"
    >
      <span
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${
          active
            ? 'border-accent/25 bg-accent/15 text-accent'
            : 'border-white/[0.06] bg-white/[0.04] text-white/35'
        }`}
      >
        <Icon size={22} />
      </span>
      <span className="mt-3 min-w-0 flex-1 max-[720px]:mt-0">
        <span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-white/35">
          {label}
        </span>
        <span className="mt-1 block truncate text-base font-bold text-white">{value}</span>
        <span className="mt-1 block text-[11px] leading-snug text-white/42">{detail}</span>
      </span>
      <ChevronRight
        size={15}
        className="absolute bottom-3 right-3 text-white/18 transition-all group-hover:translate-x-0.5 group-hover:text-white/55 max-[720px]:static"
      />
    </motion.button>
  )
})

type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string

function batteryValue(status: SystemStatusSnapshot, t: Translate): string {
  if (status.state === 'loading') return t('system.quick.loading')
  if (!status.battery.present || status.battery.level === undefined) {
    return t('system.quick.noBattery')
  }
  return `${status.battery.level}%`
}

function batteryDetail(status: SystemStatusSnapshot, t: Translate): string {
  if (!status.battery.present) return t('system.quick.noBatteryDetail')
  if (status.battery.charging) return t('system.quick.charging')
  if (status.battery.powerSource === 'ac') return t('system.quick.acPower')
  return t('system.quick.onBattery')
}

function networkLabel(status: SystemStatusSnapshot, t: Translate): string {
  if (status.network.type === 'ethernet') return t('system.quick.ethernet')
  return t('system.quick.wifi')
}

function networkValue(status: SystemStatusSnapshot, t: Translate): string {
  if (status.state === 'loading') return t('system.quick.loading')
  if (!status.network.connected) return t('system.quick.offline')
  return status.network.name ?? t('system.quick.connected')
}

function networkDetail(status: SystemStatusSnapshot, t: Translate): string {
  if (!status.network.connected) return t('system.quick.networkDetail')
  return status.network.linkSpeed ?? t('system.quick.networkDetail')
}

function bluetoothValue(status: SystemStatusSnapshot, t: Translate): string {
  if (status.state === 'loading') return t('system.quick.loading')
  if (!status.bluetooth.available) return t('system.quick.unavailable')
  return status.bluetooth.enabled ? t('system.quick.on') : t('system.quick.off')
}
