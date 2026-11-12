type OnboardingProgressProps = {
  step: 1 | 2
}

const stepCopy = {
  1: { title: 'بيانات الشركة', label: 'إعداد بيانات الشركة' },
  2: { title: 'تأكيد البريد', label: 'تأكيد البريد الإلكتروني' },
} satisfies Record<OnboardingProgressProps['step'], { title: string; label: string }>

export function OnboardingProgress({ step }: OnboardingProgressProps) {
  return (
    <ol className="onboarding-stepper" data-step={step} aria-label={`مسار التسجيل: ${stepCopy[step].label}`}>
      <li className={`onboarding-step ${step === 1 ? 'is-current' : 'is-complete'}`} aria-current={step === 1 ? 'step' : undefined}>
        <span className="onboarding-step-circle" aria-hidden="true">{step === 1 ? '1' : '✓'}</span>
        <span className="sr-only">الخطوة الأولى: {stepCopy[1].title}{step > 1 ? '، مكتملة' : '، الحالية'}</span>
      </li>
      <li className={`onboarding-step ${step === 2 ? 'is-current' : ''}`} aria-current={step === 2 ? 'step' : undefined}>
        <span className="onboarding-step-circle" aria-hidden="true">2</span>
        <span className="sr-only">الخطوة الثانية: {stepCopy[2].title}{step === 2 ? '، الحالية' : ''}</span>
      </li>
    </ol>
  )
}
