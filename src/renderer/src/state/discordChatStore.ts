import { create } from 'zustand'
import type {
  DiscordChatConversation,
  DiscordChatEvent,
  DiscordChatInbox,
  DiscordChatMessage
} from '@shared/ipc'
import { notify } from './notificationStore'
import { useFriendsStore } from './friendsStore'
import { useNavigationStore } from './navigationStore'
import { usePreferencesStore } from './preferencesStore'

interface DiscordChatState {
  inboxState: DiscordChatInbox['state'] | 'idle' | 'loading'
  conversations: DiscordChatConversation[]
  unreadByUser: Record<string, number>
  activeUserId: string | null
  requestedUserId: string | null
  start: () => void
  refreshInbox: () => Promise<void>
  reset: () => void
  setActiveUser: (userId: string | null) => void
  markRead: (userId: string) => void
  requestOpen: (userId: string) => void
  consumeOpenRequest: () => void
  ingestHistory: (userId: string, messages: DiscordChatMessage[]) => void
}

let listening = false
let inboxRequest: Promise<void> | null = null
let inboxGeneration = 0

function snowflakeTimestamp(value: string): number {
  try {
    return Number((BigInt(value) >> 22n) + 1_420_070_400_000n)
  } catch {
    return 0
  }
}

function conversationTimestamp(conversation: DiscordChatConversation): number {
  return conversation.lastMessage?.sentAt ?? snowflakeTimestamp(conversation.lastMessageId)
}

function sortConversations(
  conversations: DiscordChatConversation[]
): DiscordChatConversation[] {
  return conversations.sort(
    (left, right) => conversationTimestamp(right) - conversationTimestamp(left)
  )
}

function mergeConversation(
  conversations: DiscordChatConversation[],
  conversation: DiscordChatConversation
): DiscordChatConversation[] {
  return sortConversations([
    conversation,
    ...conversations.filter((item) => item.userId !== conversation.userId)
  ])
}

function displayNameFor(userId: string): string {
  return (
    useFriendsStore
      .getState()
      .snapshot.friends.find(
        (friend) => friend.provider === 'discord' && friend.providerUserId === userId
      )?.displayName ?? `Discord · ${userId.slice(-6)}`
  )
}

function isActiveConversation(userId: string): boolean {
  return (
    useDiscordChatStore.getState().activeUserId === userId &&
    document.visibilityState === 'visible' &&
    document.hasFocus()
  )
}

function handleChatEvent(event: DiscordChatEvent): void {
  if (event.kind === 'deleted') {
    useDiscordChatStore.setState((state) => ({
      conversations: state.conversations.map((conversation) =>
        conversation.lastMessageId === event.messageId
          ? { ...conversation, lastMessage: undefined }
          : conversation
      )
    }))
    return
  }

  const { message } = event
  useDiscordChatStore.setState((state) => {
    const current = state.conversations.find(
      (conversation) => conversation.userId === message.userId
    )
    const shouldBecomeLatest =
      !current ||
      current.lastMessageId === message.id ||
      message.sentAt >= conversationTimestamp(current)
    const conversations = shouldBecomeLatest
      ? mergeConversation(state.conversations, {
          userId: message.userId,
          lastMessageId: message.id,
          lastMessage: message
        })
      : state.conversations
    const unreadByUser =
      event.kind === 'created' &&
      message.direction === 'incoming' &&
      !isActiveConversation(message.userId)
        ? {
            ...state.unreadByUser,
            [message.userId]: Math.min(99, (state.unreadByUser[message.userId] ?? 0) + 1)
          }
        : state.unreadByUser
    return { conversations, unreadByUser }
  })

  if (
    event.kind !== 'created' ||
    message.direction !== 'incoming' ||
    isActiveConversation(message.userId) ||
    !usePreferencesStore.getState().showFriendsHub
  ) {
    return
  }

  const name = displayNameFor(message.userId)
  notify({
    titleKey: 'friends.chat.notificationTitle',
    messageKey: 'friends.chat.notificationBody',
    actionLabelKey: 'friends.chat.notificationAction',
    vars: { name },
    durationMs: 9_000,
    onAction: () => {
      useFriendsStore.getState().setFilter('discord')
      useNavigationStore.getState().setMainView('friends')
      useDiscordChatStore.getState().requestOpen(message.userId)
    }
  })
}

export const useDiscordChatStore = create<DiscordChatState>((set, get) => ({
  inboxState: 'idle',
  conversations: [],
  unreadByUser: {},
  activeUserId: null,
  requestedUserId: null,

  start: () => {
    if (listening) return
    listening = true
    window.api.discordChat.onMessage(handleChatEvent)
  },

  refreshInbox: () => {
    if (inboxRequest) return inboxRequest
    const generation = inboxGeneration
    set({ inboxState: 'loading' })
    const request = window.api.discordChat
      .inbox()
      .then((inbox) => {
        if (generation !== inboxGeneration) return
        set((state) => {
          if (inbox.state !== 'ready') return { inboxState: inbox.state }
          const liveOnly = state.conversations.filter(
            (conversation) =>
              !inbox.conversations.some((item) => item.userId === conversation.userId)
          )
          return {
            inboxState: 'ready',
            conversations: sortConversations([...inbox.conversations, ...liveOnly])
          }
        })
      })
      .catch(() => {
        if (generation === inboxGeneration) set({ inboxState: 'unavailable' })
      })
      .finally(() => {
        if (inboxRequest === request) inboxRequest = null
      })
    inboxRequest = request
    return request
  },

  reset: () => {
    inboxGeneration += 1
    inboxRequest = null
    set({
      inboxState: 'idle',
      conversations: [],
      unreadByUser: {},
      activeUserId: null,
      requestedUserId: null
    })
  },

  setActiveUser: (activeUserId) => {
    set({ activeUserId })
    if (activeUserId) get().markRead(activeUserId)
  },

  markRead: (userId) =>
    set((state) => {
      if (!state.unreadByUser[userId]) return {}
      const unreadByUser = { ...state.unreadByUser }
      delete unreadByUser[userId]
      return { unreadByUser }
    }),

  requestOpen: (requestedUserId) => set({ requestedUserId }),
  consumeOpenRequest: () => set({ requestedUserId: null }),

  ingestHistory: (userId, messages) => {
    const lastMessage = messages.at(-1)
    if (!lastMessage) return
    set((state) => ({
      conversations: mergeConversation(state.conversations, {
        userId,
        lastMessageId: lastMessage.id,
        lastMessage
      })
    }))
  }
}))

export function totalDiscordUnread(unreadByUser: Record<string, number>): number {
  return Math.min(
    99,
    Object.values(unreadByUser).reduce((total, count) => total + count, 0)
  )
}
