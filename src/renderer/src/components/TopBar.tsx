import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Home, Library, ShoppingBag, Settings, UsersRound } from 'lucide-react'
import { useNavigationStore, type MainView } from '@renderer/state/navigationStore'
import { useAuthStore } from '@renderer/state/authStore'
import { useT } from '@renderer/i18n/useT'
import type { TranslationKey } from '@renderer/i18n/translations'
import { usePreferencesStore } from '@renderer/state/preferencesStore'
import { PowerMenu } from './PowerMenu'
import { PROFILE_AVATAR_OPTIONS, ProfileAvatar } from './ProfileAvatar'
import { DownloadActivityIsland } from './DownloadActivityIsland'
import { SystemQuickMenu } from './SystemQuickMenu'

const items: { id: MainView; labelKey: TranslationKey; icon: typeof Home }[] = [
  { id: 'home', labelKey: 'nav.home', icon: Home },
  { id: 'friends', labelKey: 'nav.friends', icon: UsersRound },
  { id: 'library', labelKey: 'nav.library', icon: Library },
  { id: 'store', labelKey: 'nav.store', icon: ShoppingBag },
  { id: 'settings', labelKey: 'nav.settings', icon: Settings }
]

export function TopBar(): JSX.Element {
  const mainView = useNavigationStore((state) => state.mainView)
  const mainViewDirection = useNavigationStore((state) => state.mainViewDirection)
  const setMainView = useNavigationStore((state) => state.setMainView)
  const account = useAuthStore((state) => state.account)
  const t = useT()
  const showStoreTab = usePreferencesStore((state) => state.showStoreTab)
  const profileAvatar = usePreferencesStore((state) => state.profileAvatar)
  const customAvatarUrl = usePreferencesStore((state) => state.customAvatarUrl)
  const navRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!showStoreTab && mainView === 'store') setMainView('home')
  }, [mainView, setMainView, showStoreTab])

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

      <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
        <nav
          ref={navRef}
          data-top-nav
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
          className="relative z-10 flex items-center justify-center gap-0.5 rounded-full border border-white/[0.09] bg-black/20 p-0.5 shadow-[0_10px_32px_rgba(0,0,0,0.2)] backdrop-blur-xl"
        >
          {items.map((item) => {
            if (item.id === 'store' && !showStoreTab) return null
            const Icon = item.icon
            const active = mainView === item.id
            const label = t(item.labelKey)
            return (
              <motion.button
                key={item.id}
                data-focusable
                data-main-view={item.id}
                onClick={() => setMainView(item.id)}
                aria-label={label}
                aria-current={active ? 'page' : undefined}
                animate={{
                  y: active ? -1 : 0,
                  scale: active ? 1.045 : 1,
                  opacity: active ? 1 : 0.72
                }}
                whileHover={{ y: -1, scale: 1.045, opacity: 1 }}
                whileTap={{ scale: 0.94 }}
                transition={{ type: 'spring', stiffness: 430, damping: 30 }}
                className="group relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:text-text data-[focused=true]:text-text"
              >
                {active && (
                  <motion.span
                    layoutId="topnav-active"
                    className="absolute inset-0 rounded-full border border-white/10 bg-white/10 shadow-[0_7px_20px_rgba(0,0,0,0.25)]"
                    transition={{ type: 'spring', stiffness: 440, damping: 34, mass: 0.7 }}
                  />
                )}
                <motion.span
                  key={active ? `${item.id}-active` : `${item.id}-idle`}
                  initial={active ? { x: mainViewDirection * 6, opacity: 0, scale: 0.76 } : false}
                  animate={{
                    x: 0,
                    opacity: 1,
                    scale: 1,
                    rotate: active && item.id === 'settings' ? 18 : 0
                  }}
                  transition={{ type: 'spring', stiffness: 520, damping: 28 }}
                  className={`relative z-10 flex ${active ? 'text-accent' : ''}`}
                >
                  <Icon size={16} strokeWidth={active ? 2.5 : 1.8} />
                </motion.span>
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
                      className="absolute -bottom-1 h-1 w-1 rounded-full bg-accent shadow-[0_0_8px_var(--accent)]"
                    />
                  )}
                </AnimatePresence>
              </motion.button>
            )
          })}
          <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-white/10" />
          <SystemQuickMenu compact />
          <PowerMenu />
        </nav>
        <div className="absolute left-1/2 top-full -translate-x-1/2">
          <DownloadActivityIsland />
        </div>
      </div>
    </header>
  )
}
