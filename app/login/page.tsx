'use client'

import { FormEvent, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, LockKeyhole, Mail } from 'lucide-react'
import { Logo } from '@/components/logo'
import { createClient } from '@/lib/supabase/client'

type Access = { permissions?: string[]; role?: string }

export default function LoginPage() {
  const router = Router()
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError('')
    const form = new FormData(event.currentTarget)

    try {
      const supabase = createClient()
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: String(form.get('email')),
        password: String(form.get('password')),
      })
      if (authError) throw authError

      if (data.user?.user_metadata?.must_change_password) {
        router.push('/change-password')
        router.refresh()
        return
      }

      // جلب صلاحيات وأدوار المستخدم الحالية
      const { data: accessData, error: accessError } = await supabase.rpc('app_current_access')
      
      let hasAdminAccess = false

      if (!accessError && accessData) {
        const access = accessData as Access
        const permissions = access.permissions ?? []
        
        // التحقق مما إذا كان لديه صلاحيات إدارية أو دور مدير/مالك
        const isOwnerOrAdmin = ['owner', 'admin', 'manager'].includes(access.role || '')
        const hasExtraPermissions = permissions.some(code =>
          !['shifts.view_own', 'attendance.view_own'].includes(code)
        )

        hasAdminAccess = isOwnerOrAdmin || hasExtraPermissions
      } else {
        // Fallback في حالة عدم جلب الـ RPC بوضوح (نعتمد على الميتاداتا أو الدخول العام)
        const userRole = data.user?.user_metadata?.role
        hasAdminAccess = ['owner', 'admin', 'manager'].includes(userRole)
      }

      router.push(hasAdminAccess ? '/dashboard' : '/portal')
      router.refresh()
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'تعذر تسجيل الدخول'
      setError(message === 'Invalid login credentials' ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة.' : message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <Logo />
        <div className="auth-heading">
          <span className="eyebrow">مرحبًا بعودتك</span>
          <h1>تسجيل الدخول</h1>
          <p>يدخل كل موظف بحسابه لعرض شيفتاته وحضوره، وتظهر الإدارة حسب الصلاحيات.</p>
        </div>
        <form className="form-stack" onSubmit={submit}>
          <label> البريد الإلكتروني <div className="input-wrap"><Mail size={18}/><input required type="email" name="email" placeholder="name@company.com" /></div></label>
          <label> كلمة المرور <div className="input-wrap"><LockKeyhole size={18}/><input required minLength={8} type={showPassword ? 'text' : 'password'} name="password" placeholder="••••••••" /><button type="button" className="icon-button" onClick={() => setShowPassword(v => !v)}>{showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div></label>
          {error && <div className="form-error">{error}</div>}
          <button className="button button-primary button-full" disabled={loading}>{loading ? 'جارٍ الدخول...' : 'تسجيل الدخول'}</button>
        </form>
        <p className="auth-foot">إعداد أول شركة فقط: <Link href="/setup">إعداد الشركة</Link></p>
      </section>
      <aside className="auth-art"><div className="auth-art-content">
        <span> Emora HR </span><h2>حساب واحد لكل موظف.</h2><p>شيفتات، حضور، تقارير وطلبات وفق صلاحيات كل مستخدم.</p></div></aside>
    </main>
  )
}