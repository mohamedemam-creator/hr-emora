'use client'

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2,
  Download,
  Edit3,
  FileSpreadsheet,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  UserRoundX,
  UsersRound,
  X,
  KeyRound,
} from 'lucide-react'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { EmployeeAccountPanel } from '@/components/employee-account-panel'

type Employee = {
  id: string
  employee_code: string
  full_name: string
  phone: string | null
  email: string | null
  address: string | null
  branch_id: string | null
  branch_name: string | null
  branch_code: string | null
  department_id: string | null
  department_name: string | null
  job_title_id: string | null
  job_title_name: string | null
  direct_manager_id: string | null
  direct_manager_name: string | null
  hire_date: string | null
  employment_status: 'active' | 'suspended' | 'terminated' | 'on_leave'
  salary_type: 'monthly' | 'daily' | 'hourly'
  base_salary: number
  overtime_hour_rate: number
  has_login: boolean
  login_enabled: boolean
  must_change_password: boolean
  role_ids: string[]
  role_names: string
  created_at: string
}

type SimpleOption = { id: string; name: string; code: string }
type BranchOption = SimpleOption & { region_id: string | null }
type JobOption = SimpleOption & { department_id: string | null; default_role_id: string | null }
type ManagerOption = { id: string; name: string; code: string; branch_id: string | null }
type Options = { branches: BranchOption[]; departments: SimpleOption[]; job_titles: JobOption[]; roles: SimpleOption[]; managers: ManagerOption[] }
type Access = {
  permissions?: string[]
  roles?: Array<{ code: string; name: string }>
}

type EmployeeForm = {
  id: string | null
  employeeCode: string
  fullName: string
  phone: string
  email: string
  address: string
  branchId: string
  departmentId: string
  jobTitleId: string
  managerId: string
  hireDate: string
  salaryType: 'monthly' | 'daily' | 'hourly'
  baseSalary: string
  overtimeRate: string
  status: 'active' | 'suspended' | 'terminated' | 'on_leave'
  roleIds: string[]
}

const emptyOptions: Options = { branches: [], departments: [], job_titles: [], roles: [], managers: [] }
const emptyForm: EmployeeForm = {
  id: null,
  employeeCode: '',
  fullName: '',
  phone: '',
  email: '',
  address: '',
  branchId: '',
  departmentId: '',
  jobTitleId: '',
  managerId: '',
  hireDate: '',
  salaryType: 'monthly',
  baseSalary: '0',
  overtimeRate: '0',
  status: 'active',
  roleIds: [],
}

const statusLabels: Record<Employee['employment_status'], string> = {
  active: 'نشط', suspended: 'موقوف', terminated: 'منتهي الخدمة', on_leave: 'في إجازة',
}
const salaryLabels: Record<Employee['salary_type'], string> = { monthly: 'شهري', daily: 'يومي', hourly: 'بالساعة' }

async function edgeFunctionErrorMessage(
  error: unknown,
  fallback = 'تعذر تنفيذ العملية.',
) {
  if (error instanceof FunctionsHttpError) {
    try {
      const payload = await error.context.json()
      return payload?.error ?? payload?.message ?? fallback
    } catch {
      return error.message || fallback
    }
  }
  return error instanceof Error ? error.message : fallback
}

function humanError(message: string) {
  if (message.includes('23505') || message.toLowerCase().includes('duplicate')) return 'كود الموظف مستخدم بالفعل.'
  if (message.includes('42501') || message.toLowerCase().includes('permission')) return 'ليس لديك صلاحية تنفيذ هذه العملية أو الموظف خارج نطاق إدارتك.'
  return message
}

function getValue(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key]
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim()
  }
  return ''
}

function normalizeSalaryType(value: string) {
  const text = value.trim().toLowerCase()
  if (['daily', 'يومي'].includes(text)) return 'daily'
  if (['hourly', 'بالساعة', 'ساعي'].includes(text)) return 'hourly'
  return 'monthly'
}

