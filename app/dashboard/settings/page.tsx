'use client'

import { FormEvent,useEffect,useState } from 'react'
import { Check,Loader2,Plus,Save,X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type LeaveType={id:string;name:string;code:string;is_paid:boolean;requires_attachment:boolean;annual_entitlement:number|null;is_active:boolean}
type FormState={id:string|null;name:string;code:string;isPaid:boolean;annualEntitlement:string;isActive:boolean}
const emptyForm:FormState={id:null,name:'',code:'',isPaid:true,annualEntitlement:'',isActive:true}

export default function SettingsPage(){
 const [rows,setRows]=useState<LeaveType[]>([])
 const [form,setForm]=useState<FormState>(emptyForm)
 const [loading,setLoading]=useState(true)
 const [saving,setSaving]=useState(false)
 const [error,setError]=useState('')
 const [success,setSuccess]=useState('')

 async function load(){
  setLoading(true);setError('')
  const supabase=createClient()
  const {data,error:rpcError}=await supabase.rpc('app_list_leave_types')
  if(rpcError)setError(rpcError.message)
  else setRows((data??[]) as LeaveType[])
  setLoading(false)
 }
 useEffect(()=>{void load()},[])

 async function save(event:FormEvent<HTMLFormElement>){
  event.preventDefault();setSaving(true);setError('');setSuccess('')
  const supabase=createClient()
  const {error:rpcError}=await supabase.rpc('app_save_leave_type',{
   p_id:form.id,p_name:form.name.trim(),p_code:form.code.trim().toUpperCase(),p_is_paid:form.isPaid,
   p_annual_entitlement:form.annualEntitlement===''?null:Number(form.annualEntitlement),p_is_active:form.isActive,
  })
  if(rpcError)setError(rpcError.message)
  else{setSuccess('تم حفظ نوع الإجازة.');setForm(emptyForm);await load()}
  setSaving(false)
 }

 function edit(row:LeaveType){
  if(row.requires_attachment){setError('هذا النوع يتطلب مرفقًا، وتحريره متوقف حتى يدعم نموذج الموظف رفع المرفقات.');return}
  setError('');setSuccess('')
  setForm({id:row.id,name:row.name,code:row.code,isPaid:row.is_paid,annualEntitlement:row.annual_entitlement==null?'':String(row.annual_entitlement),isActive:row.is_active})
 }

 return <main className="dashboard-content">
  <section className="page-heading management-heading"><div><span className="eyebrow">إعدادات الشركة</span><h1>أنواع الإجازات</h1><p>إدارة الأنواع التي تظهر للموظفين عند إرسال طلب إجازة أو تعيين يوم إجازة في الجدول. الرصيد السنوي اختياري.</p></div></section>
  {error&&<div className="form-error management-message">{error}</div>}
  {success&&<div className="form-success management-message"><Check size={18}/>{success}</div>}
  <section className="panel form-panel">
   <h2>{form.id?'تعديل نوع إجازة':'إضافة نوع إجازة'}</h2>
   <form onSubmit={save} className="leave-settings-form">
    <div className="two-columns"><label>الاسم<input required maxLength={80} value={form.name} onChange={event=>setForm(current=>({...current,name:event.target.value}))}/></label>
     <label>الرمز<input required maxLength={32} value={form.code} onChange={event=>setForm(current=>({...current,code:event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g,'')}))}/></label></div>
    <div className="two-columns"><label>الحد السنوي بالأيام (اختياري)<input type="number" min="0" max="366" step="0.5" value={form.annualEntitlement} onChange={event=>setForm(current=>({...current,annualEntitlement:event.target.value}))}/></label>
     <label className="checkbox-label"><input type="checkbox" checked={form.isPaid} onChange={event=>setForm(current=>({...current,isPaid:event.target.checked}))}/> إجازة مدفوعة</label></div>
    <label className="checkbox-label"><input type="checkbox" checked={form.isActive} onChange={event=>setForm(current=>({...current,isActive:event.target.checked}))}/> متاح للموظفين</label>
    <div className="row-actions"><button className="button button-primary" disabled={saving}>{saving?<Loader2 className="spin" size={18}/>:<Save size={18}/>} حفظ</button>
     {form.id&&<button type="button" className="button button-ghost" onClick={()=>setForm(emptyForm)}><X size={18}/> إلغاء التعديل</button>}</div>
   </form>
  </section>
  <section className="panel data-table-panel"><div className="page-heading"><div><h2>الأنواع الحالية</h2><p>التعطيل يحفظ الطلبات والسجلات السابقة.</p></div><button className="button button-ghost" onClick={()=>{setForm(emptyForm);setError('');setSuccess('')}}><Plus size={18}/> نوع جديد</button></div>
   {loading?<div className="empty-state"><Loader2 className="spin"/><strong>جارٍ تحميل الأنواع...</strong></div>:rows.length===0?<div className="empty-state"><strong>لا توجد أنواع إجازات.</strong></div>:
    <div className="responsive-table"><table className="data-table"><thead><tr><th>الاسم</th><th>الرمز</th><th>الدفع</th><th>الرصيد السنوي</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td>{row.name}</td><td>{row.code}</td><td>{row.is_paid?'مدفوعة':'غير مدفوعة'}</td><td>{row.annual_entitlement??'غير محدد'}</td><td>{row.is_active?'مفعلة':'معطلة'}</td><td><button className="button button-ghost" onClick={()=>edit(row)}>تعديل</button></td></tr>)}</tbody></table></div>}
  </section>
 </main>
}
