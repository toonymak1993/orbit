import { EventEmitter } from 'node:events'
import koffi, { type LibraryHandle, type TypeObject } from 'koffi'
import type {
  DiscordChatConversation,
  DiscordChatEvent,
  DiscordChatHistory,
  DiscordChatInbox,
  DiscordChatMessage,
  DiscordChatSendResult,
  FriendPresence,
  OrbitFriend
} from '@shared/ipc'
import type {
  DiscordSocialIssue,
  DiscordSocialSnapshot,
  DiscordSocialTokens,
  DiscordWorkerMessage,
  DiscordWorkerRequest,
  DiscordWorkerResponse
} from './discordSocialProtocol'

const AUTH_TIMEOUT_MS = 5 * 60_000
const REQUEST_TIMEOUT_MS = 30_000
const READY_STATUS = 3
const FRIEND_RELATIONSHIP = 1
const BEARER_TOKEN = 1
const MAX_DISCORD_FRIENDS = 1_000
const MAX_CHAT_CONVERSATIONS = 500
const MAX_CHAT_HISTORY = 200
const MAX_MESSAGE_LENGTH = 2_000

interface NativeString {
  ptr: bigint | null
  size: number
}

interface NativeHandle {
  opaque: bigint | null
}

interface NativeSpan {
  ptr: bigint | null
  size: number
}

interface EngineResult {
  snapshot: DiscordSocialSnapshot
  tokens?: DiscordSocialTokens
  clearTokens?: boolean
}

type NativeFunction = ReturnType<LibraryHandle['func']>

function cleanText(value: string, fallback = ''): string {
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return (cleaned || fallback).slice(0, 100)
}

function cleanMessageContent(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .slice(0, MAX_MESSAGE_LENGTH)
}

function timestampFromDiscordSnowflake(value: string): number {
  try {
    return Number((BigInt(value) >> 22n) + 1_420_070_400_000n)
  } catch {
    return 0
  }
}

function presenceFromDiscord(status: number): FriendPresence {
  if (status === 0 || status === 6) return 'online'
  if (status === 3) return 'away'
  if (status === 4) return 'busy'
  if (status === 1 || status === 5) return 'offline'
  return 'unknown'
}

function onlinePresence(presence: FriendPresence): boolean {
  return presence !== 'offline' && presence !== 'unknown'
}

function trustedAvatarUrl(value: string): string | undefined {
  if (!value || value.length > 2_048) return undefined
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    if (
      url.protocol !== 'https:' ||
      (host !== 'cdn.discordapp.com' && host !== 'media.discordapp.net')
    ) {
      return undefined
    }
    return url.toString()
  } catch {
    return undefined
  }
}

function timeoutAfter<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        onTimeout?.()
      } finally {
        reject(new Error('Discord Social SDK request timed out'))
      }
    }, timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

class DiscordNativeBindings {
  readonly DiscordString: TypeObject
  readonly Client: TypeObject
  readonly ClientResult: TypeObject
  readonly AuthorizationArgs: TypeObject
  readonly AuthorizationCodeChallenge: TypeObject
  readonly AuthorizationCodeVerifier: TypeObject
  readonly RelationshipHandle: TypeObject
  readonly RelationshipSpan: TypeObject
  readonly MessageHandle: TypeObject
  readonly MessageSpan: TypeObject
  readonly UserMessageSummary: TypeObject
  readonly UserMessageSummarySpan: TypeObject
  readonly AdditionalContent: TypeObject
  readonly UserHandle: TypeObject
  readonly Activity: TypeObject

  readonly authorizationCallbackType: TypeObject
  readonly tokenCallbackType: TypeObject
  readonly resultCallbackType: TypeObject
  readonly statusCallbackType: TypeObject
  readonly changedCallbackType: TypeObject
  readonly messageResultCallbackType: TypeObject
  readonly messageSpanCallbackType: TypeObject
  readonly userMessageSummarySpanCallbackType: TypeObject
  readonly messageDeletedCallbackType: TypeObject

  readonly allocNative: NativeFunction
  readonly freeNative: NativeFunction
  readonly resetCallbacks: NativeFunction
  readonly runCallbacks: NativeFunction
  readonly versionMajor: NativeFunction
  readonly versionMinor: NativeFunction
  readonly versionPatch: NativeFunction

  readonly clientInit: NativeFunction
  readonly clientDrop: NativeFunction
  readonly clientSetApplicationId: NativeFunction
  readonly clientSetGameWindowPid: NativeFunction
  readonly clientGetStatus: NativeFunction
  readonly clientSetStatusChangedCallback: NativeFunction
  readonly clientSetRelationshipGroupsUpdatedCallback: NativeFunction
  readonly clientSetUserUpdatedCallback: NativeFunction
  readonly clientConnect: NativeFunction
  readonly clientDisconnect: NativeFunction
  readonly clientAbortAuthorize: NativeFunction
  readonly clientAuthorize: NativeFunction
  readonly clientCreateAuthorizationCodeVerifier: NativeFunction
  readonly clientGetDefaultCommunicationScopes: NativeFunction
  readonly clientGetToken: NativeFunction
  readonly clientRefreshToken: NativeFunction
  readonly clientUpdateToken: NativeFunction
  readonly clientRevokeToken: NativeFunction
  readonly clientGetRelationships: NativeFunction
  readonly clientGetCurrentUserV2: NativeFunction
  readonly clientGetMessageHandle: NativeFunction
  readonly clientGetUserMessageSummaries: NativeFunction
  readonly clientGetUserMessagesWithLimit: NativeFunction
  readonly clientSendUserMessage: NativeFunction
  readonly clientSetMessageCreatedCallback: NativeFunction
  readonly clientSetMessageUpdatedCallback: NativeFunction
  readonly clientSetMessageDeletedCallback: NativeFunction
  readonly clientSetShowingChat: NativeFunction

  readonly clientResultSuccessful: NativeFunction
  readonly clientResultToString: NativeFunction
  readonly clientResultDrop: NativeFunction

  readonly authorizationArgsInit: NativeFunction
  readonly authorizationArgsDrop: NativeFunction
  readonly authorizationArgsSetClientId: NativeFunction
  readonly authorizationArgsSetScopes: NativeFunction
  readonly authorizationArgsSetCodeChallenge: NativeFunction
  readonly verifierChallenge: NativeFunction
  readonly verifierVerifier: NativeFunction
  readonly verifierDrop: NativeFunction
  readonly challengeChallenge: NativeFunction
  readonly challengeDrop: NativeFunction

  readonly relationshipDiscordType: NativeFunction
  readonly relationshipUser: NativeFunction
  readonly relationshipDrop: NativeFunction
  readonly messageId: NativeFunction
  readonly messageAuthorId: NativeFunction
  readonly messageRecipientId: NativeFunction
  readonly messageContent: NativeFunction
  readonly messageSentTimestamp: NativeFunction
  readonly messageEditedTimestamp: NativeFunction
  readonly messageAdditionalContent: NativeFunction
  readonly messageDrop: NativeFunction
  readonly userMessageSummaryUserId: NativeFunction
  readonly userMessageSummaryLastMessageId: NativeFunction
  readonly userMessageSummaryDrop: NativeFunction
  readonly additionalContentDrop: NativeFunction
  readonly userId: NativeFunction
  readonly userDisplayName: NativeFunction
  readonly userUsername: NativeFunction
  readonly userAvatarUrl: NativeFunction
  readonly userStatus: NativeFunction
  readonly userGameActivity: NativeFunction
  readonly userDrop: NativeFunction
  readonly activityName: NativeFunction
  readonly activityDrop: NativeFunction

