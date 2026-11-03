'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, KeyRound, Loader2 } from 'lucide-react'
import { Logo } from '@/components/logo'
import { createClient } from '@/lib/supabase/client'
import { hasAdminAccess, type AppAccess } from '@/lib/app-access'

export default function ChangePasswordPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const password = String(form.get('password'))
    const confirmPassword = String(form.get('confirmPassword'))

    if (password.length < 8) return setError('كلمة المرور يجب ألا تقل عن 8 أحرف.')
    if (password !== confirmPassword) return setError('تأكيد كلمة المرور غير مطابق.')

    setLoading(true)
    setError('')
    try {
      const supabase = createClient()
      const { data: current } = await supabase.auth.getUser()
      const metadata = current.user?.user_metadata ?? {}
      const { error: updateError } = await supabase.auth.updateUser({
        password,
        data: { ...metadata, must_change_password: false },
      })
      if (updateError) throw updateError
      await supabase.rpc('app_clear_password_change_flag')
      setSuccess('تم تغيير كلمة المرور بنجاح.')
      const { data: accessData } = await supabase.rpc('app_current_access')
      const access = accessData as AppAccess | null
      setTimeout(() => router.replace(access?.is_platform_admin ? '/platform' : hasAdminAccess(access) ? '/dashboard' : '/portal'), 500)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'تعذر تغيير كلمة المرور.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="password-page">
      <section className="password-card">
        <Logo />
        <div className="module-placeholder-icon"><KeyRound size={34}/></div>
        <h1>تغيير كلمة المرور</h1>
        <p>هذه أول مرة تدخل فيها إلى Emora. اختر كلمة مرور جديدة خاصة بك.</p>
        <form className="form-stack" onSubmit={submit}>
          <label>كلمة المرور الجديدة<input name="password" type="password" required minLength={8}/></label>
          <label>تأكيد كلمة المرور<input name="confirmPassword" type="password" required minLength={8}/></label>
          {error && <div className="form-error">{error}</div>}
          {success && <div className="form-success"><CheckCircle2 size={18}/>{success}</div>}
          <button className="button button-primary button-full" disabled={loading}>
            {loading ? <Loader2 className="spin" size={18}/> : <KeyRound size={18}/>}
            {loading ? 'جارٍ الحفظ...' : 'حفظ كلمة المرور'}
          </button>
        </form>
      </section>
    </main>
  )
}
