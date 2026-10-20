'use client'

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Download, FileSpreadsheet, Loader2, Plus, RefreshCw, Save, Send, Trash2, Upload, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type Branch = { id:string; name:string; code:string }
type Employee = { id:string; employee_code:string; full_name:string; job_title:string|null }
type Template = { id:string; name:string; code:string; start_time:string; end_time:string; grace_minutes:number; break_minutes:number; is_break_paid:boolean; is_active:boolean }
type Assignment = { id:string; employee_id:string; branch_id:string; shift_template_id:string|null; shift_date:string; day_type:'work'|'off'|'leave'|'mission'; start_time:string|null; end_time:string|null; status:'draft'|'published'; notes:string|null }
type Workspace = { selected_branch_id:string|null; week_start:string; branches:Branch[]; employees:Employee[]; templates:Template[]; assignments:Assignment[]; can_manage:boolean; can_publish:boolean }
type ShiftEditPolicy = { today:string; can_manage_past:boolean }
type LeaveType = { id:string; name:string; code:string; is_paid:boolean; requires_attachment:boolean; annual_entitlement:number }
type ShiftChangeRequest = {
  id:string
  request_type:'upsert'|'delete'
  employee_id:string
  employee_code:string
  employee_name:string
  shift_date:string
  requested_day_type:'work'|'off'|'leave'|'mission'|null
  requested_start:string|null
  requested_end:string|null
  leave_type_name:string|null
  requester_name:string|null
  requested_at:string
  can_review:boolean
}

const dayLabels = ['الجمعة','السبت','الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس']
const dayTypeLabels = { work:'عمل', off:'راحة', leave:'إجازة', mission:'مأمورية' }

function formatLocalDate(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseLocalDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day, 12, 0, 0, 0)
}

function getFriday(value = new Date()) {
  const date = new Date(
    value.getFullYear(),
    value.getMonth(),
    value.getDate(),
    12,
    0,
    0,
    0,
  )
  const day = date.getDay()
  const daysSinceFriday = (day - 5 + 7) % 7
  date.setDate(date.getDate() - daysSinceFriday)
  return formatLocalDate(date)
}

function addDays(value: string, days: number) {
  const date = parseLocalDate(value)
  date.setDate(date.getDate() + days)
  return formatLocalDate(date)
}
function getValue(row:Record<string,unknown>, keys:string[]) {
  for (const key of keys) if (row[key] !== undefined && String(row[key]).trim() !== '') return String(row[key]).trim()
  return ''
}

