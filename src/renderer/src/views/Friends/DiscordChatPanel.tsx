import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import {
  CircleAlert,
  ExternalLink,
  ImageOff,
  Inbox,
  Loader2,
  MessageCircle,
  RefreshCw,
  Send,
  X
} from 'lucide-react'
import { ControllerButtonHint } from '@renderer/components/ControllerButtonHint'
import { useBackHandler } from '@renderer/hooks/useBackHandler'
import { useT } from '@renderer/i18n/useT'
import { DISCORD_CHAT_REGION_EVENT } from '@renderer/lib/discordChatNavigation'
import { focusElement } from '@renderer/lib/spatialNavigation'
import { useDiscordChatStore } from '@renderer/state/discordChatStore'
import { useFriendsStore } from '@renderer/state/friendsStore'
import type {
  DiscordChatConversation,
  DiscordChatMessage,
  OrbitFriend
} from '@shared/ipc'

const HISTORY_LIMIT = 200
const MESSAGE_LIMIT = 2_000

interface Props {
  friend?: OrbitFriend
  language: 'en' | 'de'
  onClose: () => void
  onOpenDiscord: () => Promise<boolean>
}

function upsertMessage(
  messages: DiscordChatMessage[],
  message: DiscordChatMessage
): DiscordChatMessage[] {
  return [...messages.filter((item) => item.id !== message.id), message]
    .sort((left, right) => left.sentAt - right.sentAt)
    .slice(-HISTORY_LIMIT)
}

function fallbackFriend(userId: string): OrbitFriend {
  return {
    id: `discord:${userId}`,
    provider: 'discord',
    providerUserId: userId,
    displayName: `Discord · ${userId.slice(-6)}`,
    presence: 'unknown'
  }
}

function messagePreview(conversation: DiscordChatConversation): string | undefined {
  const message = conversation.lastMessage
  if (!message) return undefined
  return message.content.trim() || undefined
}

