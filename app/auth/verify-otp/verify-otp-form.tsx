'use client'

import { ClipboardEvent, FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, Check, CheckCircle2, LoaderCircle, Mail } from 'lucide-react'
import { Logo } from '@/components/logo'
import { OnboardingProgress } from '@/components/onboarding-progress'
import { Skeleton } from '@/components/skeleton'
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
    setDigits(result.digits)
    inputs.current[result.focusIndex]?.focus()
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

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!email || !isSignupOtpValid(code)) {
      setError('أدخل رمز التحقق المكوّن من 8 أرقام.')
      return
    }

    setLoading(true)
    setVerificationState('verifying')
    setError('')
    setMessage('')
    try {
      const pendingSetup = window.localStorage.getItem('emora_pending_setup')
      if (!pendingSetup) throw new Error('بيانات إعداد الشركة غير موجودة. ابدأ التسجيل من جديد.')
      const setupEmail = String(JSON.parse(pendingSetup).email ?? '').trim().toLowerCase()
      if (setupEmail !== email.trim().toLowerCase()) {
        throw new Error('البريد لا يطابق بيانات التسجيل. ابدأ التسجيل بالبريد نفسه.')
      }

      const supabase = createClient()
      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: code,
        type: 'email',
      })
      if (verifyError) throw verifyError

      const verifiedEmail = data.user?.email?.trim().toLowerCase()
      if (!data.session || verifiedEmail !== setupEmail) {
        throw new Error('تعذر تأكيد الحساب المسجل. تحقق من البريد المستخدم ثم حاول مرة أخرى.')
      }

      setVerificationState('success')
      setMessage('تم تأكيد البريد. جارٍ تجهيز مساحة الشركة…')
      await new Promise(resolve => window.setTimeout(resolve, 650))
      router.replace('/setup?verified=1')
      router.refresh()
    } catch (caught) {
      setVerificationState('idle')
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

  async function resendCode() {
    if (!email) return
    setResending(true)
    setError('')
    setMessage('')
    try {
      const supabase = createClient()
      const { error: resendError } = await supabase.auth.resend({ type: 'signup', email })
      if (resendError) throw resendError
      setDigits(Array.from({ length: 8 }, () => ''))
      inputs.current[0]?.focus()
      setMessage('أُرسل رمز جديد. استخدم أحدث رمز وصلك إلى بريدك الإلكتروني.')
    } catch (caught) {
      setError(formatAppError(caught, 'تعذر إرسال رمز جديد. حاول مرة أخرى بعد قليل.'))
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
        <div className={`otp-icon otp-icon-${verificationState}`} role="status" aria-live="polite" aria-label={verificationState === 'verifying' ? 'جارٍ التحقق من الرمز' : verificationState === 'success' ? 'تم التحقق بنجاح' : undefined}>
          {verificationState === 'verifying' ? <LoaderCircle className="otp-icon-roll" size={24} aria-hidden="true" /> : verificationState === 'success' ? <Check className="otp-icon-check" size={25} aria-hidden="true" /> : <Mail size={23} aria-hidden="true" />}
        </div>
        <p className="otp-kicker">خطوة واحدة لإكمال التسجيل</p>
        <h1 id="otp-title">أدخل رمز التحقق</h1>
        <p className="otp-description">أرسلنا رمزًا مكوّنًا من 8 أرقام إلى بريدك الإلكتروني.</p>
        {email && <p className="otp-email" dir="ltr"><bdi>{email}</bdi></p>}

        <form className="otp-form" onSubmit={verify}>
          <fieldset className="otp-fieldset" disabled={loading || resending}>
            <legend>رمز التحقق</legend>
            <div className="otp-inputs" dir="ltr" aria-label="رمز التحقق المكوّن من 8 أرقام">
              {digits.map((digit, index) => (
                <input
                  key={index}
                  className={digit ? 'is-filled' : undefined}
                  ref={element => { inputs.current[index] = element }}
                  aria-label={`رقم التحقق ${index + 1} من 8`}
                  aria-describedby="otp-help"
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
            <span id="otp-help" className="otp-help">يمكنك كتابة الرمز أو لصقه، وسنوزع أرقامه تلقائيًا.</span>
          </fieldset>

          {error && <div className="form-error" role="alert">{error}</div>}
          {message && <div className="form-success" role="status" aria-live="polite"><CheckCircle2 size={18} />{message}</div>}

          <button className="button button-primary button-full" disabled={loading || resending || !isSignupOtpValid(code) || !email}>
            {loading ? <><Skeleton size={18} /> جارٍ التحقق…</> : 'تأكيد البريد والمتابعة'}
          </button>
          <button type="button" className="otp-resend" onClick={() => void resendCode()} disabled={loading || resending || !email}>
            {resending ? <><Skeleton size={16} /> جارٍ إرسال رمز جديد…</> : 'إعادة إرسال الرمز'}
          </button>
        </form>

        <Link className="otp-back-link" href="/setup"><ArrowRight size={16} /> العودة إلى بيانات الشركة</Link>
      </section>
    </main>
  )
}
