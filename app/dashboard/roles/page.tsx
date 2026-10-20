'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Edit3, Loader2, Plus, RefreshCw, ShieldCheck, Trash2, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type Role = {
  id: string
  name: string
  code: string
  description: string | null
  is_system: boolean
  is_active: boolean
  employee_count: number
  permission_codes: string[]
}

type Permission = { id: string; code: string; module: string; name: string; description: string | null }
type FormState = { id: string | null; name: string; code: string; description: string; isActive: boolean; permissionCodes: string[] }
const emptyForm: FormState = { id: null, name: '', code: '', description: '', isActive: true, permissionCodes: [] }

const moduleLabels: Record<string, string> = {
  branches: 'الفروع', regions: 'المناطق', employees: 'الموظفون', organization: 'الهيكل الوظيفي', security: 'الأمان والصلاحيات',
  shifts: 'الشيفتات', attendance: 'الحضور والانصراف', leaves: 'الإجازات', payroll: 'الرواتب',
}

function humanError(message: string) {
  if (message.includes('23505') || message.toLowerCase().includes('duplicate')) return 'كود الدور مستخدم بالفعل.'
  if (message.includes('42501') || message.toLowerCase().includes('permission')) return 'ليس لديك صلاحية تنفيذ هذه العملية.'
  return message
}