export default function ShiftsPage() {
  const [workspace,setWorkspace] = useState<Workspace>({selected_branch_id:null,week_start:getFriday(),branches:[],employees:[],templates:[],assignments:[],can_manage:false,can_publish:false})
  const [branchId,setBranchId] = useState('')
  const [weekStart,setWeekStart] = useState(getFriday())
  const [weekPicker,setWeekPicker] = useState(getFriday())
  const [editPolicy,setEditPolicy] = useState<ShiftEditPolicy>({
    today:formatLocalDate(new Date()),
    can_manage_past:false,
  })
  const [loading,setLoading] = useState(true)
  const [saving,setSaving] = useState(false)
  const [error,setError] = useState('')
  const [success,setSuccess] = useState('')
  const [changeRequests,setChangeRequests] = useState<ShiftChangeRequest[]>([])
  const [leaveTypes,setLeaveTypes] = useState<LeaveType[]>([])
  const [editing,setEditing] = useState<{employee:Employee; date:string; assignment?:Assignment}|null>(null)
  const [shiftForm,setShiftForm] = useState({dayType:'work',templateId:'',startTime:'09:00',endTime:'17:00',notes:'',leaveTypeId:''})
  const [templateOpen,setTemplateOpen] = useState(false)
  const [templateForm,setTemplateForm] = useState({name:'',code:'',startTime:'09:00',endTime:'17:00',grace:'10',breakMinutes:'0',paid:false})
  const fileInput = useRef<HTMLInputElement|null>(null)

  async function load(nextBranch=branchId,nextWeek=weekStart) {
    setLoading(true); setError('')
    const supabase=createClient()
    const [workspaceResult,policyResult,requestsResult,leaveTypesResult]=await Promise.all([
      supabase.rpc('app_shift_workspace',{
        p_branch_id:nextBranch||null,
        p_week_start:nextWeek,
      }),
      supabase.rpc('app_shift_edit_policy'),
      supabase.rpc('app_list_shift_change_requests',{
        p_branch_id:nextBranch||null,
        p_week_start:nextWeek,
      }),
      supabase.rpc('app_list_shift_leave_types'),
    ])
    if(workspaceResult.error) setError(workspaceResult.error.message)
    else {
      const result=workspaceResult.data as Workspace
      setWorkspace(result)
      if(!nextBranch && result.selected_branch_id) setBranchId(result.selected_branch_id)
    }
    if(!policyResult.error&&policyResult.data){
      setEditPolicy(policyResult.data as ShiftEditPolicy)
    }
    if(!requestsResult.error) setChangeRequests((requestsResult.data??[]) as ShiftChangeRequest[])
    if(!leaveTypesResult.error) setLeaveTypes((leaveTypesResult.data??[]) as LeaveType[])
    setLoading(false)
  }
  useEffect(()=>{void load()},[])
  useEffect(()=>{if(branchId) void load(branchId,weekStart)},[branchId,weekStart])
  useEffect(()=>{setWeekPicker(weekStart)},[weekStart])

  function applyWeekDate() {
    if(!weekPicker)return
    const friday=getFriday(parseLocalDate(weekPicker))
    setWeekStart(friday)
  }

  function moveWeek(days:number) {
    const next=addDays(weekStart,days)
    setWeekPicker(next)
    setWeekStart(next)
  }

  const days=useMemo(()=>Array.from({length:7},(_,i)=>addDays(weekStart,i)),[weekStart])
  const todayLocal=formatLocalDate(new Date())
  const assignmentMap=useMemo(()=>new Map(workspace.assignments.map(item=>[`${item.employee_id}_${item.shift_date}`,item])),[workspace.assignments])
  const pendingMap=useMemo(()=>new Map(changeRequests.map(item=>[`${item.employee_id}_${item.shift_date}`,item])),[changeRequests])
  const weekPublished=useMemo(()=>workspace.assignments.some(item=>item.status==='published'),[workspace.assignments])
  const isPastDate=(date:string)=>date<editPolicy.today
  const canEditDate=(_date:string)=>workspace.can_manage

  function openCell(employee:Employee,date:string) {
    if(!canEditDate(date)){
      setError('الشيفت السابق مقفول لمدير الفرع. التعديل متاح فقط لمدير المنطقة أو مدير النظام.')
      return
    }
    const assignment=assignmentMap.get(`${employee.id}_${date}`)
    const template=workspace.templates.find(item=>item.id===assignment?.shift_template_id)
    setShiftForm({
      dayType:assignment?.day_type??'work',
      templateId:assignment?.shift_template_id??'',
      startTime:assignment?.start_time??template?.start_time??'09:00',
      endTime:assignment?.end_time??template?.end_time??'17:00',
      notes:assignment?.notes??'',
      leaveTypeId:'',
    })
    setEditing({employee,date,assignment})
  }
  function chooseTemplate(id:string) {
    const template=workspace.templates.find(item=>item.id===id)
    setShiftForm(current=>({...current,templateId:id,startTime:template?.start_time??current.startTime,endTime:template?.end_time??current.endTime}))
  }
  async function saveAssignment(event:FormEvent) {
    event.preventDefault()
    if(!editing||!branchId)return
    if(shiftForm.dayType==='leave'&&!shiftForm.leaveTypeId){
      setError('اختر نوع الإجازة أولًا.')
      return
    }
    setSaving(true);setError('');setSuccess('')
    const supabase=createClient()
    const {data,error:rpcError}=await supabase.rpc('app_request_shift_change',{
      p_assignment_id:editing.assignment?.id??null,
      p_employee_id:editing.employee.id,
      p_branch_id:branchId,
      p_template_id:shiftForm.templateId||null,
      p_shift_date:editing.date,
      p_day_type:shiftForm.dayType,
      p_start_time:shiftForm.dayType==='work'?shiftForm.startTime:null,
      p_end_time:shiftForm.dayType==='work'?shiftForm.endTime:null,
      p_status:editing.assignment?.status??'draft',
      p_notes:shiftForm.notes,
      p_leave_type_id:shiftForm.dayType==='leave'?shiftForm.leaveTypeId:null,
    })
    if(rpcError)setError(rpcError.message)
    else {
      const result=(data??{}) as {applied?:boolean;pending?:boolean;message?:string}
      setEditing(null)
      setSuccess(result.message??(result.pending?'تم إرسال طلب التعديل لمدير المنطقة.':'تم حفظ الشيفت.'))
      await load(branchId,weekStart)
    }
    setSaving(false)
  }

  async function deleteAssignment() {
    if(!editing?.assignment||!confirm('حذف هذا الشيفت؟'))return
    setSaving(true);setError('');setSuccess('')
    const supabase=createClient()
    const {data,error:rpcError}=await supabase.rpc('app_request_shift_delete',{p_assignment_id:editing.assignment.id})
    if(rpcError)setError(rpcError.message)
    else {
      const result=(data??{}) as {pending?:boolean;message?:string}
      setEditing(null)
      setSuccess(result.message??(result.pending?'تم إرسال طلب الحذف لمدير المنطقة.':'تم حذف الشيفت.'))
      await load(branchId,weekStart)
    }
    setSaving(false)
  }

  async function reviewShiftRequest(requestId:string,decision:'approved'|'rejected') {
    const notes=window.prompt(decision==='approved'?'ملاحظات الموافقة (اختياري):':'سبب الرفض (اختياري):','')??''
    setSaving(true);setError('');setSuccess('')
    const supabase=createClient()
    const {error:rpcError}=await supabase.rpc('app_review_shift_change_request',{
      p_request_id:requestId,
      p_decision:decision,
      p_notes:notes,
    })
    if(rpcError)setError(rpcError.message)
    else {
      setSuccess(decision==='approved'?'تم اعتماد التعديل وتطبيقه على الجدول.':'تم رفض طلب التعديل ولم يتغير الجدول.')
      await load(branchId,weekStart)
    }
    setSaving(false)
  }

  async function saveTemplate(event:FormEvent) {
    event.preventDefault()
    setSaving(true);setError('')
    const supabase=createClient()
    const {error:rpcError}=await supabase.rpc('app_save_shift_template',{
      p_template_id:null,p_branch_id:branchId,p_name:templateForm.name,p_code:templateForm.code,
      p_start_time:templateForm.startTime,p_end_time:templateForm.endTime,
      p_grace_minutes:Number(templateForm.grace),p_break_minutes:Number(templateForm.breakMinutes),
      p_is_break_paid:templateForm.paid,p_is_active:true,
    })
    if(rpcError)setError(rpcError.message)
    else{setTemplateOpen(false);setTemplateForm({name:'',code:'',startTime:'09:00',endTime:'17:00',grace:'10',breakMinutes:'0',paid:false});await load(branchId,weekStart)}
    setSaving(false)
  }
  async function publishWeek() {
    if(!branchId||!confirm('نشر جدول الأسبوع وإظهاره للموظفين؟'))return
    setSaving(true);setError('')
    const supabase=createClient()
    const {data,error:rpcError}=await supabase.rpc('app_publish_shift_week',{p_branch_id:branchId,p_week_start:weekStart})
    if(rpcError)setError(rpcError.message);else{setSuccess(`تم نشر ${data??0} شيفت.`);await load(branchId,weekStart)}
    setSaving(false)
  }
  async function importExcel(event:ChangeEvent<HTMLInputElement>) {
    const file=event.target.files?.[0];event.target.value=''
    if(!file)return
    if(weekPublished){
      setError('الأسبوع منشور بالفعل. لا يمكن استيراد تعديلات مباشرة عليه؛ استخدم الخلايا لإرسال طلبات موافقة.')
      return
    }
    setSaving(true);setError('')
    try{
      const XLSX=await import('xlsx')
      const workbook=XLSX.read(await file.arrayBuffer(),{type:'array'})
      const sheet=workbook.Sheets[workbook.SheetNames[0]]
      const rows=XLSX.utils.sheet_to_json<Record<string,unknown>>(sheet,{defval:''}).map(row=>({
        employee_code:getValue(row,['كود الموظف','employee_code']),
        branch_code:getValue(row,['كود الفرع','branch_code']),
        shift_date:getValue(row,['التاريخ','shift_date']),
        day_type:getValue(row,['نوع اليوم','day_type'])||'work',
        start_time:getValue(row,['وقت البداية','start_time']),
        end_time:getValue(row,['وقت النهاية','end_time']),
        status:getValue(row,['الحالة','status'])||'draft',
        notes:getValue(row,['ملاحظات','notes']),
      })).filter(row=>row.employee_code&&row.shift_date)
      const supabase=createClient()
      const {data,error:rpcError}=await supabase.rpc('app_import_shifts',{p_rows:rows})
      if(rpcError)throw rpcError
      const firstDate=rows.map(row=>row.shift_date).filter(Boolean).sort()[0]
      const importedWeek=firstDate?getFriday(parseLocalDate(firstDate)):weekStart
      setWeekPicker(importedWeek)
      setWeekStart(importedWeek)
      setSuccess(`تم حفظ ${data.saved} صف، وأخفق ${data.failed}. وتم فتح أسبوع الملف تلقائيًا.`)
      await load(branchId,importedWeek)
    }catch(caught){setError(caught instanceof Error?caught.message:'تعذر استيراد الملف.')}
    setSaving(false)
  }
  async function downloadTemplate() {
    const XLSX=await import('xlsx')
    const rows=[{'كود الموظف':'','كود الفرع':workspace.branches.find(b=>b.id===branchId)?.code??'','التاريخ':weekStart,'نوع اليوم':'work','وقت البداية':'09:00','وقت النهاية':'17:00','الحالة':'draft','ملاحظات':''}]
    const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet(rows),'Shifts');XLSX.writeFile(workbook,'Emora_Shifts_Template.xlsx')
  }
  async function exportExcel() {
    const XLSX=await import('xlsx')
    const rows=workspace.assignments.map(item=>({
      'كود الموظف':workspace.employees.find(e=>e.id===item.employee_id)?.employee_code??'',
      'اسم الموظف':workspace.employees.find(e=>e.id===item.employee_id)?.full_name??'',
      'التاريخ':item.shift_date,'نوع اليوم':dayTypeLabels[item.day_type],
      'وقت البداية':item.start_time??'','وقت النهاية':item.end_time??'','الحالة':item.status,'ملاحظات':item.notes??''
    }))
    const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet(rows),'Shifts');XLSX.writeFile(workbook,`Emora_Shifts_${weekStart}.xlsx`)
  }

  return <main className="dashboard-content">
    <section className="page-heading management-heading"><div><span className="eyebrow">جدول فعلي</span><h1>الشيفتات الأسبوعية</h1><p>وزّع الموظفين يدويًا أو ارفع جدول Excel ثم انشره.</p></div><div className="page-actions">
      {workspace.can_manage&&<button className="button button-primary" onClick={()=>setTemplateOpen(true)}><Plus size={18}/> قالب شيفت</button>}
      <button className="button button-ghost" onClick={()=>void downloadTemplate()}><Download size={18}/> نموذج Excel</button>
      {workspace.can_manage&&<button className="button button-ghost" onClick={()=>fileInput.current?.click()}><Upload size={18}/> استيراد Excel</button>}
      <button className="button button-ghost" onClick={()=>void exportExcel()}><FileSpreadsheet size={18}/> تصدير Excel</button>
      <input ref={fileInput} hidden type="file" accept=".xlsx,.xls" onChange={importExcel}/>
      {workspace.can_publish&&<button className="button button-primary" disabled={saving} onClick={()=>void publishWeek()}><Send size={18}/> نشر الأسبوع</button>}
    </div></section>
    {error&&<div className="form-error management-message">{error}</div>}
    {success&&<div className="form-success management-message"><CheckCircle2 size={18}/>{success}</div>}
    <section className="panel shift-toolbar shift-week-toolbar">
      <label>الفرع<select value={branchId} onChange={event=>setBranchId(event.target.value)}>{workspace.branches.map(b=><option key={b.id} value={b.id}>{b.name} — {b.code}</option>)}</select></label>
      <label>اختر أي تاريخ من الأسبوع — البداية الجمعة
        <input type="date" value={weekPicker} onChange={event=>setWeekPicker(event.target.value)}/>
      </label>
      <button className="button button-primary" onClick={applyWeekDate}><CalendarDays size={18}/> عرض الأسبوع</button>
      <div className="week-navigation">
        <button className="button button-ghost" onClick={()=>moveWeek(-7)}><ChevronRight size={18}/> الأسبوع السابق</button>
        <button className="button button-ghost" onClick={()=>moveWeek(7)}>الأسبوع التالي <ChevronLeft size={18}/></button>
      </div>
      <button className="button button-ghost" onClick={()=>void load(branchId,weekStart)}><RefreshCw size={18}/> تحديث</button>
    </section>
    {!editPolicy.can_manage_past&&
      <div className="shift-past-lock-note">
        أول نشر للأسبوع يتم مباشرة. بعد النشر — أو عند طلب إجازة/مأمورية أو تعديل يوم سابق — يرسل النظام طلب موافقة لمدير المنطقة قبل تطبيق التغيير.
      </div>}
    <section className="panel shift-grid-panel">
      {loading?<div className="empty-state"><Loader2 className="spin"/><strong>جارٍ تحميل الجدول...</strong></div>:
      workspace.employees.length===0?<div className="empty-state"><CalendarDays/><strong>لا يوجد موظفون نشطون في الفرع</strong></div>:
      <div className="shift-grid-scroll"><table className="shift-grid"><thead><tr><th>الموظف</th>{days.map((day,i)=><th key={day} className={day===todayLocal?'today-column':''}><strong>{dayLabels[i]}</strong><span>{day.slice(5)}</span></th>)}</tr></thead><tbody>{workspace.employees.map(employee=><tr key={employee.id}><td><strong>{employee.full_name}</strong><span>{employee.employee_code} • {employee.job_title??''}</span></td>{days.map(day=>{const item=assignmentMap.get(`${employee.id}_${day}`);const pending=pendingMap.get(`${employee.id}_${day}`);return <td key={day} className={day===todayLocal?'today-column':''}><button className={`shift-cell ${item?.day_type??'empty'} ${item?.status??''}`} disabled={!canEditDate(day)} onClick={()=>openCell(employee,day)}>{item?<><b>{dayTypeLabels[item.day_type]}</b><span>{item.start_time?`${item.start_time} - ${item.end_time}`:item.notes??''}</span><small>{item.status==='published'?'منشور':'مسودة'}</small>{pending&&<small>طلب تعديل معلق</small>}</>:<><Plus size={16}/><span>إضافة</span>{pending&&<small>طلب معلق</small>}</>}</button></td>})}</tr>)}</tbody></table></div>}
    </section>
    {changeRequests.length>0&&<section className="panel data-table-panel"><div className="page-heading"><div><span className="eyebrow">الموافقات</span><h2>طلبات تعديل الشيفتات المعلقة</h2><p>التعديلات بعد النشر، والإجازات والمأموريات، لا تطبق إلا بعد الموافقة.</p></div></div><div className="responsive-table"><table className="data-table"><thead><tr><th>الموظف</th><th>التاريخ</th><th>الطلب</th><th>التفاصيل</th><th>بواسطة</th><th>الإجراء</th></tr></thead><tbody>{changeRequests.map(request=><tr key={request.id}><td><div className="primary-cell"><strong>{request.employee_name}</strong><span>{request.employee_code}</span></div></td><td>{request.shift_date}</td><td>{request.request_type==='delete'?'حذف شيفت':request.requested_day_type?dayTypeLabels[request.requested_day_type]:'تعديل'}</td><td>{request.requested_day_type==='work'?`${request.requested_start??''} - ${request.requested_end??''}`:request.leave_type_name??'—'}</td><td>{request.requester_name??'—'}</td><td>{request.can_review?<div className="row-actions"><button disabled={saving} title="موافقة" onClick={()=>void reviewShiftRequest(request.id,'approved')}><CheckCircle2 size={17}/></button><button disabled={saving} className="danger" title="رفض" onClick={()=>void reviewShiftRequest(request.id,'rejected')}><X size={17}/></button></div>:<span className="status-badge">بانتظار مدير المنطقة</span>}</td></tr>)}</tbody></table></div></section>}
    {editing&&<div className="modal-backdrop"><form className="account-modal shift-modal" onSubmit={saveAssignment}><button type="button" className="modal-close" onClick={()=>setEditing(null)}><X/></button><h2>{editing.employee.full_name}</h2><p>{editing.date}</p><label>نوع اليوم<select value={shiftForm.dayType} onChange={event=>setShiftForm(c=>({...c,dayType:event.target.value,leaveTypeId:event.target.value==='leave'?c.leaveTypeId:''}))}><option value="work">عمل</option><option value="off">راحة</option><option value="leave">إجازة</option><option value="mission">مأمورية</option></select></label>{shiftForm.dayType==='leave'&&<label>نوع الإجازة<select required value={shiftForm.leaveTypeId} onChange={event=>setShiftForm(c=>({...c,leaveTypeId:event.target.value}))}><option value="">اختر نوع الإجازة</option>{leaveTypes.map(type=><option key={type.id} value={type.id}>{type.name}{type.is_paid?' — مدفوعة':' — بدون راتب'}{type.requires_attachment?' — تحتاج مرفق':''}</option>)}</select></label>}{shiftForm.dayType==='work'&&<><label>قالب الشيفت<select value={shiftForm.templateId} onChange={event=>chooseTemplate(event.target.value)}><option value="">مخصص</option>{workspace.templates.filter(t=>t.is_active).map(t=><option key={t.id} value={t.id}>{t.name} — {t.start_time}-{t.end_time}</option>)}</select></label><div className="two-columns"><label>البداية<input type="time" value={shiftForm.startTime} onChange={event=>setShiftForm(c=>({...c,startTime:event.target.value}))}/></label><label>النهاية<input type="time" value={shiftForm.endTime} onChange={event=>setShiftForm(c=>({...c,endTime:event.target.value}))}/></label></div></>}<label>ملاحظات<input value={shiftForm.notes} onChange={event=>setShiftForm(c=>({...c,notes:event.target.value}))}/></label><button className="button button-primary button-full" disabled={saving}><Save size={18}/> حفظ / إرسال للموافقة</button>{editing.assignment&&<button type="button" className="button button-danger-soft button-full" onClick={()=>void deleteAssignment()}><Trash2 size={18}/> حذف / طلب حذف</button>}</form></div>}
    {templateOpen&&<div className="modal-backdrop"><form className="account-modal" onSubmit={saveTemplate}><button type="button" className="modal-close" onClick={()=>setTemplateOpen(false)}><X/></button><h2>إضافة قالب شيفت</h2><div className="two-columns"><label>الاسم<input required value={templateForm.name} onChange={e=>setTemplateForm(c=>({...c,name:e.target.value}))}/></label><label>الكود<input required value={templateForm.code} onChange={e=>setTemplateForm(c=>({...c,code:e.target.value}))}/></label><label>البداية<input type="time" required value={templateForm.startTime} onChange={e=>setTemplateForm(c=>({...c,startTime:e.target.value}))}/></label><label>النهاية<input type="time" required value={templateForm.endTime} onChange={e=>setTemplateForm(c=>({...c,endTime:e.target.value}))}/></label><label>السماح بالدقائق<input type="number" min="0" value={templateForm.grace} onChange={e=>setTemplateForm(c=>({...c,grace:e.target.value}))}/></label><label>الاستراحة بالدقائق<input type="number" min="0" value={templateForm.breakMinutes} onChange={e=>setTemplateForm(c=>({...c,breakMinutes:e.target.value}))}/></label></div><label className="toggle-field"><input type="checkbox" checked={templateForm.paid} onChange={e=>setTemplateForm(c=>({...c,paid:e.target.checked}))}/> الاستراحة مدفوعة</label><button className="button button-primary button-full" disabled={saving}><Save size={18}/> حفظ القالب</button></form></div>}
  </main>
}
