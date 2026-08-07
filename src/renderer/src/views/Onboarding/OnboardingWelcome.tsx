import { motion } from 'framer-motion'
import { Gamepad2 } from 'lucide-react'
import { useAutoFocus } from '@renderer/hooks/useAutoFocus'
import { FocusableButton } from '@renderer/components/FocusableButton'
import { useT } from '@renderer/i18n/useT'

interface Props {
  onContinue: () => void
}

export function OnboardingWelcome({ onContinue }: Props): JSX.Element {
  const containerRef = useAutoFocus<HTMLDivElement>()
  const t = useT()

  return (
    <div
      ref={containerRef}
      className="flex h-full flex-col items-center justify-center gap-8 px-12 text-center"
    >
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex flex-col items-center gap-6"
      >
        <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-accent to-accent-2 shadow-glow">
          <Gamepad2 size={36} className="text-black" />
        </div>
        <div>
          <h1 className="text-5xl font-bold tracking-tight">ORBIT</h1>
          <p className="mt-3 max-w-md text-muted">{t('onboarding.welcome.subtitle')}</p>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15 }}
      >
        <FocusableButton onClick={onContinue} className="px-10 py-4 text-base">
          {t('onboarding.welcome.cta')}
        </FocusableButton>
      </motion.div>
    </div>
  )
}
