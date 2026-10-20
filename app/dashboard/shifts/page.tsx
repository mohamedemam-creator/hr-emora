'use client'

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Download, FileSpreadsheet, Loader2, Plus, RefreshCw, Save, Send, Trash2, Upload, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type Branch = { id:string; name:string; code:string }
type Employee = { id:string; employee_code:string; full_name:string; job_title:string|null; branch_id?:string|null; branch_name?:string|null; branch_code?:string|null }
type Template = { id:string; name:string; code:string; start_time:string; end_time:string; grace_minutes:number; break_minutes:number; is_break_paid:boolean; is_active:boolean }
type Assignment = { id:string; employee_id:string; branch_id:string; shift_template_id:string|null; shift_date:string; day_type:'work'|'off'|'leave'|'mission'; start_time:string|null; end_time:string|null; status:'draft'|'published'; notes:string|null }
type Workspace = { selected_branch_id:string|null; week_start:string; branches:Branch[]; employees:Employee[]; templates:Template[]; assignments:Assignment[]; can_manage:boolean; can_publish:boolean }
type AllScopeAccess = { can_use_all:boolean; company_wide:boolean }
type AllBranchesWorkspace = Workspace & { can_use_all:boolean; company_wide:boolean }
const ALL_BRANCHES_VALUE='__all_branches__'
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
function normalizeHeader(value:string) {
  return value.replace(/^\uFEFF/, '').replace(/\s+/g, ' ').trim()
}

function getRawValue(row:Record<string,unknown>, keys:string[]) {
  for (const key of keys) {
    if (row[key] !== undefined && String(row[key] ?? '').trim() !== '') return row[key]
  }

  const wanted = new Set(keys.map(normalizeHeader))
  for (const [rawKey,value] of Object.entries(row)) {
    if (wanted.has(normalizeHeader(rawKey)) && String(value ?? '').trim() !== '') return value
  }

  return ''
}

function getValue(row:Record<string,unknown>, keys:string[]) {
  const value=getRawValue(row,keys)
  return value === null || value === undefined ? '' : String(value).trim()
}

function validDateParts(year:number,month:number,day:number) {
  if(!Number.isInteger(year)||!Number.isInteger(month)||!Number.isInteger(day))return false
  if(year<2000||year>2100||month<1||month>12||day<1||day>31)return false
  const date=new Date(year,month-1,day,12,0,0,0)
  return date.getFullYear()===year&&date.getMonth()===month-1&&date.getDate()===day
}

function normalizeExcelDate(value:unknown) {
  if(value instanceof Date&&!Number.isNaN(value.getTime())){
    return formatLocalDate(value)
  }

  if(typeof value==='number'&&Number.isFinite(value)){
    const wholeDays=Math.floor(value)
    const utcMs=Date.UTC(1899,11,30)+wholeDays*86400000
    const date=new Date(utcMs)
    const year=date.getUTCFullYear()
    const month=date.getUTCMonth()+1
    const day=date.getUTCDate()
    if(!validDateParts(year,month,day))return ''
    return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
  }

  const raw=String(value??'').trim()
  if(!raw)return ''

  const iso=raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/)
  if(iso){
    const year=Number(iso[1]),month=Number(iso[2]),day=Number(iso[3])
    if(!validDateParts(year,month,day))return ''
    return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
  }

  const slash=raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/)
  if(slash){
    const first=Number(slash[1]),second=Number(slash[2]),year=Number(slash[3])
    let month:number
    let day:number

    if(first>12){
      day=first
      month=second
    }else if(second>12){
      month=first
      day=second
    }else{
      // Ambiguous values such as 9/3/2026 are treated as M/D/YYYY,
      // matching the Excel format used by the current shifts template.
      month=first
      day=second
    }

    if(!validDateParts(year,month,day))return ''
    return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
  }

  return ''
}

