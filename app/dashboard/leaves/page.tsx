'use client'

import { useEffect,useMemo,useState } from 'react'
import { Check,FileText,Loader2,RefreshCw,X,XCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type Request={
  id:string;employee_id:string;employee_code:string;employee_name:string;
  branch_name:string|null;leave_type_name:string;starts_on:string;ends_on:string;
  requested_days:number;reason:string|null;status:string;
  reviewer_name:string|null;reviewer_notes:string|null;created_at:string;
  approval_stage?:'branch'|'region'|'completed';can_review?:boolean;
  branch_reviewer_name?:string|null;region_reviewer_name?:string|null;
}

const labels:Record<string,string>={
  pending:'قيد المراجعة',approved:'معتمد',rejected:'مرفوض',cancelled:'ملغي',
}
const stageLabels:Record<string,string>={
  branch:'بانتظار مدير الفرع',region:'بانتظار مدير المنطقة',completed:'مكتمل',
}

type Access={roles?:Array<{code:string;name:string}>}

export default function LeavesPage(){
  const [access,setAccess]=useState<Access>({})
  const [status,setStatus]=useState('')
  const [rows,setRows]=useState<Request[]>([])
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState('')
  const [success,setSuccess]=useState('')
  const [reviewing,setReviewing]=useState<{
    request:Request;decision:'approved'|'rejected'
  }|null>(null)
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
      useWorkflow?'app_list_leave_requests_v2':'app_list_leave_requests',
      {p_status:status||null},
    )
    if(rpcError)setError(rpcError.message)
    else setRows((data??[]) as Request[])
    setLoading(false)
  }
  useEffect(()=>{void load()},[])

  async function review(){
    if(!reviewing)return
    setLoading(true);setError('');setSuccess('')
    try{
      const supabase=createClient()
      const {data,error:rpcError}=await supabase.rpc(
        managerWorkflow?'app_review_leave_request_v2':'app_review_leave_request',{
          p_request_id:reviewing.request.id,
          p_decision:reviewing.decision,
          p_notes:notes,
        },
      )
      if(rpcError)throw rpcError
      setSuccess(
        data?.message
          ?String(data.message)
          :reviewing.decision==='approved'
            ?'تم اعتماد طلب الإجازة.'
            :'تم رفض طلب الإجازة.',
      )
      setReviewing(null);setNotes('');await load()
    }catch(caught){
      setError(caught instanceof Error?caught.message:'تعذر مراجعة طلب الإجازة.')
    }finally{setLoading(false)}
  }

  return <main className="dashboard-content">
    <section className="page-heading management-heading">
      <div><span className="eyebrow">اعتماد مدير الفرع ثم مدير المنطقة</span>
        <h1>طلبات الإجازات</h1>
        <p>الموظف يرسل الطلب لمدير الفرع أولًا، ثم ينتقل لمدير المنطقة للاعتماد النهائي. طلب مدير الفرع الشخصي يذهب لمدير المنطقة مباشرة.</p></div>
    </section>

    {error&&<div className="form-error management-message">{error}</div>}
    {success&&<div className="form-success management-message">
      <Check size={18}/>{success}</div>}

    <section className="panel shift-toolbar">
      <label>الحالة<select value={status}
        onChange={e=>setStatus(e.target.value)}>
        <option value="">كل الحالات</option>
        <option value="pending">قيد المراجعة</option>
        <option value="approved">معتمد</option>
        <option value="rejected">مرفوض</option>
        <option value="cancelled">ملغي</option>
      </select></label>
      <button className="button button-primary" onClick={()=>void load()} disabled={loading}>
        <RefreshCw className={loading?'spin':''} size={18}/> تحديث</button>
    </section>

    <section className="panel data-table-panel">
      {loading?<div className="empty-state"><Loader2 className="spin"/>
        <strong>جارٍ تحميل الطلبات...</strong></div>:
      rows.length===0?<div className="empty-state"><FileText/>
        <strong>لا توجد طلبات</strong></div>:
      <div className="responsive-table"><table className="data-table">
        <thead><tr><th>الموظف</th><th>الفرع</th><th>نوع الإجازة</th>
          <th>الفترة</th><th>الأيام</th><th>السبب</th>
          <th>الحالة</th><th>مرحلة الاعتماد</th><th>الإجراءات</th></tr></thead>
        <tbody>{rows.map(r=><tr key={r.id}>
          <td><div className="primary-cell"><strong>{r.employee_name}</strong>
            <span>{r.employee_code}</span></div></td>
          <td>{r.branch_name??'-'}</td><td>{r.leave_type_name}</td>
          <td>{r.starts_on} إلى {r.ends_on}</td><td>{r.requested_days}</td>
          <td>{r.reason??'-'}</td>
          <td><span className={`status-badge ${r.status}`}>
            {labels[r.status]??r.status}</span></td>
          <td><div className="primary-cell">
            <strong>{managerWorkflow?stageLabels[r.approval_stage??'completed']??r.approval_stage:'مراجعة مباشرة'}</strong>
            {r.branch_reviewer_name&&<span>مدير الفرع: {r.branch_reviewer_name}</span>}
            {r.region_reviewer_name&&<span>مدير المنطقة: {r.region_reviewer_name}</span>}
          </div></td>
          <td>{(managerWorkflow?r.can_review:r.status==='pending')?<div className="row-actions">
            <button title="اعتماد" onClick={()=>setReviewing({request:r,decision:'approved'})}>
              <Check size={17}/></button>
            <button className="danger" title="رفض"
              onClick={()=>setReviewing({request:r,decision:'rejected'})}>
              <X size={17}/></button>
          </div>:r.status==='pending'?<span className="status-badge neutral">للمتابعة</span>:
            r.reviewer_name??'-'}</td>
        </tr>)}</tbody>
      </table></div>}
    </section>

    {reviewing&&<div className="modal-backdrop"
      onMouseDown={event=>{if(event.target===event.currentTarget)setReviewing(null)}}>
      <section className="account-modal">
        <button className="modal-close" onClick={()=>setReviewing(null)}><XCircle/></button>
        <h2>{reviewing.decision==='approved'?'اعتماد طلب الإجازة':'رفض طلب الإجازة'}</h2>
        <p>{reviewing.request.employee_name} — {reviewing.request.starts_on} إلى {reviewing.request.ends_on}</p>
        <div className="form-note">
          المرحلة الحالية: {managerWorkflow?stageLabels[reviewing.request.approval_stage??'completed']??reviewing.request.approval_stage:'مراجعة مباشرة'}
        </div>
        <label>ملاحظات المدير<textarea rows={4} value={notes}
          onChange={e=>setNotes(e.target.value)}/></label>
        <button className={`button button-full ${
          reviewing.decision==='approved'?'button-primary':'button-danger-soft'
        }`} disabled={loading} onClick={()=>void review()}>
          {loading?<Loader2 className="spin" size={18}/>:
            reviewing.decision==='approved'?<Check size={18}/>:<X size={18}/>}
          تأكيد القرار
        </button>
      </section>
    </div>}
  </main>
}
