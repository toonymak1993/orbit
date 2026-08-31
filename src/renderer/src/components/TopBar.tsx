import { useEffect, useRef } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Home, LayoutGrid, Library, ShoppingBag, Settings, UsersRound } from 'lucide-react'
import {
  getVisibleMainViews,
  useNavigationStore,
  type MainView
} from '@renderer/state/navigationStore'
import { useAuthStore } from '@renderer/state/authStore'
import { useT } from '@renderer/i18n/useT'
import type { TranslationKey } from '@renderer/i18n/translations'
import { usePreferencesStore } from '@renderer/state/preferencesStore'
import { PowerMenu } from './PowerMenu'
import { PROFILE_AVATAR_OPTIONS, ProfileAvatar } from './ProfileAvatar'
import { DownloadActivityIsland } from './DownloadActivityIsland'
import { SystemQuickMenu } from './SystemQuickMenu'
import type { DockMotion, DockSize } from '@shared/ipc'
import {
  totalDiscordUnread,
  useDiscordChatStore
} from '@renderer/state/discordChatStore'

const items: { id: MainView; labelKey: TranslationKey; icon: typeof Home }[] = [
  { id: 'home', labelKey: 'nav.home', icon: Home },
  { id: 'applications', labelKey: 'nav.applications', icon: LayoutGrid },
  { id: 'friends', labelKey: 'nav.friends', icon: UsersRound },
  { id: 'library', labelKey: 'nav.library', icon: Library },
  { id: 'store', labelKey: 'nav.store', icon: ShoppingBag },
  { id: 'settings', labelKey: 'nav.settings', icon: Settings }
]

const DOCK_SCALE: Record<DockSize, number> = {
  compact: 0.9,
  standard: 1,
  large: 1.16
}

function effectiveDockMotion(dockMotion: DockMotion, reduceMotion: boolean): DockMotion {
  return reduceMotion ? 'calm' : dockMotion
}

