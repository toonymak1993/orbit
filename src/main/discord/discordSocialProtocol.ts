import type {
  DiscordChatEvent,
  DiscordChatHistory,
  DiscordChatInbox,
  DiscordChatSendResult,
  DiscordServerList,
  OrbitFriend
} from '@shared/ipc'

export interface DiscordSocialTokens {
  accessToken: string
  refreshToken: string
  tokenType: number
  expiresAt: number
  scopes: string
}

export type DiscordSocialState =
  | 'not-connected'
  | 'connecting'
  | 'ready'
  | 'error'

export type DiscordSocialIssue =
  | 'authentication-failed'
  | 'provider-unavailable'
  | 'sdk-unavailable'

export interface DiscordSocialSnapshot {
  state: DiscordSocialState
  friends: OrbitFriend[]
  updatedAt: number
  accountName?: string
  issue?: DiscordSocialIssue
}

export type DiscordWorkerCommand =
  | 'probe'
  | 'refresh'
  | 'connect'
  | 'disconnect'
  | 'chat-inbox'
  | 'chat-history'
  | 'chat-send'
  | 'chat-showing'
  | 'servers'
  | 'dispose'

export interface DiscordWorkerRequest {
  type: 'request'
  id: number
  command: DiscordWorkerCommand
  applicationId?: string
  tokens?: DiscordSocialTokens
  recipientId?: string
  content?: string
  limit?: number
  showing?: boolean
}

export interface DiscordWorkerResponse {
  type: 'response'
  id: number
  ok: boolean
  snapshot?: DiscordSocialSnapshot
  tokens?: DiscordSocialTokens
  clearTokens?: boolean
  version?: string
  error?: DiscordSocialIssue
  chatInbox?: DiscordChatInbox
  chatHistory?: DiscordChatHistory
  chatSend?: DiscordChatSendResult
  servers?: DiscordServerList
}

export interface DiscordWorkerUpdatedEvent {
  type: 'updated'
  snapshot: DiscordSocialSnapshot
}

export interface DiscordWorkerReadyEvent {
  type: 'ready'
  version: string
}

export interface DiscordWorkerChatEvent {
  type: 'chat-message'
  event: DiscordChatEvent
}

export type DiscordWorkerMessage =
  | DiscordWorkerResponse
  | DiscordWorkerUpdatedEvent
  | DiscordWorkerChatEvent
  | DiscordWorkerReadyEvent
