import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import {
  ChevronDown,
  CircleAlert,
  ExternalLink,
  Globe2,
  Loader2,
  LogOut,
  MessageCircle,
  RefreshCw,
  Shield,
  UserRoundPlus,
  UsersRound,
  Waypoints
} from 'lucide-react'
import { useAuthStore } from '@renderer/state/authStore'
import { useEpicAuthStore } from '@renderer/state/epicAuthStore'
import { useFriendsStore, type FriendsFilter } from '@renderer/state/friendsStore'
import { usePreferencesStore } from '@renderer/state/preferencesStore'
import { useT, type TFunction } from '@renderer/i18n/useT'
import type {
  FriendPresence,
  FriendsProvider,
  FriendsProviderStatus,
  OrbitFriend
} from '@shared/ipc'

const FILTERS: FriendsFilter[] = ['all', 'steam', 'discord', 'epic']

const providerIcon: Record<FriendsProvider, typeof Waypoints> = {
  steam: Waypoints,
  discord: MessageCircle,
  epic: Shield
}

const providerColor: Record<FriendsProvider, string> = {
  steam: 'bg-[#1b2838] text-[#66c0f4]',
  discord: 'bg-[#5865f2] text-white',
  epic: 'bg-[#2a2a2a] text-white'
}

const presenceColor: Record<FriendPresence, string> = {
  online: 'bg-emerald-400',
  away: 'bg-amber-300',
  busy: 'bg-rose-400',
  offline: 'bg-white/25',
  unknown: 'bg-white/20'
}

function onlinePresence(presence: FriendPresence): boolean {
  return presence !== 'offline' && presence !== 'unknown'
}

function statusLabel(status: FriendsProviderStatus, t: TFunction): string {
  if (status.state === 'ready') {
    if (status.accountName) {
      return t('friends.provider.accountCounts', {
        account: status.accountName,
        online: status.onlineCount,
        count: status.friendCount
      })
    }
    return t('friends.provider.counts', {
      online: status.onlineCount,
      count: status.friendCount
    })
  }
  if (status.state === 'not-connected') return t('friends.provider.notConnected')
  if (status.state === 'setup-required') return t('friends.provider.setupRequired')
  if (status.state === 'connecting') return t('friends.provider.connecting')
  if (status.state === 'external') return t('friends.provider.external')
  return t('friends.provider.error')
}

