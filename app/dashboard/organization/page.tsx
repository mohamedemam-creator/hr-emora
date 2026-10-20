'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { BriefcaseBusiness, CheckCircle2, Edit3, Loader2, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type Department = { id: string; name: string; code: string; is_active: boolean; job_count: number }
type JobTitle = { id: string; department_id: string | null; department_name: string | null; name: string; code: string; is_active: boolean; default_role_id: string | null; default_role_name: string | null; employee_count: number }
type Role = { id: string; name: string; code: string }

type FormState = {
  id: string | null
  name: string
  code: string
  isActive: boolean
  departmentId: string
  defaultRoleId: string
}

const emptyForm: FormState = { id: null, name: '', code: '', isActive: true, departmentId: '', defaultRoleId: '' }

function humanError(message: string) {
  if (message.includes('23505') || message.toLowerCase().includes('duplicate')) return 'الكود مستخدم بالفعل.'
  if (message.includes('42501') || message.toLowerCase().includes('permission')) return 'ليس لديك صلاحية تنفيذ هذه العملية.'
  return message
}

export default function OrganizationPage() {
  const [tab, setTab] = useState<'departments' | 'jobs'>('departments')
  const [departments, setDepartments] = useState<Department[]>([])
  const [jobs, setJobs] = useState<JobTitle[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [form, setForm] = useState<FormState>(emptyForm)
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
    const [departmentsResult, jobsResult, rolesResult] = await Promise.all([
      supabase.rpc('app_list_departments'),
      supabase.rpc('app_list_job_titles'),
      supabase.rpc('app_list_roles'),
    ])
    if (departmentsResult.error) setError(humanError(departmentsResult.error.message))
    else setDepartments((departmentsResult.data ?? []) as Department[])
    if (!jobsResult.error) setJobs((jobsResult.data ?? []) as JobTitle[])
    if (!rolesResult.error) setRoles(((rolesResult.data ?? []) as Role[]))
    setLoading(false)
  }

  useEffect(() => { void loadData() }, [])

  const filteredDepartments = useMemo(() => {
    const text = query.trim().toLowerCase()
    return departments.filter(item => !text || item.name.toLowerCase().includes(text) || item.code.toLowerCase().includes(text))
  }, [departments, query])

  const filteredJobs = useMemo(() => {
    const text = query.trim().toLowerCase()
    return jobs.filter(item => !text || [item.name, item.code, item.department_name ?? '', item.default_role_name ?? ''].some(value => value.toLowerCase().includes(text)))
  }, [jobs, query])

  function openCreate() { setForm(emptyForm); setView('form'); setError(''); setSuccess('') }
  function closeForm() { setForm(emptyForm); setView('list'); setError(''); setSuccess('') }
  function openDepartment(item: Department) { setTab('departments'); setForm({ ...emptyForm, id: item.id, name: item.name, code: item.code, isActive: item.is_active }); setView('form') }
  function openJob(item: JobTitle) { setTab('jobs'); setForm({ id: item.id, name: item.name, code: item.code, isActive: item.is_active, departmentId: item.department_id ?? '', defaultRoleId: item.default_role_id ?? '' }); setView('form') }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    const supabase = createClient()
    const result = tab === 'departments'
      ? await supabase.rpc('app_save_department', { p_id: form.id, p_name: form.name.trim(), p_code: form.code.trim().toUpperCase(), p_is_active: form.isActive })
      : await supabase.rpc('app_save_job_title', { p_id: form.id, p_department_id: form.departmentId || null, p_name: form.name.trim(), p_code: form.code.trim().toUpperCase(), p_is_active: form.isActive, p_default_role_id: form.defaultRoleId || null })

    if (result.error) setError(humanError(result.error.message))
    else {
      setSuccess(tab === 'departments' ? 'تم حفظ القسم بنجاح.' : 'تم حفظ المسمى الوظيفي بنجاح.')
      await loadData()
      setTimeout(closeForm, 650)
    }
    setSaving(false)
  }

  async function deleteItem(id: string, name: string) {
    if (!window.confirm(`حذف «${name}»؟`)) return
    setWorkingId(id)
    const supabase = createClient()
    const result = tab === 'departments'
      ? await supabase.rpc('app_delete_department', { p_id: id })
      : await supabase.rpc('app_delete_job_title', { p_id: id })
    if (result.error) setError(humanError(result.error.message))
    else await loadData()
    setWorkingId('')
  }

  if (view === 'form') {
    return (
      <main className="dashboard-content">
        <section className="page-heading management-heading"><div><span className="eyebrow">الهيكل الوظيفي</span><h1>{form.id ? 'تعديل' : 'إضافة'} {tab === 'departments' ? 'قسم' : 'مسمى وظيفي'}</h1><p>عرّف الأقسام والمسميات واربط كل وظيفة بدور افتراضي وصلاحياته.</p></div><button className="button button-ghost" onClick={closeForm}><X size={18}/> رجوع</button></section>
        <form className="panel employee-form" onSubmit={submit}>
          <div className="two-columns">
            <label>الاسم<input required value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} placeholder={tab === 'departments' ? 'مثال: المبيعات' : 'مثال: مدير فرع'} /></label>
            <label>الكود<input required value={form.code} onChange={event => setForm(current => ({ ...current, code: event.target.value }))} placeholder={tab === 'departments' ? 'SALES' : 'BRANCH_MANAGER'} /></label>
            {tab === 'jobs' && <>
              <label>القسم<select required value={form.departmentId} onChange={event => setForm(current => ({ ...current, departmentId: event.target.value }))}><option value="">اختر القسم</option>{departments.filter(item => item.is_active).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <label>الدور الافتراضي<select value={form.defaultRoleId} onChange={event => setForm(current => ({ ...current, defaultRoleId: event.target.value }))}><option value="">بدون دور افتراضي</option>{roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
            </>}
            <label className="toggle-field full-column"><input type="checkbox" checked={form.isActive} onChange={event => setForm(current => ({ ...current, isActive: event.target.checked }))}/><span>نشط</span></label>
          </div>
          {tab === 'jobs' && <div className="form-note">عند إضافة موظف على هذه الوظيفة، يمكن للنظام إسناد الدور الافتراضي له تلقائيًا إذا لم تختَر دورًا آخر.</div>}
          {error && <div className="form-error">{error}</div>}
          {success && <div className="form-success"><CheckCircle2 size={18}/>{success}</div>}
          <button className="button button-primary button-full" disabled={saving}>{saving ? <Loader2 className="spin" size={18}/> : <BriefcaseBusiness size={18}/>} {saving ? 'جارٍ الحفظ...' : 'حفظ'}</button>
        </form>
      </main>
    )
  }

  return (
    <main className="dashboard-content">
      <section className="page-heading management-heading"><div><span className="eyebrow">الكادر الوظيفي</span><h1>الهيكل الوظيفي</h1><p>الأقسام والمسميات الوظيفية الفعلية داخل الشركة.</p></div><div className="page-actions"><button className="button button-primary" onClick={openCreate}><Plus size={18}/> إضافة {tab === 'departments' ? 'قسم' : 'وظيفة'}</button></div></section>
      <div className="management-tabs"><button className={tab === 'departments' ? 'active' : ''} onClick={() => { setTab('departments'); setQuery('') }}>الأقسام</button><button className={tab === 'jobs' ? 'active' : ''} onClick={() => { setTab('jobs'); setQuery('') }}>المسميات الوظيفية</button></div>
      {error && <div className="form-error management-message">{error}</div>}
      <section className="panel management-toolbar"><div className="table-search"><input value={query} onChange={event => setQuery(event.target.value)} placeholder="بحث..." /></div><button className="button button-ghost" onClick={() => void loadData()}><RefreshCw size={18}/> تحديث</button></section>
      <section className="panel data-table-panel">
        {loading ? <div className="empty-state"><Loader2 className="spin"/><strong>جارٍ تحميل البيانات...</strong></div> : tab === 'departments' ? (
          filteredDepartments.length === 0 ? <div className="empty-state"><BriefcaseBusiness/><strong>لا توجد أقسام</strong><button className="button button-primary" onClick={openCreate}><Plus size={18}/> إضافة قسم</button></div> : <div className="responsive-table"><table className="data-table"><thead><tr><th>القسم</th><th>عدد الوظائف</th><th>الحالة</th><th>الإجراءات</th></tr></thead><tbody>{filteredDepartments.map(item => <tr key={item.id}><td><div className="primary-cell"><strong>{item.name}</strong><span>{item.code}</span></div></td><td>{item.job_count}</td><td><span className={`status-badge ${item.is_active ? 'active' : 'inactive'}`}>{item.is_active ? 'نشط' : 'غير نشط'}</span></td><td><div className="row-actions"><button onClick={() => openDepartment(item)}><Edit3 size={17}/></button><button className="danger" disabled={workingId === item.id} onClick={() => void deleteItem(item.id, item.name)}>{workingId === item.id ? <Loader2 className="spin" size={16}/> : <Trash2 size={17}/>}</button></div></td></tr>)}</tbody></table></div>
        ) : (
          filteredJobs.length === 0 ? <div className="empty-state"><BriefcaseBusiness/><strong>لا توجد مسميات وظيفية</strong><button className="button button-primary" onClick={openCreate}><Plus size={18}/> إضافة وظيفة</button></div> : <div className="responsive-table"><table className="data-table"><thead><tr><th>المسمى الوظيفي</th><th>القسم</th><th>الدور الافتراضي</th><th>الموظفون</th><th>الحالة</th><th>الإجراءات</th></tr></thead><tbody>{filteredJobs.map(item => <tr key={item.id}><td><div className="primary-cell"><strong>{item.name}</strong><span>{item.code}</span></div></td><td>{item.department_name ?? 'بدون قسم'}</td><td>{item.default_role_name ?? 'غير محدد'}</td><td>{item.employee_count}</td><td><span className={`status-badge ${item.is_active ? 'active' : 'inactive'}`}>{item.is_active ? 'نشط' : 'غير نشط'}</span></td><td><div className="row-actions"><button onClick={() => openJob(item)}><Edit3 size={17}/></button><button className="danger" disabled={workingId === item.id} onClick={() => void deleteItem(item.id, item.name)}>{workingId === item.id ? <Loader2 className="spin" size={16}/> : <Trash2 size={17}/>}</button></div></td></tr>)}</tbody></table></div>
        )}
      </section>
    </main>
  )
}
