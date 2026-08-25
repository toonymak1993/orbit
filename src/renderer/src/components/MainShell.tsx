import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { TopBar } from './TopBar'
import { HomeView } from '@renderer/views/Home/HomeView'
import { LibraryView } from '@renderer/views/Library/LibraryView'
import { ReleaseCalendarView } from '@renderer/views/Releases/ReleaseCalendarView'
import { StoreView } from '@renderer/views/Store/StoreView'
import { SettingsView } from '@renderer/views/Settings/SettingsView'
import {
  useNavigationStore,
  type MainView
} from '@renderer/state/navigationStore'
import { useLibraryStore } from '@renderer/state/libraryStore'
import { useBackHandler } from '@renderer/hooks/useBackHandler'
import { useSyncStore } from '@renderer/state/syncStore'
import { GameDetailPanel } from './GameDetailPanel'
import { useGameDetailStore } from '@renderer/state/gameDetailStore'
import { focusFirstIn } from '@renderer/lib/spatialNavigation'
import { useStoreStore } from '@renderer/state/storeStore'
import { GameLaunchSplash } from './GameLaunchSplash'
import type { GameLaunchStatus } from '@shared/ipc'

export function MainShell(): JSX.Element {
  const mainView = useNavigationStore((s) => s.mainView)
  const mainViewDirection = useNavigationStore((s) => s.mainViewDirection)
  const setMainView = useNavigationStore((s) => s.setMainView)
  const initLibrary = useLibraryStore((s) => s.init)
  const initSync = useSyncStore((s) => s.init)
  const initStore = useStoreStore((s) => s.init)
  const refreshStoreIfStale = useStoreStore((s) => s.refreshIfStale)
  const detailGameId = useGameDetailStore((s) => s.gameId)
  const [launchStatus, setLaunchStatus] = useState<GameLaunchStatus>({ phase: 'idle' })
  const games = useLibraryStore((s) => s.snapshot.games)
  const shellRef = useRef<HTMLDivElement>(null)
  const detailGame = detailGameId ? games.find((game) => game.id === detailGameId) : undefined

  useEffect(() => {
    void initSync()
    void initStore()
  }, [initStore, initSync])

  useEffect(() => {
    let active = true
    void window.api.game.getLaunchStatus().then((status) => {
      if (active) setLaunchStatus(status)
    })
    const unsubscribe = window.api.game.onLaunchStatus(setLaunchStatus)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    void initLibrary()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (mainView === 'store' || mainView === 'releases') void refreshStoreIfStale()
  }, [mainView, refreshStoreIfStale])

  useBackHandler(() => {
    if (mainView !== 'home') setMainView('home')
  })

  useEffect(() => {
    const shell = shellRef.current
    if (!shell) return
    if (detailGame || launchStatus.phase !== 'idle') shell.setAttribute('inert', '')
    else shell.removeAttribute('inert')
    return () => shell.removeAttribute('inert')
  }, [detailGame, launchStatus.phase])

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const activePane = shellRef.current?.querySelector<HTMLElement>(
        `[data-view-pane="${mainView}"]`
      )
      if (activePane) focusFirstIn(activePane)
    })
    return () => cancelAnimationFrame(frame)
  }, [mainView])

  function renderView(view: MainView): JSX.Element {
    if (view === 'home') return <HomeView />
    if (view === 'library') return <LibraryView />
    if (view === 'releases') return <ReleaseCalendarView />
    if (view === 'store') return <StoreView />
    return <SettingsView />
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={shellRef} className="flex h-full w-full flex-col overflow-hidden">
        <TopBar />
        <main className="relative flex-1 overflow-hidden">
          <PersistentViewPane
            key={mainView}
            view={mainView}
            active
            direction={mainViewDirection}
          >
            {renderView(mainView)}
          </PersistentViewPane>
        </main>
      </div>

      <AnimatePresence>{detailGame && <GameDetailPanel key={detailGame.id} game={detailGame} />}</AnimatePresence>
      <AnimatePresence>
        {launchStatus.phase !== 'idle' && (
          <GameLaunchSplash
            key={launchStatus.gameId ?? 'game-launch'}
            status={launchStatus}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function PersistentViewPane({
  view,
  active,
  direction,
  children
}: {
  view: MainView
  active: boolean
  direction: 1 | -1
  children: ReactNode
}): JSX.Element {
  const paneRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    paneRef.current?.toggleAttribute('inert', !active)
  }, [active])

  return (
    <motion.div
      ref={paneRef}
      data-view-pane={view}
      aria-hidden={!active}
      initial={{ opacity: 0, x: direction * 22, scale: 0.994 }}
      animate={
        active
          ? { opacity: 1, x: 0, scale: 1 }
          : { opacity: 0, x: direction * -14, scale: 0.996 }
      }
      transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
      className="absolute inset-0 h-full"
      style={{
        pointerEvents: active ? 'auto' : 'none',
        zIndex: active ? 1 : 0
      }}
    >
      {children}
    </motion.div>
  )
}