export default function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([])
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [view, setView] = useState<'list' | 'form'>('list')
  const [form, setForm] = useState<FormState>(emptyForm)
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
    const [rolesResult, permissionsResult] = await Promise.all([
      supabase.rpc('app_list_roles'),
      supabase.rpc('app_list_permissions'),
    ])
    if (rolesResult.error) setError(humanError(rolesResult.error.message))
    else setRoles((rolesResult.data ?? []) as Role[])
    if (!permissionsResult.error) setPermissions((permissionsResult.data ?? []) as Permission[])
    setLoading(false)
  }

  useEffect(() => { void loadData() }, [])

  const groupedPermissions = useMemo(() => {
    return permissions.reduce<Record<string, Permission[]>>((groups, permission) => {
      ;(groups[permission.module] ??= []).push(permission)
      return groups
    }, {})
  }, [permissions])

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase()
    return roles.filter(role => !text || [role.name, role.code, role.description ?? ''].some(value => value.toLowerCase().includes(text)))
  }, [roles, query])

  function openCreate() { setForm(emptyForm); setError(''); setSuccess(''); setView('form') }
  function openEdit(role: Role) { setForm({ id: role.id, name: role.name, code: role.code, description: role.description ?? '', isActive: role.is_active, permissionCodes: role.permission_codes ?? [] }); setError(''); setSuccess(''); setView('form') }
  function closeForm() { setForm(emptyForm); setView('list'); setError(''); setSuccess('') }

  function togglePermission(code: string) {
    setForm(current => ({
      ...current,
      permissionCodes: current.permissionCodes.includes(code)
        ? current.permissionCodes.filter(item => item !== code)
        : [...current.permissionCodes, code],
    }))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    const supabase = createClient()
    const { error: rpcError } = await supabase.rpc('app_save_role', {
      p_id: form.id,
      p_name: form.name.trim(),
      p_code: form.code.trim().toUpperCase(),
      p_description: form.description.trim(),
      p_is_active: form.isActive,
      p_permission_codes: form.permissionCodes,
    })
    if (rpcError) setError(humanError(rpcError.message))
    else {
      setSuccess('تم حفظ الدور والصلاحيات بنجاح.')
      await loadData()
      setTimeout(closeForm, 650)
    }
    setSaving(false)
  }

  async function deleteRole(role: Role) {
    if (!window.confirm(`حذف دور «${role.name}»؟`)) return
    setWorkingId(role.id)
    const supabase = createClient()
    const { error: rpcError } = await supabase.rpc('app_delete_role', { p_id: role.id })
    if (rpcError) setError(humanError(rpcError.message))
    else await loadData()
    setWorkingId('')
  }

  if (view === 'form') {
    return (
      <main className="dashboard-content">
        <section className="page-heading management-heading"><div><span className="eyebrow">الأمان</span><h1>{form.id ? 'تعديل الدور' : 'إضافة دور وصلاحيات'}</h1><p>حدد بدقة ما الذي يستطيع مستخدم هذا الدور مشاهدته أو تعديله.</p></div><button className="button button-ghost" onClick={closeForm}><X size={18}/> رجوع</button></section>
        <form className="panel role-form" onSubmit={submit}>
          <div className="two-columns">
            <label>اسم الدور<input required value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} placeholder="مثال: محاسب" /></label>
            <label>كود الدور<input required disabled={Boolean(form.id && roles.find(role => role.id === form.id)?.is_system)} value={form.code} onChange={event => setForm(current => ({ ...current, code: event.target.value }))} placeholder="ACCOUNTANT" /></label>
            <label className="full-column">الوصف<textarea value={form.description} onChange={event => setForm(current => ({ ...current, description: event.target.value }))} placeholder="وصف مختصر لمسؤوليات الدور" /></label>
            <label className="toggle-field full-column"><input type="checkbox" checked={form.isActive} onChange={event => setForm(current => ({ ...current, isActive: event.target.checked }))}/><span>الدور نشط</span></label>
          </div>

          <div className="permissions-grid">
            {Object.entries(groupedPermissions).map(([module, modulePermissions]) => <section className="permission-group" key={module}><h3>{moduleLabels[module] ?? module}</h3>{modulePermissions.map(permission => <label key={permission.code}><input type="checkbox" checked={form.permissionCodes.includes(permission.code)} onChange={() => togglePermission(permission.code)}/><span><strong>{permission.name}</strong><small>{permission.description ?? permission.code}</small></span></label>)}</section>)}
          </div>

          {error && <div className="form-error">{error}</div>}
          {success && <div className="form-success"><CheckCircle2 size={18}/>{success}</div>}
          <button className="button button-primary button-full" disabled={saving}>{saving ? <Loader2 className="spin" size={18}/> : <ShieldCheck size={18}/>} {saving ? 'جارٍ الحفظ...' : 'حفظ الدور والصلاحيات'}</button>
        </form>
      </main>
    )
  }

  return (
    <main className="dashboard-content">
      <section className="page-heading management-heading"><div><span className="eyebrow">التحكم في الوصول</span><h1>الأدوار والصلاحيات</h1><p>أنشئ أي دور وحدد صلاحياته، ثم اربطه بالموظف أو بالمسمى الوظيفي.</p></div><div className="page-actions"><button className="button button-primary" onClick={openCreate}><Plus size={18}/> إضافة دور</button></div></section>
      {error && <div className="form-error management-message">{error}</div>}
      <section className="panel management-toolbar"><div className="table-search"><input value={query} onChange={event => setQuery(event.target.value)} placeholder="ابحث باسم الدور أو الكود..." /></div><button className="button button-ghost" onClick={() => void loadData()}><RefreshCw size={18}/> تحديث</button></section>
      <section className="panel data-table-panel">
        {loading ? <div className="empty-state"><Loader2 className="spin"/><strong>جارٍ تحميل الأدوار...</strong></div> : filtered.length === 0 ? <div className="empty-state"><ShieldCheck/><strong>لا توجد أدوار</strong><button className="button button-primary" onClick={openCreate}><Plus size={18}/> إضافة دور</button></div> : <div className="responsive-table"><table className="data-table"><thead><tr><th>الدور</th><th>النوع</th><th>عدد الصلاحيات</th><th>الموظفون</th><th>الحالة</th><th>الإجراءات</th></tr></thead><tbody>{filtered.map(role => <tr key={role.id}><td><div className="primary-cell"><strong>{role.name}</strong><span>{role.code}</span></div></td><td>{role.is_system ? 'نظامي' : 'مخصص'}</td><td>{role.permission_codes?.length ?? 0}</td><td>{role.employee_count}</td><td><span className={`status-badge ${role.is_active ? 'active' : 'inactive'}`}>{role.is_active ? 'نشط' : 'غير نشط'}</span></td><td><div className="row-actions"><button onClick={() => openEdit(role)}><Edit3 size={17}/></button><button className="danger" disabled={role.is_system || workingId === role.id} title={role.is_system ? 'لا يمكن حذف دور نظامي' : 'حذف'} onClick={() => void deleteRole(role)}>{workingId === role.id ? <Loader2 className="spin" size={16}/> : <Trash2 size={17}/>}</button></div></td></tr>)}</tbody></table></div>}
      </section>
    </main>
  )
}
