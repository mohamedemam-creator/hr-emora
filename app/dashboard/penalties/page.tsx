'use client'

import { FormEvent,useEffect,useMemo,useState } from 'react'
import { AlertTriangle,Ban,Check,CheckCircle2,Download,Loader2,Plus,ShieldAlert,X,XCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type Employee={id:string;employee_code:string;full_name:string;branch_name:string|null;employment_status:string}
type Penalty={
  id:string;employee_id:string;employee_code:string;employee_name:string;branch_name:string|null;
  penalty_type:string;title:string;reason:string;amount:number;deduction_days:number;
  effective_date:string;status:string;created_by_name:string|null;created_at:string;
  salary_type:string|null;base_salary:number;day_rate:number;calculated_day_amount:number;
  total_financial_deduction:number;
}
type PenaltyRequest={
  id:string;employee_id:string;employee_code:string;employee_name:string;branch_name:string|null;
  penalty_type:string;title:string;reason:string;amount:number;deduction_days:number;
  effective_date:string;status:string;creator_name:string|null;reviewer_name:string|null;
  review_note:string|null;created_at:string;can_review:boolean;
}
type Access={permissions?:string[];roles?:Array<{code:string;name:string}>}

const typeLabels:Record<string,string>={
  warning:'إنذار',deduction_amount:'خصم مبلغ',deduction_days:'خصم أيام',other:'جزاء آخر',
}
const requestStatusLabels:Record<string,string>={pending:'بانتظار مدير المنطقة',approved:'تم الاعتماد',rejected:'مرفوض',cancelled:'ملغي'}


function dateInputValue(date:Date){
  const year=date.getFullYear()
  const month=String(date.getMonth()+1).padStart(2,'0')
  const day=String(date.getDate()).padStart(2,'0')
  return `${year}-${month}-${day}`
}
function currentMonthStart(){
  const now=new Date()
  return dateInputValue(new Date(now.getFullYear(),now.getMonth(),1))
}
function xmlEscape(value:unknown){
  return String(value??'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&apos;')
}
function crc32(bytes:Uint8Array){
  let crc=0xffffffff
  for(const byte of bytes){
    crc^=byte
    for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)
  }
  return (crc^0xffffffff)>>>0
}
function u16(value:number){return new Uint8Array([value&255,(value>>>8)&255])}
function u32(value:number){return new Uint8Array([value&255,(value>>>8)&255,(value>>>16)&255,(value>>>24)&255])}
function concatBytes(parts:Uint8Array[]){
  const size=parts.reduce((sum,part)=>sum+part.length,0)
  const out=new Uint8Array(size);let offset=0
  for(const part of parts){out.set(part,offset);offset+=part.length}
  return out
}
function storedZip(files:Array<{name:string;content:string}>){
  const encoder=new TextEncoder()
  const localParts:Uint8Array[]=[]
  const centralParts:Uint8Array[]=[]
  let offset=0
  for(const file of files){
    const name=encoder.encode(file.name)
    const data=encoder.encode(file.content)
    const crc=crc32(data)
    const local=concatBytes([
      u32(0x04034b50),u16(20),u16(0x0800),u16(0),u16(0),u16(0),u32(crc),u32(data.length),u32(data.length),
      u16(name.length),u16(0),name,data,
    ])
    localParts.push(local)
    const central=concatBytes([
      u32(0x02014b50),u16(20),u16(20),u16(0x0800),u16(0),u16(0),u16(0),u32(crc),u32(data.length),u32(data.length),
      u16(name.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),name,
    ])
    centralParts.push(central)
    offset+=local.length
  }
  const locals=concatBytes(localParts)
  const central=concatBytes(centralParts)
  const end=concatBytes([
    u32(0x06054b50),u16(0),u16(0),u16(files.length),u16(files.length),u32(central.length),u32(locals.length),u16(0),
  ])
  return concatBytes([locals,central,end])
}
function buildPenaltiesXlsx(rows:Penalty[]){
  const headers=['كود الموظف','اسم الموظف','الفرع','نوع الجزاء','العنوان','السبب','مبلغ الخصم المباشر','أيام الخصم','قيمة اليوم','قيمة خصم الأيام','إجمالي الخصم المالي الفعلي','تاريخ التطبيق','الحالة','منشئ الجزاء','تاريخ الإنشاء']
  const values=rows.map(row=>[
    row.employee_code,row.employee_name,row.branch_name??'',typeLabels[row.penalty_type]??row.penalty_type,row.title,row.reason,
    Number(row.amount||0),Number(row.deduction_days||0),Number(row.day_rate||0),Number(row.calculated_day_amount||0),
    Number(row.total_financial_deduction||0),row.effective_date,row.status==='approved'?'فعال':'ملغي',row.created_by_name??'',row.created_at,
  ])
  const cell=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)
    ?`<c><v>${value}</v></c>`
    :`<c t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`
  const sheetRows=[headers,...values].map((row,index)=>`<row r="${index+1}">${row.map(cell).join('')}</row>`).join('')
  const worksheet=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" rightToLeft="1"/></sheetViews><sheetData>${sheetRows}</sheetData><autoFilter ref="A1:O${values.length+1}"/></worksheet>`
  const workbook=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="الجزاءات" sheetId="1" r:id="rId1"/></sheets></workbook>`
  const workbookRels=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`
  const rootRels=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
  const contentTypes=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`
  return storedZip([
    {name:'[Content_Types].xml',content:contentTypes},
    {name:'_rels/.rels',content:rootRels},
    {name:'xl/workbook.xml',content:workbook},
    {name:'xl/_rels/workbook.xml.rels',content:workbookRels},
    {name:'xl/worksheets/sheet1.xml',content:worksheet},
  ])
}


function cairoToday(){
  const parts = new Intl.DateTimeFormat('en-GB',{
    timeZone:'Africa/Cairo',
    year:'numeric',
    month:'2-digit',
    day:'2-digit',
  }).formatToParts(new Date())
  const map = Object.fromEntries(parts.map(part=>[part.type,part.value]))
  return `${map.year}-${map.month}-${map.day}`
}

export default function PenaltiesPage(){
  const [employees,setEmployees]=useState<Employee[]>([])
  const [rows,setRows]=useState<Penalty[]>([])
  const [requests,setRequests]=useState<PenaltyRequest[]>([])
  const [access,setAccess]=useState<Access>({})
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState('')
  const [success,setSuccess]=useState('')
  const [open,setOpen]=useState(false)
  const [reviewing,setReviewing]=useState<{request:PenaltyRequest;approve:boolean}|null>(null)
  const [reviewNote,setReviewNote]=useState('')
  const [employeeFilter,setEmployeeFilter]=useState('')
  const [statusFilter,setStatusFilter]=useState('approved')
  const [dateFrom,setDateFrom]=useState(cairoToday())
  const [dateTo,setDateTo]=useState(cairoToday())
  const [form,setForm]=useState({
    employeeId:'',penaltyType:'warning',title:'',reason:'',amount:'0',deductionDays:'0',
    effectiveDate:new Date().toISOString().slice(0,10),
  })

  const roles=useMemo(()=>new Set((access.roles??[]).map(role=>role.code)),[access.roles])
  const isBranchManager=roles.has('BRANCH_MANAGER')
  const isRegionManager=roles.has('REGION_MANAGER')
  const isSuperAdmin=roles.has('SUPER_ADMIN')
  const permissions=useMemo(()=>new Set(access.permissions??[]),[access.permissions])
  const hasPenaltyManage=permissions.has('penalties.manage')
  const canCreatePenalty=isBranchManager||isSuperAdmin||hasPenaltyManage
  const canCancelActualPenalty=isRegionManager||isSuperAdmin||hasPenaltyManage

  async function load(){
    setLoading(true);setError('')
    const supabase=createClient()
    const accessResult=await supabase.rpc('app_current_access')
    let nextAccess:Access={}
    if(!accessResult.error&&accessResult.data){
      nextAccess=accessResult.data as Access
      setAccess(nextAccess)
    }
    const roleCodes=new Set((nextAccess.roles??[]).map(role=>role.code))
    const shouldLoadApprovalQueue=roleCodes.has('BRANCH_MANAGER')||roleCodes.has('REGION_MANAGER')||roleCodes.has('SUPER_ADMIN')

    const [penaltyResult,employeeResult,requestResult]=await Promise.all([
      supabase.rpc('app_list_penalties'),
      supabase.rpc('app_list_employees_v2'),
      shouldLoadApprovalQueue
        ?supabase.rpc('app_list_penalty_approval_requests',{p_status:null})
        :Promise.resolve({data:[],error:null}),
    ])
    if(penaltyResult.error)setError(penaltyResult.error.message)
    else setRows((penaltyResult.data??[]) as Penalty[])
    if(!employeeResult.error)setEmployees(((employeeResult.data??[]) as Employee[])
      .filter(employee=>employee.employment_status==='active'))
    if(requestResult.error)setError(current=>current||requestResult.error?.message||'تعذر تحميل طلبات الجزاءات.')
    else setRequests((requestResult.data??[]) as PenaltyRequest[])
    setLoading(false)
  }
  useEffect(()=>{void load()},[])

  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setLoading(true);setError('');setSuccess('')
    const supabase=createClient()
    const args={
      p_employee_id:form.employeeId,p_penalty_type:form.penaltyType,
      p_title:form.title,p_reason:form.reason,p_amount:Number(form.amount||0),
      p_deduction_days:Number(form.deductionDays||0),p_effective_date:form.effectiveDate,
    }
    const result=isBranchManager&&!isSuperAdmin
      ?await supabase.rpc('app_submit_penalty_for_approval',args)
      :await supabase.rpc('app_save_penalty',args)

    if(result.error)setError(result.error.message)
    else{
      setSuccess(isBranchManager&&!isSuperAdmin
        ?result.data?.message?String(result.data.message):'تم إرسال الجزاء إلى مدير المنطقة للاعتماد.'
        :'تم تسجيل الجزاء مباشرة.')
      setOpen(false)
      setForm(current=>({...current,employeeId:'',title:'',reason:'',amount:'0',deductionDays:'0'}))
      await load()
    }
    setLoading(false)
  }

  async function reviewPenaltyRequest(){
    if(!reviewing)return
    setLoading(true);setError('');setSuccess('')
    try{
      const supabase=createClient()
      const {data,error:rpcError}=await supabase.rpc('app_review_penalty_request',{
        p_request_id:reviewing.request.id,p_approve:reviewing.approve,p_note:reviewNote,
      })
      if(rpcError)throw rpcError
      setSuccess(data?.message?String(data.message):reviewing.approve?'تم اعتماد الجزاء.':'تم رفض طلب الجزاء.')
      setReviewing(null);setReviewNote('');await load()
    }catch(caught){setError(caught instanceof Error?caught.message:'تعذر مراجعة طلب الجزاء.')}
    finally{setLoading(false)}
  }

  async function cancel(p:Penalty){
    const reason=prompt('سبب إلغاء الجزاء:')
    if(reason===null)return
    setLoading(true);setError('')
    const supabase=createClient()
    const {error:rpcError}=await supabase.rpc('app_cancel_penalty',{p_penalty_id:p.id,p_reason:reason})
    if(rpcError)setError(rpcError.message)
    else{setSuccess('تم إلغاء الجزاء.');await load()}
    setLoading(false)
  }

  const filteredRows=useMemo(()=>rows.filter(row=>{
    if(employeeFilter&&row.employee_id!==employeeFilter)return false
    if(statusFilter!=='all'&&row.status!==statusFilter)return false
    if(dateFrom&&row.effective_date<dateFrom)return false
    if(dateTo&&row.effective_date>dateTo)return false
    return true
  }),[rows,employeeFilter,statusFilter,dateFrom,dateTo])
  const active=useMemo(()=>filteredRows.filter(row=>row.status==='approved').length,[filteredRows])
  const totalAmount=useMemo(()=>filteredRows.filter(row=>row.status==='approved')
    .reduce((sum,row)=>sum+Number(row.total_financial_deduction||0),0),[filteredRows])
  const totalDays=useMemo(()=>filteredRows.filter(row=>row.status==='approved')
    .reduce((sum,row)=>sum+Number(row.deduction_days||0),0),[filteredRows])
  const selectedEmployee=useMemo(()=>employees.find(employee=>employee.id===employeeFilter)??null,[employees,employeeFilter])
  const selectedPenaltySalary=useMemo(()=>filteredRows.find(row=>row.employee_id===employeeFilter)??null,[filteredRows,employeeFilter])

  function exportFilteredExcel(){
    if(filteredRows.length===0){setError('لا توجد نتائج في الفلاتر الحالية لتصديرها.');return}
    try{
      const bytes=buildPenaltiesXlsx(filteredRows)
      const blob=new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})
      const url=URL.createObjectURL(blob)
      const anchor=document.createElement('a')
      anchor.href=url
      anchor.download=`Emora-Penalties_${dateFrom||'all'}_${dateTo||'all'}.xlsx`
      document.body.appendChild(anchor);anchor.click();anchor.remove();URL.revokeObjectURL(url)
      setSuccess(`تم تصدير ${filteredRows.length} سجل إلى Excel حسب الفلاتر الحالية.`);setError('')
    }catch(caught){setError(caught instanceof Error?caught.message:'تعذر تصدير ملف Excel.')}
  }

  return <main className="dashboard-content">
    <section className="page-heading management-heading">
      <div><span className="eyebrow">اعتماد نهائي من مدير المنطقة</span>
        <h1>الجزاءات</h1>
        <p>مدير الفرع يرفع الجزاء لموظف داخل فرعه، ولا يصبح جزاءً فعليًا ولا يدخل الرواتب إلا بعد اعتماد مدير المنطقة.</p></div>
      {canCreatePenalty&&<button className="button button-primary" onClick={()=>setOpen(true)}>
        <Plus size={18}/> إضافة طلب جزاء</button>}
    </section>

    {error&&<div className="form-error management-message">{error}</div>}
    {success&&<div className="form-success management-message"><CheckCircle2 size={18}/>{success}</div>}

    <section className="panel data-table-panel" style={{marginBottom:18}}>
      <div className="portal-section-heading" style={{padding:'18px 18px 0'}}>
        <div><h2>طلبات اعتماد الجزاءات</h2><p>طلبات مدير الفرع قبل تحويلها إلى جزاءات فعلية.</p></div>
      </div>
      {loading?<div className="empty-state"><Loader2 className="spin"/><strong>جارٍ تحميل الطلبات...</strong></div>:
      requests.length===0?<div className="empty-state"><ShieldAlert/><strong>لا توجد طلبات جزاءات</strong></div>:
      <div className="responsive-table"><table className="data-table">
        <thead><tr><th>الموظف</th><th>الفرع</th><th>النوع</th><th>العنوان والسبب</th>
          <th>القيمة</th><th>تاريخ التطبيق</th><th>مقدم الطلب</th><th>الحالة</th><th>الإجراء</th></tr></thead>
        <tbody>{requests.map(request=><tr key={request.id}>
          <td><div className="primary-cell"><strong>{request.employee_name}</strong><span>{request.employee_code}</span></div></td>
          <td>{request.branch_name??'-'}</td><td>{typeLabels[request.penalty_type]??request.penalty_type}</td>
          <td><div className="primary-cell"><strong>{request.title}</strong><span>{request.reason}</span></div></td>
          <td>{request.penalty_type==='deduction_days'&&Number(request.deduction_days)>0
            ?`${request.deduction_days} يوم`:Number(request.amount)>0?`${Number(request.amount).toLocaleString('ar-EG')} جنيه`:'-'}</td>
          <td>{request.effective_date}</td><td>{request.creator_name??'-'}</td>
          <td><div className="primary-cell"><strong>{requestStatusLabels[request.status]??request.status}</strong>
            {request.reviewer_name&&<span>المراجع: {request.reviewer_name}</span>}
            {request.review_note&&<span>{request.review_note}</span>}</div></td>
          <td>{request.can_review?<div className="row-actions">
            <button title="اعتماد" onClick={()=>setReviewing({request,approve:true})}><Check size={17}/></button>
            <button className="danger" title="رفض" onClick={()=>setReviewing({request,approve:false})}><X size={17}/></button>
          </div>:request.status==='pending'?<span className="status-badge neutral">بانتظار المنطقة</span>:'-'}</td>
        </tr>)}</tbody>
      </table></div>}
    </section>

    <section className="panel report-filters penalties-filters">
      <label>الموظف<select value={employeeFilter} onChange={event=>setEmployeeFilter(event.target.value)}>
        <option value="">كل الموظفين</option>{employees.map(employee=><option key={employee.id} value={employee.id}>
          {employee.full_name} — {employee.employee_code}</option>)}</select></label>
      <label>الحالة<select value={statusFilter} onChange={event=>setStatusFilter(event.target.value)}>
        <option value="approved">الجزاءات الفعالة فقط</option><option value="cancelled">الجزاءات الملغاة فقط</option>
        <option value="all">كل الحالات</option></select></label>
      <label>تاريخ من<input type="date" value={dateFrom} max={dateTo||undefined}
        onChange={event=>setDateFrom(event.target.value)}/></label>
      <label>تاريخ إلى<input type="date" value={dateTo} min={dateFrom||undefined}
        onChange={event=>setDateTo(event.target.value)}/></label>
      <div className="penalties-filter-actions">
        <button className="button button-primary" disabled={filteredRows.length===0} onClick={exportFilteredExcel}>
          <Download size={17}/> تصدير Excel</button>
        <button className="button button-ghost" onClick={()=>{setEmployeeFilter('');setStatusFilter('approved');setDateFrom('');setDateTo('')}}>مسح الفلاتر</button>
      </div>
    </section>

    {selectedEmployee&&<div className="penalty-filter-title">ملخص خصومات: <strong>{selectedEmployee.full_name}</strong>
      <span>({selectedEmployee.employee_code})</span>{selectedPenaltySalary&&<span className="salary-calc-note">
        — المرتب: {Number(selectedPenaltySalary.base_salary||0).toLocaleString('ar-EG')} جنيه
        — قيمة اليوم: {Number(selectedPenaltySalary.day_rate||0).toLocaleString('ar-EG',{maximumFractionDigits:2})} جنيه
      </span>}</div>}

    <section className="report-stats penalty-summary-stats">
      <article><span>إجمالي السجلات</span><strong>{filteredRows.length}</strong></article>
      <article><span>الجزاءات الفعالة</span><strong>{active}</strong></article>
      <article><span>إجمالي الخصم المالي الفعلي</span><strong>{totalAmount.toLocaleString('ar-EG')} جنيه</strong></article>
      <article><span>إجمالي أيام الخصم</span><strong>{totalDays.toLocaleString('ar-EG')} يوم</strong></article>
    </section>

    <section className="panel data-table-panel">
      {loading?<div className="empty-state"><Loader2 className="spin"/><strong>جارٍ تحميل الجزاءات...</strong></div>:
      filteredRows.length===0?<div className="empty-state"><ShieldAlert/><strong>لا توجد جزاءات مسجلة</strong></div>:
      <div className="responsive-table"><table className="data-table">
        <thead><tr><th>الموظف</th><th>الفرع</th><th>النوع</th><th>العنوان والسبب</th><th>القيمة</th>
          <th>تاريخ التطبيق</th><th>الحالة</th><th>الإجراءات</th></tr></thead>
        <tbody>{filteredRows.map(p=><tr key={p.id}>
          <td><div className="primary-cell"><strong>{p.employee_name}</strong><span>{p.employee_code}</span></div></td>
          <td>{p.branch_name??'-'}</td><td>{typeLabels[p.penalty_type]}</td>
          <td><div className="primary-cell"><strong>{p.title}</strong><span>{p.reason}</span></div></td>
          <td>{p.penalty_type==='deduction_days'&&p.deduction_days>0?<div className="primary-cell">
            <strong>{p.deduction_days} يوم</strong><span>= {Number(p.calculated_day_amount||0).toLocaleString('ar-EG',{maximumFractionDigits:2})} جنيه</span></div>:
            p.amount>0?`${Number(p.amount).toLocaleString('ar-EG',{maximumFractionDigits:2})} جنيه`:'-'}</td>
          <td>{p.effective_date}</td><td><span className={`status-badge ${p.status}`}>{p.status==='approved'?'فعال':'ملغي'}</span></td>
          <td>{canCancelActualPenalty&&p.status==='approved'&&<button className="icon-danger-button"
            title="إلغاء الجزاء" onClick={()=>void cancel(p)}><Ban size={17}/></button>}</td>
        </tr>)}</tbody>
      </table></div>}
    </section>

    {open&&<div className="modal-backdrop"><form className="account-modal" onSubmit={submit}>
      <button type="button" className="modal-close" onClick={()=>setOpen(false)}><XCircle/></button>
      <div className="module-placeholder-icon"><AlertTriangle size={30}/></div><h2>إضافة طلب جزاء</h2>
      {isBranchManager&&!isSuperAdmin&&<div className="form-note">سيتم إرسال الجزاء إلى مدير المنطقة، ولن يدخل سجل الموظف أو الرواتب قبل الاعتماد النهائي.</div>}
      <label>الموظف<select required value={form.employeeId} onChange={e=>setForm(c=>({...c,employeeId:e.target.value}))}>
        <option value="">اختر الموظف</option>{employees.map(e=><option key={e.id} value={e.id}>
          {e.full_name} — {e.employee_code} — {e.branch_name??'بدون فرع'}</option>)}</select></label>
      <label>نوع الجزاء<select value={form.penaltyType} onChange={e=>setForm(c=>({...c,penaltyType:e.target.value}))}>
        <option value="warning">إنذار</option><option value="deduction_amount">خصم مبلغ</option>
        <option value="deduction_days">خصم أيام</option><option value="other">جزاء آخر</option></select></label>
      <label>عنوان الجزاء<input required value={form.title} onChange={e=>setForm(c=>({...c,title:e.target.value}))}/></label>
      <label>السبب<textarea required rows={4} value={form.reason} onChange={e=>setForm(c=>({...c,reason:e.target.value}))}/></label>
      <div className="two-columns"><label>مبلغ الخصم<input type="number" min="0" step="0.01" value={form.amount}
        onChange={e=>setForm(c=>({...c,amount:e.target.value}))}/></label>
        <label>أيام الخصم<input type="number" min="0" step="0.5" value={form.deductionDays}
          onChange={e=>setForm(c=>({...c,deductionDays:e.target.value}))}/></label></div>
      <label>تاريخ التطبيق<input type="date" required value={form.effectiveDate}
        onChange={e=>setForm(c=>({...c,effectiveDate:e.target.value}))}/></label>
      <button className="button button-primary button-full" disabled={loading}>
        {loading?<Loader2 className="spin" size={18}/>:<Plus size={18}/>}إرسال الجزاء للاعتماد</button>
    </form></div>}

    {reviewing&&<div className="modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setReviewing(null)}}>
      <section className="account-modal"><button className="modal-close" onClick={()=>setReviewing(null)}><XCircle/></button>
        <h2>{reviewing.approve?'اعتماد الجزاء':'رفض طلب الجزاء'}</h2>
        <p>{reviewing.request.employee_name} — {reviewing.request.title}</p>
        <label>ملاحظات مدير المنطقة<textarea rows={4} value={reviewNote} onChange={event=>setReviewNote(event.target.value)}/></label>
        <button className={`button button-full ${reviewing.approve?'button-primary':'button-danger-soft'}`}
          disabled={loading} onClick={()=>void reviewPenaltyRequest()}>
          {loading?<Loader2 className="spin" size={18}/>:reviewing.approve?<Check size={18}/>:<X size={18}/>}
          تأكيد القرار</button>
      </section>
    </div>}
  </main>
}