export function TopBar(): JSX.Element {
  const mainView = useNavigationStore((state) => state.mainView)
  const mainViewDirection = useNavigationStore((state) => state.mainViewDirection)
  const setMainView = useNavigationStore((state) => state.setMainView)
  const account = useAuthStore((state) => state.account)
  const t = useT()
  const showStoreTab = usePreferencesStore((state) => state.showStoreTab)
  const showFriendsHub = usePreferencesStore((state) => state.showFriendsHub)
  const profileAvatar = usePreferencesStore((state) => state.profileAvatar)
  const customAvatarUrl = usePreferencesStore((state) => state.customAvatarUrl)
  const dockTheme = usePreferencesStore((state) => state.dockTheme)
  const dockSize = usePreferencesStore((state) => state.dockSize)
  const dockMotion = usePreferencesStore((state) => state.dockMotion)
  const reduceMotion = Boolean(useReducedMotion())
  const unreadCount = useDiscordChatStore((state) => totalDiscordUnread(state.unreadByUser))
  const navRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (
      (!showFriendsHub && mainView === 'friends') ||
      (!showStoreTab && mainView === 'store')
    ) {
      setMainView('home')
    }
  }, [mainView, setMainView, showFriendsHub, showStoreTab])

  const visibleViews = getVisibleMainViews({ showFriendsHub, showStoreTab })
  const motionMode = effectiveDockMotion(dockMotion, reduceMotion)
  const itemTransition =
    motionMode === 'calm'
      ? { duration: 0.12, ease: [0.22, 1, 0.36, 1] as const }
      : motionMode === 'lively'
        ? { type: 'spring' as const, stiffness: 520, damping: 22, mass: 0.64 }
        : { type: 'spring' as const, stiffness: 430, damping: 30 }
  const iconTransition =
    motionMode === 'calm'
      ? itemTransition
      : motionMode === 'lively'
        ? { type: 'spring' as const, stiffness: 560, damping: 23, mass: 0.6 }
        : { type: 'spring' as const, stiffness: 520, damping: 28 }
  const activeLift = motionMode === 'lively' ? -3 : motionMode === 'standard' ? -1 : 0
  const activeScale = motionMode === 'lively' ? 1.09 : motionMode === 'standard' ? 1.045 : 1
  const idleOpacity = motionMode === 'lively' ? 0.66 : 0.72

  return (
    <header className="absolute inset-x-0 top-0 z-40 flex h-16 items-center px-4 xl:px-8">
      <ProfileAvatar
        avatarId={profileAvatar}
        steamAvatarUrl={account?.avatarUrl}
        customAvatarUrl={customAvatarUrl}
        label={t(
          PROFILE_AVATAR_OPTIONS.find((option) => option.id === profileAvatar)?.labelKey ??
            'settings.avatar.orbit'
        )}
        className="relative z-10 h-9 w-9 text-base"
      />

      <div
        className={`absolute left-1/2 top-1/2 z-10 origin-center ${reduceMotion ? '' : 'transition-transform duration-300'}`}
        style={{
          transform: `translate(-50%, -50%) scale(${DOCK_SCALE[dockSize]})`
        }}
      >
        <motion.nav
          layout="size"
          ref={navRef}
          data-top-nav
          data-dock-theme={dockTheme}
          data-dock-size={dockSize}
          data-dock-motion={motionMode}
          onFocusCapture={(event) => {
            const focusedItem = (event.target as HTMLElement).closest<HTMLElement>(
              '[data-focusable]'
            )
            if (!focusedItem || !event.currentTarget.contains(focusedItem)) return
            event.currentTarget
              .querySelector<HTMLElement>('[data-top-nav-last-focus="true"]')
              ?.removeAttribute('data-top-nav-last-focus')
            focusedItem.dataset.topNavLastFocus = 'true'
          }}
          transition={
            motionMode === 'calm'
              ? { layout: { duration: 0.1 } }
              : { layout: { type: 'spring', stiffness: 390, damping: 34, mass: 0.8 } }
          }
          className="orbit-dock relative z-10 flex items-center justify-center gap-0.5 rounded-full border border-white/[0.09] bg-black/20 p-0.5 shadow-[0_10px_32px_rgba(0,0,0,0.2)] backdrop-blur-xl"
        >
          {motionMode === 'lively' && (
            <motion.span
              key={`${dockTheme}-${mainView}`}
              aria-hidden="true"
              className="orbit-dock-event-glow pointer-events-none absolute inset-0 rounded-full"
              initial={{ opacity: 0, scaleX: 0.34 }}
              animate={{ opacity: [0, 0.85, 0], scaleX: [0.34, 1.02, 1.12] }}
              transition={{ duration: 0.62, ease: [0.22, 1, 0.36, 1] }}
            />
          )}
          {items.map((item) => {
            if (!visibleViews.includes(item.id)) return null
            const Icon = item.icon
            const active = mainView === item.id
            const label = t(item.labelKey)
            return (
              <motion.button
                key={item.id}
                data-focusable
                data-dock-item
                data-active={active ? 'true' : 'false'}
                data-main-view={item.id}
                onClick={() => setMainView(item.id)}
                aria-label={label}
                aria-current={active ? 'page' : undefined}
                animate={{
                  y: active ? activeLift : 0,
                  scale: active ? activeScale : 1,
                  opacity: active ? 1 : idleOpacity
                }}
                whileHover={{
                  y: motionMode === 'lively' ? -4 : motionMode === 'standard' ? -1 : 0,
                  scale: motionMode === 'lively' ? 1.1 : motionMode === 'standard' ? 1.045 : 1.02,
                  opacity: 1
                }}
                whileTap={{
                  scale:
                    motionMode === 'lively' ? 0.88 : motionMode === 'standard' ? 0.94 : 0.98
                }}
                transition={itemTransition}
                className="group relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:text-text data-[focused=true]:text-text"
              >
                {active && (
                  <motion.span
                    layoutId="topnav-active"
                    className="orbit-dock-active-surface absolute inset-0 rounded-full border border-white/10 bg-white/10 shadow-[0_7px_20px_rgba(0,0,0,0.25)]"
                    transition={
                      motionMode === 'calm'
                        ? { duration: 0.1 }
                        : motionMode === 'lively'
                          ? { type: 'spring', stiffness: 510, damping: 25, mass: 0.62 }
                          : { type: 'spring', stiffness: 440, damping: 34, mass: 0.7 }
                    }
                  />
                )}
                <motion.span
                  key={active ? `${item.id}-active` : `${item.id}-idle`}
                  initial={
                    active && motionMode !== 'calm'
                      ? motionMode === 'lively'
                        ? {
                            x: mainViewDirection * 10,
                            y: 4,
                            opacity: 0,
                            scale: 0.62,
                            rotate: mainViewDirection * -16
                          }
                        : { x: mainViewDirection * 6, opacity: 0, scale: 0.76 }
                      : false
                  }
                  animate={{
                    x: 0,
                    y: 0,
                    opacity: 1,
                    scale: active && motionMode === 'lively' ? [0.82, 1.16, 1] : 1,
                    rotate:
                      active && item.id === 'settings'
                        ? motionMode === 'lively'
                          ? 30
                          : motionMode === 'standard'
                            ? 18
                            : 0
                        : 0
                  }}
                  transition={iconTransition}
                  className={`relative z-10 flex ${active ? 'text-accent' : ''}`}
                >
                  <Icon size={16} strokeWidth={active ? 2.5 : 1.8} />
                </motion.span>
                {item.id === 'friends' && unreadCount > 0 && (
                  <span
                    aria-label={t('friends.chat.unreadCount', { count: unreadCount })}
                    className="absolute -right-1 -top-1 z-20 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-base bg-[#5865f2] px-0.5 text-[8px] font-black leading-none text-white shadow-lg"
                  >
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute left-1/2 top-[calc(100%+0.55rem)] z-30 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-full border border-white/10 bg-black/80 px-2.5 py-1 text-[10px] font-bold text-white opacity-0 shadow-lg backdrop-blur-md transition duration-150 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100 group-data-[focused=true]:translate-y-0 group-data-[focused=true]:opacity-100"
                >
                  {label}
                </span>
                <AnimatePresence>
                  {active && (
                    <motion.span
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0, opacity: 0 }}
                      transition={itemTransition}
                      className="orbit-dock-indicator absolute -bottom-1 h-1 w-1 rounded-full bg-accent"
                    />
                  )}
                </AnimatePresence>
              </motion.button>
            )
          })}
          <span aria-hidden="true" className="orbit-dock-separator mx-0.5 h-5 w-px bg-white/10" />
          <DownloadActivityIsland />
          <SystemQuickMenu compact />
          <PowerMenu />
        </motion.nav>
      </div>
    </header>
  )
}
