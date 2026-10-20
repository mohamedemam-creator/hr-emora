'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import {
  BadgeCheck,
  Banknote,
  Calculator,
  CheckCircle2,
  FileSpreadsheet,
  LockKeyhole,
  Loader2,
  Pencil,
  Printer,
  RefreshCw,
  RotateCcw,
  Search,
  WalletCards,
  X,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type Cycle = {
  id: string
  period_start: string
  period_end: string
  label: string
  status: 'draft' | 'reviewed' | 'closed'
  calculated_at: string | null
  reviewed_at: string | null
  closed_at: string | null
  notes: string | null
}

type Branch = {
  id: string
  name: string
  code: string
}

type PayrollItem = {
  id: string
  employee_id: string
  employee_code: string
  employee_name: string
  branch_id: string | null
  branch_name: string | null
  salary_type: 'monthly' | 'daily' | 'hourly'
  base_salary: number
  day_rate: number

  scheduled_work_days: number
  present_days: number
  paid_leave_days: number
  unpaid_leave_days: number
  absent_days: number

  worked_minutes: number
  late_minutes: number
  early_leave_minutes: number
  overtime_minutes: number

  gross_base: number
  overtime_amount: number
  manual_earnings: number

  absence_deduction: number
  unpaid_leave_deduction: number
  late_deduction: number
  early_leave_deduction: number
  penalty_deduction: number
  manual_deductions: number

  gross_earnings: number
  total_deductions: number
  net_salary: number
  adjustment_notes: string | null
}

type Workspace = {
  month_start: string
  month_end: string
  can_manage: boolean
  can_reopen: boolean
  settings: {
    monthly_divisor: number
    deduct_absence: boolean
    deduct_unpaid_leave: boolean
    deduct_late_minutes: boolean
    deduct_early_leave_minutes: boolean
    overtime_enabled: boolean
  }
  cycle: Cycle | null
  branches: Branch[]
  items: PayrollItem[]
}

const statusLabels = {
  draft: 'مسودة / قيد الحساب',
  reviewed: 'تمت المراجعة',
  closed: 'مقفل',
}

const salaryLabels = {
  monthly: 'شهري',
  daily: 'يومي',
  hourly: 'بالساعة',
}

