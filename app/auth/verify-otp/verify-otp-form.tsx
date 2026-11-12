'use client'

import { ClipboardEvent, FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, CheckCircle2, LoaderCircle, Mail } from 'lucide-react'
import { Logo } from '@/components/logo'
import { OnboardingProgress } from '@/components/onboarding-progress'
import { bootstrapNewCompany, type CompanySetupPayload } from '@/lib/company-bootstrap'
import {
  applySignupOtpInput,
  getSignupOtpBackspaceTarget,
  isSignupOtpValid,
  normalizeSignupOtp,
} from '@/lib/signup-otp'
import { formatAppError } from '@/lib/app-access'
import { createClient } from '@/lib/supabase/client'

export function VerifyOtpForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [digits, setDigits] = useState<string[]>(Array.from({ length: 8 }, () => ''))
  const [loading, setLoading] = useState(false)
  const [verificationState, setVerificationState] = useState<'idle' | 'verifying' | 'success'>('idle')
  const [resending, setResending] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const inputs = useRef<Array<HTMLInputElement | null>>([])
  const fieldset = useRef<HTMLFieldSetElement | null>(null)
  const verificationInFlight = useRef(false)
  const code = digits.join('')

  useEffect(() => {
    const pendingEmail = window.localStorage.getItem('emora_pending_verification_email')
    const pendingSetup = window.localStorage.getItem('emora_pending_setup')
    let setupEmail = ''

    if (pendingSetup) {
      try {
        setupEmail = String(JSON.parse(pendingSetup).email ?? '')
      } catch {
        window.localStorage.removeItem('emora_pending_setup')
      }
    }

    const resolvedEmail = pendingEmail || setupEmail
    setEmail(resolvedEmail)
    if (resolvedEmail) {
      window.localStorage.setItem('emora_pending_verification_email', resolvedEmail)
      inputs.current[0]?.focus()
    } else {
      setError('لا توجد بيانات تسجيل معلقة. ارجع إلى إعداد الشركة وابدأ التسجيل من جديد.')
    }
  }, [])

  function updateDigit(position: number, value: string) {
    const result = applySignupOtpInput(digits, value, position)
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      result.digits.forEach((digit, index) => {
        if (!digit || digit === digits[index]) return
        inputs.current[index]?.animate(
          [
            { transform: 'scale(.92)' },
            { transform: 'scale(1.055)' },
            { transform: 'scale(1)' },
          ],
          { duration: 260, easing: 'cubic-bezier(.2,.9,.3,1.16)' },
        )
      })
    }
    setDigits(result.digits)
    setError('')
    inputs.current[result.focusIndex]?.focus()
    const nextCode = result.digits.join('')
    if (email && isSignupOtpValid(nextCode) && !resending) {
      void verifyCode(nextCode)
    }
  }

  function handleKeyDown(position: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Backspace') {
      const target = getSignupOtpBackspaceTarget(position, Boolean(digits[position]))
      if (target !== position) {
        event.preventDefault()
        inputs.current[target]?.focus()
      }
    } else if (event.key === 'ArrowLeft' && position > 0) {
      event.preventDefault()
      inputs.current[position - 1]?.focus()
    } else if (event.key === 'ArrowRight' && position < 7) {
      event.preventDefault()
      inputs.current[position + 1]?.focus()
    }
  }

  function handlePaste(position: number, event: ClipboardEvent<HTMLInputElement>) {
    const pasted = normalizeSignupOtp(event.clipboardData.getData('text'))
    if (!pasted) return
    event.preventDefault()
    updateDigit(position, pasted)
  }

  function shakeInputs() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    fieldset.current?.animate(
      [
        { transform: 'translateX(0)' },
        { transform: 'translateX(-4px)' },
        { transform: 'translateX(3px)' },
        { transform: 'translateX(-2px)' },
        { transform: 'translateX(0)' },
      ],
      { duration: 340, easing: 'cubic-bezier(.2,.8,.2,1)' },
    )
  }

  async function verifyCode(submittedCode: string) {
    if (verificationInFlight.current) return
    if (!email || !isSignupOtpValid(submittedCode)) {
      setError('أدخل رمز التحقق المكوّن من 8 أرقام.')
      return
    }

    verificationInFlight.current = true
    const verificationStartedAt = performance.now()
    setLoading(true)
    setVerificationState('verifying')
    setError('')
    setMessage('')
    try {
      const pendingSetup = window.localStorage.getItem('emora_pending_setup')
      if (!pendingSetup) throw new Error('بيانات إعداد الشركة غير موجودة. ابدأ التسجيل من جديد.')
      const setupPayload = JSON.parse(pendingSetup) as CompanySetupPayload
      const setupEmail = String(setupPayload.email ?? '').trim().toLowerCase()
      if (setupEmail !== email.trim().toLowerCase()) {
        throw new Error('البريد لا يطابق بيانات التسجيل. ابدأ التسجيل بالبريد نفسه.')
      }

      const supabase = createClient()
      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: submittedCode,
        type: 'email',
      })
      if (verifyError) throw verifyError

      const verifiedEmail = data.user?.email?.trim().toLowerCase()
      if (!data.session || verifiedEmail !== setupEmail) {
        throw new Error('تعذر تأكيد الحساب المسجل. تحقق من البريد المستخدم ثم حاول مرة أخرى.')
      }

      await bootstrapNewCompany(setupPayload)
      const animationRemainder = Math.max(0, 880 - (performance.now() - verificationStartedAt))
      if (animationRemainder > 0) {
        await new Promise(resolve => window.setTimeout(resolve, animationRemainder))
      }
      setVerificationState('success')
      setMessage('تم تأكيد البريد وإنشاء الشركة. جارٍ فتح لوحة التحكم…')
      await new Promise(resolve => window.setTimeout(resolve, 1000))
      router.push('/dashboard')
      router.refresh()
    } catch (caught) {
      verificationInFlight.current = false
      setVerificationState('idle')
      shakeInputs()
      const detail = formatAppError(caught, '').toLowerCase()
      setError(
        detail.includes('expired') || detail.includes('invalid') || detail.includes('otp_expired')
          ? 'الرمز غير صالح أو انتهت صلاحيته. أرسل رمزًا جديدًا ثم أدخل أحدث رمز وصلك.'
          : formatAppError(caught, 'تعذر تأكيد البريد. راجع الرمز وحاول مرة أخرى.'),
      )
    } finally {
      setLoading(false)
    }
  }

  function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void verifyCode(code)
  }

  async function resendCode() {
    if (!email || resending || loading) return
    setResending(true)
    setError('')
    setMessage('')
    try {
      const supabase = createClient()
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim().toLowerCase(),
        options: {
          emailRedirectTo: new URL(
            '/auth/callback?next=%2Fsetup',
            process.env.NEXT_PUBLIC_APP_URL || window.location.origin,
          ).toString(),
        },
      })
      if (resendError) throw resendError
      setDigits(Array.from({ length: 8 }, () => ''))
      setVerificationState('idle')
      inputs.current[0]?.focus()
      setMessage('أُرسل رمز جديد. استخدم أحدث رمز وصلك إلى بريدك الإلكتروني.')
    } catch (caught) {
      const detail = formatAppError(caught, '').toLowerCase()
      setError(
        detail.includes('rate limit') || detail.includes('too many requests')
          ? 'تم طلب رموز كثيرة خلال وقت قصير. انتظر قليلاً ثم أعد المحاولة.'
          : formatAppError(caught, 'تعذر إرسال رمز جديد. تحقق من الاتصال وحاول مرة أخرى.'),
      )
    } finally {
      setResending(false)
    }
  }

  return (
    <main className="otp-page">
      <header className="otp-header">
        <Link className="otp-brand" href="/setup" aria-label="العودة إلى إعداد الشركة"><Logo light /></Link>
        <OnboardingProgress step={2} />
      </header>

      <section className="otp-card" aria-labelledby="otp-title">
        <div className={`otp-icon otp-icon-${verificationState}`} aria-hidden="true">
          {verificationState === 'verifying' ? (
            <svg className="otp-progress-ring" viewBox="0 0 40 40" aria-hidden="true">
              <circle className="otp-ring-track" cx="20" cy="20" r="16" />
              <circle className="otp-ring-progress" cx="20" cy="20" r="16" />
            </svg>
          ) : verificationState === 'success' ? (
            <svg className="otp-icon-check" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="m5 12.5 4.3 4.3L19 7.2" />
            </svg>
          ) : <Mail size={22} aria-hidden="true" />}
        </div>
        <h1 id="otp-title">أدخل رمز التحقق</h1>
        <p className="otp-description">أرسلنا رمزًا مكوّنًا من 8 أرقام إلى بريدك الإلكتروني.</p>
        {email && <p className="otp-email" dir="ltr"><bdi>{email}</bdi></p>}

        <form className="otp-form" onSubmit={verify} aria-busy={loading}>
          <fieldset ref={fieldset} className="otp-fieldset" disabled={loading || resending || !email}>
            <legend>رمز التحقق</legend>
            <div className={`otp-inputs${verificationState === 'verifying' ? ' is-verifying' : ''}`} dir="ltr" aria-label="رمز التحقق المكوّن من 8 أرقام">
              {digits.map((digit, index) => (
                <input
                  key={index}
                  className={digit ? 'is-filled' : undefined}
                  ref={element => { inputs.current[index] = element }}
                  aria-label={`رقم التحقق ${index + 1} من 8`}
                  autoComplete={index === 0 ? 'one-time-code' : 'off'}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  type="text"
                  maxLength={8}
                  value={digit}
                  onChange={event => updateDigit(index, event.target.value)}
                  onKeyDown={event => handleKeyDown(index, event)}
                  onPaste={event => handlePaste(index, event)}
                />
              ))}
            </div>
          </fieldset>

          {loading && <p className="otp-working" role="status" aria-live="polite">جارٍ تأكيد البريد وإنشاء الشركة…</p>}
          {error && <div className="form-error" role="alert">{error}</div>}
          {message && <div className="form-success" role="status" aria-live="polite"><CheckCircle2 size={18} />{message}</div>}

          <button type="button" className="otp-resend" onClick={() => void resendCode()} disabled={loading || resending || !email}>
            {resending ? <><LoaderCircle className="otp-resend-spinner" size={15} /> جارٍ الإرسال…</> : 'إعادة إرسال الرمز'}
          </button>
        </form>

        <Link className="otp-back-link" href="/setup"><ArrowRight size={16} /> العودة إلى بيانات الشركة</Link>
      </section>
    </main>
  )
}
