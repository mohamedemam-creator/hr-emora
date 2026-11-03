'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, Loader2, ShieldCheck } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { AppAccess } from '@/lib/app-access'
import { Logo } from '@/components/logo'

type Company = {
  id: string
  name: string
  code: string
  status: 'active' | 'suspended' | 'closed'
  timezone: string
  created_at: string
}

export default function PlatformPage() {
  const router = useRouter()
  const [companies, setCompanies] = useState<Company[]>([])
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [workingId, setWorkingId] = useState('')
  const [error, setError] = useState('')

  async function load() {
    const supabase = createClient()
    const { data: access, error: accessError } = await supabase.rpc('app_current_access')
    if (accessError || !(access as AppAccess | null)?.is_platform_admin) {
      router.replace('/login')
      return
    }
    setSelectedCompanyId(access?.platform_context?.selected_company_id ?? null)
    const { data, error: listError } = await supabase.rpc('app_platform_list_companies')
    if (listError) setError(listError.message)
    else setCompanies((data ?? []) as Company[])
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  async function selectCompany(companyId: string) {
    setWorkingId(companyId)
    setError('')
    const supabase = createClient()
    const { error: selectError } = await supabase.rpc('app_platform_select_company', {
      p_company_id: companyId,
    })
    if (selectError) setError(selectError.message)
    else setSelectedCompanyId(companyId)
    setWorkingId('')
  }

  async function toggleCompany(company: Company) {
    setWorkingId(company.id)
    setError('')
    const nextStatus = company.status === 'active' ? 'suspended' : 'active'
    const supabase = createClient()
    const { data, error: updateError } = await supabase.rpc('app_platform_update_company', {
      p_company_id: company.id,
      p_name: company.name,
      p_status: nextStatus,
      p_timezone: company.timezone,
    })
    if (updateError) setError(updateError.message)
    else setCompanies(current => current.map(row => row.id === company.id ? data as Company : row))
    setWorkingId('')
  }

  return <main className="platform-page">
    <header className="platform-header"><Logo/><span><ShieldCheck size={18}/> إدارة منصة Emora</span></header>
    <section className="platform-content">
      <div className="auth-heading"><span className="eyebrow">PLATFORM_SUPER_ADMIN</span><h1>الشركات</h1><p>هوية المنصة مستقلة عن عضويات وأدوار الشركات.</p></div>
      {error && <div className="form-error" role="alert">{error}</div>}
      {loading ? <div className="empty-state"><Loader2 className="spin"/><strong>جارٍ تحميل الشركات...</strong></div> :
        companies.length === 0 ? <div className="empty-state"><Building2/><strong>لا توجد شركات بعد</strong></div> :
          <div className="responsive-table"><table className="data-table"><thead><tr><th>الشركة</th><th>الكود</th><th>المنطقة الزمنية</th><th>الحالة</th><th>سياق المنصة</th><th>الإجراء</th></tr></thead><tbody>
            {companies.map(company => <tr key={company.id}>
              <td>{company.name}</td><td>{company.code}</td><td>{company.timezone}</td><td>{company.status}</td>
              <td>{selectedCompanyId === company.id ? 'محدد' : '—'}</td>
              <td><div className="row-actions">
                <button disabled={Boolean(workingId)} onClick={() => void selectCompany(company.id)}>{workingId === company.id ? <Loader2 className="spin" size={16}/> : 'اختيار'}</button>
                {company.status !== 'closed' && <button disabled={Boolean(workingId)} onClick={() => void toggleCompany(company)}>{company.status === 'active' ? 'تعليق' : 'تفعيل'}</button>}
              </div></td>
            </tr>)}
          </tbody></table></div>}
    </section>
  </main>
}
