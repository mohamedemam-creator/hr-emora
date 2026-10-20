'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import {
  CalendarPlus,
  CheckCircle2,
  Clock3,
  Edit3,
  FileSpreadsheet,
  History,
  Loader2,
  RefreshCw,
  Save,
  X,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type Branch = {
  id: string
  name: string
  code: string
}

type Employee = {
  id: string
  employee_code: string
  full_name: string
  branch_id: string
  branch_name: string
}

type Options = {
  can_adjust: boolean
  branches: Branch[]
  employees: Employee[]
}

type Row = {
  session_id: string | null
  shift_assignment_id: string
  shift_date: string
  employee_id: string
  employee_code: string
  employee_name: string
  branch_id: string
  branch_name: string
  region_name: string | null
  day_type: string
  planned_start: string | null
  planned_end: string | null
  check_in: string | null
  check_out: string | null
  attendance_status: string
  late_minutes: number
  original_late_minutes: number
  early_leave_minutes: number
  worked_minutes: number
  source: string | null
  is_adjusted: boolean
  adjustment_reason: string | null
  adjusted_by_name: string | null
  adjusted_at: string | null
}

type AdjustmentForm = {
  sessionId: string | null
  employeeId: string
  branchId: string
  workDate: string
  shiftStart: string
  shiftEnd: string
  checkIn: string
  checkOut: string
  lateMinutes: string
  reason: string
}

const labels: Record<string, string> = {
  work: 'عمل',
  off: 'راحة',
  leave: 'إجازة',
  mission: 'مأمورية',
  present: 'حاضر',
  late: 'متأخر',
  absent: 'غائب',
  open: 'داخل الشيفت',
  early_leave: 'انصراف مبكر',
  missing_checkout: 'بدون انصراف',
  under_review: 'قيد المراجعة',
}