  private readonly lib: LibraryHandle

  constructor(dllPath: string) {
    this.lib = koffi.load(dllPath)
    const handle = (name: string): TypeObject => koffi.struct(name, { opaque: 'void *' })

    this.DiscordString = koffi.struct('Orbit_Discord_String', {
      ptr: koffi.pointer('uint8_t'),
      size: 'size_t'
    })
    this.Client = handle('Orbit_Discord_Client')
    this.ClientResult = handle('Orbit_Discord_ClientResult')
    this.AuthorizationArgs = handle('Orbit_Discord_AuthorizationArgs')
    this.AuthorizationCodeChallenge = handle('Orbit_Discord_AuthorizationCodeChallenge')
    this.AuthorizationCodeVerifier = handle('Orbit_Discord_AuthorizationCodeVerifier')
    this.RelationshipHandle = handle('Orbit_Discord_RelationshipHandle')
    this.RelationshipSpan = koffi.struct('Orbit_Discord_RelationshipHandleSpan', {
      ptr: koffi.pointer(this.RelationshipHandle),
      size: 'size_t'
    })
    this.MessageHandle = handle('Orbit_Discord_MessageHandle')
    this.MessageSpan = koffi.struct('Orbit_Discord_MessageHandleSpan', {
      ptr: koffi.pointer(this.MessageHandle),
      size: 'size_t'
    })
    this.UserMessageSummary = handle('Orbit_Discord_UserMessageSummary')
    this.UserMessageSummarySpan = koffi.struct('Orbit_Discord_UserMessageSummarySpan', {
      ptr: koffi.pointer(this.UserMessageSummary),
      size: 'size_t'
    })
    this.AdditionalContent = handle('Orbit_Discord_AdditionalContent')
    this.UserHandle = handle('Orbit_Discord_UserHandle')
    this.Activity = handle('Orbit_Discord_Activity')

    const resultPointer = koffi.pointer(this.ClientResult)
    this.authorizationCallbackType = koffi.proto(
      'Orbit_Discord_AuthorizationCallback',
      'void',
      [resultPointer, this.DiscordString, this.DiscordString, 'void *']
    )
    this.tokenCallbackType = koffi.proto('Orbit_Discord_TokenCallback', 'void', [
      resultPointer,
      this.DiscordString,
      this.DiscordString,
      'int',
      'int32_t',
      this.DiscordString,
      'void *'
    ])
    this.resultCallbackType = koffi.proto('Orbit_Discord_ResultCallback', 'void', [
      resultPointer,
      'void *'
    ])
    this.statusCallbackType = koffi.proto('Orbit_Discord_StatusCallback', 'void', [
      'int',
      'int',
      'int32_t',
      'void *'
    ])
    this.changedCallbackType = koffi.proto('Orbit_Discord_ChangedCallback', 'void', [
      'uint64_t',
      'void *'
    ])
    this.messageResultCallbackType = koffi.proto(
      'Orbit_Discord_MessageResultCallback',
      'void',
      [resultPointer, 'uint64_t', 'void *']
    )
    this.messageSpanCallbackType = koffi.proto(
      'Orbit_Discord_MessageSpanCallback',
      'void',
      [resultPointer, this.MessageSpan, 'void *']
    )
    this.userMessageSummarySpanCallbackType = koffi.proto(
      'Orbit_Discord_UserMessageSummarySpanCallback',
      'void',
      [resultPointer, this.UserMessageSummarySpan, 'void *']
    )
    this.messageDeletedCallbackType = koffi.proto(
      'Orbit_Discord_MessageDeletedCallback',
      'void',
      ['uint64_t', 'uint64_t', 'void *']
    )

    const fn = (name: string, result: string | TypeObject, args: unknown[]): NativeFunction =>
      this.lib.func(name, result, args as never[])
    const pointer = koffi.pointer

    this.allocNative = fn('Discord_Alloc', 'void *', ['size_t'])
    this.freeNative = fn('Discord_Free', 'void', ['void *'])
    this.resetCallbacks = fn('Discord_ResetCallbacks', 'void', [])
    this.runCallbacks = fn('Discord_RunCallbacks', 'void', [])
    this.versionMajor = fn('Discord_Client_GetVersionMajor', 'int32_t', [])
    this.versionMinor = fn('Discord_Client_GetVersionMinor', 'int32_t', [])
    this.versionPatch = fn('Discord_Client_GetVersionPatch', 'int32_t', [])

    this.clientInit = fn('Discord_Client_Init', 'void', [pointer(this.Client)])
    this.clientDrop = fn('Discord_Client_Drop', 'void', [pointer(this.Client)])
    this.clientSetApplicationId = fn('Discord_Client_SetApplicationId', 'void', [
      pointer(this.Client),
      'uint64_t'
    ])
    this.clientSetGameWindowPid = fn('Discord_Client_SetGameWindowPid', 'void', [
      pointer(this.Client),
      'int32_t'
    ])
    this.clientGetStatus = fn('Discord_Client_GetStatus', 'int', [pointer(this.Client)])
    this.clientSetStatusChangedCallback = fn(
      'Discord_Client_SetStatusChangedCallback',
      'void',
      [pointer(this.Client), pointer(this.statusCallbackType), 'void *', 'void *']
    )
    this.clientSetRelationshipGroupsUpdatedCallback = fn(
      'Discord_Client_SetRelationshipGroupsUpdatedCallback',
      'void',
      [pointer(this.Client), pointer(this.changedCallbackType), 'void *', 'void *']
    )
    this.clientSetUserUpdatedCallback = fn('Discord_Client_SetUserUpdatedCallback', 'void', [
      pointer(this.Client),
      pointer(this.changedCallbackType),
      'void *',
      'void *'
    ])
    this.clientConnect = fn('Discord_Client_Connect', 'void', [pointer(this.Client)])
    this.clientDisconnect = fn('Discord_Client_Disconnect', 'void', [pointer(this.Client)])
    this.clientAbortAuthorize = fn('Discord_Client_AbortAuthorize', 'void', [pointer(this.Client)])
    this.clientAuthorize = fn('Discord_Client_Authorize', 'void', [
      pointer(this.Client),
      pointer(this.AuthorizationArgs),
      pointer(this.authorizationCallbackType),
      'void *',
      'void *'
    ])
    this.clientCreateAuthorizationCodeVerifier = fn(
      'Discord_Client_CreateAuthorizationCodeVerifier',
      'void',
      [pointer(this.Client), koffi.out(pointer(this.AuthorizationCodeVerifier))]
    )
    this.clientGetDefaultCommunicationScopes = fn(
      'Discord_Client_GetDefaultCommunicationScopes',
      'void',
      [koffi.out(pointer(this.DiscordString))]
    )
    this.clientGetToken = fn('Discord_Client_GetToken', 'void', [
      pointer(this.Client),
      'uint64_t',
      this.DiscordString,
      this.DiscordString,
      this.DiscordString,
      pointer(this.tokenCallbackType),
      'void *',
      'void *'
    ])
    this.clientRefreshToken = fn('Discord_Client_RefreshToken', 'void', [
      pointer(this.Client),
      'uint64_t',
      this.DiscordString,
      pointer(this.tokenCallbackType),
      'void *',
      'void *'
    ])
    this.clientUpdateToken = fn('Discord_Client_UpdateToken', 'void', [
      pointer(this.Client),
      'int',
      this.DiscordString,
      pointer(this.resultCallbackType),
      'void *',
      'void *'
    ])
    this.clientRevokeToken = fn('Discord_Client_RevokeToken', 'void', [
      pointer(this.Client),
      'uint64_t',
      this.DiscordString,
      pointer(this.resultCallbackType),
      'void *',
      'void *'
    ])
    this.clientGetRelationships = fn('Discord_Client_GetRelationships', 'void', [
      pointer(this.Client),
      koffi.out(pointer(this.RelationshipSpan))
    ])
    this.clientGetCurrentUserV2 = fn('Discord_Client_GetCurrentUserV2', 'bool', [
      pointer(this.Client),
      koffi.out(pointer(this.UserHandle))
    ])
    this.clientGetMessageHandle = fn('Discord_Client_GetMessageHandle', 'bool', [
      pointer(this.Client),
      'uint64_t',
      koffi.out(pointer(this.MessageHandle))
    ])
    this.clientGetUserMessageSummaries = fn(
      'Discord_Client_GetUserMessageSummaries',
      'void',
      [
        pointer(this.Client),
        pointer(this.userMessageSummarySpanCallbackType),
        'void *',
        'void *'
      ]
    )
    this.clientGetUserMessagesWithLimit = fn(
      'Discord_Client_GetUserMessagesWithLimit',
      'void',
      [
        pointer(this.Client),
        'uint64_t',
        'int32_t',
        pointer(this.messageSpanCallbackType),
        'void *',
        'void *'
      ]
    )
    this.clientSendUserMessage = fn('Discord_Client_SendUserMessage', 'void', [
      pointer(this.Client),
      'uint64_t',
      this.DiscordString,
      pointer(this.messageResultCallbackType),
      'void *',
      'void *'
    ])
    this.clientSetMessageCreatedCallback = fn(
      'Discord_Client_SetMessageCreatedCallback',
      'void',
      [pointer(this.Client), pointer(this.changedCallbackType), 'void *', 'void *']
    )
    this.clientSetMessageUpdatedCallback = fn(
      'Discord_Client_SetMessageUpdatedCallback',
      'void',
      [pointer(this.Client), pointer(this.changedCallbackType), 'void *', 'void *']
    )
    this.clientSetMessageDeletedCallback = fn(
      'Discord_Client_SetMessageDeletedCallback',
      'void',
      [pointer(this.Client), pointer(this.messageDeletedCallbackType), 'void *', 'void *']
    )
    this.clientSetShowingChat = fn('Discord_Client_SetShowingChat', 'void', [
      pointer(this.Client),
      'bool'
    ])

    this.clientResultSuccessful = fn('Discord_ClientResult_Successful', 'bool', [resultPointer])
    this.clientResultToString = fn('Discord_ClientResult_ToString', 'void', [
      resultPointer,
      koffi.out(pointer(this.DiscordString))
    ])
    this.clientResultDrop = fn('Discord_ClientResult_Drop', 'void', [resultPointer])

    this.authorizationArgsInit = fn('Discord_AuthorizationArgs_Init', 'void', [
      pointer(this.AuthorizationArgs)
    ])
    this.authorizationArgsDrop = fn('Discord_AuthorizationArgs_Drop', 'void', [
      pointer(this.AuthorizationArgs)
    ])
    this.authorizationArgsSetClientId = fn('Discord_AuthorizationArgs_SetClientId', 'void', [
      pointer(this.AuthorizationArgs),
      'uint64_t'
    ])
    this.authorizationArgsSetScopes = fn('Discord_AuthorizationArgs_SetScopes', 'void', [
      pointer(this.AuthorizationArgs),
      this.DiscordString
    ])
    this.authorizationArgsSetCodeChallenge = fn(
      'Discord_AuthorizationArgs_SetCodeChallenge',
      'void',
      [pointer(this.AuthorizationArgs), pointer(this.AuthorizationCodeChallenge)]
    )
    this.verifierChallenge = fn('Discord_AuthorizationCodeVerifier_Challenge', 'void', [
      pointer(this.AuthorizationCodeVerifier),
      koffi.out(pointer(this.AuthorizationCodeChallenge))
    ])
    this.verifierVerifier = fn('Discord_AuthorizationCodeVerifier_Verifier', 'void', [
      pointer(this.AuthorizationCodeVerifier),
      koffi.out(pointer(this.DiscordString))
    ])
    this.verifierDrop = fn('Discord_AuthorizationCodeVerifier_Drop', 'void', [
      pointer(this.AuthorizationCodeVerifier)
    ])
    this.challengeChallenge = fn('Discord_AuthorizationCodeChallenge_Challenge', 'void', [
      pointer(this.AuthorizationCodeChallenge),
      koffi.out(pointer(this.DiscordString))
    ])
    this.challengeDrop = fn('Discord_AuthorizationCodeChallenge_Drop', 'void', [
      pointer(this.AuthorizationCodeChallenge)
    ])

    this.relationshipDiscordType = fn(
      'Discord_RelationshipHandle_DiscordRelationshipType',
      'int',
      [pointer(this.RelationshipHandle)]
    )
    this.relationshipUser = fn('Discord_RelationshipHandle_User', 'bool', [
      pointer(this.RelationshipHandle),
      koffi.out(pointer(this.UserHandle))
    ])
    this.relationshipDrop = fn('Discord_RelationshipHandle_Drop', 'void', [
      pointer(this.RelationshipHandle)
    ])
    this.messageId = fn('Discord_MessageHandle_Id', 'uint64_t', [pointer(this.MessageHandle)])
    this.messageAuthorId = fn('Discord_MessageHandle_AuthorId', 'uint64_t', [
      pointer(this.MessageHandle)
    ])
    this.messageRecipientId = fn('Discord_MessageHandle_RecipientId', 'uint64_t', [
      pointer(this.MessageHandle)
    ])
    this.messageContent = fn('Discord_MessageHandle_Content', 'void', [
      pointer(this.MessageHandle),
      koffi.out(pointer(this.DiscordString))
    ])
    this.messageSentTimestamp = fn('Discord_MessageHandle_SentTimestamp', 'uint64_t', [
      pointer(this.MessageHandle)
    ])
    this.messageEditedTimestamp = fn('Discord_MessageHandle_EditedTimestamp', 'uint64_t', [
      pointer(this.MessageHandle)
    ])
    this.messageAdditionalContent = fn('Discord_MessageHandle_AdditionalContent', 'bool', [
      pointer(this.MessageHandle),
      koffi.out(pointer(this.AdditionalContent))
    ])
    this.messageDrop = fn('Discord_MessageHandle_Drop', 'void', [pointer(this.MessageHandle)])
    this.userMessageSummaryUserId = fn('Discord_UserMessageSummary_UserId', 'uint64_t', [
      pointer(this.UserMessageSummary)
    ])
    this.userMessageSummaryLastMessageId = fn(
      'Discord_UserMessageSummary_LastMessageId',
      'uint64_t',
      [pointer(this.UserMessageSummary)]
    )
    this.userMessageSummaryDrop = fn('Discord_UserMessageSummary_Drop', 'void', [
      pointer(this.UserMessageSummary)
    ])
    this.additionalContentDrop = fn('Discord_AdditionalContent_Drop', 'void', [
      pointer(this.AdditionalContent)
    ])
    this.userId = fn('Discord_UserHandle_Id', 'uint64_t', [pointer(this.UserHandle)])
    this.userDisplayName = fn('Discord_UserHandle_DisplayName', 'void', [
      pointer(this.UserHandle),
      koffi.out(pointer(this.DiscordString))
    ])
    this.userUsername = fn('Discord_UserHandle_Username', 'void', [
      pointer(this.UserHandle),
      koffi.out(pointer(this.DiscordString))
    ])
    this.userAvatarUrl = fn('Discord_UserHandle_AvatarUrl', 'void', [
      pointer(this.UserHandle),
      'int',
      'int',
      koffi.out(pointer(this.DiscordString))
    ])
    this.userStatus = fn('Discord_UserHandle_Status', 'int', [pointer(this.UserHandle)])
    this.userGameActivity = fn('Discord_UserHandle_GameActivity', 'bool', [
      pointer(this.UserHandle),
      koffi.out(pointer(this.Activity))
    ])
    this.userDrop = fn('Discord_UserHandle_Drop', 'void', [pointer(this.UserHandle)])
    this.activityName = fn('Discord_Activity_Name', 'void', [
      pointer(this.Activity),
      koffi.out(pointer(this.DiscordString))
    ])
    this.activityDrop = fn('Discord_Activity_Drop', 'void', [pointer(this.Activity)])
  }

