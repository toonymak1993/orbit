interface OrbitMarkProps {
  className?: string
}

export function OrbitMark({ className = '' }: OrbitMarkProps): JSX.Element {
  return (
    <span className={`orbit-mark ${className}`} aria-hidden="true">
      <span className="orbit-mark__axis" />
      <span className="orbit-mark__ring orbit-mark__ring--outer" />
      <span className="orbit-mark__ring orbit-mark__ring--inner" />
      <span className="orbit-mark__satellite" />
      <span className="orbit-mark__core" />
    </span>
  )
}

export function OnboardingBackdrop(): JSX.Element {
  return (
    <div className="onboarding-backdrop" aria-hidden="true">
      <span className="onboarding-backdrop__grid" />
      <span className="onboarding-backdrop__horizon" />
      <span className="onboarding-backdrop__arc onboarding-backdrop__arc--one" />
      <span className="onboarding-backdrop__arc onboarding-backdrop__arc--two" />
      <span className="onboarding-backdrop__coordinate onboarding-backdrop__coordinate--one" />
      <span className="onboarding-backdrop__coordinate onboarding-backdrop__coordinate--two" />
      <span className="onboarding-backdrop__coordinate onboarding-backdrop__coordinate--three" />
      <span className="onboarding-backdrop__edge-code">ORB / 001</span>
    </div>
  )
}
