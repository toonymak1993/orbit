import { create } from 'zustand'

export type MainView = 'home' | 'friends' | 'library' | 'store' | 'settings'

export const MAIN_VIEW_ORDER: MainView[] = [
  'home',
  'friends',
  'library',
  'store',
  'settings'
]
export type OnboardingStep = 'welcome' | 'steam-login' | 'epic-login' | 'success'
export type AppPhase = 'onboarding' | 'main'

interface NavigationState {
  phase: AppPhase
  onboardingStep: OnboardingStep
  mainView: MainView
  mainViewDirection: 1 | -1
  setPhase: (phase: AppPhase) => void
  setOnboardingStep: (step: OnboardingStep) => void
  setMainView: (view: MainView, direction?: 1 | -1) => void
}

export const useNavigationStore = create<NavigationState>((set) => ({
  phase: 'onboarding',
  onboardingStep: 'welcome',
  mainView: 'home',
  mainViewDirection: 1,
  setPhase: (phase) => set({ phase }),
  setOnboardingStep: (onboardingStep) => set({ onboardingStep }),
  setMainView: (mainView, direction) =>
    set((state) => {
      const currentIndex = MAIN_VIEW_ORDER.indexOf(state.mainView)
      const nextIndex = MAIN_VIEW_ORDER.indexOf(mainView)
      return {
        mainView,
        mainViewDirection: direction ?? (nextIndex >= currentIndex ? 1 : -1)
      }
    })
}))
