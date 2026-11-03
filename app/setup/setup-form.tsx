'use client'

import { FormEvent, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Building2, CheckCircle2, KeyRound, Mail, Phone, UserRound } from 'lucide-react'
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js'
import { Logo } from '@/components/logo'
import { waitForAuthSession } from '@/lib/auth-confirmation'
import { isSignupOtpValid, normalizeSignupOtp } from '@/lib/signup-otp'
import { formatAppError, hasAdminAccess, type AppAccess } from '@/lib/app-access'
import { createClient } from '@/lib/supabase/client'

type SetupPayload = {
  companyName: string
  companyCode: string
  adminName: string
  employeeCode: string
  phone: string
  email: string
}

export function SetupForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(false)
  const [authPending, setAuthPending] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [verificationEmail, setVerificationEmail] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [verificationPending, setVerificationPending] = useState(false)
  const [resendingCode, setResendingCode] = useState(false)
  const hasAuthCallbackError = searchParams.get('error') === 'auth'

  useEffect(() => {
    let active = true
    const pendingData = window.localStorage.getItem('emora_pending_setup')
    const pendingEmail = window.localStorage.getItem('emora_pending_verification_email')

    if (pendingEmail) {
      setVerificationEmail(pendingEmail)
      setVerificationPending(true)
    }

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
          if (hasAuthCallbackError) {
            if (pendingData) {
              const payload: SetupPayload = JSON.parse(pendingData)
              setVerificationEmail(payload.email)
              setVerificationPending(true)
              setError('تعذر استخدام رابط التأكيد. أدخل رمز التحقق المرسل إلى بريدك أو أعد إرسال الرمز.')
            } else {
              setError('تعذر تأكيد البريد الإلكتروني. سجّل الدخول أو اطلب رمز تحقق جديداً من صفحة الإعداد.')
            }
          } else if (pendingData) {
            const payload: SetupPayload = JSON.parse(pendingData)
            setVerificationEmail(payload.email)
            setVerificationPending(true)
            setMessage('أدخل رمز التحقق المكوّن من 8 أرقام المرسل إلى بريدك لإكمال إعداد الشركة.')
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

        const payload: SetupPayload = JSON.parse(pendingData)
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

  async function bootstrapCompany(payload: SetupPayload) {
    const supabase = createClient()
    const { data, error: functionError } = await supabase.functions.invoke('bootstrap-company', {
      body: {
        companyName: payload.companyName,
        companyCode: payload.companyCode,
        adminName: payload.adminName,
        employeeCode: payload.employeeCode,
        phone: payload.phone,
      },
    })

    if (functionError) {
      let message = formatAppError(functionError, 'تعذر إنشاء الشركة عبر خدمة الإعداد.')
      if (functionError instanceof FunctionsFetchError) {
        message = 'تعذر الاتصال بدالة bootstrap-company. تأكد من تشغيل Supabase المحلي والدالة محلياً، أو من نشر الدالة على مشروع Supabase المُعدّ للتطبيق.'
      }
      if (functionError instanceof FunctionsHttpError) {
        try {
          const body = await functionError.context.json()
          message = formatAppError(body, message)
        } catch {
          // keep the function error message
        }
      }
      throw new Error(message)
    }

    if (data?.error) {
      throw new Error(formatAppError(data.error, 'تعذر إنشاء الشركة.'))
    }

    window.localStorage.removeItem('emora_pending_setup')
    window.localStorage.removeItem('emora_pending_verification_email')
    if (data?.auditLogged === false) {
      throw new Error('تم إنشاء الشركة بنجاح، لكن تعذر حفظ سجل التدقيق. لا تعاود إعداد الشركة؛ سجّل الدخول أو تواصل مع مسؤول النظام.')
    }
    const { data: accessData, error: accessError } = await supabase.rpc('app_current_access')
    if (accessError) {
      throw new Error('تم إنشاء الشركة، لكن تعذر تحميل صلاحيات الدخول. لا تعاود إعداد الشركة؛ سجّل الدخول أو تواصل مع الدعم.')
    }
    const access = accessData as AppAccess | null
    const isOwnerOfCreatedCompany =
      access?.company_id === data?.companyId &&
      access?.roles?.some(role => role.code === 'COMPANY_OWNER')
    if (!isOwnerOfCreatedCompany) {
      throw new Error('تم إنشاء الشركة، لكن تعذر تأكيد عضوية المالك. لا تعاود إعداد الشركة؛ سجّل الدخول أو تواصل مع الدعم.')
    }
    router.push(hasAdminAccess(access) ? '/dashboard' : '/portal')
    router.refresh()
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (verificationPending) {
      await verifySignupOtp()
      return
    }
    setLoading(true)
    setError('')
    setMessage('')

    const form = new FormData(event.currentTarget)
    const email = String(form.get('email')).trim().toLowerCase()
    const password = String(form.get('password'))
    const payload: SetupPayload = {
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
            options: { data: { full_name: payload.adminName } },
          })
          if (signUpError) throw signUpError
          hasSession = Boolean(signUpData.session)
          if (!hasSession) {
            setVerificationEmail(email)
            setVerificationPending(true)
            setMessage('تم إرسال رمز تحقق مكوّن من 8 أرقام إلى بريدك. أدخله هنا لإكمال إعداد الشركة.')
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

  async function verifySignupOtp() {
    const code = normalizeSignupOtp(otpCode)
    if (!verificationEmail || !isSignupOtpValid(code)) {
      setError('أدخل رمز التحقق المكوّن من 8 أرقام.')
      return
    }

    setLoading(true)
    setError('')
    setMessage('')
    try {
      const pendingData = window.localStorage.getItem('emora_pending_setup')
      if (!pendingData) throw new Error('بيانات إعداد الشركة غير موجودة. أعد بدء التسجيل.')
      const payload: SetupPayload = JSON.parse(pendingData)
      if (payload.email.trim().toLowerCase() !== verificationEmail.trim().toLowerCase()) {
        throw new Error('البريد لا يطابق بيانات التسجيل. أعد بدء التسجيل بالبريد نفسه.')
      }

      const supabase = createClient()
      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        email: verificationEmail,
        token: code,
        type: 'email',
      })
      if (verifyError) throw verifyError
      const verifiedEmail = data.user?.email?.trim().toLowerCase()
      if (!data.session || verifiedEmail !== payload.email.trim().toLowerCase()) {
        throw new Error('تم التحقق من حساب مختلف عن بيانات إعداد الشركة. سجّل الدخول بالبريد المستخدم للتسجيل.')
      }

      setVerificationPending(false)
      await bootstrapCompany(payload)
    } catch (caught) {
      const detail = formatAppError(caught, '')
      const normalizedDetail = detail.toLowerCase()
      setError(
        normalizedDetail.includes('expired') || normalizedDetail.includes('invalid') || normalizedDetail.includes('otp_expired')
          ? 'الرمز غير صالح أو انتهت صلاحيته. أعد إرسال رمز جديد ثم أدخل أحدث رمز وصلك.'
          : detail || 'تعذر التحقق من الرمز. تأكد من صحته أو أعد إرسال رمز جديد.',
      )
    } finally {
      setLoading(false)
    }
  }

  async function resendSignupOtp() {
    if (!verificationEmail) return
    setResendingCode(true)
    setError('')
    setMessage('')
    try {
      const supabase = createClient()
      const { error: resendError } = await supabase.auth.resend({ type: 'signup', email: verificationEmail })
      if (resendError) throw resendError
      setOtpCode('')
      setMessage('تم إرسال رمز تحقق جديد. استخدم أحدث رمز وصلك إلى البريد الإلكتروني.')
    } catch (caught) {
      setError(formatAppError(caught, 'تعذر إعادة إرسال الرمز. حاول بعد قليل أو سجّل الدخول إذا كان الحساب مؤكداً بالفعل.'))
    } finally {
      setResendingCode(false)
    }
  }

  return (
    <main className="setup-page">
      <header className="setup-header">
        <Logo />
        <div><span>الخطوة 1 من 2</span><strong>إعداد الشركة</strong></div>
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
          {verificationPending ? (
            <div className="form-section">
              <div className="section-icon"><Mail size={22}/></div>
              <div className="section-fields">
                <h2>تأكيد البريد الإلكتروني</h2>
                <p>أدخل رمز التحقق المكوّن من 8 أرقام المرسل إلى {verificationEmail}.</p>
                <label className="full-column">رمز التحقق
                  <input
                    name="signupOtp"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    dir="ltr"
                    maxLength={8}
                    value={otpCode}
                    onChange={event => setOtpCode(normalizeSignupOtp(event.target.value))}
                    placeholder="12345678"
                    aria-label="رمز التحقق المكوّن من 8 أرقام"
                  />
                </label>
                <button className="button" type="button" onClick={resendSignupOtp} disabled={resendingCode || loading}>
                  {resendingCode ? 'جارٍ إعادة الإرسال...' : 'إعادة إرسال الرمز'}
                </button>
              </div>
            </div>
          ) : null}
          {authPending ? <div className="form-success" role="status" aria-live="polite">جارٍ تأكيد البريد الإلكتروني واستعادة جلسة الدخول...</div> : null}
          {error ? <div className="form-error" role="alert">{error}</div> : null}
          {message ? <div className="form-success"><CheckCircle2 size={18}/>{message}</div> : null}
          <button className="button button-primary button-full" disabled={loading || authPending || resendingCode}>
            {authPending ? 'جارٍ تأكيد البريد الإلكتروني...' : loading ? 'جارٍ إكمال العملية...' : verificationPending ? 'تأكيد الرمز وإنشاء الشركة' : 'إنشاء الشركة والدخول'}
          </button>
        </form>
      </section>
    </main>
  )
}
