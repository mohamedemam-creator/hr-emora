'use client'

import {
  FormEvent,
  useEffect,
  useState } from 'react'
import { Skeleton } from '@/components/skeleton'
import { useRouter } from 'next/navigation'
import { Building2,
  CheckCircle2,
  LockKeyhole,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { hasAdminAccess, type AppAccess } from '@/lib/app-access'
import { Logo } from '@/components/logo'

type PendingInvitation = {
  employee_id: string
  company_id: string
  company_name: string
  employee_name: string
  role_names: string
}

export default function AcceptInvitationPage() {
  const router = useRouter()
  const [invitations, setInvitations] = useState<PendingInvitation[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [password, setPassword] = useState('')
  const [needsPassword, setNeedsPassword] = useState(false)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void (async () => {
      const supabase = createClient()
      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user) {
        router.replace('/login')
        return
      }
      setNeedsPassword(userData.user.user_metadata?.emora_pending_employee_invitation === true)
      const { data, error: pendingError } = await supabase.rpc('app_my_pending_employee_invitations')
      if (pendingError) setError('تعذر تحميل الدعوات. حاول تسجيل الدخول مجدداً أو تواصل مع مسؤول الشركة.')
      else {
        const rows = (data ?? []) as PendingInvitation[]
        setInvitations(rows)
        if (rows.length) setSelectedId(rows[0].employee_id)
        else setError('لا توجد دعوة صالحة لهذا الحساب أو أن البريد لم يتم تأكيده بعد.')
      }
      setLoading(false)
    })()
  }, [router])

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedId) return
    setWorking(true)
    setError('')
    try {
      const supabase = createClient()
      if (needsPassword) {
        if (password.length < 8) throw new Error('كلمة المرور يجب ألا تقل عن 8 أحرف.')
        const { data: current } = await supabase.auth.getUser()
        const metadata = current.user?.user_metadata ?? {}
        const { error: passwordError } = await supabase.auth.updateUser({
          password,
          data: { ...metadata, emora_pending_employee_invitation: false },
        })
        if (passwordError) throw passwordError
      }
      const { error: acceptError } = await supabase.rpc('app_accept_employee_invitation', {
        p_employee_id: selectedId,
      })
      if (acceptError) throw acceptError
      const invitation = invitations.find(item => item.employee_id === selectedId)
      if (invitation) {
        const { error: selectError } = await supabase.rpc('app_select_company', {
          p_company_id: invitation.company_id,
        })
        if (selectError) throw selectError
      }
      const { data: accessData, error: accessError } = await supabase.rpc('app_current_access')
      if (accessError) throw accessError
      const access = accessData as AppAccess
      router.replace(access.is_platform_admin ? '/platform' : hasAdminAccess(access) ? '/dashboard' : '/portal')
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'تعذر قبول الدعوة.')
    } finally {
      setWorking(false)
    }
  }

  return <main className="auth-page">
    <section className="auth-panel">
      <Logo />
      <div className="auth-heading">
        <span className="eyebrow">دعوة عضوية شركة</span>
        <h1>تأكيد حساب الموظف</h1>
        <p>تأكد من اسم الشركة قبل ربط حسابك بعضوية الموظف.</p>
      </div>
      {loading ? <div className="empty-state"><Skeleton /><strong>جارٍ تحميل الدعوات...</strong></div> :
        <form className="form-stack" onSubmit={accept}>
          {invitations.map(invitation => <label className="invitation-choice" key={invitation.employee_id}>
            <input type="radio" name="invitation" value={invitation.employee_id} checked={selectedId===invitation.employee_id} onChange={() => setSelectedId(invitation.employee_id)} />
            <Building2 size={18}/><span><strong>{invitation.company_name}</strong><small>{invitation.employee_name}{invitation.role_names ? ` • ${invitation.role_names}` : ''}</small></span>
          </label>)}
          {needsPassword && <label>كلمة مرور جديدة<div className="input-wrap"><LockKeyhole size={18}/><input type="password" minLength={8} required value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password"/></div></label>}
          {error && <div className="form-error">{error}</div>}
          {invitations.length > 0 && <button className="button button-primary button-full" disabled={working || !selectedId}>
            {working ? <Skeleton size={18} /> : <CheckCircle2 size={18}/>} قبول الدعوة والدخول
          </button>}
        </form>}
    </section>
  </main>
}
