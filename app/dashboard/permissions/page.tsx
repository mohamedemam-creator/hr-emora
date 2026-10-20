'use client'

import { useEffect, useMemo, useState } from 'react'
import { Check,FileClock,Loader2,RefreshCw,X,XCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type PermissionRequest = {
  id:string;employee_id:string;employee_code:string;employee_name:string;
  branch_name:string|null;permission_date:string;
  permission_type:'late_arrival'|'early_leave';requested_minutes:number;
  reason:string|null;status:string;reviewer_name:string|null;
  review_note:string|null;reviewed_at:string|null;created_at:string;
  approval_stage?:'branch'|'region'|'completed';can_review?:boolean;
  branch_reviewer_name?:string|null;region_reviewer_name?:string|null;
}

const statusLabels:Record<string,string>={
  pending:'قيد المراجعة',approved:'معتمد',rejected:'مرفوض',cancelled:'ملغي',
}
const stageLabels:Record<string,string>={
  branch:'بانتظار مدير الفرع',region:'بانتظار مدير المنطقة',completed:'مكتمل',
}
const typeLabels:Record<string,string>={
  late_arrival:'تأخير حضور',early_leave:'انصراف مبكر',
}

function formatMinutes(minutes:number){
  if(minutes===60)return 'ساعة'
  if(minutes===120)return 'ساعتان'
  if(minutes===240)return '4 ساعات'
  const hours=Math.floor(minutes/60)
  const rest=minutes%60
  return rest?`${hours} س ${rest} د`:`${hours} ساعة`
}
function currentMonth(){
  const now=new Date()
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`
}

type Access={roles?:Array<{code:string;name:string}>}

export default function HourPermissionsPage(){
  const [access,setAccess]=useState<Access>({})
  const [status,setStatus]=useState('')
  const [month,setMonth]=useState(currentMonth())
  const [rows,setRows]=useState<PermissionRequest[]>([])
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState('')
  const [success,setSuccess]=useState('')
  const [reviewing,setReviewing]=useState<{request:PermissionRequest;approve:boolean}|null>(null)
  const [notes,setNotes]=useState('')

  const managerWorkflow=useMemo(()=>{
    const roles=new Set((access.roles??[]).map(role=>role.code))
    return roles.has('BRANCH_MANAGER')||roles.has('REGION_MANAGER')||roles.has('SUPER_ADMIN')
  },[access.roles])

  async function load(){
    setLoading(true);setError('')
    const supabase=createClient()
    let useWorkflow=managerWorkflow
    if((access.roles??[]).length===0){
      const accessResult=await supabase.rpc('app_current_access')
      if(!accessResult.error&&accessResult.data){
        const nextAccess=accessResult.data as Access
        setAccess(nextAccess)
        const roles=new Set((nextAccess.roles??[]).map(role=>role.code))
        useWorkflow=roles.has('BRANCH_MANAGER')||roles.has('REGION_MANAGER')||roles.has('SUPER_ADMIN')
      }
    }
    const {data,error:rpcError}=await supabase.rpc(
      useWorkflow?'app_list_hour_permissions_v2':'app_list_hour_permissions',
      {p_status:status||null,p_month:month},
    )
    if(rpcError)setError(rpcError.message)
    else setRows((data??[]) as PermissionRequest[])
    setLoading(false)
  }
  useEffect(()=>{void load()},[])

  async function review(){
    if(!reviewing)return
    setLoading(true);setError('');setSuccess('')
    try{
      const supabase=createClient()
      const {data,error:rpcError}=await supabase.rpc(managerWorkflow?'app_review_hour_permission_v2':'app_review_hour_permission',{
        p_permission_id:reviewing.request.id,p_approve:reviewing.approve,p_note:notes,
      })
      if(rpcError)throw rpcError
      setSuccess(data?.message?String(data.message):reviewing.approve?'تم اعتماد الإذن.':'تم رفض الإذن.')
      setReviewing(null);setNotes('');await load()
    }catch(caught){
      setError(caught instanceof Error?caught.message:'تعذر مراجعة الطلب.')
    }finally{setLoading(false)}
  }

  const pendingCount=useMemo(()=>rows.filter(row=>row.status==='pending').length,[rows])
  const approvedMinutes=useMemo(()=>rows.filter(row=>row.status==='approved')
    .reduce((sum,row)=>sum+Number(row.requested_minutes||0),0),[rows])

  return <main className="dashboard-content">
    <section className="page-heading management-heading"><div>
      <span className="eyebrow">اعتماد مدير الفرع ثم مدير المنطقة</span>
      <h1>أذون الساعات</h1>
      <p>الموظف يرسل الإذن لمدير الفرع أولًا ثم مدير المنطقة. طلب مدير الفرع لنفسه يذهب مباشرة لمدير المنطقة.</p>
    </div></section>

    {error&&<div className="form-error management-message">{error}</div>}
    {success&&<div className="form-success management-message"><Check size={18}/>{success}</div>}

    <section className="report-stats">
      <article><span>الطلبات الظاهرة</span><strong>{rows.length}</strong></article>
      <article><span>قيد المراجعة</span><strong>{pendingCount}</strong></article>
      <article><span>الساعات المعتمدة بالفلتر</span><strong>{(approvedMinutes/60).toLocaleString('ar-EG')}</strong></article>
      <article><span>الحد الشهري لكل موظف</span><strong>4</strong></article>
    </section>

    <section className="panel shift-toolbar">
      <label>الشهر<input type="month" value={month.slice(0,7)}
        onChange={event=>setMonth(`${event.target.value}-01`)}/></label>
      <label>الحالة<select value={status} onChange={event=>setStatus(event.target.value)}>
        <option value="">كل الحالات</option><option value="pending">قيد المراجعة</option>
        <option value="approved">معتمد</option><option value="rejected">مرفوض</option>
        <option value="cancelled">ملغي</option>
      </select></label>
      <button className="button button-primary" onClick={()=>void load()} disabled={loading}>
        <RefreshCw className={loading?'spin':''} size={18}/>تحديث</button>
    </section>

    <section className="panel data-table-panel">
      {loading?<div className="empty-state"><Loader2 className="spin" size={30}/><strong>جارٍ تحميل الأذونات...</strong></div>:
      rows.length===0?<div className="empty-state"><FileClock size={42}/><strong>لا توجد أذونات مطابقة</strong>
        <span>غيّر الشهر أو الحالة ثم اضغط تحديث.</span></div>:
      <div className="responsive-table"><table className="data-table">
        <thead><tr><th>الموظف</th><th>الفرع</th><th>التاريخ</th><th>نوع الإذن</th>
          <th>المدة</th><th>السبب</th><th>الحالة</th><th>مرحلة الاعتماد</th><th>المراجعة</th></tr></thead>
        <tbody>{rows.map(row=><tr key={row.id}>
          <td><div className="primary-cell"><strong>{row.employee_name}</strong><span>{row.employee_code}</span></div></td>
          <td>{row.branch_name??'—'}</td><td>{row.permission_date}</td>
          <td>{typeLabels[row.permission_type]??row.permission_type}</td>
          <td>{formatMinutes(row.requested_minutes)}</td><td className="wide-cell">{row.reason??'—'}</td>
          <td><span className={`status-badge ${row.status}`}>{statusLabels[row.status]??row.status}</span></td>
          <td><div className="primary-cell"><strong>{managerWorkflow?stageLabels[row.approval_stage??'completed']??row.approval_stage:'مراجعة مباشرة'}</strong>
            {row.branch_reviewer_name&&<span>مدير الفرع: {row.branch_reviewer_name}</span>}
            {row.region_reviewer_name&&<span>مدير المنطقة: {row.region_reviewer_name}</span>}</div></td>
          <td>{(managerWorkflow?row.can_review:row.status==='pending')?<div className="row-actions">
            <button title="اعتماد" onClick={()=>setReviewing({request:row,approve:true})}><Check size={17}/></button>
            <button className="danger" title="رفض" onClick={()=>setReviewing({request:row,approve:false})}><X size={17}/></button>
          </div>:row.status==='pending'?<span className="status-badge neutral">للمتابعة</span>:
          <div className="primary-cell"><strong>{row.reviewer_name??'—'}</strong><span>{row.review_note??''}</span></div>}</td>
        </tr>)}</tbody>
      </table></div>}
    </section>

    {reviewing&&<div className="modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setReviewing(null)}}>
      <section className="account-modal">
        <button className="modal-close" onClick={()=>setReviewing(null)}><XCircle/></button>
        <h2>{reviewing.approve?'اعتماد إذن الساعات':'رفض إذن الساعات'}</h2>
        <p>{reviewing.request.employee_name} — {reviewing.request.permission_date} — {typeLabels[reviewing.request.permission_type]}</p>
        <div className="form-note">المرحلة الحالية: {managerWorkflow?stageLabels[reviewing.request.approval_stage??'completed']??reviewing.request.approval_stage:'مراجعة مباشرة'}</div>
        <label>ملاحظات المدير<textarea rows={4} value={notes} onChange={event=>setNotes(event.target.value)}/></label>
        <button className={`button button-full ${reviewing.approve?'button-primary':'button-danger-soft'}`}
          disabled={loading} onClick={()=>void review()}>
          {loading?<Loader2 className="spin" size={18}/>:reviewing.approve?<Check size={18}/>:<X size={18}/>}
          تأكيد القرار
        </button>
      </section>
    </div>}
  </main>
}
