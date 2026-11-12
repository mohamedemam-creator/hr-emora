'use client'

import {
  FormEvent,
  useEffect,
  useState } from 'react'
import { Skeleton } from '@/components/skeleton'
import { Check,
  Plus,
  Save,
  X,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type QuotaCategory='annual'|'monthly'|'sick'|'custom'
type LeaveType={id:string;name:string;code:string;is_paid:boolean;requires_attachment:boolean;quota_category:QuotaCategory;is_active:boolean}
type FormState={id:string|null;name:string;code:string;isPaid:boolean;quotaCategory:QuotaCategory;isActive:boolean}
type PolicyState={annualLeaveDays:string;monthlyLeaveDays:string;sickLeaveDays:string}
type LeavePolicy={annual_leave_days:number|null;monthly_leave_days:number|null;sick_leave_days:number|null;updated_at:string|null}
const emptyForm:FormState={id:null,name:'',code:'',isPaid:true,quotaCategory:'custom',isActive:true}
const emptyPolicy:PolicyState={annualLeaveDays:'',monthlyLeaveDays:'',sickLeaveDays:''}
const categoryLabels:Record<QuotaCategory,string>={annual:'سنوية',monthly:'شهرية',sick:'مرضية',custom:'بدون حد مركزي'}

function toInput(value:number|null|undefined){return value==null?'':String(value)}
function toNumber(value:string){return value.trim()===''?null:Number(value)}

export default function SettingsPage(){
 const [rows,setRows]=useState<LeaveType[]>([])
 const [form,setForm]=useState<FormState>(emptyForm)
 const [policy,setPolicy]=useState<PolicyState>(emptyPolicy)
 const [loading,setLoading]=useState(true)
 const [saving,setSaving]=useState(false)
 const [savingPolicy,setSavingPolicy]=useState(false)
 const [error,setError]=useState('')
 const [success,setSuccess]=useState('')

 async function load(){
  setLoading(true);setError('')
  const supabase=createClient()
  const [typesResult,policyResult]=await Promise.all([
   supabase.rpc('app_list_leave_types_with_category'),
   supabase.rpc('app_company_leave_policy'),
  ])
  if(typesResult.error)setError(typesResult.error.message)
  else setRows((typesResult.data??[]) as LeaveType[])
  if(policyResult.error)setError(current=>current||policyResult.error.message)
  else{
   const value=policyResult.data as LeavePolicy
   setPolicy({annualLeaveDays:toInput(value?.annual_leave_days),monthlyLeaveDays:toInput(value?.monthly_leave_days),sickLeaveDays:toInput(value?.sick_leave_days)})
  }
  setLoading(false)
 }
 useEffect(()=>{void load()},[])

 async function savePolicy(event:FormEvent<HTMLFormElement>){
  event.preventDefault();setSavingPolicy(true);setError('');setSuccess('')
  const supabase=createClient()
  const {error:rpcError}=await supabase.rpc('app_save_company_leave_policy',{
   p_annual_leave_days:toNumber(policy.annualLeaveDays),
   p_monthly_leave_days:toNumber(policy.monthlyLeaveDays),
   p_sick_leave_days:toNumber(policy.sickLeaveDays),
  })
  if(rpcError)setError(rpcError.message)
  else{setSuccess('تم حفظ سياسات الإجازات للشركة.');await load()}
  setSavingPolicy(false)
 }

 async function saveLeaveType(event:FormEvent<HTMLFormElement>){
  event.preventDefault();setSaving(true);setError('');setSuccess('')
  const supabase=createClient()
  const {error:rpcError}=await supabase.rpc('app_save_leave_type_with_category',{
   p_id:form.id,p_name:form.name.trim(),p_code:form.code.trim().toUpperCase(),
   p_is_paid:form.isPaid,p_quota_category:form.quotaCategory,p_is_active:form.isActive,
  })
  if(rpcError)setError(rpcError.message)
  else{setSuccess('تم حفظ نوع الإجازة.');setForm(emptyForm);await load()}
  setSaving(false)
 }

 function edit(row:LeaveType){
  if(row.requires_attachment){setError('هذا النوع يتطلب مرفقًا، وتحريره متوقف حتى يدعم نموذج الموظف رفع المرفقات.');return}
  setError('');setSuccess('')
  setForm({id:row.id,name:row.name,code:row.code,isPaid:row.is_paid,quotaCategory:row.quota_category,isActive:row.is_active})
 }

 return <main className="dashboard-content">
  <section className="page-heading management-heading"><div><span className="eyebrow">إعدادات الشركة</span><h1>سياسات الإجازات</h1><p>تُدار الحدود على مستوى الشركة وتُطبق مركزيًا على طلبات الموظفين حسب فئة الإجازة.</p></div></section>
  {error&&<div className="form-error management-message" role="alert">{error}</div>}
  {success&&<div className="form-success management-message" role="status"><Check size={18}/>{success}</div>}

  <section className="panel form-panel">
   <h2>الحدود الافتراضية للشركة</h2>
   <p className="field-help">اترك الحد فارغًا إذا لم ترغب في فرض حد مركزي. لا يحدد النظام قيمًا قانونية افتراضية.</p>
   <form onSubmit={savePolicy} className="leave-settings-form">
    <div className="three-columns">
     <label>الحد السنوي للإجازات (أيام)<input type="number" min="0" max="366" step="0.5" value={policy.annualLeaveDays} onChange={event=>setPolicy(current=>({...current,annualLeaveDays:event.target.value}))}/></label>
     <label>الحد الشهري للإجازات (أيام)<input type="number" min="0" max="31" step="0.5" value={policy.monthlyLeaveDays} onChange={event=>setPolicy(current=>({...current,monthlyLeaveDays:event.target.value}))}/></label>
     <label>حد الإجازة المرضية السنوي (أيام)<input type="number" min="0" max="366" step="0.5" value={policy.sickLeaveDays} onChange={event=>setPolicy(current=>({...current,sickLeaveDays:event.target.value}))}/></label>
    </div>
    <button className="button button-primary" disabled={savingPolicy}>{savingPolicy?<Skeleton size={18} />:<Save size={18}/>} حفظ سياسات الشركة</button>
   </form>
  </section>

  <section className="panel form-panel">
   <h2>{form.id?'تعديل نوع إجازة':'إضافة نوع إجازة'}</h2>
   <form onSubmit={saveLeaveType} className="leave-settings-form">
    <div className="two-columns">
     <label>الاسم<input required maxLength={80} value={form.name} onChange={event=>setForm(current=>({...current,name:event.target.value}))}/></label>
     <label>الرمز<input required maxLength={32} value={form.code} onChange={event=>setForm(current=>({...current,code:event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g,'')}))}/></label>
    </div>
    <div className="two-columns">
     <label>فئة الحد المركزي<select value={form.quotaCategory} onChange={event=>setForm(current=>({...current,quotaCategory:event.target.value as QuotaCategory}))}>
      <option value="annual">سنوية — تطبق الحد السنوي</option><option value="monthly">شهرية — تطبق الحد الشهري</option><option value="sick">مرضية — تطبق الحد المرضي</option><option value="custom">بدون حد مركزي</option>
     </select></label>
     <label className="checkbox-label"><input type="checkbox" checked={form.isPaid} onChange={event=>setForm(current=>({...current,isPaid:event.target.checked}))}/> إجازة مدفوعة</label>
    </div>
    <label className="checkbox-label"><input type="checkbox" checked={form.isActive} onChange={event=>setForm(current=>({...current,isActive:event.target.checked}))}/> متاح للموظفين</label>
    <div className="row-actions"><button className="button button-primary" disabled={saving}>{saving?<Skeleton size={18} />:<Save size={18}/>} حفظ النوع</button>
     {form.id&&<button type="button" className="button button-ghost" onClick={()=>setForm(emptyForm)}><X size={18}/> إلغاء التعديل</button>}</div>
   </form>
  </section>

  <section className="panel data-table-panel"><div className="page-heading"><div><h2>أنواع الإجازات</h2><p>تُجمع الطلبات ضمن فئة الحد المحددة أعلاه. التعطيل يحفظ الطلبات السابقة.</p></div><button className="button button-ghost" onClick={()=>{setForm(emptyForm);setError('');setSuccess('')}}><Plus size={18}/> نوع جديد</button></div>
   {loading?<div className="empty-state"><Skeleton /><strong>جارٍ تحميل الإعدادات...</strong></div>:rows.length===0?<div className="empty-state"><strong>لا توجد أنواع إجازات.</strong></div>:
    <div className="responsive-table"><table className="data-table"><thead><tr><th>الاسم</th><th>الرمز</th><th>الدفع</th><th>فئة الحد</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td>{row.name}</td><td>{row.code}</td><td>{row.is_paid?'مدفوعة':'غير مدفوعة'}</td><td>{categoryLabels[row.quota_category]}</td><td>{row.is_active?'مفعلة':'معطلة'}</td><td><button className="button button-ghost" onClick={()=>edit(row)}>تعديل</button></td></tr>)}</tbody></table></div>}
  </section>
 </main>
}
