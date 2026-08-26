import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useAnimationControls } from 'framer-motion'
import { CalendarDays, Home, Library, ShoppingBag, Settings, User } from 'lucide-react'
import { useNavigationStore, type MainView } from '@renderer/state/navigationStore'
import { useAuthStore } from '@renderer/state/authStore'
import { useEpicAuthStore } from '@renderer/state/epicAuthStore'
import { useT } from '@renderer/i18n/useT'
import type { TranslationKey } from '@renderer/i18n/translations'
import { SyncStatusIndicator } from './SyncStatusIndicator'
import { usePreferencesStore } from '@renderer/state/preferencesStore'
import { PowerMenu } from './PowerMenu'
import { ControllerButtonHint } from './ControllerButtonHint'
import { PROFILE_AVATAR_OPTIONS, ProfileAvatar } from './ProfileAvatar'
import { DownloadActivityIsland } from './DownloadActivityIsland'

const items: { id: MainView; labelKey: TranslationKey; icon: typeof Home }[] = [
  { id: 'home', labelKey: 'nav.home', icon: Home },
  { id: 'library', labelKey: 'nav.library', icon: Library },
  { id: 'releases', labelKey: 'nav.releases', icon: CalendarDays },
  { id: 'store', labelKey: 'nav.store', icon: ShoppingBag },
  { id: 'settings', labelKey: 'nav.settings', icon: Settings }
]

export function TopBar(): JSX.Element {
  const mainView = useNavigationStore((s) => s.mainView)
  const mainViewDirection = useNavigationStore((s) => s.mainViewDirection)
  const setMainView = useNavigationStore((s) => s.setMainView)
  const account = useAuthStore((s) => s.account)
  const epicAccount = useEpicAuthStore((s) => s.account)
  const t = useT()
  const showStoreTab = usePreferencesStore((state) => state.showStoreTab)
  const profileAvatar = usePreferencesStore((state) => state.profileAvatar)
  const customAvatarUrl = usePreferencesStore((state) => state.customAvatarUrl)
  const navFocusControls = useAnimationControls()
  const [clock, setClock] = useState(() =>
    new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  )

  useEffect(() => {
    if (!showStoreTab && mainView === 'store') setMainView('home')
  }, [mainView, setMainView, showStoreTab])

  useEffect(() => {
    const id = setInterval(() => {
      setClock(new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }))
    }, 15000)
    return () => clearInterval(id)
  }, [])

  return (
    <header className="absolute inset-x-0 top-0 z-40 flex h-20 items-center px-4 xl:px-8">
      <ProfileAvatar
        avatarId={profileAvatar}
        steamAvatarUrl={account?.avatarUrl}
        customAvatarUrl={customAvatarUrl}
        label={t(
          PROFILE_AVATAR_OPTIONS.find((option) => option.id === profileAvatar)?.labelKey ??
            'settings.avatar.orbit'
        )}
        className="relative z-10 h-10 w-10 text-lg"
      />

      <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
        <motion.nav
          data-top-nav
          initial={false}
          animate={navFocusControls}
          onFocusCapture={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
            navFocusControls.set({ y: 0, scale: 1 })
            void navFocusControls.start({
              y: [0, -7, 1, 0],
              scale: [1, 1.025, 0.995, 1],
              transition: {
                duration: 0.42,
                times: [0, 0.42, 0.78, 1],
                ease: [0.22, 1, 0.36, 1]
              }
            })
          }}
          className="relative z-10 flex items-center justify-center gap-1 rounded-full border border-white/[0.09] bg-black/20 p-1 shadow-[0_12px_40px_rgba(0,0,0,0.22)] backdrop-blur-xl xl:gap-1.5"
        >
          <ControllerButtonHint
            button="leftBumper"
            className="ml-1 rounded-md border border-white/10 bg-black/20 px-1.5 py-1 text-[9px] font-bold tracking-wide text-muted/70"
          />
        {items.map((item) => {
          const Icon = item.icon
          const active = mainView === item.id
          if (item.id === 'store' && !showStoreTab) {
            return (
              <span
                key={item.id}
                aria-hidden="true"
                className="invisible relative flex items-center gap-2 rounded-full px-3 py-2.5 text-sm xl:px-4"
              >
                <Icon size={17} />
                <span className="font-medium">{t(item.labelKey)}</span>
              </span>
            )
          }
          return (
            <motion.button
              key={item.id}
              data-focusable
              data-main-view={item.id}
              onClick={() => setMainView(item.id)}
              aria-label={t(item.labelKey)}
              aria-current={active ? 'page' : undefined}
              animate={{
                y: active ? -2 : 0,
                scale: active ? 1.06 : 1,
                opacity: active ? 1 : 0.7
              }}
              whileHover={{ y: -2, scale: 1.05, opacity: 1 }}
              whileTap={{ scale: 0.94 }}
              transition={{ type: 'spring', stiffness: 430, damping: 30 }}
              className="group relative flex items-center gap-2 rounded-full px-3 py-2.5 text-sm text-muted hover:text-text data-[focused=true]:text-text xl:px-4"
            >
              {active && (
                <motion.div
                  layoutId="topnav-active"
                  className="absolute inset-0 rounded-full border border-white/10 bg-white/10 shadow-[0_8px_24px_rgba(0,0,0,0.28)]"
                  transition={{ type: 'spring', stiffness: 440, damping: 34, mass: 0.7 }}
                />
              )}
              <motion.span
                key={active ? `${item.id}-active` : `${item.id}-idle`}
                initial={active ? { x: mainViewDirection * 7, opacity: 0, scale: 0.72 } : false}
                animate={{ x: 0, opacity: 1, scale: 1, rotate: active && item.id === 'settings' ? 18 : 0 }}
                transition={{ type: 'spring', stiffness: 520, damping: 28 }}
                className="relative z-10 flex"
              >
                <Icon size={17} strokeWidth={active ? 2.5 : 1.8} />
              </motion.span>
              <span className={`relative z-10 font-medium ${active ? 'text-accent' : ''}`}>
                {t(item.labelKey)}
              </span>
              <AnimatePresence>
                {active && (
                  <motion.span
                    initial={{ width: 0, opacity: 0 }}
                    animate={{ width: 14, opacity: 1 }}
                    exit={{ width: 0, opacity: 0 }}
                    className="absolute -bottom-1 left-1/2 h-0.5 -translate-x-1/2 rounded-full bg-accent shadow-[0_0_10px_var(--accent)]"
                  />
                )}
              </AnimatePresence>
            </motion.button>
          )
        })}
          <ControllerButtonHint
            button="rightBumper"
            className="mr-1 rounded-md border border-white/10 bg-black/20 px-1.5 py-1 text-[9px] font-bold tracking-wide text-muted/70"
          />
          <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-white/10" />
          <PowerMenu />
        </motion.nav>
        <div className="absolute left-1/2 top-full -translate-x-1/2">
          <DownloadActivityIsland />
        </div>
      </div>

      <div className="absolute right-4 top-1/2 z-20 flex -translate-y-1/2 items-center gap-3 text-sm text-muted xl:right-8">
        <SyncStatusIndicator />
        <span className="hidden font-medium text-text/80 2xl:inline">{clock}</span>
        {(account || epicAccount) && (
          <div className="flex items-center gap-2 rounded-full bg-white/5 px-3 py-1.5">
            <User size={14} />
            <span className="hidden text-text 2xl:inline">
              {account && epicAccount ? 'Steam + Epic' : account?.accountName ?? epicAccount?.displayName}
            </span>
          </div>
        )}
      </div>
    </header>
  )
}
