'use client'

import { useEffect, useState } from 'react'
import { Download, FileSpreadsheet, Loader2, RefreshCw } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type Branch={id:string;name:string;code:string}
type Row={shift_date:string;employee_code:string;employee_name:string;branch_name:string;region_name:string|null;day_type:string;planned_start:string|null;planned_end:string|null;check_in:string|null;check_out:string|null;attendance_status:string;late_minutes:number;worked_minutes:number}
type Access={roles?:Array<{code:string}>}
type BranchOpsRow={
  report_date:string
  branch_id:string
  branch_name:string
  branch_code:string
  region_name:string|null
  scheduled_employees:number
  checked_in_employees:number
  planned_open:string|null
  actual_open:string|null
  opening_delay_minutes:number
  opened_by_name:string|null
  opened_by_code:string|null
  planned_close:string|null
  actual_close:string|null
  early_close_minutes:number
  closed_by_name:string|null
  closed_by_code:string|null
  open_sessions:number
  auto_closed_sessions:number
  open_status:string
  close_status:string
}

const labels:Record<string,string>={work:'عمل',off:'راحة',leave:'إجازة',mission:'مأمورية',present:'حاضر',late:'متأخر',absent:'غائب',open:'داخل الشيفت',early_leave:'انصراف مبكر',missing_checkout:'بدون انصراف',under_review:'قيد المراجعة'}
const branchStatusLabels:Record<string,string>={
  on_time:'في الموعد',
  late_open:'فتح متأخر',
  not_opened:'لم يفتح',
  opened_without_schedule:'فتح بدون جدول',
  early_close:'إغلاق مبكر',
  open_now:'مفتوح الآن',
  unclosed_session:'جلسات غير مغلقة',
  no_real_checkout:'لا يوجد خروج فعلي',
  no_checkout:'لا يوجد إغلاق',
  closed_without_schedule:'إغلاق بدون جدول',
  no_schedule:'لا يوجد جدول',
}

function dateOffset(days:number){const d=new Date();d.setDate(d.getDate()+days);return d.toISOString().slice(0,10)}
function statusClass(status:string){
  if(status==='on_time')return 'present'
  if(status==='late_open')return 'late'
  if(status==='early_close')return 'early_leave'
  if(status==='open_now')return 'open'
  if(['not_opened','no_real_checkout','no_checkout','unclosed_session'].includes(status))return 'missing_checkout'
  return 'under_review'
}

