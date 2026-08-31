import { useEffect, useRef, useState } from 'react'
import { useGamepadNavigation } from '@renderer/hooks/useGamepadNavigation'
import { usePreferencesStore } from '@renderer/state/preferencesStore'
import { useAuthStore } from '@renderer/state/authStore'
import { useEpicAuthStore } from '@renderer/state/epicAuthStore'
import { usePlayStationStore } from '@renderer/state/playstationStore'
import { useNavigationStore } from '@renderer/state/navigationStore'
import { useLibraryCollectionsStore } from '@renderer/state/libraryCollectionsStore'
import { useAppUpdateStore } from '@renderer/state/appUpdateStore'
import { OnboardingFlow } from '@renderer/views/Onboarding/OnboardingFlow'
import { MainShell } from '@renderer/components/MainShell'
import { installPointerUiSounds } from '@renderer/lib/uiAudio'
import { NotificationCenter } from '@renderer/components/NotificationCenter'
import { StartupAnimation } from '@renderer/components/StartupAnimation'
import {
  markCustomStartupVideoFailed,
  readCachedStartupAnimationMode,
  readCachedStartupVideoUrl
} from '@renderer/lib/startupAnimationPreference'
import type { StartupAnimationMode } from '@shared/ipc'
import { GamepadKeyboard } from '@renderer/components/GamepadKeyboard'
import { MediaKeyboardOverlay } from '@renderer/components/MediaKeyboardOverlay'

const STARTUP_TOTAL_MS = 1_500
const STARTUP_EXIT_MS = 180
const STARTUP_MIN_VISIBLE_MS = STARTUP_TOTAL_MS - STARTUP_EXIT_MS
const STARTUP_REDUCED_MOTION_MS = 100
const CUSTOM_STARTUP_MAX_MS = 15_000

type StartupPhase = 'playing' | 'leaving' | 'hidden'

function initialStartupMode(): StartupAnimationMode {
  const mode = readCachedStartupAnimationMode()
  return mode === 'custom' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 'orbit'
    : mode
}

function OrbitApp(): JSX.Element | null {
  const cachedStartupMode = useRef(initialStartupMode())
  const [ready, setReady] = useState(false)
  const [startupMode, setStartupMode] = useState<StartupAnimationMode>(
    cachedStartupMode.current
  )
  const [startupPhase, setStartupPhase] = useState<StartupPhase>(
    cachedStartupMode.current === 'off' ? 'hidden' : 'playing'
  )
  const [customStartupComplete, setCustomStartupComplete] = useState(false)
  const startupStartedAt = useRef(performance.now())
  const customStartupVideoUrl = useRef(readCachedStartupVideoUrl())
  const appContentRef = useRef<HTMLDivElement>(null)
  const hydratePreferences = usePreferencesStore((s) => s.hydrate)
  const restoreAuth = useAuthStore((s) => s.restore)
  const restoreEpicAuth = useEpicAuthStore((s) => s.restore)
  const restorePlayStation = usePlayStationStore((s) => s.restore)
  const hydrateLibraryCollections = useLibraryCollectionsStore((s) => s.hydrate)
  const initAppUpdates = useAppUpdateStore((s) => s.init)
  const phase = useNavigationStore((s) => s.phase)
  const setPhase = useNavigationStore((s) => s.setPhase)

  useGamepadNavigation()

  useEffect(() => installPointerUiSounds(), [])

  useEffect(() => {
    async function bootstrap(): Promise<void> {
      const [settings] = await Promise.all([
        window.api.settings.get(),
        hydratePreferences(),
        hydrateLibraryCollections(),
        initAppUpdates(),
        restoreAuth(),
        restoreEpicAuth(),
        restorePlayStation()
      ])
      setPhase(settings.hasCompletedOnboarding ? 'main' : 'onboarding')
      setReady(true)
    }
    void bootstrap()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!ready || startupMode === 'off') return
    if (startupMode === 'custom' && !customStartupComplete) return

    const minimumVisibleMs =
      startupMode === 'custom'
        ? 0
        : window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? STARTUP_REDUCED_MOTION_MS
          : STARTUP_MIN_VISIBLE_MS
    const elapsedMs = performance.now() - startupStartedAt.current
    const timer = window.setTimeout(
      () => setStartupPhase('leaving'),
      Math.max(0, minimumVisibleMs - elapsedMs)
    )

    return () => window.clearTimeout(timer)
  }, [customStartupComplete, ready, startupMode])

  useEffect(() => {
    if (startupMode !== 'custom' || startupPhase !== 'playing') return
    const timer = window.setTimeout(() => setCustomStartupComplete(true), CUSTOM_STARTUP_MAX_MS)
    return () => window.clearTimeout(timer)
  }, [startupMode, startupPhase])

  useEffect(() => {
    if (startupPhase !== 'leaving') return
    const timer = window.setTimeout(() => setStartupPhase('hidden'), STARTUP_EXIT_MS)
    return () => window.clearTimeout(timer)
  }, [startupPhase])

  function fallbackToOrbitStartup(): void {
    startupStartedAt.current = performance.now()
    markCustomStartupVideoFailed()
    void window.api.settings.set({ startupAnimationMode: 'orbit' }).catch(() => undefined)
    setCustomStartupComplete(false)
    setStartupMode('orbit')
  }

  useEffect(() => {
    const content = appContentRef.current
    if (!content) return
    content.toggleAttribute('inert', startupPhase !== 'hidden')
    return () => content.removeAttribute('inert')
  }, [startupPhase])

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-base">
      <div
        ref={appContentRef}
        data-orbit-app-content
        className="orbit-app-content h-full w-full"
        aria-hidden={!ready || startupPhase !== 'hidden'}
      >
        {ready && (phase === 'onboarding' ? <OnboardingFlow /> : <MainShell />)}
        {ready && <NotificationCenter />}
      </div>

      {startupPhase !== 'hidden' && startupMode !== 'off' && (
        <StartupAnimation
          phase={startupPhase}
          mode={startupMode}
          customVideoUrl={customStartupVideoUrl.current}
          onCustomVideoEnded={() => setCustomStartupComplete(true)}
          onCustomVideoError={fallbackToOrbitStartup}
        />
      )}
      <GamepadKeyboard />
    </div>
  )
}

function App(): JSX.Element | null {
  const mode = new URLSearchParams(window.location.search).get('orbitMode')
  return mode === 'media-keyboard' ? <MediaKeyboardOverlay /> : <OrbitApp />
}

export default App
