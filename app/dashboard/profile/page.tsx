'use client'

import {
  FormEvent,
  useEffect,
  useState } from 'react'
import { Skeleton } from '@/components/skeleton'
import { CheckCircle2,
  KeyRound,
  LogOut,
  UserRound,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { getPersonalProfile, type PersonalProfile } from './actions'
import { createClient } from '@/lib/supabase/client'

export default function ProfilePage() {
  const router = useRouter()
  const [profile, setProfile] = useState<PersonalProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [signingOut, setSigningOut] = useState(false)
  const [passwordFormOpen, setPasswordFormOpen] = useState(false)

  useEffect(() => {
    let active = true
    void getPersonalProfile()
      .then(result => { if (active) setProfile(result) })
      .catch(caught => { if (active) setError(caught instanceof Error ? caught.message : 'تعذر تحميل الملف الشخصي.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSuccess('')
    if (password.length < 8 || password.length > 128) {
      setError('يجب أن تتكون كلمة المرور من 8 إلى 128 حرفًا.')
      return
    }
    if (password !== confirmation) {
      setError('تأكيد كلمة المرور غير مطابق.')
      return
    }

    setSaving(true)
    const supabase = createClient()
    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) setError('تعذر تغيير كلمة المرور. أعد تسجيل الدخول ثم حاول مرة أخرى.')
    else {
      setPassword('')
      setConfirmation('')
      setSuccess('تم تغيير كلمة المرور بنجاح.')
    }
    setSaving(false)
  }

  async function signOut() {
    setError('')
    setSigningOut(true)
    const supabase = createClient()
    const { error: signOutError } = await supabase.auth.signOut()
    if (signOutError) {
      setError('تعذر تسجيل الخروج. حاول مرة أخرى.')
      setSigningOut(false)
      return
    }
    router.replace('/login')
    router.refresh()
  }

  return (
    <main className="dashboard-content">
      <section className="page-heading management-heading">
        <div>
          <span className="eyebrow">الحساب الشخصي</span>
          <h1>ملفي الشخصي</h1>
          <p>بيانات حسابك الشخصية وإعدادات الوصول.</p>
        </div>
        <button type="button" className="button button-ghost" onClick={() => void signOut()} disabled={signingOut}>
          {signingOut ? <Skeleton size={18} /> : <LogOut size={18}/>}
          {signingOut ? 'جارٍ تسجيل الخروج...' : 'تسجيل خروج'}
        </button>
      </section>

      {error && <div className="form-error management-message" role="alert">{error}</div>}
      {success && <div className="form-success management-message" role="status"><CheckCircle2 size={18}/>{success}</div>}

      {loading ? (
        <div className="empty-state"><Skeleton /><strong>جارٍ تحميل بياناتك...</strong></div>
      ) : profile ? (
        <div className="profile-settings-grid">
          <section className="panel">
            <div className="panel-heading">
              <div><h2>المعلومات الشخصية</h2><p>بيانات حسابك المرتبطة بهويتك الحالية.</p></div>
              <UserRound size={22}/>
            </div>
            <dl className="profile-details">
              <div><dt>الاسم</dt><dd>{profile.fullName || 'غير مسجل'}</dd></div>
              <div><dt>البريد الإلكتروني</dt><dd dir="ltr">{profile.email || 'غير مسجل'}</dd></div>
              <div><dt>رقم الهاتف</dt><dd dir="ltr">{profile.phone || 'غير مسجل'}</dd></div>
            </dl>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div><h2>إعدادات كلمة المرور</h2><p>افتح هذا القسم عند رغبتك في تغيير كلمة المرور.</p></div>
            </div>
            <button
              type="button"
              className={`profile-password-toggle${passwordFormOpen ? ' is-active' : ''}`}
              aria-expanded={passwordFormOpen}
              aria-controls="profile-password-form-panel"
              onClick={() => setPasswordFormOpen(open => !open)}
            >
              <KeyRound size={18}/>
              {passwordFormOpen ? 'إغلاق تغيير كلمة المرور' : 'تغيير كلمة المرور'}
            </button>
            <div
              id="profile-password-form-panel"
              className={`profile-password-panel${passwordFormOpen ? ' is-open' : ''}`}
              aria-hidden={!passwordFormOpen}
              inert={!passwordFormOpen}
            >
              <div className="profile-password-panel-inner">
                <form className="profile-password-form" onSubmit={changePassword}>
                  <label>كلمة المرور الجديدة<input type="password" required minLength={8} maxLength={128} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)}/></label>
                  <label>تأكيد كلمة المرور<input type="password" required minLength={8} maxLength={128} autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)}/></label>
                  <button className="button button-primary" disabled={saving}>
                    {saving ? <Skeleton size={18} /> : <KeyRound size={18}/>}
                    {saving ? 'جارٍ التحديث...' : 'حفظ كلمة المرور الجديدة'}
                  </button>
                </form>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  )
}
