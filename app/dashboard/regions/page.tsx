'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Edit3, Loader2, MapPinned, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type Region = {
  id: string
  name: string
  code: string
  is_active: boolean
  manager_employee_id: string | null
  manager_name: string | null
  branch_count: number
  employee_count: number
  created_at: string
}

type Manager = {
  id: string
  employee_code: string
  full_name: string
  job_title_name: string | null
  is_assigned: boolean
}

type RegionForm = {
  id: string | null
  name: string
  code: string
  managerId: string
  isActive: boolean
}

const emptyForm: RegionForm = { id: null, name: '', code: '', managerId: '', isActive: true }

function humanError(message: string) {
  if (message.includes('23505') || message.toLowerCase().includes('duplicate')) return 'كود المنطقة مستخدم بالفعل.'
  if (message.includes('42501') || message.toLowerCase().includes('permission')) return 'ليس لديك صلاحية تنفيذ هذه العملية.'
  return message
}

export default function RegionsPage() {
  const [regions, setRegions] = useState<Region[]>([])
  const [managers, setManagers] = useState<Manager[]>([])
  const [form, setForm] = useState<RegionForm>(emptyForm)
  const [view, setView] = useState<'list' | 'form'>('list')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [workingId, setWorkingId] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function loadData() {
    setLoading(true)
    setError('')
    const supabase = createClient()
    const [regionsResult, managersResult] = await Promise.all([
      supabase.rpc('app_list_regions'),
      supabase.rpc('app_list_region_manager_candidates'),
    ])

    if (regionsResult.error) setError(humanError(regionsResult.error.message))
    else setRegions((regionsResult.data ?? []) as Region[])

    if (!managersResult.error) setManagers((managersResult.data ?? []) as Manager[])
    setLoading(false)
  }

  useEffect(() => { void loadData() }, [])

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase()
    return regions.filter(region => !text || [region.name, region.code, region.manager_name ?? '']
      .some(value => value.toLowerCase().includes(text)))
  }, [regions, query])

  function openCreate() {
    setForm(emptyForm)
    setError('')
    setSuccess('')
    setView('form')
  }

  function openEdit(region: Region) {
    setForm({
      id: region.id,
      name: region.name,
      code: region.code,
      managerId: region.manager_employee_id ?? '',
      isActive: region.is_active,
    })
    setError('')
    setSuccess('')
    setView('form')
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    const supabase = createClient()
    const { error: rpcError } = await supabase.rpc('app_save_region', {
      p_region_id: form.id,
      p_name: form.name.trim(),
      p_code: form.code.trim().toUpperCase(),
      p_is_active: form.isActive,
      p_manager_employee_id: form.managerId || null,
    })

    if (rpcError) setError(humanError(rpcError.message))
    else {
      setSuccess(form.id ? 'تم تحديث المنطقة ومديرها بنجاح.' : 'تم إنشاء المنطقة بنجاح.')
      await loadData()
      setTimeout(() => { setView('list'); setForm(emptyForm); setSuccess('') }, 650)
    }
    setSaving(false)
  }

  async function deleteRegion(region: Region) {
    if (!window.confirm(`حذف منطقة «${region.name}»؟\nإذا كانت مرتبطة بفروع سيرفض النظام الحذف.`)) return
    setWorkingId(region.id)
    const supabase = createClient()
    const { error: rpcError } = await supabase.rpc('app_delete_region', { p_region_id: region.id })
    if (rpcError) setError(humanError(rpcError.message))
    else await loadData()
    setWorkingId('')
  }

  if (view === 'form') {
    return (
      <main className="dashboard-content">
        <section className="page-heading management-heading">
          <div><span className="eyebrow">إدارة المناطق</span><h1>{form.id ? 'تعديل المنطقة' : 'إضافة منطقة'}</h1><p>المنطقة تجمع عددًا من الفروع ويشاهد مديرها فروعه وموظفيه فقط.</p></div>
          <button className="button button-ghost" type="button" onClick={() => setView('list')}><X size={18}/> رجوع</button>
        </section>

        <form className="panel employee-form" onSubmit={submit}>
          <div className="two-columns">
            <label>اسم المنطقة<input required value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} placeholder="مثال: الجيزة" /></label>
            <label>كود المنطقة<input required value={form.code} onChange={event => setForm(current => ({ ...current, code: event.target.value }))} placeholder="GIZ" /></label>
            <label className="full-column">مدير المنطقة
              <select value={form.managerId} onChange={event => setForm(current => ({ ...current, managerId: event.target.value }))}>
                <option value="">بدون مدير حاليًا</option>
                {managers.map(manager => <option value={manager.id} key={manager.id}>{manager.full_name} — {manager.employee_code}{manager.job_title_name ? ` — ${manager.job_title_name}` : ''}</option>)}
              </select>
            </label>
            <label className="toggle-field full-column"><input type="checkbox" checked={form.isActive} onChange={event => setForm(current => ({ ...current, isActive: event.target.checked }))}/><span>المنطقة نشطة</span></label>
          </div>
          <div className="form-note">مدير المنطقة لن يرى أي فرع تابع لمنطقة أخرى. يجب بعد ذلك ربط كل فرع بمنطقته وربط الموظفين بالفروع.</div>
          {error && <div className="form-error">{error}</div>}
          {success && <div className="form-success"><CheckCircle2 size={18}/>{success}</div>}
          <button className="button button-primary button-full" disabled={saving}>{saving ? <Loader2 className="spin" size={18}/> : <MapPinned size={18}/>} {saving ? 'جارٍ الحفظ...' : 'حفظ المنطقة'}</button>
        </form>
      </main>
    )
  }

  return (
    <main className="dashboard-content">
      <section className="page-heading management-heading">
        <div><span className="eyebrow">نطاقات الإدارة</span><h1>المناطق</h1><p>{regions.length} منطقة مسجلة. كل مدير منطقة يرى المناطق المسندة إليه فقط.</p></div>
        <div className="page-actions"><button className="button button-primary" onClick={openCreate}><Plus size={18}/> إضافة منطقة</button></div>
      </section>

      {error && <div className="form-error management-message">{error}</div>}
      <section className="panel management-toolbar">
        <div className="table-search"><input value={query} onChange={event => setQuery(event.target.value)} placeholder="ابحث باسم المنطقة أو المدير..." /></div>
        <button className="button button-ghost" onClick={() => void loadData()}><RefreshCw size={18}/> تحديث</button>
      </section>

      <section className="panel data-table-panel">
        {loading ? <div className="empty-state"><Loader2 className="spin"/><strong>جارٍ تحميل المناطق...</strong></div> : filtered.length === 0 ? <div className="empty-state"><MapPinned/><strong>لا توجد مناطق</strong><span>ابدأ بإضافة أول منطقة وتعيين مديرها.</span><button className="button button-primary" onClick={openCreate}><Plus size={18}/> إضافة منطقة</button></div> : (
          <div className="responsive-table"><table className="data-table"><thead><tr><th>المنطقة</th><th>مدير المنطقة</th><th>الفروع</th><th>الموظفون</th><th>الحالة</th><th>الإجراءات</th></tr></thead><tbody>
            {filtered.map(region => <tr key={region.id}><td><div className="primary-cell"><strong>{region.name}</strong><span>{region.code}</span></div></td><td>{region.manager_name ?? 'لم يتم التعيين'}</td><td>{region.branch_count}</td><td>{region.employee_count}</td><td><span className={`status-badge ${region.is_active ? 'active' : 'inactive'}`}>{region.is_active ? 'نشطة' : 'غير نشطة'}</span></td><td><div className="row-actions"><button title="تعديل" onClick={() => openEdit(region)}><Edit3 size={17}/></button><button className="danger" title="حذف" disabled={workingId === region.id} onClick={() => void deleteRegion(region)}>{workingId === region.id ? <Loader2 className="spin" size={16}/> : <Trash2 size={17}/>}</button></div></td></tr>)}
          </tbody></table></div>
        )}
      </section>
    </main>
  )
}