export function FriendsView(): JSX.Element {
  const t = useT()
  const language = usePreferencesStore((state) => state.language)
  const account = useAuthStore((state) => state.account)
  const steamLoginStatus = useAuthStore((state) => state.status)
  const startSteamLogin = useAuthStore((state) => state.startLogin)
  const epicAccount = useEpicAuthStore((state) => state.account)
  const epicLoginStatus = useEpicAuthStore((state) => state.status)
  const startEpicLogin = useEpicAuthStore((state) => state.startLogin)
  const snapshot = useFriendsStore((state) => state.snapshot)
  const initialized = useFriendsStore((state) => state.initialized)
  const filter = useFriendsStore((state) => state.filter)
  const init = useFriendsStore((state) => state.init)
  const refresh = useFriendsStore((state) => state.refresh)
  const setFilter = useFriendsStore((state) => state.setFilter)
  const connect = useFriendsStore((state) => state.connect)
  const disconnect = useFriendsStore((state) => state.disconnect)
  const openProvider = useFriendsStore((state) => state.openProvider)
  const [handoffError, setHandoffError] = useState<FriendsProvider | null>(null)

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    if (initialized) void refresh()
  }, [account?.steamId, epicAccount?.accountId, initialized, refresh])

  const visibleProviders = useMemo<FriendsProvider[]>(
    () => (filter === 'all' ? ['steam', 'discord', 'epic'] : [filter]),
    [filter]
  )
  const onlineCount = snapshot.friends.filter((friend) => onlinePresence(friend.presence)).length

  const openProviderSafely = async (provider: FriendsProvider): Promise<void> => {
    setHandoffError(null)
    try {
      await openProvider(provider)
    } catch {
      setHandoffError(provider)
    }
  }

  const runDiscordAction = async (action: 'connect' | 'disconnect'): Promise<void> => {
    setHandoffError(null)
    try {
      if (action === 'connect') await connect('discord')
      else await disconnect('discord')
    } catch {
      setHandoffError('discord')
    }
  }

  return (
    <div className="friends-view scrollbar-none h-full overflow-y-auto px-5 pb-12 pt-24 xl:px-8">
      <div className="mx-auto max-w-[112rem]">
        <header className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-accent">
              <UsersRound size={14} />
              {t('friends.eyebrow')}
            </p>
            <h1 className="mt-2 text-[clamp(2rem,4vw,4rem)] font-black leading-none tracking-[-0.045em]">
              {t('friends.title')}
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">
              {t('friends.subtitle')}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="rounded-full border border-white/10 bg-white/[0.045] px-4 py-2 text-xs font-bold text-muted">
              <span className="text-emerald-300">{onlineCount}</span>
              <span className="px-1.5 text-white/25">/</span>
              {t('friends.summary', { count: snapshot.friends.length })}
            </div>
            <button
              data-focusable
              data-disabled={snapshot.isRefreshing ? 'true' : undefined}
              disabled={snapshot.isRefreshing}
              onClick={() => void refresh()}
              aria-label={t('friends.refresh')}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.055] text-muted transition hover:bg-white/10 hover:text-white disabled:opacity-50"
            >
              <RefreshCw size={17} className={snapshot.isRefreshing ? 'animate-spin' : ''} />
            </button>
          </div>
        </header>

        <nav
          aria-label={t('friends.filters.label')}
          className="mt-7 flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-white/[0.08] bg-black/15 p-2"
        >
          {FILTERS.map((item) => {
            const provider = item === 'all' ? null : item
            const Icon = provider ? providerIcon[provider] : Globe2
            const active = filter === item
            return (
              <button
                key={item}
                data-focusable
                data-view-entry={item === 'all' ? 'true' : undefined}
                data-friends-filter={item}
                aria-current={active ? 'page' : undefined}
                onClick={() => setFilter(item)}
                className={`relative flex min-h-11 items-center gap-2 rounded-[calc(var(--radius-card)*0.72)] px-4 py-2.5 text-sm font-bold transition ${
                  active ? 'text-text' : 'text-muted hover:bg-white/[0.055] hover:text-text'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="friends-filter-active"
                    className="absolute inset-0 rounded-[inherit] border border-white/10 bg-white/10 shadow-card"
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  />
                )}
                <Icon size={16} className="relative z-10" />
                <span className="relative z-10">{t(`friends.filter.${item}`)}</span>
              </button>
            )
          })}
          <span className="ml-auto hidden items-center gap-2 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-muted xl:flex">
            {snapshot.isRefreshing && <Loader2 size={13} className="animate-spin text-accent" />}
            {snapshot.isRefreshing ? t('friends.loading') : t('friends.filterHint')}
          </span>
        </nav>

        <div className="mt-6 space-y-7">
          {visibleProviders.map((provider) => {
            const status = snapshot.providers[provider]
            const friends = snapshot.friends.filter((friend) => friend.provider === provider)
            return (
              <ProviderSection
                key={provider}
                provider={provider}
                status={status}
                friends={friends}
                initialized={initialized}
                loginPending={
                  provider === 'steam'
                    ? steamLoginStatus.state === 'waiting-for-browser'
                    : provider === 'epic'
                      ? epicLoginStatus.state === 'waiting-for-browser'
                      : false
                }
                handoffError={handoffError === provider}
                onConnectSteam={() => void startSteamLogin()}
                onConnectEpic={() => void startEpicLogin()}
                onConnectDiscord={() => void runDiscordAction('connect')}
                onDisconnectDiscord={() => void runDiscordAction('disconnect')}
                onOpenProvider={() => void openProviderSafely(provider)}
                onRetry={() => void refresh()}
                t={t}
                language={language}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

function ProviderSection({
  provider,
  status,
  friends,
  initialized,
  loginPending,
  handoffError,
  onConnectSteam,
  onConnectEpic,
  onConnectDiscord,
  onDisconnectDiscord,
  onOpenProvider,
  onRetry,
  t,
  language
}: {
  provider: FriendsProvider
  status: FriendsProviderStatus
  friends: OrbitFriend[]
  initialized: boolean
  loginPending: boolean
  handoffError: boolean
  onConnectSteam: () => void
  onConnectEpic: () => void
  onConnectDiscord: () => void
  onDisconnectDiscord: () => void
  onOpenProvider: () => void
  onRetry: () => void
  t: TFunction
  language: 'en' | 'de'
}): JSX.Element {
  const Icon = providerIcon[provider]
  const [offlineExpanded, setOfflineExpanded] = useState(false)
  const onlineFriends = friends.filter((friend) => onlinePresence(friend.presence))
  const offlineFriends = friends.filter((friend) => !onlinePresence(friend.presence))
  const hasFriends = friends.length > 0

  return (
    <section aria-labelledby={`friends-provider-${provider}`}>
      <div className="mb-3 flex flex-wrap items-center gap-3 px-1">
        <span
          className={`flex h-9 w-9 items-center justify-center rounded-xl ${providerColor[provider]}`}
        >
          <Icon size={18} />
        </span>
        <div>
          <h2 id={`friends-provider-${provider}`} className="text-lg font-black">
            {t(`friends.provider.${provider}`)}
          </h2>
          <p className="text-xs text-muted">{statusLabel(status, t)}</p>
        </div>
        {status.state === 'ready' && (
          <div className="ml-auto flex items-center gap-2">
            {provider === 'discord' && (
              <button
                data-focusable
                type="button"
                onClick={onDisconnectDiscord}
                className="flex min-h-9 items-center gap-2 rounded-full border border-white/10 bg-white/[0.045] px-3 text-[10px] font-black uppercase tracking-[0.12em] text-muted transition hover:bg-white/10 hover:text-white"
              >
                <LogOut size={13} />
                {t('friends.discord.disconnect')}
              </button>
            )}
            <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-emerald-200">
              {t('friends.provider.live')}
            </span>
          </div>
        )}
      </div>

      {onlineFriends.length > 0 && (
        <div className="friends-grid grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {onlineFriends.map((friend) => (
            <FriendCard key={friend.id} friend={friend} t={t} language={language} />
          ))}
        </div>
      )}

      {hasFriends && onlineFriends.length === 0 && (
        <p className="rounded-[var(--radius-card)] border border-white/[0.08] bg-white/[0.03] px-5 py-4 text-sm text-muted">
          {t('friends.online.empty')}
        </p>
      )}

      {offlineFriends.length > 0 && (
        <div className="mt-3">
          <button
            data-focusable
            type="button"
            aria-expanded={offlineExpanded}
            onClick={() => setOfflineExpanded((expanded) => !expanded)}
            className="flex min-h-11 w-full items-center justify-between rounded-[var(--radius-card)] border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-left text-xs font-black uppercase tracking-[0.12em] text-muted transition hover:bg-white/[0.07] hover:text-white"
          >
            <span>{t('friends.offline.count', { count: offlineFriends.length })}</span>
            <ChevronDown
              size={17}
              className={`transition-transform ${offlineExpanded ? 'rotate-180' : ''}`}
            />
          </button>
          {offlineExpanded && (
            <div className="friends-grid mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {offlineFriends.map((friend) => (
                <FriendCard key={friend.id} friend={friend} t={t} language={language} />
              ))}
            </div>
          )}
        </div>
      )}

      {!hasFriends && (
        <ProviderStateCard
          provider={provider}
          status={status}
          initialized={initialized}
          loginPending={loginPending}
          onConnectSteam={onConnectSteam}
          onConnectEpic={onConnectEpic}
          onConnectDiscord={onConnectDiscord}
          onOpenProvider={onOpenProvider}
          onRetry={onRetry}
          t={t}
        />
      )}

      {hasFriends && status.state === 'error' && (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-amber-300/20 bg-amber-300/[0.08] px-4 py-3 text-xs text-amber-100">
          <CircleAlert size={15} className="shrink-0" />
          {t('friends.error.cached')}
        </div>
      )}

      {handoffError && (
        <p className="mt-2 flex items-center gap-2 px-1 text-xs text-amber-200" role="status">
          <CircleAlert size={13} />
          {t('friends.openFailed')}
        </p>
      )}
    </section>
  )
}

function ProviderStateCard({
  provider,
  status,
  initialized,
  loginPending,
  onConnectSteam,
  onConnectEpic,
  onConnectDiscord,
  onOpenProvider,
  onRetry,
  t
}: {
  provider: FriendsProvider
  status: FriendsProviderStatus
  initialized: boolean
  loginPending: boolean
  onConnectSteam: () => void
  onConnectEpic: () => void
  onConnectDiscord: () => void
  onOpenProvider: () => void
  onRetry: () => void
  t: TFunction
}): JSX.Element {
  let icon: ReactNode = <UsersRound size={26} />
  let title = t('friends.empty.title')
  let body = t('friends.empty.body')
  let action = t('friends.openProvider', { provider: t(`friends.provider.${provider}`) })
  let onAction = onOpenProvider

  if (!initialized) {
    icon = <Loader2 size={26} className="animate-spin" />
    title = t('friends.loading')
    body = t('friends.loadingBody')
    action = ''
  } else if (provider === 'steam' && status.state === 'not-connected') {
    icon = <UserRoundPlus size={26} />
    title = t('friends.steam.connectTitle')
    body = t('friends.steam.connectBody')
    action = loginPending ? t('friends.steam.connecting') : t('friends.steam.connect')
    onAction = onConnectSteam
  } else if (provider === 'steam' && status.state === 'error') {
    icon = <CircleAlert size={26} />
    title = t(
      status.issue === 'private-profile'
        ? 'friends.steam.privateTitle'
        : 'friends.error.title'
    )
    body = t(
      status.issue === 'private-profile'
        ? 'friends.steam.privateBody'
        : status.issue === 'authentication-failed'
          ? 'friends.steam.sessionBody'
          : 'friends.error.body'
    )
    action = status.issue === 'authentication-failed' ? t('friends.steam.connect') : t('friends.retry')
    onAction = status.issue === 'authentication-failed' ? onConnectSteam : onRetry
  } else if (provider === 'epic' && status.state === 'not-connected') {
    icon = <UserRoundPlus size={26} />
    title = t('friends.epic.connectTitle')
    body = t('friends.epic.connectBody')
    action = loginPending ? t('friends.epic.connecting') : t('friends.epic.connect')
    onAction = onConnectEpic
  } else if (provider === 'epic' && status.state === 'error') {
    icon = <CircleAlert size={26} />
    title = t('friends.error.title')
    body = t(
      status.issue === 'authentication-failed'
        ? 'friends.epic.sessionBody'
        : 'friends.error.body'
    )
    action = status.issue === 'authentication-failed' ? t('friends.epic.connect') : t('friends.retry')
    onAction = status.issue === 'authentication-failed' ? onConnectEpic : onRetry
  } else if (provider === 'discord' && status.state === 'not-connected') {
    icon = <UserRoundPlus size={26} />
    title = t('friends.discord.connectTitle')
    body = t('friends.discord.connectBody')
    action = t('friends.discord.connect')
    onAction = onConnectDiscord
  } else if (provider === 'discord' && status.state === 'connecting') {
    icon = <Loader2 size={26} className="animate-spin" />
    title = t('friends.discord.connecting')
    body = t('friends.discord.connectingBody')
    action = ''
  } else if (provider === 'discord' && status.state === 'error') {
    icon = <CircleAlert size={26} />
    title = t('friends.discord.errorTitle')
    body = t(
      status.issue === 'sdk-unavailable'
        ? 'friends.discord.sdkUnavailableBody'
        : 'friends.discord.errorBody'
    )
    action = status.issue === 'sdk-unavailable' ? t('friends.retry') : t('friends.discord.connect')
    onAction = onConnectDiscord
  }

  return (
    <div className="friends-state-card flex min-h-44 items-center rounded-[var(--radius-card)] border border-white/[0.09] bg-white/[0.035] p-5 shadow-card">
      <div className="flex min-w-0 items-start gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent">
          {icon}
        </span>
        <div className="min-w-0">
          <h3 className="text-lg font-black">{title}</h3>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">{body}</p>
          {action && (
            <button
              data-focusable
              data-disabled={loginPending ? 'true' : undefined}
              disabled={loginPending}
              onClick={onAction}
              className="mt-4 flex min-h-11 items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-xs font-black text-black transition disabled:cursor-wait disabled:opacity-60"
            >
              {loginPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <ExternalLink size={14} />
              )}
              {action}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function FriendCard({
  friend,
  t,
  language
}: {
  friend: OrbitFriend
  t: TFunction
  language: 'en' | 'de'
}): JSX.Element {
  const ProviderIcon = providerIcon[friend.provider]
  const [avatarFailed, setAvatarFailed] = useState(false)
  const initials = friend.displayName.slice(0, 2).toUpperCase()
  const subtitle = friend.activity
    ? t('friends.playing', { game: friend.activity })
    : friend.presence === 'offline' && friend.lastSeenAt
      ? t('friends.lastSeen', {
          date: new Intl.DateTimeFormat(language === 'de' ? 'de-DE' : 'en-US', {
            dateStyle: 'medium'
          }).format(new Date(friend.lastSeenAt))
        })
      : t(`friends.presence.${friend.presence}`)

  return (
    <motion.button
      data-focusable
      data-disabled={!friend.profileUrl ? 'true' : undefined}
      disabled={!friend.profileUrl}
      onClick={() => friend.profileUrl && void window.api.app.openExternal(friend.profileUrl)}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.985 }}
      transition={{ duration: 0.14 }}
      className="friend-card group relative flex min-h-24 items-center gap-4 overflow-hidden rounded-[var(--radius-card)] border border-white/[0.09] bg-surface/80 p-4 text-left shadow-card disabled:cursor-default"
    >
      <span className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white/10 text-base font-black text-white/70">
        {friend.avatarUrl && !avatarFailed ? (
          <img
            src={friend.avatarUrl}
            alt=""
            loading="lazy"
            onError={() => setAvatarFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          initials
        )}
        <span
          className={`absolute bottom-1 right-1 h-3.5 w-3.5 rounded-full border-[3px] border-surface ${presenceColor[friend.presence]}`}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-black text-text">{friend.displayName}</span>
        <span className={`mt-1 block truncate text-xs ${friend.activity ? 'text-accent' : 'text-muted'}`}>
          {subtitle}
        </span>
        <span className="mt-2 flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.16em] text-white/35">
          <ProviderIcon size={11} /> {t(`friends.filter.${friend.provider}`)}
        </span>
      </span>
      {friend.profileUrl && (
        <ExternalLink
          size={15}
          className="shrink-0 text-white/20 transition group-hover:text-accent group-data-[focused=true]:text-accent"
        />
      )}
    </motion.button>
  )
}
