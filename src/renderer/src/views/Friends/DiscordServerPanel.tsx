import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import {
  CircleAlert,
  ExternalLink,
  Loader2,
  RefreshCw,
  Server,
  X
} from 'lucide-react'
import { ControllerButtonHint } from '@renderer/components/ControllerButtonHint'
import { useBackHandler } from '@renderer/hooks/useBackHandler'
import { useT } from '@renderer/i18n/useT'
import { focusElement } from '@renderer/lib/spatialNavigation'
import type { DiscordServer, DiscordServerList } from '@shared/ipc'

interface Props {
  onClose: () => void
}

function serverMonogram(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean)
  return (words.length > 1 ? `${words[0][0]}${words[1][0]}` : words[0]?.slice(0, 2) || 'DS')
    .toLocaleUpperCase()
    .slice(0, 2)
}

function serverHue(id: string): number {
  let hash = 0
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) % 360
  return hash
}

export function DiscordServerPanel({ onClose }: Props): JSX.Element {
  const t = useT()
  const panelRef = useRef<HTMLElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const requestRef = useRef(0)
  const [list, setList] = useState<DiscordServerList>({ state: 'ready', servers: [] })
  const [loading, setLoading] = useState(true)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [openFailedFor, setOpenFailedFor] = useState<string | null>(null)

  useBackHandler(() => onClose())

  const loadServers = useCallback(async (): Promise<void> => {
    const requestId = ++requestRef.current
    setLoading(true)
    try {
      const next = await window.api.discordServers.list()
      if (requestId !== requestRef.current) return
      setList(next)
    } catch {
      if (requestId !== requestRef.current) return
      setList({ state: 'unavailable', servers: [], issue: 'provider-unavailable' })
    } finally {
      if (requestId === requestRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null
    const focusFrame = requestAnimationFrame(() => {
      focusElement(panelRef.current?.querySelector<HTMLElement>('[data-panel-entry]') ?? null)
    })
    void loadServers()
    return () => {
      cancelAnimationFrame(focusFrame)
      requestRef.current++
      const previousFocus = previousFocusRef.current
      if (previousFocus?.isConnected) requestAnimationFrame(() => focusElement(previousFocus))
    }
  }, [loadServers])

  const openServer = async (server: DiscordServer): Promise<void> => {
    setOpeningId(server.id)
    setOpenFailedFor(null)
    try {
      await window.api.discordServers.open(server.id)
    } catch {
      setOpenFailedFor(server.id)
    } finally {
      setOpeningId(null)
    }
  }

  return createPortal(
    <motion.div
      data-focus-scope="active"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#02040c]/78 px-5 py-16 backdrop-blur-xl"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <motion.section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="discord-servers-title"
        className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-[calc(var(--radius-card)*1.15)] border border-white/[0.1] bg-[#090d19]/95 shadow-2xl"
        initial={{ opacity: 0, y: 18, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.99 }}
        transition={{ type: 'spring', stiffness: 390, damping: 34 }}
      >
        <header className="flex items-center gap-4 border-b border-white/[0.08] px-5 py-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#5865f2] text-white shadow-lg shadow-[#5865f2]/20">
            <Server size={21} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="discord-servers-title" className="text-lg font-black text-white">
              {t('friends.servers.title')}
            </h2>
            <p className="mt-0.5 text-xs text-white/45">
              {t('friends.servers.subtitle')}
            </p>
          </div>
          {!loading && list.state === 'ready' && (
            <span className="hidden rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-white/45 sm:block">
              {t('friends.servers.count', { count: list.servers.length })}
            </span>
          )}
          <button
            data-focusable
            data-panel-entry
            type="button"
            onClick={() => void loadServers()}
            aria-label={t('friends.servers.refresh')}
            disabled={loading}
            data-disabled={loading ? 'true' : undefined}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
          >
            <RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            data-focusable
            type="button"
            onClick={onClose}
            aria-label={t('friends.chat.close')}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white/50 transition hover:bg-white/10 hover:text-white"
          >
            <X size={18} />
          </button>
        </header>

        <div className="scrollbar-none min-h-64 flex-1 overflow-y-auto p-5" aria-live="polite">
          {loading && list.servers.length === 0 && (
            <div className="flex min-h-64 items-center justify-center text-sm text-white/45">
              <Loader2 size={18} className="mr-2 animate-spin" />
              {t('friends.servers.loading')}
            </div>
          )}

          {!loading && list.state === 'unavailable' && (
            <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-300/10 text-amber-200">
                <CircleAlert size={23} />
              </span>
              <p className="mt-4 text-sm font-semibold text-white/80">
                {t('friends.servers.unavailable')}
              </p>
              <p className="mt-1 max-w-md text-xs leading-relaxed text-white/40">
                {t('friends.servers.unavailableBody')}
              </p>
              <button
                data-focusable
                type="button"
                onClick={() => void loadServers()}
                className="mt-5 flex min-h-10 items-center gap-2 rounded-full bg-white/10 px-4 text-xs font-black text-white transition hover:bg-white/15"
              >
                <RefreshCw size={14} />
                {t('friends.retry')}
              </button>
            </div>
          )}

          {!loading && list.state === 'ready' && list.servers.length === 0 && (
            <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#5865f2]/15 text-[#aeb4ff]">
                <Server size={23} />
              </span>
              <p className="mt-4 text-sm font-semibold text-white/80">
                {t('friends.servers.empty')}
              </p>
              <p className="mt-1 max-w-md text-xs leading-relaxed text-white/40">
                {t('friends.servers.emptyBody')}
              </p>
            </div>
          )}

          {list.state === 'ready' && list.servers.length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.servers.map((server) => {
                const opening = openingId === server.id
                const failed = openFailedFor === server.id
                const hue = serverHue(server.id)
                return (
                  <button
                    key={server.id}
                    data-focusable
                    type="button"
                    disabled={openingId !== null}
                    data-disabled={openingId !== null ? 'true' : undefined}
                    onClick={() => void openServer(server)}
                    className={`group flex min-h-20 items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition disabled:opacity-55 ${
                      failed
                        ? 'border-amber-300/30 bg-amber-300/[0.07]'
                        : 'border-white/[0.08] bg-white/[0.035] hover:border-[#7f88ff]/35 hover:bg-[#5865f2]/10'
                    }`}
                  >
                    <span
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-xs font-black text-white shadow-inner"
                      style={{ background: `hsl(${hue} 48% 38%)` }}
                      aria-hidden="true"
                    >
                      {serverMonogram(server.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-white/85">
                        {server.name}
                      </span>
                      <span className={`mt-1 block text-[10px] ${failed ? 'text-amber-200' : 'text-white/35'}`}>
                        {failed ? t('friends.servers.openFailed') : t('friends.servers.open')}
                      </span>
                    </span>
                    {opening ? (
                      <Loader2 size={16} className="shrink-0 animate-spin text-[#aeb4ff]" />
                    ) : (
                      <ExternalLink size={15} className="shrink-0 text-white/25 transition group-hover:text-[#aeb4ff]" />
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-4 border-t border-white/[0.08] bg-black/15 px-5 py-3 text-[9px] uppercase tracking-[0.1em] text-white/30">
          <span>{t('friends.servers.externalHint')}</span>
          <span className="flex shrink-0 items-center gap-3">
            <span className="flex items-center gap-1">
              <ControllerButtonHint button="south" className="font-black text-white/55" />
              {t('friends.servers.openShort')}
            </span>
            <span className="flex items-center gap-1">
              <ControllerButtonHint button="east" className="font-black text-white/55" />
              {t('friends.chat.backHint')}
            </span>
          </span>
        </footer>
      </motion.section>
    </motion.div>,
    document.body
  )
}