  version(): string {
    return `${this.versionMajor()}.${this.versionMinor()}.${this.versionPatch()}`
  }
}

class DiscordSocialEngine extends EventEmitter {
  private readonly native: DiscordNativeBindings
  private client: unknown | null = null
  private applicationId = ''
  private callbackTimer?: ReturnType<typeof setInterval>
  private changedTimer?: ReturnType<typeof setTimeout>
  private callbacks = new Set<bigint>()
  private readyWaiters = new Set<{
    resolve: () => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()
  private currentTokens?: DiscordSocialTokens
  private disposed = false
  private mainProcessId = 0

  constructor(dllPath: string, mainProcessId: number) {
    super()
    this.native = new DiscordNativeBindings(dllPath)
    this.mainProcessId = mainProcessId
  }

  version(): string {
    return this.native.version()
  }

  tokens(): DiscordSocialTokens | undefined {
    return this.currentTokens ? { ...this.currentTokens } : undefined
  }

  chatBindingsAvailable(): boolean {
    return this.communicationScopes().trim().length > 0
  }

  private register(callback: Function, type: TypeObject): bigint {
    const pointer = koffi.register(callback, koffi.pointer(type))
    this.callbacks.add(pointer)
    return pointer
  }

  private unregister(pointer: bigint): void {
    if (!this.callbacks.delete(pointer)) return
    try {
      koffi.unregister(pointer)
    } catch {
      // The native client may already have released its callback table.
    }
  }

  private inputString(value: string): { ptr: Buffer; size: number } {
    const buffer = Buffer.from(value, 'utf8')
    return { ptr: buffer, size: buffer.length }
  }

  private takeString(value: NativeString): string {
    try {
      if (!value.ptr || !value.size) return ''
      return Buffer.from(koffi.decode(value.ptr, 'uint8_t', Number(value.size))).toString('utf8')
    } finally {
      if (value.ptr) this.native.freeNative(value.ptr)
    }
  }

  private outputString(call: (output: Record<string, unknown>) => void): string {
    const output: Record<string, unknown> = {}
    call(output)
    return this.takeString(output as unknown as NativeString)
  }

  private assertSuccessful(result: unknown): void {
    try {
      if (this.native.clientResultSuccessful(result)) return
      const detail = this.outputString((output) => this.native.clientResultToString(result, output))
      throw new Error(cleanText(detail, 'Discord Social SDK request failed'))
    } finally {
      this.native.clientResultDrop(result)
    }
  }

  private ensureClient(applicationId: string): void {
    if (this.disposed) throw new Error('Discord Social SDK worker is disposed')
    if (this.client && this.applicationId === applicationId) return
    this.disposeClient()
    this.applicationId = applicationId
    this.client = koffi.alloc(this.native.Client, 1)
    this.native.clientInit(this.client)
    this.native.clientSetApplicationId(this.client, BigInt(applicationId))
    if (this.mainProcessId > 0) {
      this.native.clientSetGameWindowPid(this.client, this.mainProcessId)
    }

    const statusCallback = this.register(
      (status: number, error: number): void => this.handleStatus(status, error),
      this.native.statusCallbackType
    )
    const changedCallback = this.register(
      (): void => this.scheduleChangedSnapshot(),
      this.native.changedCallbackType
    )
    const userChangedCallback = this.register(
      (): void => this.scheduleChangedSnapshot(),
      this.native.changedCallbackType
    )
    const messageCreatedCallback = this.register(
      (messageId: bigint): void => this.emitMessageEvent('created', messageId),
      this.native.changedCallbackType
    )
    const messageUpdatedCallback = this.register(
      (messageId: bigint): void => this.emitMessageEvent('updated', messageId),
      this.native.changedCallbackType
    )
    const messageDeletedCallback = this.register(
      (messageId: bigint): void => {
        this.emit('chat-message', {
          kind: 'deleted',
          messageId: String(messageId)
        } satisfies DiscordChatEvent)
      },
      this.native.messageDeletedCallbackType
    )
    this.native.clientSetStatusChangedCallback(this.client, statusCallback, null, null)
    this.native.clientSetRelationshipGroupsUpdatedCallback(
      this.client,
      changedCallback,
      null,
      null
    )
    this.native.clientSetUserUpdatedCallback(this.client, userChangedCallback, null, null)
    this.native.clientSetMessageCreatedCallback(this.client, messageCreatedCallback, null, null)
    this.native.clientSetMessageUpdatedCallback(this.client, messageUpdatedCallback, null, null)
    this.native.clientSetMessageDeletedCallback(this.client, messageDeletedCallback, null, null)
    this.callbackTimer = setInterval(() => {
      try {
        this.native.runCallbacks()
      } catch {
        this.failReadyWaiters(new Error('Discord Social SDK callback processing failed'))
      }
    }, 50)
  }

  private handleStatus(status: number, error: number): void {
    if (status === READY_STATUS) {
      for (const waiter of this.readyWaiters) {
        clearTimeout(waiter.timer)
        waiter.resolve()
      }
      this.readyWaiters.clear()
      this.scheduleChangedSnapshot()
      return
    }
    if (status === 0 && error !== 0) {
      this.failReadyWaiters(new Error('Discord connection failed'))
    }
  }

  private failReadyWaiters(error: Error): void {
    for (const waiter of this.readyWaiters) {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
    this.readyWaiters.clear()
  }

  private waitForReady(): Promise<void> {
    if (!this.client) return Promise.reject(new Error('Discord client is not initialized'))
    if (this.native.clientGetStatus(this.client) === READY_STATUS) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.readyWaiters.delete(waiter)
          reject(new Error('Discord connection timed out'))
        }, REQUEST_TIMEOUT_MS)
      }
      this.readyWaiters.add(waiter)
    })
  }

  private scheduleChangedSnapshot(): void {
    if (this.changedTimer) clearTimeout(this.changedTimer)
    this.changedTimer = setTimeout(() => {
      this.changedTimer = undefined
      if (!this.client || this.native.clientGetStatus(this.client) !== READY_STATUS) return
      try {
        this.emit('updated', this.readySnapshot())
      } catch {
        // A later explicit refresh can recover from a transient native read failure.
      }
    }, 180)
  }

  private communicationScopes(): string {
    return this.outputString((output) =>
      this.native.clientGetDefaultCommunicationScopes(output)
    )
  }

  private hasCommunicationScopes(tokens: DiscordSocialTokens | undefined): boolean {
    if (!tokens?.scopes) return false
    const granted = new Set(tokens.scopes.split(/[\s,]+/u).filter(Boolean))
    const required = this.communicationScopes().split(/[\s,]+/u).filter(Boolean)
    return required.length > 0 && required.every((scope) => granted.has(scope))
  }

  private authorize(applicationId: string): Promise<DiscordSocialTokens> {
    if (!this.client) return Promise.reject(new Error('Discord client is not initialized'))
    const verifier = koffi.alloc(this.native.AuthorizationCodeVerifier, 1)
    const challenge = koffi.alloc(this.native.AuthorizationCodeChallenge, 1)
    const args = koffi.alloc(this.native.AuthorizationArgs, 1)
    this.native.clientCreateAuthorizationCodeVerifier(this.client, verifier)
    this.native.verifierChallenge(verifier, challenge)
    const verifierText = this.outputString((output) => this.native.verifierVerifier(verifier, output))
    const scopes = this.communicationScopes()
    this.native.authorizationArgsInit(args)
    this.native.authorizationArgsSetClientId(args, BigInt(applicationId))
    this.native.authorizationArgsSetScopes(args, this.inputString(scopes))
    this.native.authorizationArgsSetCodeChallenge(args, challenge)

    const authorization = new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
      let callbackPointer = 0n
      callbackPointer = this.register(
        (result: unknown, code: NativeString, redirectUri: NativeString): void => {
          let codeText = ''
          let redirectText = ''
          try {
            codeText = this.takeString(code)
            redirectText = this.takeString(redirectUri)
            this.assertSuccessful(result)
            resolve({ code: codeText, redirectUri: redirectText })
          } catch (error) {
            reject(error)
          } finally {
            queueMicrotask(() => this.unregister(callbackPointer))
          }
        },
        this.native.authorizationCallbackType
      )
      try {
        this.native.clientAuthorize(this.client, args, callbackPointer, null, null)
      } catch (error) {
        this.unregister(callbackPointer)
        reject(error)
      } finally {
        this.native.authorizationArgsDrop(args)
        this.native.challengeDrop(challenge)
        this.native.verifierDrop(verifier)
      }
    })

    return timeoutAfter(authorization, AUTH_TIMEOUT_MS, () => {
      if (this.client) this.native.clientAbortAuthorize(this.client)
    }).then(({ code, redirectUri }) =>
      this.exchangeToken(applicationId, code, verifierText, redirectUri)
    )
  }

  private exchangeToken(
    applicationId: string,
    code: string,
    verifier: string,
    redirectUri: string
  ): Promise<DiscordSocialTokens> {
    if (!this.client) return Promise.reject(new Error('Discord client is not initialized'))
    return timeoutAfter(
      new Promise<DiscordSocialTokens>((resolve, reject) => {
        let callbackPointer = 0n
        callbackPointer = this.register(
          (
            result: unknown,
            accessToken: NativeString,
            refreshToken: NativeString,
            tokenType: number,
            expiresIn: number,
            scopes: NativeString
          ): void => {
            const access = this.takeString(accessToken)
            const refresh = this.takeString(refreshToken)
            const scopeText = this.takeString(scopes)
            try {
              this.assertSuccessful(result)
              resolve({
                accessToken: access,
                refreshToken: refresh,
                tokenType,
                expiresAt: Date.now() + Math.max(0, expiresIn) * 1_000,
                scopes: scopeText
              })
            } catch (error) {
              reject(error)
            } finally {
              queueMicrotask(() => this.unregister(callbackPointer))
            }
          },
          this.native.tokenCallbackType
        )
        try {
          this.native.clientGetToken(
            this.client,
            BigInt(applicationId),
            this.inputString(code),
            this.inputString(verifier),
            this.inputString(redirectUri),
            callbackPointer,
            null,
            null
          )
        } catch (error) {
          this.unregister(callbackPointer)
          reject(error)
        }
      }),
      REQUEST_TIMEOUT_MS
    )
  }

  private refreshToken(
    applicationId: string,
    refreshToken: string
  ): Promise<DiscordSocialTokens> {
    if (!this.client) return Promise.reject(new Error('Discord client is not initialized'))
    return timeoutAfter(
      new Promise<DiscordSocialTokens>((resolve, reject) => {
        let callbackPointer = 0n
        callbackPointer = this.register(
          (
            result: unknown,
            accessToken: NativeString,
            nextRefreshToken: NativeString,
            tokenType: number,
            expiresIn: number,
            scopes: NativeString
          ): void => {
            const access = this.takeString(accessToken)
            const refresh = this.takeString(nextRefreshToken)
            const scopeText = this.takeString(scopes)
            try {
              this.assertSuccessful(result)
              resolve({
                accessToken: access,
                refreshToken: refresh || refreshToken,
                tokenType,
                expiresAt: Date.now() + Math.max(0, expiresIn) * 1_000,
                scopes: scopeText
              })
            } catch (error) {
              reject(error)
            } finally {
              queueMicrotask(() => this.unregister(callbackPointer))
            }
          },
          this.native.tokenCallbackType
        )
        try {
          this.native.clientRefreshToken(
            this.client,
            BigInt(applicationId),
            this.inputString(refreshToken),
            callbackPointer,
            null,
            null
          )
        } catch (error) {
          this.unregister(callbackPointer)
          reject(error)
        }
      }),
      REQUEST_TIMEOUT_MS
    )
  }

  private updateToken(token: DiscordSocialTokens): Promise<void> {
    if (!this.client) return Promise.reject(new Error('Discord client is not initialized'))
    return timeoutAfter(
      new Promise<void>((resolve, reject) => {
        let callbackPointer = 0n
        callbackPointer = this.register(
          (result: unknown): void => {
            try {
              this.assertSuccessful(result)
              resolve()
            } catch (error) {
              reject(error)
            } finally {
              queueMicrotask(() => this.unregister(callbackPointer))
            }
          },
          this.native.resultCallbackType
        )
        try {
          this.native.clientUpdateToken(
            this.client,
            token.tokenType ?? BEARER_TOKEN,
            this.inputString(token.accessToken),
            callbackPointer,
            null,
            null
          )
        } catch (error) {
          this.unregister(callbackPointer)
          reject(error)
        }
      }),
      REQUEST_TIMEOUT_MS
    )
  }

  private revokeToken(applicationId: string, accessToken: string): Promise<void> {
    if (!this.client) return Promise.resolve()
    return timeoutAfter(
      new Promise<void>((resolve, reject) => {
        let callbackPointer = 0n
        callbackPointer = this.register(
          (result: unknown): void => {
            try {
              this.assertSuccessful(result)
              resolve()
            } catch (error) {
              reject(error)
            } finally {
              queueMicrotask(() => this.unregister(callbackPointer))
            }
          },
          this.native.resultCallbackType
        )
        try {
          this.native.clientRevokeToken(
            this.client,
            BigInt(applicationId),
            this.inputString(accessToken),
            callbackPointer,
            null,
            null
          )
        } catch (error) {
          this.unregister(callbackPointer)
          reject(error)
        }
      }),
      REQUEST_TIMEOUT_MS
    )
  }

  private async authenticateAndConnect(tokens: DiscordSocialTokens): Promise<void> {
    if (!this.client) throw new Error('Discord client is not initialized')
    await this.updateToken(tokens)
    this.native.clientConnect(this.client)
    await this.waitForReady()
    this.currentTokens = tokens
  }

  private userText(user: unknown, getter: NativeFunction): string {
    return this.outputString((output) => getter(user, output))
  }

  private toFriend(user: unknown): OrbitFriend {
    const id = String(this.native.userId(user))
    const username = cleanText(this.userText(user, this.native.userUsername), `Discord ${id.slice(-6)}`)
    const displayName = cleanText(this.userText(user, this.native.userDisplayName), username)
    const avatarUrl = trustedAvatarUrl(
      this.outputString((output) => this.native.userAvatarUrl(user, 0, 1, output))
    )
    const presence = presenceFromDiscord(Number(this.native.userStatus(user)))
    const activity: Record<string, unknown> = {}
    let activityName: string | undefined
    if (this.native.userGameActivity(user, activity)) {
      try {
        activityName = cleanText(this.userText(activity, this.native.activityName)) || undefined
      } finally {
        this.native.activityDrop(activity)
      }
    }
    return {
      id: `discord:${id}`,
      provider: 'discord',
      providerUserId: id,
      displayName,
      avatarUrl,
      presence,
      activity: activityName
    }
  }

  private friends(): OrbitFriend[] {
    if (!this.client) return []
    const span: Record<string, unknown> = {}
    this.native.clientGetRelationships(this.client, span)
    const nativeSpan = span as unknown as NativeSpan
    const count = Math.min(Number(nativeSpan.size) || 0, MAX_DISCORD_FRIENDS)
    try {
      if (!nativeSpan.ptr || count === 0) return []
      const relationships = koffi.decode(
        nativeSpan.ptr,
        this.native.RelationshipHandle,
        count
      ) as NativeHandle[]
      const friends: OrbitFriend[] = []
      const seen = new Set<string>()
      for (const relationship of relationships) {
        try {
          if (Number(this.native.relationshipDiscordType(relationship)) !== FRIEND_RELATIONSHIP) {
            continue
          }
          const user: Record<string, unknown> = {}
          if (!this.native.relationshipUser(relationship, user)) continue
          try {
            const friend = this.toFriend(user)
            if (!seen.has(friend.providerUserId)) {
              seen.add(friend.providerUserId)
              friends.push(friend)
            }
          } finally {
            this.native.userDrop(user)
          }
        } finally {
          this.native.relationshipDrop(relationship)
        }
      }
      return friends.sort(
        (left, right) =>
          Number(onlinePresence(right.presence)) - Number(onlinePresence(left.presence)) ||
          Number(Boolean(right.activity)) - Number(Boolean(left.activity)) ||
          left.displayName.localeCompare(right.displayName)
      )
    } finally {
      if (nativeSpan.ptr) this.native.freeNative(nativeSpan.ptr)
    }
  }

  private accountName(): string | undefined {
    if (!this.client) return undefined
    const user: Record<string, unknown> = {}
    if (!this.native.clientGetCurrentUserV2(this.client, user)) return undefined
    try {
      const id = String(this.native.userId(user))
      const username = cleanText(this.userText(user, this.native.userUsername), `Discord ${id.slice(-6)}`)
      return cleanText(this.userText(user, this.native.userDisplayName), username)
    } finally {
      this.native.userDrop(user)
    }
  }

  private accountId(): string | undefined {
    if (!this.client) return undefined
    const user: Record<string, unknown> = {}
    if (!this.native.clientGetCurrentUserV2(this.client, user)) return undefined
    try {
      return String(this.native.userId(user))
    } finally {
      this.native.userDrop(user)
    }
  }

  private toChatMessage(
    handle: unknown,
    fallbackUserId?: string,
    currentUserId = this.accountId()
  ): DiscordChatMessage {
    const authorId = String(this.native.messageAuthorId(handle))
    const recipientId = String(this.native.messageRecipientId(handle))
    const direction = currentUserId && authorId === currentUserId ? 'outgoing' : 'incoming'
    const conversationUserId = direction === 'outgoing' ? recipientId : authorId
    const userId = /^\d{17,20}$/u.test(conversationUserId)
      ? conversationUserId
      : fallbackUserId ?? ''
    const content = cleanMessageContent(
      this.outputString((output) => this.native.messageContent(handle, output))
    )
    const additionalContent: Record<string, unknown> = {}
    const hasAdditionalContent = this.native.messageAdditionalContent(handle, additionalContent)
    if (hasAdditionalContent) this.native.additionalContentDrop(additionalContent)
    const sentAt = Number(this.native.messageSentTimestamp(handle))
    const editedAt = Number(this.native.messageEditedTimestamp(handle))
    return {
      id: String(this.native.messageId(handle)),
      userId,
      content,
      sentAt: Number.isFinite(sentAt) && sentAt > 0 ? sentAt : Date.now(),
      editedAt: Number.isFinite(editedAt) && editedAt > 0 ? editedAt : undefined,
      direction,
      unsupportedContent: content.length === 0 || hasAdditionalContent
    }
  }

  private messageFromId(messageId: bigint, fallbackUserId?: string): DiscordChatMessage | null {
    if (!this.client) return null
    const handle: Record<string, unknown> = {}
    if (!this.native.clientGetMessageHandle(this.client, messageId, handle)) return null
    try {
      return this.toChatMessage(handle, fallbackUserId)
    } finally {
      this.native.messageDrop(handle)
    }
  }

  private emitMessageEvent(kind: 'created' | 'updated', messageId: bigint): void {
    try {
      const message = this.messageFromId(messageId)
      if (message?.userId) {
        this.emit('chat-message', { kind, message } satisfies DiscordChatEvent)
      }
    } catch {
      // A subsequent history refresh can recover if Discord evicted the handle.
    }
  }

  private async ensureChatReady(
    applicationId: string,
    tokens?: DiscordSocialTokens
  ): Promise<void> {
    const resumed = await this.refresh(applicationId, tokens)
    if (resumed.snapshot.state !== 'ready') {
      throw new Error('Discord chat is not connected')
    }
  }

  async getChatInbox(
    applicationId: string,
    tokens?: DiscordSocialTokens
  ): Promise<DiscordChatInbox> {
    try {
      await this.ensureChatReady(applicationId, tokens)
    } catch {
      return { state: 'unavailable', conversations: [], issue: 'not-connected' }
    }
    if (!this.client) throw new Error('Discord client is not initialized')
    try {
      const conversations = await timeoutAfter(
        new Promise<DiscordChatConversation[]>((resolve, reject) => {
          let callbackPointer = 0n
          callbackPointer = this.register(
            (result: unknown, span: NativeSpan): void => {
              const count = Math.min(Number(span.size) || 0, MAX_CHAT_CONVERSATIONS)
              try {
                this.assertSuccessful(result)
                if (!span.ptr || count === 0) {
                  resolve([])
                  return
                }
                const handles = koffi.decode(
                  span.ptr,
                  this.native.UserMessageSummary,
                  count
                ) as NativeHandle[]
                const decoded: DiscordChatConversation[] = []
                for (const handle of handles) {
                  try {
                    const userId = String(this.native.userMessageSummaryUserId(handle))
                    const lastMessageId = String(
                      this.native.userMessageSummaryLastMessageId(handle)
                    )
                    if (!/^\d{17,20}$/u.test(userId) || !/^\d{17,20}$/u.test(lastMessageId)) {
                      continue
                    }
                    decoded.push({
                      userId,
                      lastMessageId,
                      lastMessage: this.messageFromId(BigInt(lastMessageId), userId) ?? undefined
                    })
                  } finally {
                    this.native.userMessageSummaryDrop(handle)
                  }
                }
                resolve(decoded)
              } catch (error) {
                reject(error)
              } finally {
                if (span.ptr) this.native.freeNative(span.ptr)
                queueMicrotask(() => this.unregister(callbackPointer))
              }
            },
            this.native.userMessageSummarySpanCallbackType
          )
          try {
            this.native.clientGetUserMessageSummaries(
              this.client,
              callbackPointer,
              null,
              null
            )
          } catch (error) {
            this.unregister(callbackPointer)
            reject(error)
          }
        }),
        REQUEST_TIMEOUT_MS
      )
      return {
        state: 'ready',
        conversations: conversations.sort(
          (left, right) =>
            (right.lastMessage?.sentAt ?? timestampFromDiscordSnowflake(right.lastMessageId)) -
            (left.lastMessage?.sentAt ?? timestampFromDiscordSnowflake(left.lastMessageId))
        )
      }
    } catch {
      return { state: 'unavailable', conversations: [], issue: 'history-unavailable' }
    }
  }

  async getChatHistory(
    applicationId: string,
    tokens: DiscordSocialTokens | undefined,
    recipientId: string,
    limit: number
  ): Promise<DiscordChatHistory> {
    try {
      await this.ensureChatReady(applicationId, tokens)
    } catch {
      return {
        state: 'unavailable',
        userId: recipientId,
        messages: [],
        issue: 'not-connected'
      }
    }
    if (!this.client) throw new Error('Discord client is not initialized')
    const safeLimit = Math.max(1, Math.min(MAX_CHAT_HISTORY, Math.trunc(limit)))
    const currentUserId = this.accountId()
    try {
      const messages = await timeoutAfter(
        new Promise<DiscordChatMessage[]>((resolve, reject) => {
          let callbackPointer = 0n
          callbackPointer = this.register(
            (result: unknown, span: NativeSpan): void => {
              const count = Math.min(Number(span.size) || 0, safeLimit)
              try {
                this.assertSuccessful(result)
                if (!span.ptr || count === 0) {
                  resolve([])
                  return
                }
                const handles = koffi.decode(
                  span.ptr,
                  this.native.MessageHandle,
                  count
                ) as NativeHandle[]
                const decoded: DiscordChatMessage[] = []
                for (const handle of handles) {
                  try {
                    const message = this.toChatMessage(handle, recipientId, currentUserId)
                    if (message.userId === recipientId) decoded.push(message)
                  } finally {
                    this.native.messageDrop(handle)
                  }
                }
                resolve(decoded)
              } catch (error) {
                reject(error)
              } finally {
                if (span.ptr) this.native.freeNative(span.ptr)
                queueMicrotask(() => this.unregister(callbackPointer))
              }
            },
            this.native.messageSpanCallbackType
          )
          try {
            this.native.clientGetUserMessagesWithLimit(
              this.client,
              BigInt(recipientId),
              safeLimit,
              callbackPointer,
              null,
              null
            )
          } catch (error) {
            this.unregister(callbackPointer)
            reject(error)
          }
        }),
        REQUEST_TIMEOUT_MS
      )
      return {
        state: 'ready',
        userId: recipientId,
        messages: messages.sort((left, right) => left.sentAt - right.sentAt)
      }
    } catch {
      return {
        state: 'unavailable',
        userId: recipientId,
        messages: [],
        issue: 'history-unavailable'
      }
    }
  }

  async sendChatMessage(
    applicationId: string,
    tokens: DiscordSocialTokens | undefined,
    recipientId: string,
    content: string
  ): Promise<DiscordChatSendResult> {
    try {
      await this.ensureChatReady(applicationId, tokens)
    } catch {
      return { ok: false, issue: 'not-connected' }
    }
    if (!this.client) throw new Error('Discord client is not initialized')
    const messageContent = cleanMessageContent(content).trim()
    if (!messageContent) return { ok: false, issue: 'send-failed' }
    try {
      const messageId = await timeoutAfter(
        new Promise<bigint>((resolve, reject) => {
          let callbackPointer = 0n
          callbackPointer = this.register(
            (result: unknown, id: bigint): void => {
              try {
                this.assertSuccessful(result)
                resolve(id)
              } catch (error) {
                reject(error)
              } finally {
                queueMicrotask(() => this.unregister(callbackPointer))
              }
            },
            this.native.messageResultCallbackType
          )
          try {
            this.native.clientSendUserMessage(
              this.client,
              BigInt(recipientId),
              this.inputString(messageContent),
              callbackPointer,
              null,
              null
            )
          } catch (error) {
            this.unregister(callbackPointer)
            reject(error)
          }
        }),
        REQUEST_TIMEOUT_MS
      )
      const message = this.messageFromId(messageId, recipientId) ?? {
        id: String(messageId),
        userId: recipientId,
        content: messageContent,
        sentAt: Date.now(),
        direction: 'outgoing' as const,
        unsupportedContent: false
      }
      return { ok: true, message }
    } catch {
      return { ok: false, issue: 'send-failed' }
    }
  }

  async setShowingChat(
    applicationId: string,
    tokens: DiscordSocialTokens | undefined,
    showing: boolean
  ): Promise<void> {
    await this.ensureChatReady(applicationId, tokens)
    if (!this.client) throw new Error('Discord client is not initialized')
    this.native.clientSetShowingChat(this.client, showing)
  }

  private readySnapshot(): DiscordSocialSnapshot {
    return {
      state: 'ready',
      friends: this.friends(),
      accountName: this.accountName(),
      updatedAt: Date.now()
    }
  }

  private stateSnapshot(
    state: DiscordSocialSnapshot['state'],
    issue?: DiscordSocialIssue
  ): DiscordSocialSnapshot {
    return { state, friends: [], updatedAt: Date.now(), issue }
  }

  async refresh(applicationId: string, storedTokens?: DiscordSocialTokens): Promise<EngineResult> {
    this.ensureClient(applicationId)
    const availableTokens = storedTokens ?? this.currentTokens
    if (availableTokens && !this.hasCommunicationScopes(availableTokens)) {
      if (this.client) this.native.clientDisconnect(this.client)
      this.currentTokens = undefined
      this.disposeClient()
      this.ensureClient(applicationId)
      return {
        snapshot: this.stateSnapshot('not-connected'),
        clearTokens: true
      }
    }
    if (this.client && this.native.clientGetStatus(this.client) === READY_STATUS) {
      return { snapshot: this.readySnapshot(), tokens: this.currentTokens }
    }
    if (!storedTokens?.accessToken) {
      return { snapshot: this.stateSnapshot('not-connected') }
    }
    try {
      let tokens = storedTokens
      if (tokens.expiresAt <= Date.now() + 5 * 60_000 && tokens.refreshToken) {
        tokens = await this.refreshToken(applicationId, tokens.refreshToken)
      }
      await this.authenticateAndConnect(tokens)
      return { snapshot: this.readySnapshot(), tokens }
    } catch {
      this.currentTokens = undefined
      return {
        snapshot: this.stateSnapshot('error', 'authentication-failed'),
        clearTokens: true
      }
    }
  }

  async connect(applicationId: string, storedTokens?: DiscordSocialTokens): Promise<EngineResult> {
    const resumed = await this.refresh(applicationId, storedTokens)
    if (resumed.snapshot.state === 'ready') return resumed
    this.emit('updated', this.stateSnapshot('connecting'))
    try {
      const tokens = await this.authorize(applicationId)
      await this.authenticateAndConnect(tokens)
      return { snapshot: this.readySnapshot(), tokens }
    } catch {
      this.currentTokens = undefined
      return {
        snapshot: this.stateSnapshot('error', 'authentication-failed'),
        clearTokens: true
      }
    }
  }

  async disconnect(applicationId: string, tokens?: DiscordSocialTokens): Promise<EngineResult> {
    if (this.client && tokens?.accessToken) {
      try {
        await this.revokeToken(applicationId, tokens.accessToken)
      } catch {
        // Local disconnect still succeeds if Discord cannot be reached for revocation.
      }
    }
    if (this.client) this.native.clientDisconnect(this.client)
    this.currentTokens = undefined
    this.disposeClient()
    return { snapshot: this.stateSnapshot('not-connected'), clearTokens: true }
  }

  private disposeClient(): void {
    if (this.changedTimer) clearTimeout(this.changedTimer)
    this.changedTimer = undefined
    if (this.callbackTimer) clearInterval(this.callbackTimer)
    this.callbackTimer = undefined
    this.failReadyWaiters(new Error('Discord client stopped'))
    if (this.client) {
      try {
        this.native.resetCallbacks()
        this.native.clientDrop(this.client)
      } catch {
        // The utility process is the crash boundary for native teardown failures.
      }
      this.client = null
    }
    for (const callback of [...this.callbacks]) this.unregister(callback)
    this.applicationId = ''
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.disposeClient()
  }
}

