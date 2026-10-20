'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import {
  ArrowUpLeft,
  Building2,
  CalendarClock,
  Clock3,
  Loader2,
  MapPinned,
  Plus,
  Search,
  UserCheck,
  UsersRound,
  X,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type WeekPoint = {
  date: string
  label: string
  count: number
}

type DashboardSummary = {
  employees: number
  branches: number
  regions: number
  present_today: number
  late_today: number
  weekly_attendance: WeekPoint[]
}

type LateEmployee = {
  employee_id: string
  employee_code: string
  employee_name: string
  branch_id: string
  branch_name: string
  region_name: string | null
  planned_start: string | null
  check_in: string | null
  late_minutes: number
}

const emptySummary: DashboardSummary = {
  employees: 0,
  branches: 0,
  regions: 0,
  present_today: 0,
  late_today: 0,
  weekly_attendance: [],
}

const dayFormatter = new Intl.DateTimeFormat('ar-EG', { weekday: 'short' })
const fullDateFormatter = new Intl.DateTimeFormat('ar-EG', {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
})

export default function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary>(emptySummary)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [lateEmployees, setLateEmployees] = useState<LateEmployee[]>([])
  const [lateLoading, setLateLoading] = useState(false)
  const [lateError, setLateError] = useState('')
  const [lateOpen, setLateOpen] = useState(false)
  const [lateSearch, setLateSearch] = useState('')

  async function loadLateEmployees(syncCardCount = true) {
    setLateLoading(true)
    setLateError('')

    const supabase = createClient()
    const { data, error: rpcError } = await supabase.rpc(
      'app_dashboard_late_today_details',
    )

    if (rpcError) {
      setLateError(rpcError.message)
    } else {
      const rows = (data ?? []) as LateEmployee[]
      setLateEmployees(rows)

      if (syncCardCount) {
        setSummary(current => ({
          ...current,
          late_today: rows.length,
        }))
      }
    }

    setLateLoading(false)
  }

  async function loadSummary() {
    setLoading(true)
    setError('')

    const supabase = createClient()

    const [
      { data, error: rpcError },
      { data: lateData, error: lateRpcError },
    ] = await Promise.all([
      supabase.rpc('app_dashboard_summary'),
      supabase.rpc('app_dashboard_late_today_details'),
    ])

    if (rpcError) {
      setError(rpcError.message)
      setSummary(emptySummary)
    } else {
      const nextSummary = {
        ...emptySummary,
        ...(data as Partial<DashboardSummary>),
      }

      if (!lateRpcError) {
        const rows = (lateData ?? []) as LateEmployee[]
        setLateEmployees(rows)
        setLateError('')
        nextSummary.late_today = rows.length
      } else {
        setLateError(lateRpcError.message)
      }

      setSummary(nextSummary)
    }

    setLoading(false)
  }

  useEffect(() => {
    void loadSummary()
  }, [])

  const stats = useMemo(() => [
    {
      label: 'إجمالي الموظفين',
      value: summary.employees,
      detail: 'الموظفون النشطون فعليًا',
      icon: UsersRound,
      action: false,
    },
    {
      label: 'الحاضرون اليوم',
      value: summary.present_today,
      detail: summary.employees
        ? `${Math.round((summary.present_today / summary.employees) * 100)}% من الموظفين`
        : 'لا توجد بيانات حضور',
      icon: UserCheck,
      action: false,
    },
    {
      label: 'المتأخرون اليوم',
      value: summary.late_today,
      detail: 'اضغط لعرض الموظفين المتأخرين',
      icon: Clock3,
      action: true,
    },
    {
      label: 'الفروع النشطة',
      value: summary.branches,
      detail: `${summary.regions} منطقة نشطة`,
      icon: Building2,
      action: false,
    },
  ], [summary])

  const maxWeek = Math.max(
    1,
    ...summary.weekly_attendance.map(point => Number(point.count) || 0),
  )

  const filteredLateEmployees = useMemo(() => {
    const query = lateSearch.trim().toLowerCase()
    if (!query) return lateEmployees

    return lateEmployees.filter(employee =>
      [
        employee.employee_code,
        employee.employee_name,
        employee.branch_name,
        employee.region_name ?? '',
      ].some(value => String(value).toLowerCase().includes(query)),
    )
  }, [lateEmployees, lateSearch])

  function openLateEmployees() {
    setLateSearch('')
    setLateOpen(true)

    if (lateEmployees.length === 0 || lateError) {
      void loadLateEmployees(true)
    }
  }

  return (
    <main className="dashboard-content">
      <section className="page-heading">
        <div>
          <span className="eyebrow">{fullDateFormatter.format(new Date())}</span>
          <h1>صباح الخير 👋</h1>
          <p>كل الأرقام في هذه الصفحة قادمة مباشرة من Supabase.</p>
        </div>
        <Link href="/dashboard/branches" className="button button-primary">
          <Plus size={18} /> إدارة الفروع
        </Link>
      </section>

      {error && (
        <div className="form-error dashboard-alert">
          تعذر تحميل ملخص النظام: {error}
          <button
            type="button"
            className="inline-link"
            onClick={() => void loadSummary()}
          >
            إعادة المحاولة
          </button>
        </div>
      )}

      <section className="stats-grid">
        {stats.map(({ label, value, detail, icon: Icon, action }) =>
          action ? (
            <button
              type="button"
              className="stat-card stat-card-clickable"
              key={label}
              onClick={openLateEmployees}
              aria-label={`عرض ${label}`}
            >
              <div className="stat-icon"><Icon size={22} /></div>
              <span>{label}</span>
              <strong>
                {loading ? <Loader2 className="spin" size={24} /> : value}
              </strong>
              <small>{detail}</small>
              <span className="stat-card-open-hint">
                عرض التفاصيل <ArrowUpLeft size={13} />
              </span>
            </button>
          ) : (
            <article className="stat-card" key={label}>
              <div className="stat-icon"><Icon size={22} /></div>
              <span>{label}</span>
              <strong>
                {loading ? <Loader2 className="spin" size={24} /> : value}
              </strong>
              <small>{detail}</small>
            </article>
          ),
        )}
      </section>

      <section className="dashboard-grid">
        <article className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <h2>الحضور خلال آخر 7 أيام</h2>
              <p>عدد الموظفين الذين سجلوا حضورًا فعليًا</p>
            </div>
            <button
              type="button"
              className="chip"
              onClick={() => void loadSummary()}
            >
              تحديث
            </button>
          </div>

          {loading ? (
            <div className="real-chart-empty">
              <Loader2 className="spin" /> جارٍ تحميل البيانات...
            </div>
          ) : summary.weekly_attendance.length === 0 ||
            summary.weekly_attendance.every(
              point => Number(point.count) === 0,
            ) ? (
            <div className="real-chart-empty">
              <Clock3 size={32} />
              <strong>لا توجد تسجيلات حضور حتى الآن</strong>
              <span>
                ستظهر الحركة هنا فور بدء الموظفين في تسجيل الحضور.
              </span>
            </div>
          ) : (
            <div className="real-bar-chart">
              {summary.weekly_attendance.map(point => {
                const date = new Date(`${point.date}T12:00:00`)
                const height = Math.max(
                  8,
                  (Number(point.count) / maxWeek) * 100,
                )

                return (
                  <div className="bar-column" key={point.date}>
                    <span className="bar-value">{point.count}</span>
                    <div className="bar-track">
                      <div
                        className="bar-fill"
                        style={{ height: `${height}%` }}
                      />
                    </div>
                    <small>{dayFormatter.format(date)}</small>
                  </div>
                )
              })}
            </div>
          )}
        </article>

        <article className="panel quick-panel">
          <div className="panel-heading">
            <div>
              <h2>إجراءات سريعة</h2>
              <p>إدارة البيانات الحقيقية</p>
            </div>
          </div>

          <Link href="/dashboard/branches">
            <MapPinned />
            <div>
              <strong>الفروع والمناطق</strong>
              <span>إضافة وتعديل وحذف واستيراد Excel</span>
            </div>
            <ArrowUpLeft />
          </Link>

          <Link href="/dashboard/employees">
            <UsersRound />
            <div>
              <strong>الموظفون</strong>
              <span>إضافة أو استيراد ملف الموظفين</span>
            </div>
            <ArrowUpLeft />
          </Link>

          <Link href="/dashboard/organization">
            <CalendarClock />
            <div>
              <strong>الهيكل الوظيفي</strong>
              <span>الأقسام والمسميات والأدوار الافتراضية</span>
            </div>
            <ArrowUpLeft />
          </Link>
        </article>
      </section>

      {lateOpen && (
        <div
          className="modal-backdrop dashboard-late-backdrop"
          onMouseDown={event => {
            if (event.currentTarget === event.target) {
              setLateOpen(false)
            }
          }}
        >
          <section
            className="account-modal dashboard-late-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="late-employees-title"
          >
            <button
              type="button"
              className="modal-close"
              onClick={() => setLateOpen(false)}
              aria-label="إغلاق"
            >
              <X size={19} />
            </button>

            <div className="dashboard-late-heading">
              <div>
                <span className="eyebrow">الحضور اليوم</span>
                <h2 id="late-employees-title">
                  المتأخرون اليوم — {lateEmployees.length} موظف
                </h2>
                <p>
                  القائمة تعرض الموظفين داخل نطاق صلاحيات حسابك فقط.
                </p>
              </div>

              <button
                type="button"
                className="chip"
                onClick={() => void loadLateEmployees(true)}
                disabled={lateLoading}
              >
                {lateLoading ? (
                  <Loader2 className="spin" size={15} />
                ) : (
                  'تحديث'
                )}
              </button>
            </div>

            <label className="dashboard-late-search">
              <Search size={18} />
              <input
                value={lateSearch}
                onChange={event => setLateSearch(event.target.value)}
                placeholder="ابحث بالاسم أو الكود أو الفرع..."
              />
            </label>

            {lateError && (
              <div className="form-error">
                تعذر تحميل الموظفين المتأخرين: {lateError}
              </div>
            )}

            {lateLoading ? (
              <div className="dashboard-late-empty">
                <Loader2 className="spin" />
                <span>جارٍ تحميل المتأخرين...</span>
              </div>
            ) : filteredLateEmployees.length === 0 ? (
              <div className="dashboard-late-empty">
                <Clock3 size={30} />
                <strong>
                  {lateSearch
                    ? 'لا توجد نتائج مطابقة للبحث'
                    : 'لا يوجد موظفون متأخرون اليوم'}
                </strong>
              </div>
            ) : (
              <div className="dashboard-late-list">
                <div className="dashboard-late-table-head">
                  <span>الموظف</span>
                  <span>الفرع</span>
                  <span>موعد الشيفت</span>
                  <span>الحضور</span>
                  <span>التأخير</span>
                </div>

                {filteredLateEmployees.map(employee => (
                  <div
                    className="dashboard-late-row"
                    key={employee.employee_id}
                  >
                    <div className="dashboard-late-employee">
                      <strong>{employee.employee_name}</strong>
                      <span>كود {employee.employee_code}</span>
                    </div>

                    <div>
                      <strong>{employee.branch_name}</strong>
                      {employee.region_name && (
                        <span>{employee.region_name}</span>
                      )}
                    </div>

                    <div>
                      <strong>{employee.planned_start ?? '-'}</strong>
                      <span>بداية الشيفت</span>
                    </div>

                    <div>
                      <strong>{employee.check_in ?? '-'}</strong>
                      <span>وقت الحضور</span>
                    </div>

                    <div>
                      <b className="dashboard-late-minutes">
                        {employee.late_minutes} دقيقة
                      </b>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="dashboard-late-footer">
              <span>
                المعروض: {filteredLateEmployees.length} من{' '}
                {lateEmployees.length}
              </span>
              <Link
                href="/dashboard/attendance"
                className="button button-secondary"
                onClick={() => setLateOpen(false)}
              >
                فتح سجل الحضور الكامل
              </Link>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}
