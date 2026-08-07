import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Loader2, ExternalLink, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useAuthStore } from '@renderer/state/authStore'
import { useAutoFocus } from '@renderer/hooks/useAutoFocus'
import { useBackHandler } from '@renderer/hooks/useBackHandler'
import { FocusableButton } from '@renderer/components/FocusableButton'
import { useT } from '@renderer/i18n/useT'

interface Props {
  onBack: () => void
  onSuccess: () => void
  onSkip: () => void
}

export function OnboardingSteamLogin({ onBack, onSuccess, onSkip }: Props): JSX.Element {
  const status = useAuthStore((s) => s.status)
  const startLogin = useAuthStore((s) => s.startLogin)
  const cancelLogin = useAuthStore((s) => s.cancelLogin)
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
    if (status.state === 'success') {
      const timeout = setTimeout(onSuccess, 900)
      return () => clearTimeout(timeout)
    }
    return undefined
  }, [status.state, onSuccess])

  return (
    <div
      ref={containerRef}
      className="flex h-full flex-col items-center justify-center gap-8 px-12 text-center"
    >
      <div>
        <h2 className="text-3xl font-bold tracking-tight">{t('onboarding.steamLogin.title')}</h2>
        <p className="mt-2 max-w-sm text-muted">{t('onboarding.steamLogin.subtitle')}</p>
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
              <p className="max-w-[16rem] text-sm text-muted">{t('onboarding.steamLogin.waitingForBrowser')}</p>
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
                {t('onboarding.steamLogin.success', { name: status.account.accountName })}
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
            {t('onboarding.steamLogin.retry')}
          </FocusableButton>
        ) : (
          <FocusableButton
            variant="ghost"
            onClick={() => {
              void cancelLogin()
              onBack()
            }}
          >
            {t('onboarding.steamLogin.back')}
          </FocusableButton>
        )}
        <FocusableButton variant="ghost" onClick={onSkip}>
          {t('onboarding.steamLogin.skip')}
        </FocusableButton>
      </div>
    </div>
  )
}