export default function ReportsPage(){
  const [from,setFrom]=useState(dateOffset(-30))
  const [to,setTo]=useState(dateOffset(0))
  const [branchId,setBranchId]=useState('')
  const [branches,setBranches]=useState<Branch[]>([])
  const [rows,setRows]=useState<Row[]>([])
  const [branchRows,setBranchRows]=useState<BranchOpsRow[]>([])
  const [roles,setRoles]=useState<string[]>([])
  const [activeReport,setActiveReport]=useState<'attendance'|'branch_ops'>('attendance')
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState('')

  const canViewBranchOps=roles.includes('SUPER_ADMIN')||roles.includes('REGION_MANAGER')

  async function load(mode:'attendance'|'branch_ops'=activeReport){
    setLoading(true);setError('')
    const supabase=createClient()
    const reportPromise=mode==='attendance'
      ? supabase.rpc('app_attendance_report',{p_date_from:from,p_date_to:to,p_branch_id:branchId||null,p_region_id:null})
      : supabase.rpc('app_branch_open_close_report',{p_date_from:from,p_date_to:to,p_branch_id:branchId||null})

    const [reportResult,workspaceResult,accessResult]=await Promise.all([
      reportPromise,
      supabase.rpc('app_shift_workspace',{p_branch_id:null,p_week_start:null}),
      supabase.rpc('app_current_access'),
    ])

    if(reportResult.error)setError(reportResult.error.message)
    else if(mode==='attendance')setRows((reportResult.data??[]) as Row[])
    else setBranchRows((reportResult.data??[]) as BranchOpsRow[])

    if(workspaceResult.data)setBranches((workspaceResult.data as {branches:Branch[]}).branches??[])
    if(accessResult.data)setRoles(((accessResult.data as Access).roles??[]).map(role=>role.code))
    setLoading(false)
  }

  useEffect(()=>{void load('attendance')},[])

  function switchReport(mode:'attendance'|'branch_ops'){
    setActiveReport(mode)
    void load(mode)
  }

  const summary={
    total:rows.filter(r=>r.day_type==='work').length,
    present:rows.filter(r=>['present','open','early_leave','missing_checkout','under_review'].includes(r.attendance_status)).length,
    late:rows.filter(r=>r.attendance_status==='late'||r.late_minutes>0).length,
    absent:rows.filter(r=>r.attendance_status==='absent').length,
  }

  const branchSummary={
    days:branchRows.length,
    lateOpen:branchRows.filter(r=>r.opening_delay_minutes>0).length,
    earlyClose:branchRows.filter(r=>r.early_close_minutes>0).length,
    issues:branchRows.filter(r=>['not_opened','no_real_checkout','no_checkout','unclosed_session'].includes(r.open_status)||['not_opened','no_real_checkout','no_checkout','unclosed_session'].includes(r.close_status)).length,
  }

  async function exportExcel(){
    const XLSX=await import('xlsx')

    if(activeReport==='attendance'){
      const data=rows.map(r=>({
        'التاريخ':r.shift_date,
        'كود الموظف':r.employee_code,
        'اسم الموظف':r.employee_name,
        'المنطقة':r.region_name??'',
        'الفرع':r.branch_name,
        'نوع اليوم':labels[r.day_type]??r.day_type,
        'موعد البداية':r.planned_start??'',
        'موعد النهاية':r.planned_end??'',
        'الحضور':r.check_in??'',
        'الانصراف':r.check_out??'',
        'الحالة':labels[r.attendance_status]??r.attendance_status,
        'دقائق التأخير':r.late_minutes,
        'دقائق العمل':r.worked_minutes,
      }))
      const workbook=XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet(data),'Attendance')
      XLSX.writeFile(workbook,`Selin_Attendance_${from}_${to}.xlsx`)
      return
    }

    const data=branchRows.map(r=>({
      'التاريخ':r.report_date,
      'المنطقة':r.region_name??'',
      'الفرع':r.branch_name,
      'كود الفرع':r.branch_code,
      'عدد الموظفين المجدولين':r.scheduled_employees,
      'عدد من سجلوا حضور':r.checked_in_employees,
      'موعد الفتح المخطط':r.planned_open??'',
      'الفتح الفعلي':r.actual_open??'',
      'تأخير الفتح بالدقائق':r.opening_delay_minutes,
      'فتح بواسطة':r.opened_by_name?r.opened_by_name+(r.opened_by_code?` (${r.opened_by_code})`:''):'',
      'حالة الفتح':branchStatusLabels[r.open_status]??r.open_status,
      'موعد الإغلاق المخطط':r.planned_close??'',
      'آخر خروج فعلي':r.actual_close??'',
      'الإغلاق المبكر بالدقائق':r.early_close_minutes,
      'آخر خروج بواسطة':r.closed_by_name?r.closed_by_name+(r.closed_by_code?` (${r.closed_by_code})`:''):'',
      'حالة الإغلاق':branchStatusLabels[r.close_status]??r.close_status,
      'جلسات ما زالت مفتوحة':r.open_sessions,
      'جلسات بدون خروج فعلي/إغلاق آلي':r.auto_closed_sessions,
    }))
    const workbook=XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet(data),'Branch Open Close')
    XLSX.writeFile(workbook,`Selin_Branch_Open_Close_${from}_${to}.xlsx`)
  }

  return <main className="dashboard-content">
    <section className="page-heading management-heading">
      <div>
        <span className="eyebrow">بيانات فعلية</span>
        <h1>{activeReport==='attendance'?'تقارير الحضور والشيفتات':'تقرير فتح وإغلاق الفروع'}</h1>
        <p>{activeReport==='attendance'?'فلترة حسب الفترة والفرع وتصدير النتائج إلى Excel.':'يعتمد الفتح الفعلي على أول تسجيل حضور، والإغلاق الفعلي على آخر تسجيل خروج حقيقي بالفرع.'}</p>
      </div>
      <button className="button button-ghost" onClick={()=>void exportExcel()}><FileSpreadsheet size={18}/> تصدير Excel</button>
    </section>

    <section className="panel" style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:16}}>
      <button className={`button ${activeReport==='attendance'?'button-primary':'button-ghost'}`} onClick={()=>switchReport('attendance')}>الحضور والشيفتات</button>
      {canViewBranchOps&&<button className={`button ${activeReport==='branch_ops'?'button-primary':'button-ghost'}`} onClick={()=>switchReport('branch_ops')}>فتح وإغلاق الفروع</button>}
    </section>

    {error&&<div className="form-error management-message">{error}</div>}

    <section className="panel report-filters">
      <label>من<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
      <label>إلى<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
      <label>الفرع<select value={branchId} onChange={e=>setBranchId(e.target.value)}><option value="">كل الفروع المسموح بها</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name} — {b.code}</option>)}</select></label>
      <button className="button button-primary" onClick={()=>void load(activeReport)}><RefreshCw size={18}/> عرض التقرير</button>
    </section>

    {activeReport==='attendance'?<>
      <section className="report-stats">
        <article><span>أيام العمل</span><strong>{summary.total}</strong></article>
        <article><span>الحضور</span><strong>{summary.present}</strong></article>
        <article><span>التأخير</span><strong>{summary.late}</strong></article>
        <article><span>الغياب</span><strong>{summary.absent}</strong></article>
      </section>

      <section className="panel data-table-panel">
        {loading?<div className="empty-state"><Loader2 className="spin"/><strong>جارٍ تحميل التقرير...</strong></div>
        :rows.length===0?<div className="empty-state"><Download/><strong>لا توجد بيانات في الفترة المختارة</strong></div>
        :<div className="responsive-table"><table className="data-table report-table">
          <thead><tr><th>التاريخ</th><th>الموظف</th><th>الفرع</th><th>اليوم</th><th>المخطط</th><th>الحضور</th><th>الانصراف</th><th>الحالة</th><th>التأخير</th><th>ساعات العمل</th></tr></thead>
          <tbody>{rows.map((r,i)=><tr key={`${r.employee_code}_${r.shift_date}_${i}`}>
            <td>{r.shift_date}</td>
            <td><div className="primary-cell"><strong>{r.employee_name}</strong><span>{r.employee_code}</span></div></td>
            <td><div className="primary-cell"><strong>{r.branch_name}</strong><span>{r.region_name??''}</span></div></td>
            <td>{labels[r.day_type]??r.day_type}</td>
            <td>{r.planned_start&&r.planned_end?`${r.planned_start} - ${r.planned_end}`:'-'}</td>
            <td>{r.check_in??'-'}</td>
            <td>{r.check_out??'-'}</td>
            <td><span className={`status-badge ${r.attendance_status}`}>{labels[r.attendance_status]??r.attendance_status}</span></td>
            <td>{r.late_minutes} دقيقة</td>
            <td>{(r.worked_minutes/60).toFixed(1)}</td>
          </tr>)}</tbody>
        </table></div>}
      </section>
    </>:<>
      <section className="report-stats">
        <article><span>أيام/فروع بالتقرير</span><strong>{branchSummary.days}</strong></article>
        <article><span>فتح متأخر</span><strong>{branchSummary.lateOpen}</strong></article>
        <article><span>إغلاق مبكر</span><strong>{branchSummary.earlyClose}</strong></article>
        <article><span>حالات تحتاج مراجعة</span><strong>{branchSummary.issues}</strong></article>
      </section>

      <section className="panel data-table-panel">
        {loading?<div className="empty-state"><Loader2 className="spin"/><strong>جارٍ تحميل تقرير الفروع...</strong></div>
        :branchRows.length===0?<div className="empty-state"><Download/><strong>لا توجد بيانات فروع في الفترة المختارة</strong></div>
        :<div className="responsive-table"><table className="data-table report-table">
          <thead><tr>
            <th>التاريخ</th><th>الفرع</th><th>فتح مخطط</th><th>فتح فعلي</th><th>تأخير الفتح</th><th>فتح بواسطة</th><th>حالة الفتح</th>
            <th>إغلاق مخطط</th><th>آخر خروج فعلي</th><th>إغلاق مبكر</th><th>آخر خروج بواسطة</th><th>حالة الإغلاق</th><th>ملاحظات</th>
          </tr></thead>
          <tbody>{branchRows.map(r=><tr key={`${r.branch_id}_${r.report_date}`}>
            <td>{r.report_date}</td>
            <td><div className="primary-cell"><strong>{r.branch_name}</strong><span>{r.region_name??r.branch_code}</span></div></td>
            <td>{r.planned_open??'-'}</td>
            <td>{r.actual_open??'-'}</td>
            <td>{r.opening_delay_minutes>0?`${r.opening_delay_minutes} دقيقة`:'-'}</td>
            <td>{r.opened_by_name?<div className="primary-cell"><strong>{r.opened_by_name}</strong><span>{r.opened_by_code??''}</span></div>:'-'}</td>
            <td><span className={`status-badge ${statusClass(r.open_status)}`}>{branchStatusLabels[r.open_status]??r.open_status}</span></td>
            <td>{r.planned_close??'-'}</td>
            <td>{r.actual_close??'-'}</td>
            <td>{r.early_close_minutes>0?`${r.early_close_minutes} دقيقة`:'-'}</td>
            <td>{r.closed_by_name?<div className="primary-cell"><strong>{r.closed_by_name}</strong><span>{r.closed_by_code??''}</span></div>:'-'}</td>
            <td><span className={`status-badge ${statusClass(r.close_status)}`}>{branchStatusLabels[r.close_status]??r.close_status}</span></td>
            <td>{r.open_sessions>0?`${r.open_sessions} جلسة مفتوحة`:r.auto_closed_sessions>0?`${r.auto_closed_sessions} بدون خروج فعلي`:'-'}</td>
          </tr>)}</tbody>
        </table></div>}
      </section>
    </>}
  </main>
}