function today() {
  const value = new Date()
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function emptyForm(date = today()): AdjustmentForm {
  return {
    sessionId: null,
    employeeId: '',
    branchId: '',
    workDate: date,
    shiftStart: '09:00',
    shiftEnd: '17:00',
    checkIn: '',
    checkOut: '',
    lateMinutes: '',
    reason: '',
  }
}

export default function AttendancePage() {
  const [date, setDate] = useState(today())
  const [branchId, setBranchId] = useState('')
  const [options, setOptions] = useState<Options>({
    can_adjust: false,
    branches: [],
    employees: [],
  })
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<AdjustmentForm>(emptyForm())

  async function load() {
    setLoading(true)
    setError('')

    const supabase = createClient()
    const [
      { data: report, error: reportError },
      { data: optionData, error: optionError },
    ] = await Promise.all([
      supabase.rpc('app_attendance_admin_report', {
        p_date_from: date,
        p_date_to: date,
        p_branch_id: branchId || null,
      }),
      supabase.rpc('app_attendance_admin_options'),
    ])

    if (reportError) {
      setError(reportError.message)
    } else {
      setRows((report ?? []) as Row[])
    }

    if (!optionError && optionData) {
      setOptions(optionData as Options)
    }

    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  const filteredEmployees = useMemo(
    () =>
      options.employees.filter(
        employee =>
          !form.branchId || employee.branch_id === form.branchId,
      ),
    [options.employees, form.branchId],
  )

  const total = rows.length
  const present = rows.filter(row =>
    [
      'present',
      'late',
      'open',
      'early_leave',
      'missing_checkout',
      'under_review',
    ].includes(row.attendance_status),
  ).length
  const late = rows.filter(row => row.late_minutes > 0).length
  const absent = rows.filter(
    row => row.attendance_status === 'absent',
  ).length

  function openAdd() {
    const initialBranch =
      branchId || options.branches[0]?.id || ''
    const employee =
      options.employees.find(item => item.branch_id === initialBranch) ??
      options.employees[0]

    setForm({
      ...emptyForm(date),
      branchId: initialBranch || employee?.branch_id || '',
      employeeId: employee?.id || '',
    })
    setError('')
    setSuccess('')
    setModalOpen(true)
  }

  function openEdit(row: Row) {
    setForm({
      sessionId: row.session_id,
      employeeId: row.employee_id,
      branchId: row.branch_id,
      workDate: row.shift_date,
      shiftStart: row.planned_start ?? '09:00',
      shiftEnd: row.planned_end ?? '17:00',
      checkIn: row.check_in ?? '',
      checkOut: row.check_out ?? '',
      lateMinutes: String(row.late_minutes ?? 0),
      reason: '',
    })
    setError('')
    setSuccess('')
    setModalOpen(true)
  }

  async function saveAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')

    try {
      const supabase = createClient()
      const { data: result, error: rpcError } = await supabase.rpc(
        'app_save_attendance_adjustment',
        {
          p_session_id: form.sessionId,
          p_employee_id: form.employeeId,
          p_branch_id: form.branchId,
          p_work_date: form.workDate,
          p_shift_start: form.shiftStart,
          p_shift_end: form.shiftEnd,
          p_check_in_time: form.checkIn || null,
          p_check_out_time: form.checkOut || null,
          p_effective_late_minutes:
            form.checkIn && form.lateMinutes !== ''
              ? Number(form.lateMinutes)
              : null,
          p_reason: form.reason,
        },
      )

      if (rpcError) throw rpcError

      const response = result as { message?: string }
      setSuccess(response.message ?? 'تم حفظ التعديل بنجاح.')
      setModalOpen(false)
      setDate(form.workDate)
      setBranchId(form.branchId)
      await load()
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'تعذر حفظ التعديل.',
      )
    } finally {
      setSaving(false)
    }
  }

  async function exportExcel() {
    const XLSX = await import('xlsx')
    const data = rows.map(row => ({
      التاريخ: row.shift_date,
      'كود الموظف': row.employee_code,
      'اسم الموظف': row.employee_name,
      المنطقة: row.region_name ?? '',
      الفرع: row.branch_name,
      'موعد الشيفت':
        row.planned_start && row.planned_end
          ? `${row.planned_start} - ${row.planned_end}`
          : '',
      الحضور: row.check_in ?? '',
      الانصراف: row.check_out ?? '',
      الحالة: labels[row.attendance_status] ?? row.attendance_status,
      'التأخير الفعلي': row.late_minutes,
      'التأخير قبل التعديل': row.original_late_minutes,
      'الانصراف المبكر': row.early_leave_minutes,
      'ساعات العمل': Number(row.worked_minutes / 60).toFixed(1),
      'تعديل إداري': row.is_adjusted ? 'نعم' : 'لا',
      'سبب التعديل': row.adjustment_reason ?? '',
      'تم التعديل بواسطة': row.adjusted_by_name ?? '',
      'وقت التعديل': row.adjusted_at ?? '',
    }))

    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(data),
      'Attendance',
    )
    XLSX.writeFile(workbook, `Emora_Attendance_${date}.xlsx`)
  }

  return (
    <main className="dashboard-content">
      <section className="page-heading management-heading">
        <div>
          <span className="eyebrow">متابعة فعلية</span>
          <h1>الحضور والانصراف</h1>
          <p>
            عرض الحضور والتأخير، وإجراء التعديلات الإدارية الموثقة.
          </p>
        </div>

        <div className="page-actions">
          {options.can_adjust && (
            <button
              className="button button-primary"
              onClick={openAdd}
            >
              <CalendarPlus size={18} />
              إضافة يوم عمل
            </button>
          )}
          <button
            className="button button-ghost"
            onClick={() => void exportExcel()}
          >
            <FileSpreadsheet size={18} />
            تصدير Excel
          </button>
        </div>
      </section>

      {error && (
        <div className="form-error management-message">{error}</div>
      )}
      {success && (
        <div className="form-success management-message">
          <CheckCircle2 size={18} />
          {success}
        </div>
      )}

      <section className="panel report-filters">
        <label>
          التاريخ
          <input
            type="date"
            value={date}
            onChange={event => setDate(event.target.value)}
          />
        </label>

        <label>
          الفرع
          <select
            value={branchId}
            onChange={event => setBranchId(event.target.value)}
          >
            <option value="">كل الفروع المسموح بها</option>
            {options.branches.map(branch => (
              <option key={branch.id} value={branch.id}>
                {branch.name} — {branch.code}
              </option>
            ))}
          </select>
        </label>

        <button
          className="button button-primary"
          onClick={() => void load()}
        >
          <RefreshCw size={18} />
          تحديث
        </button>
      </section>

      <section className="report-stats">
        <article>
          <span>إجمالي الشيفتات</span>
          <strong>{total}</strong>
        </article>
        <article>
          <span>الحاضرون</span>
          <strong>{present}</strong>
        </article>
        <article>
          <span>المتأخرون</span>
          <strong>{late}</strong>
        </article>
        <article>
          <span>الغائبون</span>
          <strong>{absent}</strong>
        </article>
      </section>

      <section className="panel data-table-panel">
        {loading ? (
          <div className="empty-state">
            <Loader2 className="spin" />
            <strong>جارٍ تحميل الحضور...</strong>
          </div>
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <Clock3 />
            <strong>لا توجد شيفتات في هذا التاريخ</strong>
          </div>
        ) : (
          <div className="responsive-table">
            <table className="data-table report-table attendance-admin-table">
              <thead>
                <tr>
                  <th>الموظف</th>
                  <th>الفرع</th>
                  <th>الشيفت</th>
                  <th>الحضور</th>
                  <th>الانصراف</th>
                  <th>الحالة</th>
                  <th>التأخير</th>
                  <th>ساعات العمل</th>
                  <th>المراجعة</th>
                  {options.can_adjust && <th>الإجراءات</th>}
                </tr>
              </thead>

              <tbody>
                {rows.map(row => (
                  <tr key={row.shift_assignment_id}>
                    <td>
                      <div className="primary-cell">
                        <strong>{row.employee_name}</strong>
                        <span>{row.employee_code}</span>
                      </div>
                    </td>
                    <td>
                      <div className="primary-cell">
                        <strong>{row.branch_name}</strong>
                        <span>{row.region_name ?? ''}</span>
                      </div>
                    </td>
                    <td>
                      {row.planned_start && row.planned_end
                        ? `${row.planned_start} - ${row.planned_end}`
                        : labels[row.day_type] ?? row.day_type}
                    </td>
                    <td>{row.check_in ?? '-'}</td>
                    <td>{row.check_out ?? '-'}</td>
                    <td>
                      <span
                        className={`status-badge ${row.attendance_status}`}
                      >
                        {labels[row.attendance_status] ??
                          row.attendance_status}
                      </span>
                    </td>
                    <td>
                      <div className="late-cell">
                        <strong>{row.late_minutes} دقيقة</strong>
                        {row.is_adjusted &&
                          row.original_late_minutes !==
                            row.late_minutes && (
                            <span>
                              قبل التعديل {row.original_late_minutes}
                            </span>
                          )}
                      </div>
                    </td>
                    <td>
                      {Number(row.worked_minutes / 60).toFixed(1)}
                    </td>
                    <td>
                      {row.is_adjusted ? (
                        <span
                          className="adjusted-badge"
                          title={row.adjustment_reason ?? ''}
                        >
                          <History size={14} />
                          تعديل إداري
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                    {options.can_adjust && (
                      <td>
                        <button
                          className="attendance-edit-button"
                          title="تعديل الحضور أو التأخير"
                          onClick={() => openEdit(row)}
                        >
                          <Edit3 size={17} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {modalOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={event => {
            if (event.target === event.currentTarget) {
              setModalOpen(false)
            }
          }}
        >
          <form
            className="account-modal attendance-adjustment-modal"
            onSubmit={saveAdjustment}
          >
            <button
              type="button"
              className="modal-close"
              onClick={() => setModalOpen(false)}
            >
              <X />
            </button>

            <div className="module-placeholder-icon">
              {form.sessionId ? (
                <Edit3 size={30} />
              ) : (
                <CalendarPlus size={30} />
              )}
            </div>

            <h2>
              {form.sessionId
                ? 'تعديل الحضور والانصراف'
                : 'إضافة يوم عمل'}
            </h2>
            <p>
              جميع التعديلات تُحفظ باسم المستخدم وسبب التعديل داخل
              سجل التدقيق.
            </p>

            <div className="two-columns">
              <label>
                الفرع
                <select
                  required
                  disabled={Boolean(form.sessionId)}
                  value={form.branchId}
                  onChange={event => {
                    const nextBranch = event.target.value
                    const firstEmployee = options.employees.find(
                      employee => employee.branch_id === nextBranch,
                    )
                    setForm(current => ({
                      ...current,
                      branchId: nextBranch,
                      employeeId: firstEmployee?.id ?? '',
                    }))
                  }}
                >
                  <option value="">اختر الفرع</option>
                  {options.branches.map(branch => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name} — {branch.code}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                الموظف
                <select
                  required
                  disabled={Boolean(form.sessionId)}
                  value={form.employeeId}
                  onChange={event =>
                    setForm(current => ({
                      ...current,
                      employeeId: event.target.value,
                    }))
                  }
                >
                  <option value="">اختر الموظف</option>
                  {filteredEmployees.map(employee => (
                    <option key={employee.id} value={employee.id}>
                      {employee.full_name} — {employee.employee_code}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                يوم العمل
                <input
                  type="date"
                  required
                  value={form.workDate}
                  onChange={event =>
                    setForm(current => ({
                      ...current,
                      workDate: event.target.value,
                    }))
                  }
                />
              </label>

              <span />

              <label>
                بداية الشيفت
                <input
                  type="time"
                  required
                  value={form.shiftStart}
                  onChange={event =>
                    setForm(current => ({
                      ...current,
                      shiftStart: event.target.value,
                    }))
                  }
                />
              </label>

              <label>
                نهاية الشيفت
                <input
                  type="time"
                  required
                  value={form.shiftEnd}
                  onChange={event =>
                    setForm(current => ({
                      ...current,
                      shiftEnd: event.target.value,
                    }))
                  }
                />
              </label>

              <label>
                وقت الحضور
                <input
                  type="time"
                  value={form.checkIn}
                  onChange={event =>
                    setForm(current => ({
                      ...current,
                      checkIn: event.target.value,
                    }))
                  }
                />
              </label>

              <label>
                وقت الانصراف
                <input
                  type="time"
                  disabled={!form.checkIn}
                  value={form.checkOut}
                  onChange={event =>
                    setForm(current => ({
                      ...current,
                      checkOut: event.target.value,
                    }))
                  }
                />
              </label>
            </div>

            <div className="late-adjustment-field">
              <label>
                التأخير المعتمد بعد المراجعة
                <div className="late-input-row">
                  <input
                    type="number"
                    min="0"
                    disabled={!form.checkIn}
                    value={form.lateMinutes}
                    onChange={event =>
                      setForm(current => ({
                        ...current,
                        lateMinutes: event.target.value,
                      }))
                    }
                  />
                  <span>دقيقة</span>
                  <button
                    type="button"
                    className="button button-ghost"
                    disabled={!form.checkIn}
                    onClick={() =>
                      setForm(current => ({
                        ...current,
                        lateMinutes: '0',
                      }))
                    }
                  >
                    قبول العذر وإلغاء التأخير
                  </button>
                </div>
              </label>
            </div>

            <label>
              سبب الإضافة أو التعديل
              <textarea
                required
                minLength={5}
                rows={4}
                placeholder="مثال: عطل في وسيلة النقل وتم اعتماد العذر بواسطة الإدارة"
                value={form.reason}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    reason: event.target.value,
                  }))
                }
              />
            </label>

            {!form.checkIn && (
              <div className="form-note">
                ترك وقت الحضور فارغًا سيضيف يوم العمل والشيفت فقط بدون
                إنشاء حركة حضور.
              </div>
            )}

            <button
              className="button button-primary button-full"
              disabled={saving}
            >
              {saving ? (
                <Loader2 className="spin" size={18} />
              ) : (
                <Save size={18} />
              )}
              {saving ? 'جارٍ الحفظ...' : 'حفظ التعديل'}
            </button>
          </form>
        </div>
      )}
    </main>
  )
}