function normalizeStatus(value: string) {
  const text = value.trim().toLowerCase()
  if (['suspended', 'موقوف'].includes(text)) return 'suspended'
  if (['terminated', 'منتهي الخدمة', 'منتهى الخدمة'].includes(text)) return 'terminated'
  if (['on_leave', 'في إجازة', 'إجازة'].includes(text)) return 'on_leave'
  return 'active'
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [options, setOptions] = useState<Options>(emptyOptions)
  const [access, setAccess] = useState<Access>({})
  const [view, setView] = useState<'list' | 'form'>('list')
  const [form, setForm] = useState<EmployeeForm>(emptyForm)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | Employee['employment_status']>('all')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [codeLoading, setCodeLoading] = useState(false)
  const [workingId, setWorkingId] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [importMessage, setImportMessage] = useState('')
  const [accountEmployee, setAccountEmployee] = useState<Employee | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  async function loadData() {
    setLoading(true)
    setError('')
    const supabase = createClient()
    const [employeesResult, optionsResult, accessResult] = await Promise.all([
      supabase.rpc('app_list_employees_v3'),
      supabase.rpc('app_employee_options'),
      supabase.rpc('app_current_access'),
    ])
    if (employeesResult.error) setError(humanError(employeesResult.error.message))
    else setEmployees((employeesResult.data ?? []) as Employee[])
    if (!optionsResult.error) setOptions({ ...emptyOptions, ...(optionsResult.data as Partial<Options>) })
    if (!accessResult.error && accessResult.data) setAccess(accessResult.data as Access)
    setLoading(false)
  }

  useEffect(() => { void loadData() }, [])

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase()
    return employees.filter(employee => {
      const matchesText = !text || [employee.full_name, employee.employee_code, employee.phone ?? '', employee.email ?? '', employee.address ?? '', employee.branch_name ?? '', employee.department_name ?? '', employee.job_title_name ?? '', employee.role_names ?? ''].some(value => value.toLowerCase().includes(text))
      const matchesStatus = statusFilter === 'all' || employee.employment_status === statusFilter
      return matchesText && matchesStatus
    })
  }, [employees, query, statusFilter])

  const filteredJobs = useMemo(() => options.job_titles.filter(job => !form.departmentId || job.department_id === form.departmentId), [options.job_titles, form.departmentId])
  const filteredManagers = useMemo(() => options.managers.filter(manager => manager.id !== form.id && (!form.branchId || !manager.branch_id || manager.branch_id === form.branchId)), [options.managers, form.id, form.branchId])

  const currentRoles = useMemo(
    () => new Set((access.roles ?? []).map(role => role.code)),
    [access.roles],
  )
  const canDeleteEmployee =
    currentRoles.has('SUPER_ADMIN') || currentRoles.has('REGION_MANAGER')

  async function openCreate() {
    setError('')
    setSuccess('')
    setCodeLoading(true)
    try {
      const supabase = createClient()
      const { data, error: codeError } = await supabase.rpc('app_next_employee_code')
      if (codeError) throw codeError
      const nextCode = String(data ?? '').trim()
      if (!nextCode) throw new Error('تعذر إنشاء كود الموظف التالي تلقائيًا.')
      setForm({ ...emptyForm, employeeCode: nextCode })
      setView('form')
    } catch (caught) {
      setError(caught instanceof Error ? humanError(caught.message) : 'تعذر إنشاء كود الموظف التالي تلقائيًا.')
    } finally {
      setCodeLoading(false)
    }
  }

  function closeForm() { setForm(emptyForm); setError(''); setSuccess(''); setView('list') }
  function openEdit(employee: Employee) {
    setForm({
      id: employee.id,
      employeeCode: employee.employee_code,
      fullName: employee.full_name,
      phone: employee.phone ?? '',
      email: employee.email ?? '',
      address: employee.address ?? '',
      branchId: employee.branch_id ?? '',
      departmentId: employee.department_id ?? '',
      jobTitleId: employee.job_title_id ?? '',
      managerId: employee.direct_manager_id ?? '',
      hireDate: employee.hire_date ?? '',
      salaryType: employee.salary_type,
      baseSalary: String(employee.base_salary ?? 0),
      overtimeRate: String(employee.overtime_hour_rate ?? 0),
      status: employee.employment_status,
      roleIds: employee.role_ids ?? [],
    })
    setError('')
    setSuccess('')
    setView('form')
  }

  function toggleRole(roleId: string) {
    setForm(current => ({ ...current, roleIds: current.roleIds.includes(roleId) ? current.roleIds.filter(id => id !== roleId) : [...current.roleIds, roleId] }))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    const supabase = createClient()

    const currentEmployee = form.id
      ? employees.find(employee => employee.id === form.id)
      : null
    const nextEmail = form.email.trim().toLowerCase()
    const currentEmail = (currentEmployee?.email ?? '').trim().toLowerCase()

    if (currentEmployee?.has_login && currentEmail !== nextEmail) {
      if (!nextEmail) {
        setError('لا يمكن حذف البريد من موظف لديه حساب دخول. غيّر البريد إلى بريد آخر صحيح.')
        setSaving(false)
        return
      }

      const { data: syncResult, error: syncError } =
        await supabase.functions.invoke('manage-employee-account', {
          body: {
            action: 'update-email',
            employeeId: currentEmployee.id,
            email: nextEmail,
          },
        })

      if (syncError || syncResult?.error) {
        const message = syncResult?.error
          ? String(syncResult.error)
          : await edgeFunctionErrorMessage(
              syncError,
              'تعذر تحديث بريد تسجيل الدخول.',
            )
        setError(humanError(message))
        setSaving(false)
        return
      }
    }

    const { error: rpcError } = await supabase.rpc('app_save_employee_v2', {
      p_employee_id: form.id,
      // New employees are allocated atomically by the database.
      // The displayed code is a preview only; edit keeps the existing immutable code.
      p_employee_code: form.id ? form.employeeCode.trim().toUpperCase() : '',
      p_full_name: form.fullName.trim(),
      p_phone: form.phone.trim(),
      p_email: form.email.trim().toLowerCase(),
      p_address: form.address.trim(),
      p_branch_id: form.branchId || null,
      p_department_id: form.departmentId || null,
      p_job_title_id: form.jobTitleId || null,
      p_direct_manager_id: form.managerId || null,
      p_hire_date: form.hireDate || null,
      p_salary_type: form.salaryType,
      p_base_salary: Number(form.baseSalary || 0),
      p_overtime_hour_rate: Number(form.overtimeRate || 0),
      p_status: form.status,
      p_role_ids: form.roleIds,
    })

    if (rpcError) setError(humanError(rpcError.message))
    else {
      setSuccess(form.id ? 'تم تحديث الموظف بنجاح.' : 'تمت إضافة الموظف بنجاح.')
      await loadData()
      setTimeout(closeForm, 650)
    }
    setSaving(false)
  }

  async function changeStatus(employee: Employee) {
    const nextStatus = employee.employment_status === 'active' ? 'suspended' : 'active'
    if (!window.confirm(`${nextStatus === 'active' ? 'تفعيل' : 'إيقاف'} الموظف «${employee.full_name}»؟`)) return
    setWorkingId(employee.id)
    const supabase = createClient()
    const { error: rpcError } = await supabase.rpc('app_set_employee_status', { p_employee_id: employee.id, p_status: nextStatus })
    if (rpcError) setError(humanError(rpcError.message)); else await loadData()
    setWorkingId('')
  }

  async function deleteEmployee(employee: Employee) {
    if (!window.confirm(
      `حذف الموظف «${employee.full_name}» من النظام؟\n\n` +
      'سيتم إخفاؤه من القوائم وإيقافه مع الاحتفاظ بالسجلات التاريخية. ' +
      'لن يسمح النظام بالحذف إذا كان له حضور خلال الشهر الحالي.'
    )) return

    setWorkingId(employee.id)
    setError('')
    setSuccess('')
    const supabase = createClient()
    const { error: rpcError } = await supabase.rpc('app_delete_employee', {
      p_employee_id: employee.id,
    })

    if (rpcError) {
      setError(humanError(rpcError.message))
    } else {
      setSuccess('تم حذف الموظف من القوائم مع الاحتفاظ بسجلاته التاريخية.')
      await loadData()
    }
    setWorkingId('')
  }

  async function importExcel(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError('')
    setImportMessage('جارٍ قراءة الملف...')
    try {
      const XLSX = await import('xlsx')
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
      const worksheet = workbook.Sheets[workbook.SheetNames[0]]
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '', raw: true })
      const rows = rawRows.map(row => ({
        employee_code: getValue(row, ['كود الموظف', 'employee_code', 'Employee Code']),
        full_name: getValue(row, ['الاسم الكامل', 'اسم الموظف', 'full_name', 'Full Name']),
        phone: getValue(row, ['الهاتف', 'phone', 'Phone']),
        email: getValue(row, ['البريد الإلكتروني', 'email', 'Email']),
        address: getValue(row, ['العنوان', 'address', 'Address']),
        branch_code: getValue(row, ['كود الفرع', 'branch_code', 'Branch Code']),
        department_code: getValue(row, ['كود القسم', 'department_code', 'Department Code']),
        department_name: getValue(row, ['القسم', 'department_name', 'Department']),
        job_title_code: getValue(row, ['كود الوظيفة', 'job_title_code', 'Job Title Code']),
        job_title_name: getValue(row, ['المسمى الوظيفي', 'job_title_name', 'Job Title']),
        manager_code: getValue(row, ['كود المدير المباشر', 'manager_code', 'Manager Code']),
        hire_date: getValue(row, ['تاريخ التعيين', 'hire_date', 'Hire Date']),
        salary_type: normalizeSalaryType(getValue(row, ['نوع الراتب', 'salary_type', 'Salary Type'])),
        base_salary: getValue(row, ['الراتب الأساسي', 'base_salary', 'Base Salary']) || '0',
        overtime_hour_rate: getValue(row, ['سعر ساعة الأوفر تايم', 'overtime_hour_rate', 'Overtime Rate']) || '0',
        employment_status: normalizeStatus(getValue(row, ['الحالة', 'employment_status', 'Status'])),
        role_codes: getValue(row, ['أكواد الأدوار', 'role_codes', 'Role Codes']),
      })).filter(row => row.employee_code || row.full_name)
      if (!rows.length) throw new Error('لم يتم العثور على صفوف موظفين داخل الملف.')
      setImportMessage(`جارٍ استيراد ${rows.length} صف...`)
      const supabase = createClient()
      const { data, error: rpcError } = await supabase.rpc('app_import_employees_v2', { p_rows: rows })
      if (rpcError) throw rpcError
      const result = data as { inserted: number; updated: number; failed: number }
      setImportMessage(
        `تمت إضافة ${result.inserted} موظف. تم رفض ${result.failed} صف. ` +
        'لا يتم تعديل أي موظف موجود تلقائيًا من ملف الاستيراد.'
      )
      await loadData()
    } catch (caught) {
      setImportMessage('')
      setError(caught instanceof Error ? humanError(caught.message) : 'تعذر استيراد الملف.')
    }
  }

  async function downloadTemplate() {
    const XLSX = await import('xlsx')
    const rows = [{
      'كود الموظف': '', 'الاسم الكامل': '', 'الهاتف': '', 'البريد الإلكتروني': '', 'العنوان': '', 'كود الفرع': '',
      'كود القسم': '', 'كود الوظيفة': '', 'كود المدير المباشر': '', 'تاريخ التعيين': '2026-08-05', 'نوع الراتب': 'monthly',
      'الراتب الأساسي': 0, 'سعر ساعة الأوفر تايم': 0, 'الحالة': 'active', 'أكواد الأدوار': 'EMPLOYEE',
    }]
    const workbook = XLSX.utils.book_new()
    const worksheet = XLSX.utils.json_to_sheet(rows)
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Employees')
    XLSX.writeFile(workbook, 'Emora_Employees_Template.xlsx')
  }

  async function exportExcel() {
    const XLSX = await import('xlsx')
    const rows = employees.map(employee => ({
      'كود الموظف': employee.employee_code,
      'الاسم الكامل': employee.full_name,
      'الهاتف': employee.phone ?? '',
      'البريد الإلكتروني': employee.email ?? '',
      'العنوان': employee.address ?? '',
      'كود الفرع': employee.branch_code ?? '',
      'القسم': employee.department_name ?? '',
      'المسمى الوظيفي': employee.job_title_name ?? '',
      'المدير المباشر': employee.direct_manager_name ?? '',
      'تاريخ التعيين': employee.hire_date ?? '',
      'نوع الراتب': employee.salary_type,
      'الراتب الأساسي': employee.base_salary,
      'سعر ساعة الأوفر تايم': employee.overtime_hour_rate,
      'الحالة': employee.employment_status,
      'الأدوار': employee.role_names,
    }))
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Employees')
    XLSX.writeFile(workbook, 'Emora_Employees.xlsx')
  }

  if (view === 'form') {
    return (
      <main className="dashboard-content">
        <section className="page-heading management-heading"><div><span className="eyebrow">ملف الموظف</span><h1>{form.id ? 'تعديل الموظف' : 'إضافة موظف'}</h1><p>البيانات الوظيفية والمالية والدور والصلاحيات.</p></div><button className="button button-ghost" onClick={closeForm}><X size={18}/> رجوع</button></section>
        <form className="panel employee-form" onSubmit={submit}>
          <div className="two-columns">
            <label>
              {form.id ? 'كود الموظف — ثابت' : 'كود الموظف — تلقائي'}
              <input
                required
                readOnly
                value={form.employeeCode}
                title={form.id ? 'كود الموظف ثابت ولا يمكن تغييره بعد الإنشاء.' : 'يتم إنشاء كود الموظف تلقائيًا بواسطة النظام.'}
              />
              <small>{form.id ? 'لا يمكن تغيير الكود بعد إنشاء الموظف.' : 'يُحجز الكود النهائي تلقائيًا عند الحفظ لمنع التكرار.'}</small>
            </label>
            <label>الاسم الكامل<input required value={form.fullName} onChange={event => setForm(current => ({ ...current, fullName: event.target.value }))}/></label>
            <label>رقم الهاتف<input value={form.phone} onChange={event => setForm(current => ({ ...current, phone: event.target.value }))}/></label>
            <label>البريد الإلكتروني<input type="email" value={form.email} onChange={event => setForm(current => ({ ...current, email: event.target.value }))}/></label>
            <label className="full-column">عنوان الموظف<input value={form.address} onChange={event => setForm(current => ({ ...current, address: event.target.value }))} placeholder="العنوان بالتفصيل"/></label>
            <label>الفرع<select value={form.branchId} onChange={event => setForm(current => ({ ...current, branchId: event.target.value, managerId: '' }))}><option value="">بدون فرع</option>{options.branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name} — {branch.code}</option>)}</select></label>
            <label>القسم<select value={form.departmentId} onChange={event => setForm(current => ({ ...current, departmentId: event.target.value, jobTitleId: '' }))}><option value="">بدون قسم</option>{options.departments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>المسمى الوظيفي<select value={form.jobTitleId} onChange={event => setForm(current => ({ ...current, jobTitleId: event.target.value }))}><option value="">بدون مسمى</option>{filteredJobs.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>المدير المباشر<select value={form.managerId} onChange={event => setForm(current => ({ ...current, managerId: event.target.value }))}><option value="">بدون مدير مباشر</option>{filteredManagers.map(item => <option key={item.id} value={item.id}>{item.name} — {item.code}</option>)}</select></label>
            <label>تاريخ التعيين<input type="date" value={form.hireDate} onChange={event => setForm(current => ({ ...current, hireDate: event.target.value }))}/></label>
            <label>الحالة<select value={form.status} onChange={event => setForm(current => ({ ...current, status: event.target.value as EmployeeForm['status'] }))}><option value="active">نشط</option><option value="suspended">موقوف</option><option value="on_leave">في إجازة</option><option value="terminated">منتهي الخدمة</option></select></label>
            <label>نوع الراتب<select value={form.salaryType} onChange={event => setForm(current => ({ ...current, salaryType: event.target.value as EmployeeForm['salaryType'] }))}><option value="monthly">شهري</option><option value="daily">يومي</option><option value="hourly">بالساعة</option></select></label>
            <label>الراتب الأساسي<input type="number" min="0" step="0.01" value={form.baseSalary} onChange={event => setForm(current => ({ ...current, baseSalary: event.target.value }))}/></label>
            <label>سعر ساعة الأوفر تايم<input type="number" min="0" step="0.01" value={form.overtimeRate} onChange={event => setForm(current => ({ ...current, overtimeRate: event.target.value }))}/></label>
          </div>

          <section className="role-picker"><h3>الأدوار والصلاحيات</h3><p>يمكن إسناد أكثر من دور للموظف. لو لم تختَر دورًا، يُستخدم الدور الافتراضي للمسمى الوظيفي.</p><div>{options.roles.map(role => <label key={role.id}><input type="checkbox" checked={form.roleIds.includes(role.id)} onChange={() => toggleRole(role.id)}/><span>{role.name}<small>{role.code}</small></span></label>)}</div></section>

          {error && <div className="form-error">{error}</div>}
          {success && <div className="form-success"><CheckCircle2 size={18}/>{success}</div>}
          <button className="button button-primary button-full" disabled={saving}>{saving ? <Loader2 className="spin" size={18}/> : <UsersRound size={18}/>} {saving ? 'جارٍ الحفظ...' : 'حفظ الموظف'}</button>
        </form>
      </main>
    )
  }

  return (
    <main className="dashboard-content">
      <section className="page-heading management-heading"><div><span className="eyebrow">بيانات فعلية</span><h1>الموظفون</h1><p>{employees.length} موظف ظاهرون حسب نطاق صلاحياتك.</p></div><div className="page-actions"><button className="button button-primary" disabled={codeLoading} onClick={() => void openCreate()}>{codeLoading ? <Loader2 className="spin" size={18}/> : <Plus size={18}/>} {codeLoading ? 'جارٍ تجهيز الكود...' : 'إضافة موظف'}</button><button className="button button-ghost" onClick={() => void downloadTemplate()}><Download size={18}/> نموذج Excel</button><button className="button button-ghost" onClick={() => fileInputRef.current?.click()}><Upload size={18}/> استيراد Excel</button><button className="button button-ghost" onClick={() => void exportExcel()}><FileSpreadsheet size={18}/> تصدير Excel</button><input ref={fileInputRef} hidden type="file" accept=".xlsx,.xls" onChange={importExcel}/></div></section>
      {error && <div className="form-error management-message">{error}</div>}
      {success && <div className="form-success management-message"><CheckCircle2 size={18}/>{success}</div>}
      {importMessage && <div className="form-success management-message"><CheckCircle2 size={18}/>{importMessage}</div>}
      <section className="panel management-toolbar"><div className="table-search"><input value={query} onChange={event => setQuery(event.target.value)} placeholder="ابحث بالاسم أو الكود أو الفرع أو الوظيفة..." /></div><select value={statusFilter} onChange={event => setStatusFilter(event.target.value as typeof statusFilter)}><option value="all">كل الحالات</option><option value="active">نشط</option><option value="suspended">موقوف</option><option value="on_leave">في إجازة</option><option value="terminated">منتهي الخدمة</option></select><button className="button button-ghost" onClick={() => void loadData()}><RefreshCw size={18}/> تحديث</button></section>
      <section className="panel data-table-panel">
        {loading ? <div className="empty-state"><Loader2 className="spin"/><strong>جارٍ تحميل الموظفين...</strong></div> : filtered.length === 0 ? <div className="empty-state"><UsersRound/><strong>لا يوجد موظفون</strong><button className="button button-primary" disabled={codeLoading} onClick={() => void openCreate()}>{codeLoading ? <Loader2 className="spin" size={18}/> : <Plus size={18}/>} إضافة موظف</button></div> : <div className="responsive-table"><table className="data-table employee-table"><thead><tr><th>الموظف</th><th>الفرع</th><th>الوظيفة</th><th>الدور</th><th>المدير</th><th>الراتب</th><th>العنوان</th><th>الحالة</th><th>الإجراءات</th></tr></thead><tbody>{filtered.map(employee => <tr key={employee.id}><td><div className="primary-cell"><strong>{employee.full_name}</strong><span>{employee.employee_code} • {employee.phone ?? 'بدون هاتف'}</span></div></td><td>{employee.branch_name ?? 'بدون فرع'}</td><td><div className="primary-cell"><strong>{employee.job_title_name ?? 'غير محدد'}</strong><span>{employee.department_name ?? 'بدون قسم'}</span></div></td><td>{employee.role_names || 'بدون دور'}</td><td>{employee.direct_manager_name ?? 'غير محدد'}</td><td><div className="primary-cell"><strong>{Number(employee.base_salary).toLocaleString('ar-EG')}</strong><span>{salaryLabels[employee.salary_type]} • أوفر تايم {Number(employee.overtime_hour_rate).toLocaleString('ar-EG')}</span></div></td><td className="wide-cell">{employee.address ?? 'لم يسجل عنوان'}</td><td><span className={`status-badge ${employee.employment_status}`}>{statusLabels[employee.employment_status]}</span></td><td><div className="row-actions"><button title="حساب الدخول" onClick={() => setAccountEmployee(employee)}><KeyRound size={17}/></button><button onClick={() => openEdit(employee)}><Edit3 size={17}/></button><button title={employee.employment_status === 'active' ? 'إيقاف' : 'تفعيل'} disabled={workingId === employee.id} onClick={() => void changeStatus(employee)}>{workingId === employee.id ? <Loader2 className="spin" size={16}/> : <UserRoundX size={17}/>}</button>{canDeleteEmployee && <button className="danger" disabled={workingId === employee.id} title="حذف آمن — متاح لمدير المنطقة أو مدير النظام فقط" onClick={() => void deleteEmployee(employee)}><Trash2 size={17}/></button>}</div></td></tr>)}</tbody></table></div>}
      </section>
    {accountEmployee && <EmployeeAccountPanel employee={accountEmployee} onClose={() => setAccountEmployee(null)} onUpdated={async () => { await loadData(); setAccountEmployee(current => current ? employees.find(item => item.id === current.id) ?? current : null) }}/>}
    </main>
  )
}
