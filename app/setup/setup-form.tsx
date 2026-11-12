'use client'

import { FormEvent, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Building2, CheckCircle2, KeyRound, Mail, Phone, UserRound } from 'lucide-react'
import { Logo } from '@/components/logo'
import { OnboardingProgress } from '@/components/onboarding-progress'
import { waitForAuthSession } from '@/lib/auth-confirmation'
import { bootstrapNewCompany, type CompanySetupPayload } from '@/lib/company-bootstrap'
import { formatAppError } from '@/lib/app-access'
import { createClient } from '@/lib/supabase/client'

export function SetupForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(false)
  const [authPending, setAuthPending] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const hasAuthCallbackError = searchParams.get('error') === 'auth'

  useEffect(() => {
    let active = true
    const pendingData = window.localStorage.getItem('emora_pending_setup')
    if (!hasAuthCallbackError && !pendingData) return

    async function handleEmailCallback() {
      try {
        setAuthPending(true)
        const supabase = createClient()
        const session = await waitForAuthSession(async () => {
          const { data, error: sessionError } = await supabase.auth.getSession()
          if (sessionError) throw sessionError
          return data.session
        })

        if (!active) return

        if (!session) {
          if (pendingData) {
            router.replace('/auth/verify-otp')
            return
          }
          if (hasAuthCallbackError) {
            setError('تعذر تأكيد البريد الإلكتروني. سجّل الدخول أو ابدأ التسجيل مجدداً لطلب رمز تحقق جديد.')
          }
          return
        }

        if (hasAuthCallbackError) {
          setError('')
          if (!pendingData) {
            setAuthPending(false)
            router.replace('/setup')
            return
          }
        }

        if (!pendingData) return

        const payload: CompanySetupPayload = JSON.parse(pendingData)
        const sessionEmail = session.user.email?.trim().toLowerCase()
        if (!sessionEmail || sessionEmail !== payload.email.trim().toLowerCase()) {
          setError('تم تأكيد حساب مختلف عن البريد المستخدم لإعداد الشركة. سجّل الدخول بالبريد نفسه لإكمال الإعداد.')
          return
        }

        setMessage('')
        setLoading(true)
        await bootstrapCompany(payload)
      } catch (err: unknown) {
        if (active) setError(formatAppError(err, 'تعذر إكمال إعداد الشركة تلقائياً'))
      } finally {
        if (active) {
          setAuthPending(false)
          setLoading(false)
        }
      }
    }

    void handleEmailCallback()
    return () => {
      active = false
    }
  }, [hasAuthCallbackError, router])

  async function bootstrapCompany(payload: CompanySetupPayload) {
    await bootstrapNewCompany(payload)
    router.push('/dashboard')
    router.refresh()
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError('')
    setMessage('')

    const form = new FormData(event.currentTarget)
    const email = String(form.get('email')).trim().toLowerCase()
    const password = String(form.get('password'))
    const payload: CompanySetupPayload = {
      companyName: String(form.get('companyName')).trim(),
      companyCode: String(form.get('companyCode')).trim().toUpperCase(),
      adminName: String(form.get('adminName')).trim(),
      employeeCode: String(form.get('employeeCode')).trim().toUpperCase(),
      phone: String(form.get('phone') ?? '').trim(),
      email,
    }

    if (!payload.companyName || !payload.companyCode || !payload.adminName || !payload.employeeCode || !email) {
      setError('أكمل جميع البيانات المطلوبة.')
      setLoading(false)
      return
    }

    try {
      const supabase = createClient()
      const { data: sessionData } = await supabase.auth.getSession()
      let hasSession = Boolean(sessionData.session?.user)

      if (!hasSession) {
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        })

        if (!signInError && signInData.session) {
          hasSession = true
        } else {
          window.localStorage.setItem('emora_pending_setup', JSON.stringify(payload))
          window.localStorage.setItem('emora_pending_verification_email', email)
          const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
            email,
            password,
            options: {
              data: { full_name: payload.adminName },
              emailRedirectTo: new URL(
                '/auth/callback?next=%2Fsetup',
                process.env.NEXT_PUBLIC_APP_URL || window.location.origin,
              ).toString(),
            },
          })
          if (signUpError) throw signUpError
          hasSession = Boolean(signUpData.session)
          if (!hasSession) {
            router.push('/auth/verify-otp')
            return
          }
        }
      }

      await bootstrapCompany(payload)
    } catch (caught) {
      setError(formatAppError(caught, 'تعذر إكمال إعداد الشركة'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="setup-page">
      <header className="setup-header">
        <div className="setup-brand"><Logo light /></div>
        <OnboardingProgress step={1} />
      </header>
      <section className="setup-card">
        <div className="setup-intro">
          <span className="eyebrow">ابدأ مع Emora HR</span>
          <h1>أنشئ مساحة شركتك</h1>
          <p>سيصبح هذا الحساب مالك الشركة الجديدة، ويمكنك بعدها إضافة الفروع والموظفين وتحديد أدوارهم من داخل الشركة.</p>
        </div>
        <form className="setup-form" onSubmit={submit} noValidate>
          <div className="form-section">
            <div className="section-icon"><Building2 size={22}/></div>
            <div className="section-fields">
              <h2>بيانات الشركة</h2>
              <div className="two-columns">
                <label>اسم الشركة<input required name="companyName" placeholder="مثال: إمورا للحلول المباشرة" /></label>
                <label>كود الشركة<input required name="companyCode" minLength={2} maxLength={20} pattern="[A-Za-z0-9_\-]+" title="حروف وأرقام وشرطة وشرطة سفلية فقط" placeholder="Emora01" /></label>
              </div>
            </div>
          </div>
          <div className="form-section">
            <div className="section-icon"><UserRound size={22}/></div>
            <div className="section-fields">
              <h2>مالك الشركة</h2>
              <div className="two-columns">
                <label>الاسم الكامل<input required name="adminName" placeholder="الاسم بالكامل" /></label>
                <label>كود الموظف<input required name="employeeCode" placeholder="EMP001" /></label>
                <label>رقم الهاتف<div className="input-wrap"><Phone size={18}/><input name="phone" type="tel" autoComplete="tel" placeholder="01xxxxxxxxx" /></div></label>
                <label>البريد الإلكتروني<div className="input-wrap"><Mail size={18}/><input required type="email" name="email" placeholder="admin@company.com" /></div></label>
                <label className="full-column">كلمة المرور<div className="input-wrap"><KeyRound size={18}/><input required minLength={8} type="password" name="password" placeholder="8 أحرف على الأقل" /></div></label>
              </div>
            </div>
          </div>
          {authPending ? <div className="form-success" role="status" aria-live="polite">جارٍ تأكيد البريد الإلكتروني واستعادة جلسة الدخول...</div> : null}
          {error ? <div className="form-error" role="alert">{error}</div> : null}
          {message ? <div className="form-success"><CheckCircle2 size={18}/>{message}</div> : null}
          <button className="button button-primary button-full" disabled={loading || authPending}>
            {authPending ? 'جارٍ تأكيد البريد الإلكتروني...' : loading ? 'جارٍ إكمال العملية...' : 'إنشاء الشركة والدخول'}
          </button>
        </form>
      </section>
    </main>
  )
}
