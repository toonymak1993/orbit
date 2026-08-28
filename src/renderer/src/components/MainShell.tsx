import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { TopBar } from './TopBar'
import { HomeView } from '@renderer/views/Home/HomeView'
import { FriendsView } from '@renderer/views/Friends/FriendsView'
import { LibraryView } from '@renderer/views/Library/LibraryView'
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
import { focusElement, focusFirstIn } from '@renderer/lib/spatialNavigation'
import { useStoreStore } from '@renderer/state/storeStore'
import { GameLaunchSplash } from './GameLaunchSplash'
import { SessionSummaryToast } from './SessionSummaryToast'
import { AppUpdateBanner } from './AppUpdateBanner'
import { useAppUpdateStore } from '@renderer/state/appUpdateStore'
import { BottomStatusHud } from './BottomStatusHud'
import type { GameLaunchStatus } from '@shared/ipc'

const SESSION_SUMMARY_VISIBLE_MS = 6_000

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
  const [sessionSummary, setSessionSummary] = useState<GameLaunchStatus | null>(null)
  const updateStage = useAppUpdateStore((state) => state.snapshot.stage)
  const updateBannerVisible = useAppUpdateStore((state) => state.bannerVisible)
  const pendingSessionSummaryRef = useRef<GameLaunchStatus | null>(null)
  const games = useLibraryStore((s) => s.snapshot.games)
  const providerGames = useLibraryStore((s) => s.snapshot.providerGames)
  const shellRef = useRef<HTMLDivElement>(null)
  const detailGame = detailGameId
    ? (games.find((game) => game.id === detailGameId) ??
      providerGames.find((game) => game.id === detailGameId))
    : undefined

  useEffect(() => {
    void initSync()
    void initStore()
  }, [initStore, initSync])

  useEffect(() => {
    let active = true
    const receiveLaunchStatus = (status: GameLaunchStatus): void => {
      if (!active) return
      setLaunchStatus(status)
      if (status.phase === 'returning' && (status.sessionDurationSeconds ?? 0) > 0) {
        pendingSessionSummaryRef.current = status
      }
      if (status.phase === 'idle' && pendingSessionSummaryRef.current) {
        setSessionSummary(pendingSessionSummaryRef.current)
        pendingSessionSummaryRef.current = null
      }
    }
    const unsubscribe = window.api.game.onLaunchStatus(receiveLaunchStatus)
    void window.api.game.getLaunchStatus().then(receiveLaunchStatus)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!sessionSummary) return
    const timer = window.setTimeout(() => setSessionSummary(null), SESSION_SUMMARY_VISIBLE_MS)
    return () => window.clearTimeout(timer)
  }, [sessionSummary])

  useEffect(() => {
    void initLibrary()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (mainView === 'store') void refreshStoreIfStale()
  }, [mainView, refreshStoreIfStale])

  useBackHandler(() => {
    if (mainView !== 'home') setMainView('home')
  })

  useEffect(() => {
    const shell = shellRef.current
    if (!shell) return
    if (detailGame || launchStatus.phase !== 'idle' || updateStage === 'installing') {
      shell.setAttribute('inert', '')
    }
    else shell.removeAttribute('inert')
    return () => shell.removeAttribute('inert')
  }, [detailGame, launchStatus.phase, updateStage])

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const activePane = shellRef.current?.querySelector<HTMLElement>(
        `[data-view-pane="${mainView}"]`
      )
      const preferredEntry = activePane?.querySelector<HTMLElement>('[data-view-entry="true"]')
      if (preferredEntry) focusElement(preferredEntry)
      else if (activePane) focusFirstIn(activePane)
    })
    return () => cancelAnimationFrame(frame)
  }, [mainView])

  function renderView(view: MainView): JSX.Element {
    if (view === 'home') return <HomeView />
    if (view === 'friends') return <FriendsView />
    if (view === 'library') return <LibraryView />
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
        <BottomStatusHud />
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
      <AnimatePresence>
        {sessionSummary && (
          <SessionSummaryToast
            key={`${sessionSummary.gameId}:${sessionSummary.endedAt}`}
            status={sessionSummary}
            visibleSeconds={SESSION_SUMMARY_VISIBLE_MS / 1_000}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {updateBannerVisible &&
          (updateStage === 'installing' ||
            (updateStage === 'ready' && launchStatus.phase === 'idle')) && (
            <AppUpdateBanner key="app-update" />
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