function currentMonth() {
  const value = new Date()
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`
}

function money(value: number) {
  return Number(value || 0).toLocaleString('ar-EG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function hours(minutes: number) {
  return (Number(minutes || 0) / 60).toLocaleString('ar-EG', {
    maximumFractionDigits: 1,
  })
}

export default function PayrollPage() {
  const [month, setMonth] = useState(currentMonth())
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [branchId, setBranchId] = useState('')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [action, setAction] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [adjustItem, setAdjustItem] = useState<PayrollItem | null>(null)
  const [payslipItem, setPayslipItem] = useState<PayrollItem | null>(null)
  const [reopenOpen, setReopenOpen] = useState(false)
  const [reopenReason, setReopenReason] = useState('')
  const [adjustForm, setAdjustForm] = useState({
    earnings: '0',
    deductions: '0',
    notes: '',
  })

  async function load(selectedMonth = month) {
    setLoading(true)
    setError('')
    const supabase = createClient()
    const { data, error: rpcError } = await supabase.rpc(
      'app_payroll_workspace',
      { p_month: `${selectedMonth}-01` },
    )

    if (rpcError) {
      setError(rpcError.message)
      setWorkspace(null)
    } else {
      setWorkspace(data as Workspace)
    }
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (workspace?.items ?? []).filter(item => {
      if (branchId && item.branch_id !== branchId) return false
      if (
        needle &&
        !`${item.employee_name} ${item.employee_code} ${item.branch_name ?? ''}`
          .toLowerCase()
          .includes(needle)
      ) {
        return false
      }
      return true
    })
  }, [workspace, branchId, query])

  const summary = useMemo(() => {
    return filtered.reduce(
      (acc, item) => {
        acc.employees += 1
        acc.gross += Number(item.gross_earnings || 0)
        acc.deductions += Number(item.total_deductions || 0)
        acc.net += Number(item.net_salary || 0)
        acc.overtime += Number(item.overtime_amount || 0)
        return acc
      },
      { employees: 0, gross: 0, deductions: 0, net: 0, overtime: 0 },
    )
  }, [filtered])

  async function runAction(
    name: string,
    rpc: string,
    params: Record<string, unknown>,
    message: string,
  ) {
    setAction(name)
    setError('')
    setSuccess('')

    const supabase = createClient()
    const { error: rpcError } = await supabase.rpc(rpc, params)

    if (rpcError) {
      setError(rpcError.message)
    } else {
      setSuccess(message)
      await load()
    }
    setAction('')
  }

  async function calculate() {
    if (
      workspace?.cycle &&
      !confirm('سيتم إعادة حساب بيانات الشهر من الحضور والإجازات والجزاءات الحالية. هل تريد المتابعة؟')
    ) {
      return
    }

    await runAction(
      'calculate',
      'app_calculate_payroll',
      { p_month: `${month}-01` },
      'تم حساب مرتبات الشهر وتحديث البيانات.',
    )
  }

  async function review() {
    if (!workspace?.cycle) return
    await runAction(
      'review',
      'app_review_payroll_cycle',
      { p_cycle_id: workspace.cycle.id },
      'تم اعتماد مراجعة دورة الرواتب. يمكنك الآن إقفال الشهر.',
    )
  }

  async function closeCycle() {
    if (!workspace?.cycle) return
    if (
      !confirm(
        'بعد إقفال الشهر لن تتغير المرتبات بتعديلات الحضور أو الجزاءات إلا بعد إعادة فتح الدورة. هل تريد الإقفال؟',
      )
    ) {
      return
    }

    await runAction(
      'close',
      'app_close_payroll_cycle',
      { p_cycle_id: workspace.cycle.id },
      'تم إقفال مرتبات الشهر وحفظ Snapshot نهائي.',
    )
  }

  async function reopen(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!workspace?.cycle) return

    setAction('reopen')
    setError('')
    const supabase = createClient()
    const { error: rpcError } = await supabase.rpc(
      'app_reopen_payroll_cycle',
      {
        p_cycle_id: workspace.cycle.id,
        p_reason: reopenReason,
      },
    )

    if (rpcError) {
      setError(rpcError.message)
    } else {
      setReopenOpen(false)
      setReopenReason('')
      setSuccess('تم إعادة فتح دورة الرواتب. يمكنك التعديل وإعادة الحساب.')
      await load()
    }
    setAction('')
  }

  function openAdjustment(item: PayrollItem) {
    setAdjustItem(item)
    setAdjustForm({
      earnings: String(item.manual_earnings ?? 0),
      deductions: String(item.manual_deductions ?? 0),
      notes: item.adjustment_notes ?? '',
    })
  }

  async function saveAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!adjustItem) return

    setAction('adjust')
    setError('')
    const supabase = createClient()
    const { error: rpcError } = await supabase.rpc(
      'app_adjust_payroll_item',
      {
        p_item_id: adjustItem.id,
        p_manual_earnings: Number(adjustForm.earnings || 0),
        p_manual_deductions: Number(adjustForm.deductions || 0),
        p_notes: adjustForm.notes,
      },
    )

    if (rpcError) {
      setError(rpcError.message)
    } else {
      setAdjustItem(null)
      setSuccess('تم حفظ الاستحقاق/الخصم اليدوي وتحديث صافي المرتب.')
      await load()
    }
    setAction('')
  }

  async function exportExcel() {
    const exportCycle = workspace?.cycle
    if (!exportCycle || filtered.length === 0) return
    const XLSX = await import('xlsx')

    const rows = filtered.map(item => ({
      'كود الموظف': item.employee_code,
      'اسم الموظف': item.employee_name,
      الفرع: item.branch_name ?? '',
      'نوع الراتب': salaryLabels[item.salary_type],
      'الراتب الأساسي': item.base_salary,
      'أيام العمل المجدولة': item.scheduled_work_days,
      'أيام الحضور': item.present_days,
      'إجازات مدفوعة': item.paid_leave_days,
      'إجازات بدون راتب': item.unpaid_leave_days,
      'أيام الغياب': item.absent_days,
      'دقائق التأخير': item.late_minutes,
      'دقائق الانصراف المبكر': item.early_leave_minutes,
      'ساعات العمل': Number(item.worked_minutes / 60).toFixed(2),
      'ساعات الأوفر تايم': Number(item.overtime_minutes / 60).toFixed(2),
      'الراتب المحتسب': item.gross_base,
      'قيمة الأوفر تايم': item.overtime_amount,
      'استحقاقات يدوية': item.manual_earnings,
      'خصم الغياب': item.absence_deduction,
      'خصم بدون راتب': item.unpaid_leave_deduction,
      'خصم التأخير': item.late_deduction,
      'خصم الانصراف المبكر': item.early_leave_deduction,
      'الجزاءات': item.penalty_deduction,
      'خصومات يدوية': item.manual_deductions,
      'إجمالي الاستحقاقات': item.gross_earnings,
      'إجمالي الخصومات': item.total_deductions,
      'صافي المرتب': item.net_salary,
      ملاحظات: item.adjustment_notes ?? '',
      'حالة الدورة': statusLabels[exportCycle.status],
    }))

    const workbook = XLSX.utils.book_new()
    const sheet = XLSX.utils.json_to_sheet(rows)
    XLSX.utils.book_append_sheet(workbook, sheet, 'Payroll')
    XLSX.writeFile(workbook, `Emora_Payroll_${month}.xlsx`)
  }

  const cycle = workspace?.cycle
  const isClosed = cycle?.status === 'closed'
  const isReviewed = cycle?.status === 'reviewed'

  return (
    <main className="dashboard-content payroll-page">
      <section className="page-heading management-heading">
        <div>
          <span className="eyebrow">دورة رواتب فعلية</span>
          <h1>الرواتب</h1>
          <p>
            حساب المرتب من الحضور والإجازات والجزاءات والأوفر تايم، ثم
            المراجعة والإقفال الشهري.
          </p>
        </div>

        <div className="page-actions">
          {workspace?.can_manage && !isClosed && (
            <button
              className="button button-primary"
              disabled={action === 'calculate'}
              onClick={() => void calculate()}
            >
              {action === 'calculate' ? (
                <Loader2 className="spin" size={18} />
              ) : (
                <Calculator size={18} />
              )}
              {cycle ? 'إعادة حساب الشهر' : 'حساب مرتبات الشهر'}
            </button>
          )}

          {cycle && (
            <button
              className="button button-ghost"
              onClick={() => void exportExcel()}
            >
              <FileSpreadsheet size={18} />
              تصدير Excel
            </button>
          )}
        </div>
      </section>

      {error && <div className="form-error payroll-message">{error}</div>}
      {success && (
        <div className="form-success payroll-message">
          <CheckCircle2 size={18} />
          {success}
        </div>
      )}

      <section className="panel payroll-toolbar">
        <label>
          شهر الرواتب
          <input
            type="month"
            value={month}
            onChange={event => setMonth(event.target.value)}
          />
        </label>

        <label>
          الفرع
          <select
            value={branchId}
            onChange={event => setBranchId(event.target.value)}
          >
            <option value="">كل الفروع المسموح بها</option>
            {(workspace?.branches ?? []).map(branch => (
              <option key={branch.id} value={branch.id}>
                {branch.name} — {branch.code}
              </option>
            ))}
          </select>
        </label>

        <button
          className="button button-ghost"
          onClick={() => void load(month)}
        >
          <RefreshCw size={18} />
          تحديث
        </button>
      </section>

      {cycle && (
        <section className={`payroll-cycle-banner ${cycle.status}`}>
          <div>
            <span>دورة {cycle.label}</span>
            <strong>{statusLabels[cycle.status]}</strong>
            {cycle.closed_at && <small>تم الإقفال وتثبيت القيم.</small>}
          </div>

          <div className="payroll-cycle-actions">
            {workspace?.can_manage && cycle.status === 'draft' && (
              <button
                className="button button-ghost"
                disabled={action === 'review'}
                onClick={() => void review()}
              >
                <BadgeCheck size={18} />
                اعتماد المراجعة
              </button>
            )}

            {workspace?.can_manage && isReviewed && (
              <button
                className="button button-primary"
                disabled={action === 'close'}
                onClick={() => void closeCycle()}
              >
                <LockKeyhole size={18} />
                إقفال مرتبات الشهر
              </button>
            )}

            {workspace?.can_reopen && isClosed && (
              <button
                className="button button-danger-soft"
                onClick={() => setReopenOpen(true)}
              >
                <RotateCcw size={18} />
                إعادة فتح الشهر
              </button>
            )}
          </div>
        </section>
      )}

      {!cycle && !loading ? (
        <section className="panel payroll-empty">
          <WalletCards />
          <h2>لم يتم إنشاء دورة رواتب لهذا الشهر</h2>
          <p>
            اضغط «حساب مرتبات الشهر» لسحب بيانات الموظفين والحضور
            والإجازات والجزاءات الفعلية.
          </p>
          {workspace?.can_manage && (
            <button
              className="button button-primary"
              onClick={() => void calculate()}
            >
              <Calculator size={18} />
              حساب مرتبات {month}
            </button>
          )}
        </section>
      ) : (
        <>
          <section className="payroll-summary">
            <article>
              <span>الموظفون</span>
              <strong>{summary.employees}</strong>
            </article>
            <article>
              <span>إجمالي الاستحقاقات</span>
              <strong>{money(summary.gross)} جنيه</strong>
            </article>
            <article>
              <span>إجمالي الخصومات</span>
              <strong>{money(summary.deductions)} جنيه</strong>
            </article>
            <article className="net">
              <span>صافي الرواتب</span>
              <strong>{money(summary.net)} جنيه</strong>
            </article>
          </section>

          <section className="panel payroll-search">
            <Search size={18} />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="ابحث باسم الموظف أو الكود أو الفرع..."
            />
          </section>

          <section className="panel data-table-panel payroll-table-panel">
            {loading ? (
              <div className="empty-state">
                <Loader2 className="spin" />
                <strong>جارٍ تحميل الرواتب...</strong>
              </div>
            ) : filtered.length === 0 ? (
              <div className="empty-state">
                <Banknote />
                <strong>لا توجد بيانات رواتب مطابقة للفلتر</strong>
              </div>
            ) : (
              <div className="responsive-table">
                <table className="data-table payroll-table">
                  <thead>
                    <tr>
                      <th>الموظف</th>
                      <th>الفرع</th>
                      <th>الأساسي</th>
                      <th>الحضور</th>
                      <th>التأخير</th>
                      <th>الأوفر تايم</th>
                      <th>الجزاءات</th>
                      <th>غياب/بدون راتب</th>
                      <th>استحقاقات</th>
                      <th>خصومات</th>
                      <th>الصافي</th>
                      <th>الإجراءات</th>
                    </tr>
                  </thead>

                  <tbody>
                    {filtered.map(item => (
                      <tr key={item.id}>
                        <td>
                          <div className="primary-cell">
                            <strong>{item.employee_name}</strong>
                            <span>
                              {item.employee_code} •{' '}
                              {salaryLabels[item.salary_type]}
                            </span>
                          </div>
                        </td>
                        <td>{item.branch_name ?? '-'}</td>
                        <td>{money(item.gross_base)}</td>
                        <td>
                          <div className="primary-cell">
                            <strong>
                              {item.present_days}/{item.scheduled_work_days}
                            </strong>
                            <span>
                              {hours(item.worked_minutes)} ساعة عمل
                            </span>
                          </div>
                        </td>
                        <td>
                          <div className="primary-cell">
                            <strong>{item.late_minutes} دقيقة</strong>
                            <span>-{money(item.late_deduction)} جنيه</span>
                          </div>
                        </td>
                        <td>
                          <div className="primary-cell">
                            <strong>{hours(item.overtime_minutes)} ساعة</strong>
                            <span>+{money(item.overtime_amount)} جنيه</span>
                          </div>
                        </td>
                        <td className="deduction-value">
                          -{money(item.penalty_deduction)}
                        </td>
                        <td>
                          <div className="primary-cell">
                            <strong>
                              {item.absent_days} غياب •{' '}
                              {item.unpaid_leave_days} بدون راتب
                            </strong>
                            <span>
                              -
                              {money(
                                item.absence_deduction +
                                  item.unpaid_leave_deduction,
                              )}{' '}
                              جنيه
                            </span>
                          </div>
                        </td>
                        <td className="earning-value">
                          +{money(item.gross_earnings)}
                        </td>
                        <td className="deduction-value">
                          -{money(item.total_deductions)}
                        </td>
                        <td className="net-value">
                          {money(item.net_salary)} جنيه
                        </td>
                        <td>
                          <div className="row-actions">
                            <button
                              title="كشف المرتب"
                              onClick={() => setPayslipItem(item)}
                            >
                              <Banknote size={17} />
                            </button>

                            {workspace?.can_manage && !isClosed && (
                              <button
                                title="إضافة استحقاق أو خصم يدوي"
                                onClick={() => openAdjustment(item)}
                              >
                                <Pencil size={17} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {adjustItem && (
        <div
          className="modal-backdrop"
          onMouseDown={event => {
            if (event.target === event.currentTarget) {
              setAdjustItem(null)
            }
          }}
        >
          <form
            className="account-modal payroll-adjust-modal"
            onSubmit={saveAdjustment}
          >
            <button
              type="button"
              className="modal-close"
              onClick={() => setAdjustItem(null)}
            >
              <X />
            </button>

            <Pencil className="payroll-modal-icon" />
            <h2>استحقاق / خصم يدوي</h2>
            <p>
              {adjustItem.employee_name} — {adjustItem.employee_code}
            </p>

            <div className="two-columns">
              <label>
                استحقاق إضافي
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={adjustForm.earnings}
                  onChange={event =>
                    setAdjustForm(current => ({
                      ...current,
                      earnings: event.target.value,
                    }))
                  }
                />
              </label>

              <label>
                خصم إضافي
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={adjustForm.deductions}
                  onChange={event =>
                    setAdjustForm(current => ({
                      ...current,
                      deductions: event.target.value,
                    }))
                  }
                />
              </label>
            </div>

            <label>
              سبب التعديل
              <textarea
                rows={4}
                value={adjustForm.notes}
                onChange={event =>
                  setAdjustForm(current => ({
                    ...current,
                    notes: event.target.value,
                  }))
                }
                placeholder="مثال: مكافأة شهرية / سلفة / خصم إداري..."
              />
            </label>

            <button
              className="button button-primary button-full"
              disabled={action === 'adjust'}
            >
              {action === 'adjust' ? (
                <Loader2 className="spin" size={18} />
              ) : (
                <CheckCircle2 size={18} />
              )}
              حفظ التعديل
            </button>
          </form>
        </div>
      )}

      {payslipItem && cycle && (
        <div
          className="modal-backdrop payslip-backdrop"
          onMouseDown={event => {
            if (event.target === event.currentTarget) {
              setPayslipItem(null)
            }
          }}
        >
          <section className="account-modal payslip-modal">
            <button
              type="button"
              className="modal-close no-print"
              onClick={() => setPayslipItem(null)}
            >
              <X />
            </button>

            <div className="payslip-header">
              <div>
                <span> Emora HR</span>
                <h2>كشف مرتب</h2>
                <p>شهر {cycle.label}</p>
              </div>
              <Banknote size={38} />
            </div>

            <div className="payslip-employee">
              <strong>{payslipItem.employee_name}</strong>
              <span>
                {payslipItem.employee_code} •{' '}
                {payslipItem.branch_name ?? '-'}
              </span>
            </div>

            <div className="payslip-columns">
              <div>
                <h3>الاستحقاقات</h3>
                <p>
                  <span>الراتب المحتسب</span>
                  <b>{money(payslipItem.gross_base)}</b>
                </p>
                <p>
                  <span>الأوفر تايم</span>
                  <b>{money(payslipItem.overtime_amount)}</b>
                </p>
                <p>
                  <span>استحقاقات إضافية</span>
                  <b>{money(payslipItem.manual_earnings)}</b>
                </p>
                <p className="total">
                  <span>الإجمالي</span>
                  <b>{money(payslipItem.gross_earnings)}</b>
                </p>
              </div>

              <div>
                <h3>الخصومات</h3>
                <p>
                  <span>الغياب</span>
                  <b>{money(payslipItem.absence_deduction)}</b>
                </p>
                <p>
                  <span>إجازة بدون راتب</span>
                  <b>{money(payslipItem.unpaid_leave_deduction)}</b>
                </p>
                <p>
                  <span>التأخير</span>
                  <b>{money(payslipItem.late_deduction)}</b>
                </p>
                <p>
                  <span>الانصراف المبكر</span>
                  <b>{money(payslipItem.early_leave_deduction)}</b>
                </p>
                <p>
                  <span>الجزاءات</span>
                  <b>{money(payslipItem.penalty_deduction)}</b>
                </p>
                <p>
                  <span>خصومات إضافية</span>
                  <b>{money(payslipItem.manual_deductions)}</b>
                </p>
                <p className="total">
                  <span>الإجمالي</span>
                  <b>{money(payslipItem.total_deductions)}</b>
                </p>
              </div>
            </div>

            <div className="payslip-net">
              <span>صافي المرتب</span>
              <strong>{money(payslipItem.net_salary)} جنيه</strong>
            </div>

            <div className="payslip-attendance">
              <span>الحضور: {payslipItem.present_days} يوم</span>
              <span>الغياب: {payslipItem.absent_days} يوم</span>
              <span>التأخير: {payslipItem.late_minutes} دقيقة</span>
              <span>أوفر تايم: {hours(payslipItem.overtime_minutes)} ساعة</span>
            </div>

            {payslipItem.adjustment_notes && (
              <div className="payslip-note">
                ملاحظات: {payslipItem.adjustment_notes}
              </div>
            )}

            <button
              className="button button-primary button-full no-print"
              onClick={() => window.print()}
            >
              <Printer size={18} />
              طباعة كشف المرتب
            </button>
          </section>
        </div>
      )}

      {reopenOpen && cycle && (
        <div className="modal-backdrop">
          <form className="account-modal" onSubmit={reopen}>
            <button
              type="button"
              className="modal-close"
              onClick={() => setReopenOpen(false)}
            >
              <X />
            </button>

            <RotateCcw className="payroll-modal-icon" />
            <h2>إعادة فتح مرتبات {cycle.label}</h2>
            <p>
              سيتم إلغاء حالة الإقفال للسماح بالتصحيح وإعادة الحساب.
              العملية مسجلة في سجل التدقيق.
            </p>

            <label>
              سبب إعادة الفتح
              <textarea
                required
                minLength={5}
                rows={4}
                value={reopenReason}
                onChange={event => setReopenReason(event.target.value)}
                placeholder="اكتب سبب التصحيح..."
              />
            </label>

            <button
              className="button button-danger-soft button-full"
              disabled={action === 'reopen'}
            >
              <RotateCcw size={18} />
              تأكيد إعادة الفتح
            </button>
          </form>
        </div>
      )}
    </main>
  )
}
