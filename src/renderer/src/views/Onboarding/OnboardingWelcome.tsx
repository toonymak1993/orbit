import { motion } from 'framer-motion'
import { Gamepad2 } from 'lucide-react'
import { useAutoFocus } from '@renderer/hooks/useAutoFocus'
import { FocusableButton } from '@renderer/components/FocusableButton'
import { useT } from '@renderer/i18n/useT'
import { OnboardingBackdrop, OrbitMark } from './OnboardingChrome'

interface Props {
  onContinue: () => void
}

export function OnboardingWelcome({ onContinue }: Props): JSX.Element {
  const containerRef = useAutoFocus<HTMLDivElement>()
  const t = useT()

  return (
    <div
      ref={containerRef}
      className="onboarding-welcome relative flex h-full flex-col overflow-hidden px-[clamp(1.5rem,5vw,6rem)] py-[clamp(1rem,4vh,3rem)]"
    >
      <OnboardingBackdrop />

      <header className="onboarding-welcome__header flex items-center justify-between">
        <div className="onboarding-welcome__brand flex items-center">
          <OrbitMark />
          <div className="ml-3">
            <div className="text-sm font-black tracking-[0.24em]">ORBIT</div>
            <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/35">
              {t('onboarding.setup.eyebrow')}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 text-[9px] font-bold uppercase tracking-[0.22em] text-white/35">
          <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_12px_rgb(var(--color-accent)/0.8)]" />
          01 / 04
        </div>
      </header>

      <main className="onboarding-welcome__stage flex-1">
        <motion.section
          initial={{ opacity: 0, x: -24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="onboarding-welcome__copy"
        >
          <div className="mb-[clamp(1.5rem,4vh,3.5rem)] flex items-center gap-3 text-[10px] font-bold uppercase tracking-[0.24em] text-accent">
            <span className="text-white/35">SYS.01</span>
            <span className="h-px w-10 bg-accent/50" />
            {t('onboarding.setup.page.libraries')}
          </div>
          <h1 className="onboarding-welcome__title" aria-label="ORBIT">
            OR<span>BIT</span>
          </h1>
          <p className="mt-[clamp(1.5rem,4vh,3rem)] max-w-xl text-[clamp(0.95rem,1.25vw,1.2rem)] leading-relaxed text-white/55">
            {t('onboarding.welcome.subtitle')}
          </p>
          <FocusableButton
            onClick={onContinue}
            className="onboarding-primary-action mt-[clamp(1.75rem,4.5vh,3.5rem)] flex px-7 py-4 text-sm uppercase tracking-[0.12em]"
          >
            {t('onboarding.welcome.cta')}
          </FocusableButton>
        </motion.section>

        <motion.div
          initial={{ opacity: 0, scale: 0.92, rotate: 5 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          transition={{ duration: 0.8, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
          className="onboarding-orbit-field"
          aria-hidden="true"
        >
          <span className="onboarding-orbit-field__axis" />
          <span className="onboarding-orbit-field__axis onboarding-orbit-field__axis--vertical" />
          <span className="onboarding-orbit-field__ring" />
          <span className="onboarding-orbit-field__ring onboarding-orbit-field__ring--cross" />
          <span className="onboarding-orbit-field__core"><Gamepad2 size={34} /></span>
          <span className="onboarding-orbit-field__node onboarding-orbit-field__node--one">{t('nav.library')}</span>
          <span className="onboarding-orbit-field__node onboarding-orbit-field__node--two">{t('nav.home')}</span>
          <span className="onboarding-orbit-field__node onboarding-orbit-field__node--three">ORBIT</span>
        </motion.div>
      </main>

      <motion.footer
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.25 }}
        className="onboarding-welcome__footer grid grid-cols-4 gap-[clamp(0.75rem,2vw,2rem)]"
      >
        {(['libraries', 'personalize', 'hardware', 'ready'] as const).map((page, index) => (
          <div key={page} className="onboarding-welcome__chapter">
            <div className="text-[9px] font-bold tracking-[0.2em] text-white/28">0{index + 1}</div>
            <div className="mt-1 truncate text-[10px] font-bold uppercase tracking-[0.16em] text-white/60">
              {t(`onboarding.setup.page.${page}`)}
            </div>
          </div>
        ))}
      </motion.footer>
    </div>
  )
}