const parentPort = process.parentPort
const dllPath = process.argv[2]
const mainProcessId = Number(process.argv[3]) || 0
let engine: DiscordSocialEngine | null = null

function send(message: DiscordWorkerMessage): void {
  parentPort?.postMessage(message)
}

function errorResponse(request: DiscordWorkerRequest, issue: DiscordSocialIssue): void {
  send({ type: 'response', id: request.id, ok: false, error: issue })
}

try {
  if (!parentPort || !dllPath) throw new Error('Discord worker arguments are missing')
  engine = new DiscordSocialEngine(dllPath, mainProcessId)
  engine.on('updated', (snapshot: DiscordSocialSnapshot) => {
    send({ type: 'updated', snapshot })
  })
  engine.on('chat-message', (event: DiscordChatEvent) => {
    send({ type: 'chat-message', event })
  })
  send({ type: 'ready', version: engine.version() })
} catch {
  send({ type: 'ready', version: 'unavailable' })
}

parentPort?.on('message', (event) => {
  const request = event.data as DiscordWorkerRequest
  if (!request || request.type !== 'request' || !Number.isSafeInteger(request.id)) return
  void (async () => {
    if (!engine) {
      errorResponse(request, 'sdk-unavailable')
      return
    }
    if (request.command === 'probe') {
      if (!engine.chatBindingsAvailable()) {
        errorResponse(request, 'sdk-unavailable')
        return
      }
      send({ type: 'response', id: request.id, ok: true, version: engine.version() })
      return
    }
    if (request.command === 'dispose') {
      engine.dispose()
      send({ type: 'response', id: request.id, ok: true })
      setImmediate(() => process.exit(0))
      return
    }
    if (!request.applicationId || !/^\d{17,20}$/.test(request.applicationId)) {
      errorResponse(request, 'authentication-failed')
      return
    }
    if (request.command === 'chat-inbox') {
      const chatInbox = await engine.getChatInbox(request.applicationId, request.tokens)
      const tokens = engine.tokens()
      send({
        type: 'response',
        id: request.id,
        ok: true,
        chatInbox,
        tokens,
        clearTokens: !tokens
      })
      return
    }
    if (request.command === 'chat-history') {
      if (!request.recipientId || !/^\d{17,20}$/.test(request.recipientId)) {
        errorResponse(request, 'provider-unavailable')
        return
      }
      const chatHistory = await engine.getChatHistory(
        request.applicationId,
        request.tokens,
        request.recipientId,
        request.limit ?? 50
      )
      const tokens = engine.tokens()
      send({
        type: 'response',
        id: request.id,
        ok: true,
        chatHistory,
        tokens,
        clearTokens: !tokens
      })
      return
    }
    if (request.command === 'chat-send') {
      if (
        !request.recipientId ||
        !/^\d{17,20}$/.test(request.recipientId) ||
        typeof request.content !== 'string' ||
        request.content.length > MAX_MESSAGE_LENGTH
      ) {
        errorResponse(request, 'provider-unavailable')
        return
      }
      const chatSend = await engine.sendChatMessage(
        request.applicationId,
        request.tokens,
        request.recipientId,
        request.content
      )
      const tokens = engine.tokens()
      send({
        type: 'response',
        id: request.id,
        ok: true,
        chatSend,
        tokens,
        clearTokens: !tokens
      })
      return
    }
    if (request.command === 'chat-showing') {
      if (typeof request.showing !== 'boolean') {
        errorResponse(request, 'provider-unavailable')
        return
      }
      await engine.setShowingChat(request.applicationId, request.tokens, request.showing)
      const tokens = engine.tokens()
      send({
        type: 'response',
        id: request.id,
        ok: true,
        tokens,
        clearTokens: !tokens
      })
      return
    }
    let result: EngineResult
    if (request.command === 'connect') {
      result = await engine.connect(request.applicationId, request.tokens)
    } else if (request.command === 'disconnect') {
      result = await engine.disconnect(request.applicationId, request.tokens)
    } else {
      result = await engine.refresh(request.applicationId, request.tokens)
    }
    const response: DiscordWorkerResponse = {
      type: 'response',
      id: request.id,
      ok: true,
      ...result
    }
    send(response)
  })().catch(() => errorResponse(request, 'provider-unavailable'))
})

process.once('exit', () => engine?.dispose())