export function DiscordChatPanel({
  friend,
  language,
  onClose,
  onOpenDiscord
}: Props): JSX.Element {
  const t = useT()
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const conversationListRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const historyRequestRef = useRef(0)
  const selectedUserIdRef = useRef<string | null>(null)
  // Zustand 5 selectors must return a stable snapshot value. Filtering inside
  // the selector creates a new array for every getSnapshot call and can send
  // React into an infinite render loop as soon as the chat mounts.
  const allFriends = useFriendsStore((state) => state.snapshot.friends)
  const discordFriends = useMemo(
    () => allFriends.filter((item) => item.provider === 'discord'),
    [allFriends]
  )
  const conversations = useDiscordChatStore((state) => state.conversations)
  const unreadByUser = useDiscordChatStore((state) => state.unreadByUser)
  const inboxState = useDiscordChatStore((state) => state.inboxState)
  const refreshInbox = useDiscordChatStore((state) => state.refreshInbox)
  const setActiveUser = useDiscordChatStore((state) => state.setActiveUser)
  const markRead = useDiscordChatStore((state) => state.markRead)
  const ingestHistory = useDiscordChatStore((state) => state.ingestHistory)
  const [selectedUserId, setSelectedUserId] = useState<string | null>(
    friend?.providerUserId ?? conversations[0]?.userId ?? null
  )
  const [messages, setMessages] = useState<DiscordChatMessage[]>([])
  const [historyState, setHistoryState] = useState<'loading' | 'ready' | 'unavailable'>(
    selectedUserId ? 'loading' : 'ready'
  )
  const [connectionLost, setConnectionLost] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendFailed, setSendFailed] = useState(false)
  const [openFailed, setOpenFailed] = useState(false)
  const [avatarFailedFor, setAvatarFailedFor] = useState<string | null>(null)

  const friendByUserId = useMemo(
    () => new Map(discordFriends.map((item) => [item.providerUserId, item])),
    [discordFriends]
  )
  const entries = useMemo(() => {
    const next = conversations.map((conversation) => ({
      conversation,
      friend: friendByUserId.get(conversation.userId) ?? fallbackFriend(conversation.userId)
    }))
    if (selectedUserId && !next.some((entry) => entry.friend.providerUserId === selectedUserId)) {
      next.unshift({
        conversation: { userId: selectedUserId, lastMessageId: '0' },
        friend: friendByUserId.get(selectedUserId) ?? fallbackFriend(selectedUserId)
      })
    }
    return next
  }, [conversations, friendByUserId, selectedUserId])
  const selectedFriend = selectedUserId
    ? friendByUserId.get(selectedUserId) ?? fallbackFriend(selectedUserId)
    : null

  const timeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(language === 'de' ? 'de-DE' : 'en-US', {
        hour: '2-digit',
        minute: '2-digit'
      }),
    [language]
  )

  useBackHandler(() => {
    if (!sending) onClose()
  })

  const loadHistory = useCallback(async (): Promise<void> => {
    if (!selectedUserId) return
    const requestId = ++historyRequestRef.current
    setHistoryState('loading')
    setConnectionLost(false)
    try {
      const history = await window.api.discordChat.history(selectedUserId, HISTORY_LIMIT)
      if (requestId !== historyRequestRef.current) return
      setMessages((current) =>
        [...history.messages, ...current].reduce(upsertMessage, [] as DiscordChatMessage[])
      )
      ingestHistory(selectedUserId, history.messages)
      setHistoryState(history.state)
      setConnectionLost(history.issue === 'not-connected')
    } catch {
      if (requestId !== historyRequestRef.current) return
      setHistoryState('unavailable')
    }
  }, [ingestHistory, selectedUserId])

  useEffect(() => {
    selectedUserIdRef.current = selectedUserId
  }, [selectedUserId])

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null
    const initialFocusFrame = requestAnimationFrame(() => {
      if (!selectedUserIdRef.current) {
        focusElement(panelRef.current?.querySelector<HTMLElement>('[data-focusable]') ?? null)
      }
    })
    void window.api.discordChat.setVisible(
      document.visibilityState === 'visible' && document.hasFocus()
    )
    const unsubscribe = window.api.discordChat.onMessage((event) => {
      if (event.kind === 'deleted') {
        setMessages((current) => current.filter((message) => message.id !== event.messageId))
        return
      }
      if (event.message.userId !== selectedUserIdRef.current) return
      setMessages((current) => upsertMessage(current, event.message))
    })
    return () => {
      cancelAnimationFrame(initialFocusFrame)
      historyRequestRef.current++
      unsubscribe()
      setActiveUser(null)
      void window.api.discordChat.setVisible(false)
      const previousFocus = previousFocusRef.current
      if (previousFocus?.isConnected) {
        requestAnimationFrame(() => focusElement(previousFocus))
      }
    }
  }, [setActiveUser])

  useEffect(() => {
    const syncVisibility = (): void => {
      const visible = document.visibilityState === 'visible' && document.hasFocus()
      void window.api.discordChat.setVisible(visible)
      if (visible && selectedUserId) markRead(selectedUserId)
    }
    window.addEventListener('focus', syncVisibility)
    window.addEventListener('blur', syncVisibility)
    document.addEventListener('visibilitychange', syncVisibility)
    return () => {
      window.removeEventListener('focus', syncVisibility)
      window.removeEventListener('blur', syncVisibility)
      document.removeEventListener('visibilitychange', syncVisibility)
    }
  }, [markRead, selectedUserId])

  useEffect(() => {
    if (!selectedUserId && conversations[0]) setSelectedUserId(conversations[0].userId)
  }, [conversations, selectedUserId])

  useEffect(() => {
    if (!selectedUserId) return
    historyRequestRef.current++
    setMessages([])
    setDraft('')
    setSendFailed(false)
    setAvatarFailedFor(null)
    setActiveUser(selectedUserId)
    void loadHistory()
    const frame = requestAnimationFrame(() => focusElement(composerRef.current))
    return () => cancelAnimationFrame(frame)
  }, [loadHistory, selectedUserId, setActiveUser])

  useEffect(() => {
    const switchRegion = (event: Event): void => {
      const step = (event as CustomEvent<1 | -1>).detail
      if (step < 0) {
        focusElement(
          conversationListRef.current?.querySelector<HTMLElement>(
            `[data-chat-user="${selectedUserId}"]`
          ) ?? conversationListRef.current?.querySelector<HTMLElement>('[data-focusable]') ?? null
        )
      } else {
        focusElement(composerRef.current)
      }
    }
    window.addEventListener(DISCORD_CHAT_REGION_EVENT, switchRegion)
    return () => window.removeEventListener(DISCORD_CHAT_REGION_EVENT, switchRegion)
  }, [selectedUserId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, historyState])

  const sendMessage = async (): Promise<void> => {
    if (!selectedUserId) return
    const content = draft.trim()
    if (!content || sending || connectionLost) return
    setSending(true)
    setSendFailed(false)
    try {
      const result = await window.api.discordChat.send(selectedUserId, content)
      if (result.ok && result.message) {
        const sentMessage = result.message
        setMessages((current) => upsertMessage(current, sentMessage))
        ingestHistory(selectedUserId, [sentMessage])
        setDraft('')
        setHistoryState('ready')
      } else {
        if (result.issue === 'not-connected') setConnectionLost(true)
        setSendFailed(true)
      }
    } catch {
      setSendFailed(true)
    }
    setSending(false)
    requestAnimationFrame(() => focusElement(composerRef.current))
  }

  const openDiscord = async (): Promise<void> => {
    setOpenFailed(false)
    try {
      if (!(await onOpenDiscord())) setOpenFailed(true)
    } catch {
      setOpenFailed(true)
    }
  }

  const initials = selectedFriend?.displayName.slice(0, 2).toUpperCase() ?? 'DC'

  return createPortal(
    <motion.div
      data-focus-scope="active"
      data-discord-chat-panel="true"
      role="dialog"
      aria-modal="true"
      aria-labelledby="discord-inbox-title"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !sending) onClose()
      }}
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/65 p-3 backdrop-blur-sm xl:p-6"
    >
      <motion.section
        ref={panelRef}
        initial={{ y: 18, opacity: 0, scale: 0.99 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 12, opacity: 0, scale: 0.995 }}
        transition={{ type: 'spring', stiffness: 380, damping: 34 }}
        onPointerDown={(event) => event.stopPropagation()}
        className="grid h-full max-h-[64rem] w-full max-w-[76rem] grid-cols-[19rem_minmax(0,1fr)] overflow-hidden rounded-[var(--radius-card)] border border-white/10 bg-[#101217] shadow-[0_32px_100px_rgba(0,0,0,0.58)] max-[900px]:grid-cols-[15rem_minmax(0,1fr)]"
      >
        <aside className="flex min-w-0 flex-col border-r border-white/[0.08] bg-black/20">
          <header className="flex min-h-[4.75rem] items-center gap-3 border-b border-white/[0.08] px-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#5865f2]/15 text-[#aeb4ff]">
              <Inbox size={19} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="discord-inbox-title" className="text-sm font-black text-white">
                {t('friends.chat.inbox')}
              </h2>
              <p className="truncate text-[10px] text-white/40">
                {t('friends.chat.inboxSubtitle')}
              </p>
            </div>
            <button
              data-focusable
              data-disabled={inboxState === 'loading' ? 'true' : undefined}
              disabled={inboxState === 'loading'}
              type="button"
              onClick={() => void refreshInbox()}
              aria-label={t('friends.chat.refreshInbox')}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/45 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
            >
              <RefreshCw size={15} className={inboxState === 'loading' ? 'animate-spin' : ''} />
            </button>
          </header>

          <div ref={conversationListRef} className="scrollbar-none flex-1 overflow-y-auto p-2">
            {entries.length === 0 && (
              <div className="flex h-full min-h-48 flex-col items-center justify-center px-5 text-center">
                <MessageCircle size={23} className="text-white/25" />
                <p className="mt-3 text-xs font-bold text-white/65">
                  {t('friends.chat.inboxEmpty')}
                </p>
                <p className="mt-1 text-[10px] leading-relaxed text-white/35">
                  {t('friends.chat.inboxEmptyBody')}
                </p>
              </div>
            )}
            {entries.map((entry) => {
              const entryUserId = entry.friend.providerUserId
              const active = entryUserId === selectedUserId
              const unread = unreadByUser[entryUserId] ?? 0
              const preview = messagePreview(entry.conversation)
              return (
                <button
                  key={entryUserId}
                  data-focusable
                  data-chat-user={entryUserId}
                  type="button"
                  aria-current={active ? 'true' : undefined}
                  onClick={() => {
                    setSelectedUserId(entryUserId)
                    markRead(entryUserId)
                  }}
                  className={`mb-1 flex min-h-[4.4rem] w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition ${
                    active
                      ? 'border-[#7d86ff]/30 bg-[#5865f2]/14'
                      : 'border-transparent hover:bg-white/[0.055]'
                  }`}
                >
                  <span className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10 text-xs font-black text-white/65">
                    {entry.friend.avatarUrl ? (
                      <img src={entry.friend.avatarUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      entry.friend.displayName.slice(0, 2).toUpperCase()
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-bold text-white/85">
                      {entry.friend.displayName}
                    </span>
                    <span className="mt-1 block truncate text-[10px] text-white/35">
                      {preview ?? t('friends.chat.noPreview')}
                    </span>
                  </span>
                  {unread > 0 && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#5865f2] px-1 text-[9px] font-black text-white">
                      {unread > 9 ? '9+' : unread}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </aside>

        <div className="flex min-w-0 flex-col">
          <header className="flex min-h-[4.75rem] items-center gap-3 border-b border-white/[0.08] px-5">
            {selectedFriend ? (
              <>
                <span className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10 text-sm font-black text-white/65">
                  {selectedFriend.avatarUrl && avatarFailedFor !== selectedFriend.providerUserId ? (
                    <img
                      src={selectedFriend.avatarUrl}
                      alt=""
                      onError={() => setAvatarFailedFor(selectedFriend.providerUserId)}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    initials
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-base font-bold text-white">
                    {selectedFriend.displayName}
                  </h3>
                  <p className="flex items-center gap-1.5 text-xs text-white/45">
                    <MessageCircle size={12} className="text-[#8b93ff]" />
                    {t('friends.chat.viaDiscord')}
                  </p>
                </div>
              </>
            ) : (
              <div className="flex-1">
                <h3 className="text-base font-bold text-white">
                  {t('friends.chat.selectConversation')}
                </h3>
              </div>
            )}
            <button
              data-focusable
              type="button"
              onClick={() => void openDiscord()}
              className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-xs font-semibold text-white/55 transition hover:bg-white/[0.07] hover:text-white"
            >
              <ExternalLink size={15} />
              {t('friends.chat.openDiscord')}
            </button>
            <button
              data-focusable
              data-disabled={sending ? 'true' : undefined}
              disabled={sending}
              type="button"
              onClick={onClose}
              aria-label={t('friends.chat.close')}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
            >
              <X size={19} />
            </button>
          </header>

          {!selectedFriend ? (
            <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
              <MessageCircle size={30} className="text-[#8b93ff]/55" />
              <p className="mt-4 text-sm font-bold text-white/70">
                {t('friends.chat.selectConversation')}
              </p>
              <p className="mt-1 max-w-sm text-xs leading-relaxed text-white/35">
                {t('friends.chat.selectConversationBody')}
              </p>
            </div>
          ) : (
            <>
              <div className="scrollbar-none flex-1 overflow-y-auto px-5 py-5" aria-live="polite">
                {historyState === 'loading' && messages.length === 0 && (
                  <div className="flex h-full min-h-48 items-center justify-center text-sm text-white/45">
                    <Loader2 size={18} className="mr-2 animate-spin" />
                    {t('friends.chat.loading')}
                  </div>
                )}

                {historyState === 'unavailable' && (
                  <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-300/15 bg-amber-300/[0.06] p-4 text-sm text-amber-50/80">
                    <CircleAlert size={17} className="mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-amber-50">
                        {t(
                          connectionLost
                            ? 'friends.chat.connectionLost'
                            : 'friends.chat.historyUnavailable'
                        )}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-amber-50/55">
                        {t(
                          connectionLost
                            ? 'friends.chat.connectionLostBody'
                            : 'friends.chat.historyUnavailableBody'
                        )}
                      </p>
                    </div>
                    <button
                      data-focusable
                      type="button"
                      onClick={() => void loadHistory()}
                      aria-label={t('friends.retry')}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-white/10"
                    >
                      <RefreshCw size={15} />
                    </button>
                  </div>
                )}

                {historyState !== 'loading' && !connectionLost && messages.length === 0 && (
                  <div className="flex min-h-56 flex-col items-center justify-center px-8 text-center">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#5865f2]/15 text-[#9fa6ff]">
                      <MessageCircle size={23} />
                    </span>
                    <p className="mt-4 text-sm font-semibold text-white/75">
                      {t('friends.chat.empty', { name: selectedFriend.displayName })}
                    </p>
                    <p className="mt-1 max-w-sm text-xs leading-relaxed text-white/40">
                      {t('friends.chat.emptyBody')}
                    </p>
                  </div>
                )}

                {messages.length > 0 && (
                  <div className="space-y-2.5">
                    {messages.map((message) => (
                      <div
                        key={message.id}
                        className={`flex ${message.direction === 'outgoing' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                            message.direction === 'outgoing'
                              ? 'rounded-br-md bg-[#5865f2] text-white'
                              : 'rounded-bl-md bg-white/[0.075] text-white/85'
                          }`}
                        >
                          {message.content && (
                            <p className="whitespace-pre-wrap break-words">{message.content}</p>
                          )}
                          {message.unsupportedContent && (
                            <span
                              className={`flex items-center gap-2 text-xs opacity-70 ${
                                message.content ? 'mt-2 border-t border-white/15 pt-2' : ''
                              }`}
                            >
                              <ImageOff size={15} />
                              {t('friends.chat.unsupported')}
                            </span>
                          )}
                          <p
                            className={`mt-1 text-right text-[9px] tabular-nums ${
                              message.direction === 'outgoing' ? 'text-white/60' : 'text-white/30'
                            }`}
                          >
                            {timeFormatter.format(new Date(message.sentAt))}
                            {message.editedAt ? ` · ${t('friends.chat.edited')}` : ''}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              <footer className="border-t border-white/[0.08] bg-black/15 px-4 pb-3 pt-3">
                {openFailed && (
                  <p role="alert" className="mb-2 flex items-center gap-2 px-1 text-xs text-amber-100">
                    <CircleAlert size={14} />
                    {t('friends.openFailed')}
                  </p>
                )}
                {sendFailed && (
                  <p role="alert" className="mb-2 flex items-center gap-2 px-1 text-xs text-rose-200">
                    <CircleAlert size={14} />
                    {t('friends.chat.sendFailed')}
                  </p>
                )}
                <div className="flex items-end gap-2 rounded-2xl border border-white/10 bg-white/[0.055] p-2 focus-within:border-[#7c86ff]/60">
                  <textarea
                    ref={composerRef}
                    data-focusable
                    data-system-gamepad-keyboard="true"
                    rows={1}
                    maxLength={MESSAGE_LIMIT}
                    value={draft}
                    disabled={sending || connectionLost}
                    onChange={(event) => {
                      setDraft(event.target.value)
                      setSendFailed(false)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault()
                        void sendMessage()
                      }
                    }}
                    placeholder={t('friends.chat.placeholder', { name: selectedFriend.displayName })}
                    aria-label={t('friends.chat.messageLabel')}
                    className="scrollbar-none max-h-28 min-h-10 flex-1 resize-none bg-transparent px-2 py-2.5 text-sm leading-5 text-white outline-none placeholder:text-white/30 disabled:opacity-50"
                  />
                  <button
                    data-focusable
                    data-disabled={!draft.trim() || sending || connectionLost ? 'true' : undefined}
                    disabled={!draft.trim() || sending || connectionLost}
                    type="button"
                    onClick={() => void sendMessage()}
                    aria-label={t('friends.chat.send')}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#5865f2] text-white transition hover:bg-[#6875f5] disabled:bg-white/10 disabled:text-white/25"
                  >
                    {sending ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}
                  </button>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3 px-1 text-[9px] text-white/30">
                  <span>{draft.length}/{MESSAGE_LIMIT} · {t('friends.chat.hint')}</span>
                  <span className="flex shrink-0 items-center gap-2.5 uppercase tracking-[0.1em]">
                    <span className="flex items-center gap-1">
                      <ControllerButtonHint button="leftBumper" className="font-black text-white/55" />
                      <ControllerButtonHint button="rightBumper" className="font-black text-white/55" />
                      {t('friends.chat.regionHint')}
                    </span>
                    <span className="flex items-center gap-1">
                      <ControllerButtonHint button="south" className="font-black text-white/55" />
                      {t('friends.chat.chooseHint')}
                    </span>
                    <span className="flex items-center gap-1">
                      <ControllerButtonHint button="east" className="font-black text-white/55" />
                      {t('friends.chat.backHint')}
                    </span>
                  </span>
                </div>
              </footer>
            </>
          )}
        </div>
      </motion.section>
    </motion.div>,
    document.body
  )
}
