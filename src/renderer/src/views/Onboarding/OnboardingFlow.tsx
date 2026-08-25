import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useNavigationStore } from '@renderer/state/navigationStore'
import { useLibraryStore } from '@renderer/state/libraryStore'
import { OnboardingWelcome } from './OnboardingWelcome'
import { OnboardingSuccess } from './OnboardingSuccess'
import { useSyncStore } from '@renderer/state/syncStore'
import './onboarding.css'

export function OnboardingFlow(): JSX.Element {
  const [syncBaselineStartedAt, setSyncBaselineStartedAt] = useState<number | undefined>()
  const step = useNavigationStore((s) => s.onboardingStep)
  const setOnboardingStep = useNavigationStore((s) => s.setOnboardingStep)
  const setPhase = useNavigationStore((s) => s.setPhase)
  const initLibrary = useLibraryStore((s) => s.init)
  const refreshLibrary = useLibraryStore((s) => s.refresh)
  const initSync = useSyncStore((s) => s.init)

  useEffect(() => {
    void initSync()
  }, [initSync])

  async function complete(): Promise<void> {
    await window.api.settings.set({ hasCompletedOnboarding: true })
    setPhase('main')
  }

  function startSetup(): void {
    const baseline = useSyncStore.getState().status.startedAt
    setSyncBaselineStartedAt(baseline)
    setOnboardingStep('success')
    void (async () => {
      await initLibrary()
      // Re-running onboarding from Settings can happen while an older refresh
      // is still active. Only queue a second pass when the first call merely
      // joined that old session instead of creating a new one.
      if (baseline !== undefined) {
        await refreshLibrary()
        if (useSyncStore.getState().status.startedAt === baseline) {
          await refreshLibrary()
        }
      }
    })()
  }

  return (
    <div className="h-full w-full">
      <AnimatePresence mode="wait">
        {step === 'welcome' && (
          <motion.div
            key="welcome"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="h-full"
          >
            <OnboardingWelcome onContinue={startSetup} />
          </motion.div>
        )}
        {step === 'success' && (
          <motion.div
            key="success"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="h-full"
          >
            <OnboardingSuccess
              syncBaselineStartedAt={syncBaselineStartedAt}
              onBack={() => setOnboardingStep('welcome')}
              onFinish={() => void complete()}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
