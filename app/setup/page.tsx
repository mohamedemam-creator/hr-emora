'use client'

import { FormEvent, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Building2, CheckCircle2, KeyRound, Mail, Phone, UserRound } from 'lucide-react'
import { Logo } from '@/components/logo'
import { createClient } from '@/lib/supabase/client'

type SetupPayload = {
  companyName: string
  companyCode: string
  adminName: string
  employeeCode: string
  phone: string
  email: string
}

export default function SetupPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  // 1. Check if returning from Email Confirmation Link
  useEffect(() => {
    async function handleEmailCallback() {
      const code = searchParams.get('code')
      const pendingData = window.localStorage.getItem('emora_pending_setup')

      if (code && pendingData) {
        try {
          setLoading(true)
          const payload: SetupPayload = JSON.parse(pendingData)
          const supabase = createClient()
          const { data: sessionData } = await supabase.auth.getSession()

          if (sessionData.session?.user) {
            await bootstrapCompanyDirect(payload, sessionData.session.user.id)
          }
        } catch (err: any) {
          setError(err.message || 'تعذر إكمال إعداد الشركة تلقائياً')
        } finally {
          setLoading(false)
        }
      }
    }

    handleEmailCallback()
  }, [searchParams])

  async function bootstrapCompanyDirect(payload: SetupPayload, userId: string) {
    const supabase = createClient()

    // Create Company
    const { data: company, error: companyError } = await supabase
      .from('companies')
      .insert([{ name: payload.companyName, code: payload.companyCode }])
      .select()
      .single()

    if (companyError) throw companyError

    // Create Admin Employee
    const { error: empError } = await supabase.from('employees').insert([
      {
        company_id: company.id,
        user_id: userId,
        full_name: payload.adminName,
        email: payload.email,
        role: 'company_admin',
        device_id: payload.employeeCode,
      },
    ])

    if (empError) throw empError

    window.localStorage.removeItem('emora_pending_setup')
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
    const payload: SetupPayload = {
      companyName: String(form.get('companyName')).trim(),
      companyCode: String(form.get('companyCode')).trim().toUpperCase(),
      adminName: String(form.get('adminName')).trim(),
      employeeCode: String(form.get('employeeCode')).trim().toUpperCase(),
      phone: String(form.get('phone')).trim(),
      email,
    }

    try {
      const supabase = createClient()
      const { data: sessionData } = await supabase.auth.getSession()

      let activeUserId = sessionData.session?.user?.id

      if (!activeUserId) {
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        })

        if (!signInError && signInData.session) {
          activeUserId = signInData.session.user.id
        } else {
          // Save pending state
          window.localStorage.setItem('emora_pending_setup', JSON.stringify(payload))

          const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
            email,
            password,
            options: {
              emailRedirectTo: `${window.location.origin}/setup`,
            },
          })

          if (signUpError) throw signUpError

          if (signUpData.session) {
            activeUserId = signUpData.session.user.id
          } else {
            setMessage('تم إرسال رابط التأكيد إلى بريدك. بعد الضغط على Confirm f-الإيميل، سيتم إنشاء الشركة والدخول تلقائياً!')
            return
          }
        }
      }

      if (activeUserId) {
        await bootstrapCompanyDirect(payload, activeUserId)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'تعذر إكمال إعداد الشركة')
    } finally {
      setLoading(false)
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
          <span className="eyebrow">ابدأ مع Emora</span>
          <h1>أنشئ مساحة شركتك</h1>
          <p>سيصبح هذا الحساب مدير النظام الرئيسي، وبعدها ستضيف مديري المناطق والفروع من داخل البرنامج.</p>
        </div>
        <form className="setup-form" onSubmit={submit}>
          <div className="form-section">
            <div className="section-icon"><Building2 size={22}/></div>
            <div className="section-fields">
              <h2>بيانات الشركة</h2>
              <div className="two-columns">
                <label>اسم الشركة<input required name="companyName" placeholder="مثال: شركة سيلين للتجارة" /></label>
                <label>كود الشركة<input required name="companyCode" minLength={2} maxLength={20} pattern="[A-Za-z0-9_-]+" placeholder="Emora01" /></label>
              </div>
            </div>
          </div>
          <div className="form-section">
            <div className="section-icon"><UserRound size={22}/></div>
            <div className="section-fields">
              <h2>مدير النظام</h2>
              <div className="two-columns">
                <label>الاسم الكامل<input required name="adminName" placeholder="الاسم بالكامل" /></label>
                <label>كود الموظف<input required name="employeeCode" placeholder="EMP001" /></label>
                <label>رقم الهاتف<div className="input-wrap"><Phone size={18}/><input name="phone" placeholder="01xxxxxxxxx" /></div></label>
                <label>البريد الإلكتروني<div className="input-wrap"><Mail size={18}/><input required type="email" name="email" placeholder="admin@company.com" /></div></label>
                <label className="full-column">كلمة المرور<div className="input-wrap"><KeyRound size={18}/><input required minLength={8} type="password" name="password" placeholder="8 أحرف على الأقل" /></div></label>
              </div>
            </div>
          </div>
          {error && <div className="form-error">{error}</div>}
          {message && <div className="form-success"><CheckCircle2 size={18}/>{message}</div>}
          <button className="button button-primary button-full" disabled={loading}>
            {loading ? 'جارٍ إنشاء الشركة...' : 'إنشاء الشركة والدخول'}
          </button>
        </form>
      </section>
    </main>
  )
}