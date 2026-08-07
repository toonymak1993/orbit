import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react'
import { FocusableButton } from '@renderer/components/FocusableButton'
import { useAutoFocus } from '@renderer/hooks/useAutoFocus'
import { useBackHandler } from '@renderer/hooks/useBackHandler'
import { useT } from '@renderer/i18n/useT'
import { useEpicAuthStore } from '@renderer/state/epicAuthStore'

interface Props {
  onBack: () => void
  onSuccess: () => void
  onSkip: () => void
}

export function OnboardingEpicLogin({ onBack, onSuccess, onSkip }: Props): JSX.Element {
  const status = useEpicAuthStore((state) => state.status)
  const startLogin = useEpicAuthStore((state) => state.startLogin)
  const cancelLogin = useEpicAuthStore((state) => state.cancelLogin)
  const containerRef = useAutoFocus<HTMLDivElement>()
  const t = useT()

  useBackHandler(() => {
    void cancelLogin()
    onBack()
  })

  useEffect(() => {
    void startLogin()
    return () => {
      void cancelLogin()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (status.state !== 'success') return undefined
    const timeout = setTimeout(onSuccess, 900)
    return () => clearTimeout(timeout)
  }, [status.state, onSuccess])

  return (
    <div
      ref={containerRef}
      className="flex h-full flex-col items-center justify-center gap-8 px-12 text-center"
    >
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-accent">Epic Games</p>
        <h2 className="text-3xl font-bold tracking-tight">{t('onboarding.epicLogin.title')}</h2>
        <p className="mt-2 max-w-md text-muted">{t('onboarding.epicLogin.subtitle')}</p>
      </div>

      <div className="relative flex h-56 w-72 items-center justify-center rounded-xl2 bg-white/5">
        <AnimatePresence mode="wait">
          {status.state === 'idle' || status.state === 'waiting-for-browser' ? (
            <motion.div
              key="waiting"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-3"
            >
              <ExternalLink size={36} className="text-accent" />
              <Loader2 size={20} className="animate-spin text-muted" />
              <p className="max-w-[16rem] text-sm text-muted">
                {t('onboarding.epicLogin.waitingForBrowser')}
              </p>
            </motion.div>
          ) : status.state === 'success' ? (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center gap-3 text-emerald-400"
            >
              <CheckCircle2 size={48} />
              <p className="text-sm font-medium">
                {t('onboarding.epicLogin.success', { name: status.account.displayName })}
              </p>
            </motion.div>
          ) : (
            <motion.div
              key="error"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center gap-3 px-4 text-red-400"
            >
              <AlertTriangle size={40} />
              <p className="text-sm">{status.message}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex items-center gap-3">
        {status.state === 'error' ? (
          <FocusableButton onClick={() => void startLogin()}>
            {t('onboarding.epicLogin.retry')}
          </FocusableButton>
        ) : (
          <FocusableButton
            variant="ghost"
            onClick={() => {
              void cancelLogin()
              onBack()
            }}
          >
            {t('onboarding.epicLogin.back')}
          </FocusableButton>
        )}
        <FocusableButton variant="ghost" onClick={onSkip}>
          {t('onboarding.epicLogin.skip')}
        </FocusableButton>
      </div>
    </div>
  )
}
