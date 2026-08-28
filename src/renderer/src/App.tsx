import { useEffect, useState } from 'react'
import { useGamepadNavigation } from '@renderer/hooks/useGamepadNavigation'
import { usePreferencesStore } from '@renderer/state/preferencesStore'
import { useAuthStore } from '@renderer/state/authStore'
import { useEpicAuthStore } from '@renderer/state/epicAuthStore'
import { useNavigationStore } from '@renderer/state/navigationStore'
import { useLibraryCollectionsStore } from '@renderer/state/libraryCollectionsStore'
import { useAppUpdateStore } from '@renderer/state/appUpdateStore'
import { OnboardingFlow } from '@renderer/views/Onboarding/OnboardingFlow'
import { MainShell } from '@renderer/components/MainShell'
import { installPointerUiSounds } from '@renderer/lib/uiAudio'
import { NotificationCenter } from '@renderer/components/NotificationCenter'

function App(): JSX.Element | null {
  const [ready, setReady] = useState(false)
  const hydratePreferences = usePreferencesStore((s) => s.hydrate)
  const restoreAuth = useAuthStore((s) => s.restore)
  const restoreEpicAuth = useEpicAuthStore((s) => s.restore)
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
        restoreEpicAuth()
      ])
      setPhase(settings.hasCompletedOnboarding ? 'main' : 'onboarding')
      setReady(true)
    }
    void bootstrap()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!ready) {
    return <div className="h-full w-full bg-base" />
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-base">
      {phase === 'onboarding' ? <OnboardingFlow /> : <MainShell />}
      <NotificationCenter />
    </div>
  )
}

export default App