function normalizeExcelTime(value:unknown) {
  if(value instanceof Date&&!Number.isNaN(value.getTime())){
    return `${String(value.getHours()).padStart(2,'0')}:${String(value.getMinutes()).padStart(2,'0')}`
  }

  if(typeof value==='number'&&Number.isFinite(value)){
    const fraction=((value%1)+1)%1
    const totalMinutes=Math.round(fraction*24*60)%(24*60)
    const hours=Math.floor(totalMinutes/60)
    const minutes=totalMinutes%60
    return `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}`
  }

  const raw=String(value??'').trim()
  if(!raw)return ''

  const match=raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)
  if(!match)return ''
  const hours=Number(match[1]),minutes=Number(match[2])
  if(hours<0||hours>23||minutes<0||minutes>59)return ''
  return `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}`
}

export default function ShiftsPage() {
  const [workspace,setWorkspace] = useState<Workspace>({selected_branch_id:null,week_start:getFriday(),branches:[],employees:[],templates:[],assignments:[],can_manage:false,can_publish:false})
  const [branchId,setBranchId] = useState('')
  const [canUseAllBranches,setCanUseAllBranches] = useState(false)
  const [allBranchesCompanyWide,setAllBranchesCompanyWide] = useState(false)
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

  async function loadAllScopeAccess() {
    const supabase=createClient()
    const {data,error:rpcError}=await supabase.rpc('app_shift_all_scope_access')
    if(rpcError||!data)return
    const access=data as AllScopeAccess
    setCanUseAllBranches(Boolean(access.can_use_all))
    setAllBranchesCompanyWide(Boolean(access.company_wide))
  }

  async function load(nextBranch=branchId,nextWeek=weekStart) {
    setLoading(true); setError('')
    const supabase=createClient()

    if(nextBranch===ALL_BRANCHES_VALUE){
      const [allWorkspaceResult,policyResult]=await Promise.all([
        supabase.rpc('app_shift_all_accessible_workspace',{p_week_start:nextWeek}),
        supabase.rpc('app_shift_edit_policy'),
      ])

      if(allWorkspaceResult.error){
        setError(allWorkspaceResult.error.message)
      }else{
        const result=allWorkspaceResult.data as AllBranchesWorkspace
        setCanUseAllBranches(Boolean(result.can_use_all))
        setAllBranchesCompanyWide(Boolean(result.company_wide))
        setWorkspace({
          selected_branch_id:null,
          week_start:result.week_start,
          branches:result.branches??[],
          employees:result.employees??[],
          templates:[],
          assignments:result.assignments??[],
          can_manage:false,
          can_publish:false,
        })
      }

      if(!policyResult.error&&policyResult.data){
        setEditPolicy(policyResult.data as ShiftEditPolicy)
      }
      setChangeRequests([])
      setLoading(false)
      return
    }

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
  useEffect(()=>{void load();void loadAllScopeAccess()},[])
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
  const isAllBranches=branchId===ALL_BRANCHES_VALUE
  const allBranchesLabel=allBranchesCompanyWide?'كل الفروع':'كل الفروع التابعة لي'
  const todayLocal=formatLocalDate(new Date())
  const assignmentMap=useMemo(()=>new Map(workspace.assignments.map(item=>[`${item.employee_id}_${item.shift_date}`,item])),[workspace.assignments])
  const pendingMap=useMemo(()=>new Map(changeRequests.map(item=>[`${item.employee_id}_${item.shift_date}`,item])),[changeRequests])
  const weekPublished=useMemo(()=>workspace.assignments.some(item=>item.status==='published'),[workspace.assignments])
  const isPastDate=(date:string)=>date<editPolicy.today
  const canEditDate=(_date:string)=>!isAllBranches&&workspace.can_manage

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
    if(isAllBranches||!editing||!branchId)return
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
    if(isAllBranches)return
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

  async function deleteTemplate(template:Template) {
    if(!confirm(`حذف قالب "${template.name}" (${template.code})؟\n\nالشيفتات القديمة المرتبطة به لن تُحذف، لكن القالب نفسه سيُحذف نهائيًا.`))return

    setSaving(true);setError('');setSuccess('')
    const supabase=createClient()
    const {data,error:rpcError}=await supabase.rpc('app_delete_shift_template',{
      p_template_id:template.id,
    })

    if(rpcError){
      setError(rpcError.message)
    }else{
      const result=(data??{}) as {deleted?:boolean;linked_assignments?:number;name?:string}
      setSuccess(
        `تم حذف قالب ${result.name??template.name}.`+
        (Number(result.linked_assignments??0)>0
          ? ` تم الاحتفاظ بـ ${Number(result.linked_assignments)} شيفت قديم كما هو بدون حذف.`
          : '')
      )
      await load(branchId,weekStart)
    }
    setSaving(false)
  }
  async function publishWeek() {
    if(isAllBranches||!branchId)return

    const draftCount=workspace.assignments.filter(item=>item.status==='draft').length
    if(draftCount===0){
      setError('لا توجد شيفتات مسودة جديدة للنشر في هذا الأسبوع.')
      return
    }

    if(!confirm(`سيتم نشر ${draftCount} شيفت مسودة موجود حاليًا. يمكنك استكمال باقي الأيام لاحقًا كمسودة ثم نشرها مرة أخرى. هل تريد المتابعة؟`))return

    setSaving(true);setError('');setSuccess('')
    const supabase=createClient()
    const {data,error:rpcError}=await supabase.rpc('app_publish_shift_week',{p_branch_id:branchId,p_week_start:weekStart})
    if(rpcError)setError(rpcError.message)
    else{
      setSuccess(`تم نشر ${data??0} شيفت مسودة. يمكنك استكمال الخانات الفارغة لاحقًا ثم نشر المسودات الجديدة مرة أخرى.`)
      await load(branchId,weekStart)
    }
    setSaving(false)
  }
  async function importExcel(event:ChangeEvent<HTMLInputElement>) {
    const file=event.target.files?.[0];event.target.value=''
    if(isAllBranches){setError('استيراد Excel متاح بعد اختيار فرع محدد فقط.');return}
    if(!file)return
    if(weekPublished){
      setError('الأسبوع منشور بالفعل. لا يمكن استيراد تعديلات مباشرة عليه؛ استخدم الخلايا لإرسال طلبات موافقة.')
      return
    }

    setSaving(true);setError('');setSuccess('')
    try{
      const XLSX=await import('xlsx')
      // Keep Excel date/time cells as raw serial numbers.
      // This avoids the one-day timezone shift that can happen when SheetJS
      // converts an Excel date into a JavaScript Date object.
      const workbook=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false})
      const firstSheetName=workbook.SheetNames[0]
      if(!firstSheetName)throw new Error('ملف Excel لا يحتوي على ورقة بيانات.')

      const sheet=workbook.Sheets[firstSheetName]
      const sourceRows=XLSX.utils.sheet_to_json<Record<string,unknown>>(sheet,{defval:'',raw:true})

      const invalidRows:number[]=[]
      const rows=sourceRows.map((row,index)=>{
        const employeeCode=getValue(row,['كود الموظف','employee_code'])
        const branchCode=getValue(row,['كود الفرع','branch_code'])
        const rawDate=getRawValue(row,['التاريخ','shift_date'])
        const shiftDate=normalizeExcelDate(rawDate)
        const dayType=getValue(row,['نوع اليوم','day_type']).toLowerCase()||'work'
        const startTime=normalizeExcelTime(getRawValue(row,['وقت البداية','start_time']))
        const endTime=normalizeExcelTime(getRawValue(row,['وقت النهاية','end_time']))
        // Excel import is ALWAYS a draft operation.
        // Publishing is allowed only through the "نشر الأسبوع" button.
        const notes=getValue(row,['ملاحظات','notes'])

        const hasContent=employeeCode||branchCode||String(rawDate??'').trim()||startTime||endTime||notes
        if(!hasContent)return null

        const validDayType=['work','off','leave','mission'].includes(dayType)
        const workTimesValid=dayType!=='work'||Boolean(startTime&&endTime)

        if(!employeeCode||!branchCode||!shiftDate||!validDayType||!workTimesValid){
          invalidRows.push(index+2)
          return null
        }

        return {
          employee_code:employeeCode,
          branch_code:branchCode,
          shift_date:shiftDate,
          day_type:dayType,
          start_time:dayType==='work'?startTime:'',
          end_time:dayType==='work'?endTime:'',
          status:'draft',
          notes,
        }
      }).filter((row):row is NonNullable<typeof row>=>Boolean(row))

      if(rows.length===0){
        const details=invalidRows.length?` راجع الصفوف: ${invalidRows.join(', ')}.`:''
        throw new Error(`لم يتم العثور على صفوف شيفتات صالحة للاستيراد.${details}`)
      }

      const supabase=createClient()
      const {data,error:rpcError}=await supabase.rpc('app_import_shifts',{p_rows:rows})
      if(rpcError)throw rpcError

      const firstDate=rows.map(row=>row.shift_date).sort()[0]
      const importedWeek=getFriday(parseLocalDate(firstDate))
      setWeekPicker(importedWeek)
      setWeekStart(importedWeek)

      const result=(data??{}) as {
        saved?:number
        failed?:number
        errors?:Array<{row?:number;employee_code?:string;error?:string}>
      }
      const saved=Number(result.saved??0)
      const failed=Number(result.failed??0)
      const skippedInvalid=invalidRows.length
      const serverErrors=Array.isArray(result.errors)?result.errors:[]

      const successMessage=
        `تم حفظ ${saved} صف كمسودة`+
        (skippedInvalid?`، وتم تجاهل ${skippedInvalid} صف غير صالح (${invalidRows.join(', ')})`:'')+
        '. تم فتح أسبوع الملف تلقائيًا؛ النشر يتم فقط من زر "نشر الأسبوع".'

      setSuccess(successMessage)

      if(failed>0){
        const details=serverErrors.length
          ? serverErrors.map(item=>{
              const row=item.row??'?'
              const code=item.employee_code?` - موظف ${item.employee_code}`:''
              const message=item.error??'سبب غير معروف'
              return `صف ${row}${code}: ${message}`
            }).join(' | ')
          : 'لم يرسل الخادم تفاصيل الخطأ.'
        setError(`فشل ${failed} صف في الاستيراد. ${details}`)
      }else{
        setError('')
      }

      await load(branchId,importedWeek)
    }catch(caught){
      setError(caught instanceof Error?caught.message:'تعذر استيراد الملف.')
    }finally{
      setSaving(false)
    }
  }
  async function downloadTemplate() {
    if(isAllBranches){setError('نموذج Excel متاح بعد اختيار فرع محدد فقط.');return}
    const XLSX=await import('xlsx')
    const rows=[{'كود الموظف':'','كود الفرع':workspace.branches.find(b=>b.id===branchId)?.code??'','التاريخ':weekStart,'نوع اليوم':'work','وقت البداية':'09:00','وقت النهاية':'17:00','الحالة':'draft','ملاحظات':''}]
    const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet(rows),'Shifts');XLSX.writeFile(workbook,'Emora_Shifts_Template.xlsx')
  }
  async function exportExcel() {
    const XLSX=await import('xlsx')
    const employeeById=new Map(workspace.employees.map(employee=>[employee.id,employee]))
    const branchById=new Map(workspace.branches.map(branch=>[branch.id,branch]))
    const rows=workspace.assignments.map(item=>{
      const employee=employeeById.get(item.employee_id)
      const branch=branchById.get(item.branch_id)
      return {
        'كود الفرع':branch?.code??employee?.branch_code??'',
        'اسم الفرع':branch?.name??employee?.branch_name??'',
        'كود الموظف':employee?.employee_code??'',
        'اسم الموظف':employee?.full_name??'',
        'التاريخ':item.shift_date,
        'نوع اليوم':dayTypeLabels[item.day_type],
        'وقت البداية':item.start_time??'',
        'وقت النهاية':item.end_time??'',
        'الحالة':item.status,
        'ملاحظات':item.notes??'',
      }
    })
    const workbook=XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet(rows),'Shifts')
    const fileName=isAllBranches
      ? `Emora_Shifts_All_Branches_${weekStart}.xlsx`
      : `Emora_Shifts_${workspace.branches.find(branch=>branch.id===branchId)?.code??weekStart}_${weekStart}.xlsx`
    XLSX.writeFile(workbook,fileName)
  }

  return <main className="dashboard-content">
    <section className="page-heading management-heading"><div><span className="eyebrow">جدول فعلي</span><h1>الشيفتات الأسبوعية</h1><p>وزّع الموظفين يدويًا أو ارفع جدول Excel ثم انشره.</p></div><div className="page-actions">
      {!isAllBranches&&workspace.can_manage&&<button className="button button-primary" onClick={()=>setTemplateOpen(true)}><Plus size={18}/> قالب شيفت</button>}
      {!isAllBranches&&<button className="button button-ghost" onClick={()=>void downloadTemplate()}><Download size={18}/> نموذج Excel</button>}
      {!isAllBranches&&workspace.can_manage&&<button className="button button-ghost" onClick={()=>fileInput.current?.click()}><Upload size={18}/> استيراد Excel</button>}
      <button className="button button-ghost" onClick={()=>void exportExcel()}><FileSpreadsheet size={18}/> تصدير Excel</button>
      {!isAllBranches&&<input ref={fileInput} hidden type="file" accept=".xlsx,.xls" onChange={importExcel}/>}
      {!isAllBranches&&workspace.can_publish&&<button className="button button-primary" disabled={saving} onClick={()=>void publishWeek()}><Send size={18}/> نشر الأسبوع</button>}
    </div></section>
    {error&&<div className="form-error management-message">{error}</div>}
    {success&&<div className="form-success management-message"><CheckCircle2 size={18}/>{success}</div>}
    <section className="panel shift-toolbar shift-week-toolbar">
      <label>الفرع<select value={branchId} onChange={event=>{setEditing(null);setTemplateOpen(false);setBranchId(event.target.value)}}>{canUseAllBranches&&<option value={ALL_BRANCHES_VALUE}>{allBranchesLabel}</option>}{workspace.branches.map(b=><option key={b.id} value={b.id}>{b.name} — {b.code}</option>)}</select></label>
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
    {isAllBranches?
      <div className="shift-past-lock-note">
        وضع {allBranchesLabel} للعرض والتصدير فقط. اختر فرعًا محددًا لإضافة أو تعديل الشيفتات أو الاستيراد أو النشر.
      </div>:
      !editPolicy.can_manage_past&&
      <div className="shift-past-lock-note">
        أول نشر للأسبوع يتم مباشرة. بعد النشر — أو عند طلب إجازة/مأمورية أو تعديل يوم سابق — يرسل النظام طلب موافقة لمدير المنطقة قبل تطبيق التغيير.
      </div>}
    <section className="panel shift-grid-panel">
      {loading?<div className="empty-state"><Loader2 className="spin"/><strong>جارٍ تحميل الجدول...</strong></div>:
      workspace.employees.length===0?<div className="empty-state"><CalendarDays/><strong>{isAllBranches?'لا يوجد موظفون نشطون في الفروع المتاحة':'لا يوجد موظفون نشطون في الفرع'}</strong></div>:
      <div className="shift-grid-scroll"><table className="shift-grid"><thead><tr>{isAllBranches&&<th>الفرع</th>}<th>الموظف</th>{days.map((day,i)=><th key={day} className={day===todayLocal?'today-column':''}><strong>{dayLabels[i]}</strong><span>{day.slice(5)}</span></th>)}</tr></thead><tbody>{workspace.employees.map(employee=><tr key={employee.id}>{isAllBranches&&<td><strong>{employee.branch_name??workspace.branches.find(branch=>branch.id===employee.branch_id)?.name??'—'}</strong><span>{employee.branch_code??workspace.branches.find(branch=>branch.id===employee.branch_id)?.code??''}</span></td>}<td><strong>{employee.full_name}</strong><span>{employee.employee_code} • {employee.job_title??''}</span></td>{days.map(day=>{const item=assignmentMap.get(`${employee.id}_${day}`);const pending=pendingMap.get(`${employee.id}_${day}`);return <td key={day} className={day===todayLocal?'today-column':''}><button className={`shift-cell ${item?.day_type??'empty'} ${item?.status??''}`} disabled={!canEditDate(day)} onClick={()=>openCell(employee,day)}>{item?<><b>{dayTypeLabels[item.day_type]}</b><span>{item.start_time?`${item.start_time} - ${item.end_time}`:item.notes??''}</span><small>{item.status==='published'?'منشور':'مسودة'}</small>{pending&&<small>طلب تعديل معلق</small>}</>:isAllBranches?<><span>—</span></>:<><Plus size={16}/><span>إضافة</span>{pending&&<small>طلب معلق</small>}</>}</button></td>})}</tr>)}</tbody></table></div>}
    </section>
    {!isAllBranches&&changeRequests.length>0&&<section className="panel data-table-panel"><div className="page-heading"><div><span className="eyebrow">الموافقات</span><h2>طلبات تعديل الشيفتات المعلقة</h2><p>التعديلات بعد النشر، والإجازات والمأموريات، لا تطبق إلا بعد الموافقة.</p></div></div><div className="responsive-table"><table className="data-table"><thead><tr><th>الموظف</th><th>التاريخ</th><th>الطلب</th><th>التفاصيل</th><th>بواسطة</th><th>الإجراء</th></tr></thead><tbody>{changeRequests.map(request=><tr key={request.id}><td><div className="primary-cell"><strong>{request.employee_name}</strong><span>{request.employee_code}</span></div></td><td>{request.shift_date}</td><td>{request.request_type==='delete'?'حذف شيفت':request.requested_day_type?dayTypeLabels[request.requested_day_type]:'تعديل'}</td><td>{request.requested_day_type==='work'?`${request.requested_start??''} - ${request.requested_end??''}`:request.leave_type_name??'—'}</td><td>{request.requester_name??'—'}</td><td>{request.can_review?<div className="row-actions"><button disabled={saving} title="موافقة" onClick={()=>void reviewShiftRequest(request.id,'approved')}><CheckCircle2 size={17}/></button><button disabled={saving} className="danger" title="رفض" onClick={()=>void reviewShiftRequest(request.id,'rejected')}><X size={17}/></button></div>:<span className="status-badge">بانتظار مدير المنطقة</span>}</td></tr>)}</tbody></table></div></section>}
    {!isAllBranches&&editing&&<div className="modal-backdrop"><form className="account-modal shift-modal" onSubmit={saveAssignment}><button type="button" className="modal-close" onClick={()=>setEditing(null)}><X/></button><h2>{editing.employee.full_name}</h2><p>{editing.date}</p><label>نوع اليوم<select value={shiftForm.dayType} onChange={event=>setShiftForm(c=>({...c,dayType:event.target.value,leaveTypeId:event.target.value==='leave'?c.leaveTypeId:''}))}><option value="work">عمل</option><option value="off">راحة</option><option value="leave">إجازة</option><option value="mission">مأمورية</option></select></label>{shiftForm.dayType==='leave'&&<label>نوع الإجازة<select required value={shiftForm.leaveTypeId} onChange={event=>setShiftForm(c=>({...c,leaveTypeId:event.target.value}))}><option value="">اختر نوع الإجازة</option>{leaveTypes.map(type=><option key={type.id} value={type.id}>{type.name}{type.is_paid?' — مدفوعة':' — بدون راتب'}{type.requires_attachment?' — تحتاج مرفق':''}</option>)}</select></label>}{shiftForm.dayType==='work'&&<><label>قالب الشيفت<select value={shiftForm.templateId} onChange={event=>chooseTemplate(event.target.value)}><option value="">مخصص</option>{workspace.templates.filter(t=>t.is_active).map(t=><option key={t.id} value={t.id}>{t.name} — {t.start_time}-{t.end_time}</option>)}</select></label><div className="two-columns"><label>البداية<input type="time" value={shiftForm.startTime} onChange={event=>setShiftForm(c=>({...c,startTime:event.target.value}))}/></label><label>النهاية<input type="time" value={shiftForm.endTime} onChange={event=>setShiftForm(c=>({...c,endTime:event.target.value}))}/></label></div></>}<label>ملاحظات<input value={shiftForm.notes} onChange={event=>setShiftForm(c=>({...c,notes:event.target.value}))}/></label><button className="button button-primary button-full" disabled={saving}><Save size={18}/> حفظ / إرسال للموافقة</button>{editing.assignment&&<button type="button" className="button button-danger-soft button-full" onClick={()=>void deleteAssignment()}><Trash2 size={18}/> حذف / طلب حذف</button>}</form></div>}
    {!isAllBranches&&templateOpen&&<div className="modal-backdrop"><form className="account-modal" onSubmit={saveTemplate}><button type="button" className="modal-close" onClick={()=>setTemplateOpen(false)}><X/></button><h2>إضافة قالب شيفت</h2><div className="two-columns"><label>الاسم<input required value={templateForm.name} onChange={e=>setTemplateForm(c=>({...c,name:e.target.value}))}/></label><label>الكود<input required value={templateForm.code} onChange={e=>setTemplateForm(c=>({...c,code:e.target.value}))}/></label><label>البداية<input type="time" required value={templateForm.startTime} onChange={e=>setTemplateForm(c=>({...c,startTime:e.target.value}))}/></label><label>النهاية<input type="time" required value={templateForm.endTime} onChange={e=>setTemplateForm(c=>({...c,endTime:e.target.value}))}/></label><label>السماح بالدقائق<input type="number" min="0" value={templateForm.grace} onChange={e=>setTemplateForm(c=>({...c,grace:e.target.value}))}/></label><label>الاستراحة بالدقائق<input type="number" min="0" value={templateForm.breakMinutes} onChange={e=>setTemplateForm(c=>({...c,breakMinutes:e.target.value}))}/></label></div><label className="toggle-field"><input type="checkbox" checked={templateForm.paid} onChange={e=>setTemplateForm(c=>({...c,paid:e.target.checked}))}/> الاستراحة مدفوعة</label><button className="button button-primary button-full" disabled={saving}><Save size={18}/> حفظ القالب</button><div style={{marginTop:20,paddingTop:16,borderTop:'1px solid var(--border, #e5e7eb)'}}><h3 style={{margin:'0 0 10px'}}>قوالب الفرع الحالية</h3><p style={{margin:'0 0 12px',fontSize:13,opacity:.75}}>يمكن حذف القالب من هنا. حذف القالب لا يحذف الشيفتات القديمة المرتبطة به.</p>{workspace.templates.filter(t=>t.is_active).length===0?<div className="empty-state" style={{padding:12}}>لا توجد قوالب حالية.</div>:<div style={{display:'grid',gap:8,maxHeight:260,overflowY:'auto'}}>{workspace.templates.filter(t=>t.is_active).map(template=><div key={template.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,padding:'10px 12px',border:'1px solid var(--border, #e5e7eb)',borderRadius:10}}><div style={{minWidth:0}}><strong style={{display:'block'}}>{template.name}</strong><span style={{fontSize:12,opacity:.75}}>{template.code} • {template.start_time} - {template.end_time}</span></div><button type="button" className="button button-danger-soft" disabled={saving} onClick={()=>void deleteTemplate(template)} title={`حذف قالب ${template.name}`}><Trash2 size={17}/> حذف</button></div>)}</div>}</div></form></div>}
  </main>
}
