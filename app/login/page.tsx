
'use client'

import { FormEvent, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, LockKeyhole, Mail } from 'lucide-react'
import { Logo } from '@/components/logo'
import {
  formatAppError,
  hasAdminAccess,
  type AppAccess,
} from '@/lib/app-access'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (loading) return

    setLoading(true)
    setError('')

    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') ?? '').trim()
    const password = String(form.get('password') ?? '')

    const supabase = createClient()
    let authenticated = false

    try {
      const { data, error: authError } =
        await supabase.auth.signInWithPassword({
          email,
          password,
        })

      if (authError) throw authError

      if (!data.user) {
        throw new Error('تعذر التحقق من بيانات الحساب.')
      }

      authenticated = true

      if (data.user.user_metadata?.must_change_password) {
        router.replace('/change-password')
        router.refresh()
        return
      }

      const { data: accessData, error: accessError } =
        await supabase.rpc('app_current_access')

      if (accessError) {
        const missingFunction =
          accessError.code === 'PGRST202' ||
          accessError.message?.includes(
            'Could not find the function public.app_current_access',
          )

        if (missingFunction) {
          throw new Error(
            'تم التحقق من كلمة المرور، لكن إعداد الصلاحيات غير مكتمل في قاعدة البيانات. الدالة app_current_access() غير موجودة أو غير ظاهرة في Supabase Schema Cache. يلزم إصلاح قاعدة البيانات قبل الدخول.',
          )
        }

        throw accessError
      }

      if (!accessData) {
        throw new Error(
          'هذا الحساب غير مرتبط بملف موظف أو لا يملك صلاحيات دخول. راجع مسؤول النظام.',
        )
      }

      const access = accessData as AppAccess
      if (!access.is_platform_admin && (!access.company_id || !access.employee_id)) {
        const { data: invitations, error: invitationsError } = await supabase.rpc(
          'app_my_pending_employee_invitations',
        )
        if (!invitationsError && Array.isArray(invitations) && invitations.length > 0) {
          router.replace('/accept-invitation')
          router.refresh()
          return
        }
        throw new Error(
          'هذا الحساب غير مرتبط بعضوية شركة وملف موظف نشط. راجع مسؤول الشركة.',
        )
      }

      router.replace(
        access.is_platform_admin
          ? '/platform'
          : hasAdminAccess(access) ? '/dashboard' : '/portal',
      )
      router.refresh()
    } catch (caught) {
      if (authenticated) {
        // Do not leave an authenticated session active when
        // the application's authorization check has failed.
        await supabase.auth.signOut()
      }

      const message = formatAppError(
        caught,
        'تعذر تسجيل الدخول. حاول مرة أخرى.',
      )

      setError(
        message === 'Invalid login credentials'
          ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة.'
          : message,
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <Logo light />

        <div className="auth-heading">
          <span className="eyebrow">مرحبًا بعودتك</span>
          <h1>تسجيل الدخول</h1>
          <p>
            يدخل كل موظف بحسابه لعرض شيفتاته وحضوره،
            وتظهر الإدارة حسب الصلاحيات.
          </p>
        </div>

        <form className="form-stack" onSubmit={submit}>
          <label>
            البريد الإلكتروني
            <div className="input-wrap">
              <Mail size={18} />
              <input
                required
                type="email"
                name="email"
                autoComplete="username"
                placeholder="name@company.com"
              />
            </div>
          </label>

          <label>
            كلمة المرور
            <div className="input-wrap">
              <LockKeyhole size={18} />
              <input
                required
                minLength={8}
                type={showPassword ? 'text' : 'password'}
                name="password"
                autoComplete="current-password"
                placeholder="••••••••"
              />

              <button
                type="button"
                className="icon-button"
                onClick={() => setShowPassword(value => !value)}
                aria-label={
                  showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'
                }
              >
                {showPassword
                  ? <EyeOff size={18} />
                  : <Eye size={18} />}
              </button>
            </div>
          </label>

          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}

          <button
            className="button button-primary button-full"
            disabled={loading}
            type="submit"
          >
            {loading ? 'جارٍ التحقق من الحساب والصلاحيات...' : 'تسجيل الدخول'}
          </button>
        </form>

        <p className="auth-foot">
          إعداد أول شركة فقط:{' '}
          <Link href="/setup">إعداد الشركة</Link>
        </p>
      </section>

      <aside className="auth-art">
        <div className="auth-art-content">
          <span>Emora</span>
          <h2>إدارة الموارد البشرية، بوضوح أكبر.</h2>
          <p>
            مساحة عمل واحدة للموظفين والحضور والطلبات والتقارير، مع وصول يحدده دور كل مستخدم.
          </p>
        </div>
      </aside>
    </main>
  )
}
