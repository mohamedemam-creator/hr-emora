'use client'

import { FormEvent, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle, Bell, CalendarDays, CheckCircle2, Clock3, FileText,
  Loader2, LogIn, LogOut, MapPin, Send, ShieldAlert, Smartphone, UserRound,
  WalletCards, XCircle,
} from 'lucide-react'
import { Logo } from '@/components/logo'
import { createClient } from '@/lib/supabase/client'
import {
  ensureIosWebKey,
  getExistingIosWebKey,
  isIosBrowser,
  makeSignedPayload,
  signIosPayload,
} from '@/lib/ios-web-secure'

type Profile = {
  employee_code:string; full_name:string; branch_name:string|null;
  attendance_radius_m:number|null; minimum_gps_accuracy_m:number|null;
  job_title_name:string|null; manager_name:string|null;
  salary_type:string; base_salary:number;
}
type Shift = {
  id:string; shift_date:string; day_type:'work'|'off'|'leave'|'mission';
  start_time:string|null; end_time:string|null; status:string;
  branch_name:string|null; notes:string|null;
}
type OpenSession = {
  id:string; check_in_at:string; late_minutes:number;
  branch_id:string; branch_name:string;
}
type Attendance = {
  id:string; date:string; check_in:string|null; check_out:string|null;
  status:string; late_minutes:number; early_leave_minutes:number;
  worked_minutes:number; branch_name:string|null;
}
type LeaveType = {
  id:string; name:string; code:string; annual_entitlement:number;
  is_paid:boolean; requires_attachment:boolean;
}
type LeaveBalance = {
  leave_type_id:string; name:string; entitlement:number;
  used:number; remaining:number;
}
type LeaveRequest = {
  id:string; leave_type_name:string; starts_on:string; ends_on:string;
  requested_days:number; reason:string|null; status:string;
  reviewer_notes:string|null; created_at:string;
}
type Penalty = {
  id:string; penalty_type:string; title:string; reason:string;
  amount:number; deduction_days:number; effective_date:string; status:string;
}
type Notification = {
  id:string; type:string; title:string; body:string;
  read_at:string|null; created_at:string;
}
type PortalData = {
  profile:Profile; today:string; week_start:string;
  today_shift:Shift|null; open_session:OpenSession|null;
  shifts:Shift[]; attendance:Attendance[]; leave_types:LeaveType[];
  leave_balances:LeaveBalance[]; leave_requests:LeaveRequest[];
  penalties:Penalty[]; notifications:Notification[];
}
type AttendanceResult = {
  message:string; distance_m:number; accuracy_m:number;
}

const dayTypeLabels={work:'عمل',off:'راحة',leave:'إجازة',mission:'مأمورية'}
const attendanceLabels:Record<string,string>={
  open:'داخل الشيفت',present:'حاضر',late:'متأخر',absent:'غائب',
  early_leave:'انصراف مبكر',missing_checkout:'لم يسجل انصراف',
  under_review:'قيد المراجعة',
}
const leaveLabels:Record<string,string>={
  pending:'قيد المراجعة',approved:'معتمد',rejected:'مرفوض',cancelled:'ملغي',
}
const penaltyLabels:Record<string,string>={
  warning:'إنذار',deduction_amount:'خصم مبلغ',
  deduction_days:'خصم أيام',other:'جزاء آخر',
}
function fridayOf(date=new Date()){
  const v=new Date(date);const day=v.getDay()
  const daysSinceFriday=(day-5+7)%7
  v.setDate(v.getDate()-daysSinceFriday)
  return v.toISOString().slice(0,10)
}
type IosWebStatus = {
  bound:boolean
  pending:boolean
  requestCode?:string
  deviceCode?:string
  message?:string
}

export default function PortalPage(){
  const [data,setData]=useState<PortalData|null>(null)
  const [loading,setLoading]=useState(true)
  const [working,setWorking]=useState(false)
  const [error,setError]=useState('')
  const [success,setSuccess]=useState('')
  const [weekStart,setWeekStart]=useState(fridayOf())
  const [locationInfo,setLocationInfo]=useState('')
  const [monitorInfo,setMonitorInfo]=useState('')
  const [iosMode,setIosMode]=useState(false)
  const [iosStatus,setIosStatus]=useState<IosWebStatus|null>(null)
  const [leaveOpen,setLeaveOpen]=useState(false)
  const [leaveForm,setLeaveForm]=useState({
    leaveTypeId:'',startsOn:'',endsOn:'',reason:'',
  })
  const watchId=useRef<number|null>(null)
  const lastSent=useRef(0)


  async function invokeIosWeb(body: Record<string, unknown>) {
    const supabase=createClient()
    const {data:result,error:functionError}=await supabase.functions.invoke(
      'ios-web-attendance',
      {body},
    )
    if(functionError)throw functionError
    if(result?.error)throw new Error(String(result.error))
    return result
  }

  async function refreshIosStatus() {
    const ios=isIosBrowser()
    setIosMode(ios)
    if(!ios){setIosStatus(null);return}

    try{
      const existing=await getExistingIosWebKey()
      if(!existing){
        setIosStatus({bound:false,pending:false})
        return
      }
      const result=await invokeIosWeb({
        action:'status',
        browserId:existing.browserId,
        publicKeySpki:existing.publicKeySpki,
      })
      setIosStatus({
        bound:Boolean(result?.bound),
        pending:Boolean(result?.pending),
        requestCode:result?.requestCode,
        deviceCode:result?.deviceCode,
        message:result?.message,
      })
    }catch(caught){
      setIosStatus({bound:false,pending:false})
      setError(caught instanceof Error?caught.message:'تعذر التحقق من تفعيل iPhone.')
    }
  }

  async function requestIosActivation() {
    setWorking(true);setError('');setSuccess('')
    try{
      const key=await ensureIosWebKey()
      const result=await invokeIosWeb({
        action:'request_binding',
        browserId:key.browserId,
        publicKeySpki:key.publicKeySpki,
        userAgent:navigator.userAgent,
      })
      setIosStatus({
        bound:Boolean(result?.bound),
        pending:Boolean(result?.pending ?? !result?.bound),
        requestCode:result?.requestCode,
        deviceCode:result?.deviceCode,
      })
      if(result?.bound){
        setSuccess('هذا iPhone مفعل بالفعل للحساب.')
      }else{
        setSuccess(
          `تم إرسال طلب تفعيل iPhone${result?.requestCode?` — كود الطلب ${result.requestCode}`:''}. بانتظار موافقة مدير المنطقة أو مدير النظام.`,
        )
      }
    }catch(caught){
      setError(caught instanceof Error?caught.message:'تعذر إرسال طلب تفعيل iPhone.')
    }finally{setWorking(false)}
  }

  async function signIosRequest(
    action:string,
    extra:Record<string,unknown>={},
  ){
    const key=await getExistingIosWebKey()
    if(!key)throw new Error('مفتاح iPhone الآمن غير موجود. يلزم إعادة التفعيل.')
    const payload=makeSignedPayload(action,key.browserId,extra)
    const signature=await signIosPayload(key.privateKey,payload)
    return {browserId:key.browserId,payload,signature}
  }

  async function load(){
    setLoading(true);setError('')
    const supabase=createClient()
    const {data:result,error:rpcError}=await supabase.rpc(
      'app_my_portal',{p_week_start:weekStart}
    )
    if(rpcError)setError(rpcError.message)
    else setData(result as PortalData)
    setLoading(false)
  }
  useEffect(()=>{void load()},[weekStart])
  useEffect(()=>{void refreshIosStatus()},[])
  useEffect(()=>{
    if(!iosStatus?.pending)return
    const timer=window.setInterval(()=>void refreshIosStatus(),15000)
    return()=>window.clearInterval(timer)
  },[iosStatus?.pending])

  useEffect(()=>{
    if(!data?.open_session||!navigator.geolocation){
      if(watchId.current!==null){
        navigator.geolocation.clearWatch(watchId.current);watchId.current=null
      }
      return
    }
    if(!iosMode||!iosStatus?.bound)return
    watchId.current=navigator.geolocation.watchPosition(
      position=>{
        const now=Date.now()
        if(now-lastSent.current<45000)return
        lastSent.current=now
        void signIosRequest('report_position',{
          latitude:position.coords.latitude,
          longitude:position.coords.longitude,
          accuracy:position.coords.accuracy,
        }).then(request=>invokeIosWeb({
          action:'signed',
          ...request,
        })).then((report:any)=>{
          if(!report)return
          if(report.accuracy_ok===false)setMonitorInfo('دقة الموقع ضعيفة.')
          else if(report.in_range===false)
            setMonitorInfo(`تنبيه: خارج نطاق الفرع (${report.distance_m??0} متر).`)
          else setMonitorInfo(`متابعة الموقع نشطة — داخل النطاق (${report.distance_m??0} متر).`)
        }).catch(()=>setMonitorInfo('تعذر تحديث متابعة الموقع.'))
      },
      ()=>setMonitorInfo('تعذر متابعة الموقع أثناء الشيفت.'),
      {enableHighAccuracy:true,maximumAge:15000,timeout:20000},
    )
    return()=>{
      if(watchId.current!==null){
        navigator.geolocation.clearWatch(watchId.current);watchId.current=null
      }
    }
  },[data?.open_session?.id,iosMode,iosStatus?.bound])

  async function signOut(){
    const supabase=createClient();await supabase.auth.signOut()
    window.location.href='/login'
  }
  function readLocation(){
    return new Promise<GeolocationPosition>((resolve,reject)=>{
      if(!navigator.geolocation){
        reject(new Error('الهاتف أو المتصفح لا يدعم تحديد الموقع.'));return
      }
      navigator.geolocation.getCurrentPosition(resolve,reject,{
        enableHighAccuracy:true,timeout:25000,maximumAge:0,
      })
    })
  }
  async function attendanceAction(action:'check_in'|'check_out'){
    if(!iosMode){
      setError('تسجيل الحضور والانصراف من الويب متاح مؤقتًا لأجهزة iPhone المفعلة فقط. مستخدمو Android يستخدمون تطبيق Selin Team.')
      return
    }
    if(!iosStatus?.bound){
      setError(iosStatus?.pending?
        'طلب تفعيل هذا iPhone ما زال بانتظار موافقة مدير المنطقة أو مدير النظام.':
        'يلزم تفعيل هذا iPhone أولًا قبل تسجيل الحضور أو الانصراف.')
      return
    }

    setWorking(true);setError('');setSuccess('');setLocationInfo('')
    try{
      const position=await readLocation()
      setLocationInfo(`دقة GPS: ${Math.round(position.coords.accuracy)} متر`)
      const request=await signIosRequest('attendance',{
        attendanceAction:action,
        latitude:position.coords.latitude,
        longitude:position.coords.longitude,
        accuracy:position.coords.accuracy,
      })
      const result=await invokeIosWeb({action:'signed',...request})
      setSuccess(result?.message??'تم تنفيذ العملية بنجاح.')
      await load()
    }catch(caught){
      setError(caught instanceof Error?caught.message:'تعذر تنفيذ عملية الحضور.')
    }finally{setWorking(false)}
  }
  async function submitLeave(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setWorking(true);setError('');setSuccess('')
    try{
      const supabase=createClient()
      const {error:rpcError}=await supabase.rpc('app_submit_leave_request',{
        p_leave_type_id:leaveForm.leaveTypeId,
        p_starts_on:leaveForm.startsOn,
        p_ends_on:leaveForm.endsOn,
        p_reason:leaveForm.reason,
      })
      if(rpcError)throw rpcError
      setLeaveOpen(false)
      setLeaveForm({leaveTypeId:'',startsOn:'',endsOn:'',reason:''})
      setSuccess('تم إرسال طلب الإجازة للمدير المختص.')
      await load()
    }catch(caught){
      setError(caught instanceof Error?caught.message:'تعذر إرسال الطلب.')
    }finally{setWorking(false)}
  }
  async function cancelLeave(id:string){
    if(!confirm('إلغاء طلب الإجازة؟'))return
    setWorking(true);setError('')
    const supabase=createClient()
    const {error:rpcError}=await supabase.rpc(
      'app_cancel_leave_request',{p_request_id:id}
    )
    if(rpcError)setError(rpcError.message)
    else{setSuccess('تم إلغاء الطلب.');await load()}
    setWorking(false)
  }

  const todayShift=data?.today_shift??null
  return <main className="employee-portal">
    <header className="portal-header">
      <Logo/>
      {(!iosMode||(!iosStatus?.bound&&!iosStatus?.pending))&&
        <button className="button button-ghost" onClick={signOut}>
          <LogOut size={18}/> تسجيل الخروج
        </button>}
      {iosMode&&(iosStatus?.bound||iosStatus?.pending)&&
        <div className="ios-locked-account">
          <ShieldAlert size={17}/>
          <span>الحساب مثبت على Safari الحالي</span>
        </div>}
    </header>

    {loading?<div className="empty-state"><Clock3/><strong>جارٍ تحميل بياناتك...</strong></div>:
    error&&!data?<div className="form-error">{error}</div>:data?<>
      <section className="portal-welcome">
        <div><span className="eyebrow">بوابة الموظف</span>
          <h1>مرحبًا، {data.profile.full_name}</h1>
          <p>{data.profile.job_title_name??'موظف'} • {data.profile.branch_name??'بدون فرع'}</p>
        </div>
        <div className="portal-code"><UserRound/><span>كود الموظف</span>
          <strong>{data.profile.employee_code}</strong>
        </div>
      </section>

      {error&&<div className="form-error portal-message">{error}</div>}
      {success&&<div className="form-success portal-message">
        <CheckCircle2 size={18}/>{success}</div>}

      <section className="attendance-action-card">
        <div className="attendance-action-info">
          <div className="attendance-action-icon">
            {data.open_session?<LogOut/>:<LogIn/>}
          </div>
          <div><span className="eyebrow">الحضور والانصراف بالـGPS</span>
            <h2>{data.open_session?'أنت داخل الشيفت الآن':
              todayShift?.day_type!=='work'?'لا يوجد شيفت عمل منشور اليوم':
              iosMode?
                iosStatus?.bound?'الحضور متاح من هذا iPhone':
                iosStatus?.pending?'بانتظار اعتماد هذا iPhone':
                'فعّل هذا iPhone للحضور':
              'الحضور متاح من تطبيق Selin Team على Android'}</h2>
            <p>{todayShift?.start_time?
              `${todayShift.branch_name} • ${todayShift.start_time} - ${todayShift.end_time}`:
              data.profile.branch_name??'لم يتم تحديد الفرع'}</p>
            {data.open_session&&<small>تم الحضور: {data.open_session.check_in_at}</small>}
            {locationInfo&&<small>{locationInfo}</small>}
            {monitorInfo&&<small className={monitorInfo.includes('خارج')?'monitor-danger':''}>
              {monitorInfo}</small>}
          </div>
        </div>
        {iosMode&&!iosStatus?.bound?
          <button className="button button-attendance"
            disabled={working||Boolean(iosStatus?.pending)}
            onClick={()=>void requestIosActivation()}>
            {working?<Loader2 className="spin" size={20}/>:<Smartphone size={20}/>}
            {iosStatus?.pending?'بانتظار الموافقة':'طلب تفعيل هذا iPhone'}
          </button>:
          <button className={`button button-attendance ${data.open_session?'checkout':''}`}
            disabled={working||!iosMode||!iosStatus?.bound||todayShift?.day_type!=='work'}
            onClick={()=>void attendanceAction(data.open_session?'check_out':'check_in')}>
            {working?<Loader2 className="spin" size={20}/>:
              data.open_session?<LogOut size={20}/>:<LogIn size={20}/>}
            {iosMode&&iosStatus?.bound?
              data.open_session?'تسجيل الانصراف':'تسجيل الحضور':
              'استخدم تطبيق Selin Team'}
          </button>}
      </section>

      <section className="portal-stats">
        <article><CalendarDays/><span>شيفت اليوم</span>
          <strong>{todayShift?dayTypeLabels[todayShift.day_type]:'غير منشور'}</strong>
          <small>{todayShift?.start_time?`${todayShift.start_time} - ${todayShift.end_time}`:''}</small>
        </article>
        <article><MapPin/><span>الفرع</span>
          <strong>{data.profile.branch_name??'غير محدد'}</strong>
          <small>نطاق الحضور: {data.profile.attendance_radius_m??0} متر</small>
        </article>
        <article><WalletCards/><span>الراتب الأساسي</span>
          <strong>{Number(data.profile.base_salary??0).toLocaleString('ar-EG')}</strong>
          <small>{data.profile.salary_type==='monthly'?'شهري':
            data.profile.salary_type==='daily'?'يومي':'بالساعة'}</small>
        </article>
      </section>

      {data.leave_balances.length>0&&<section className="portal-balance-grid">
        {data.leave_balances.map(balance=><article key={balance.leave_type_id}>
          <FileText/><div><span>{balance.name}</span>
            <strong>{balance.remaining} يوم متبقي</strong>
            <small>المستخدم {balance.used} من {balance.entitlement}</small>
          </div>
        </article>)}
      </section>}

      <section className="portal-grid">
        <article className="panel">
          <div className="portal-section-heading">
            <div><h2>جدول الأسبوع</h2><p>الشيفتات المنشورة فقط.</p></div>
            <input type="date" value={weekStart}
              onChange={e=>setWeekStart(e.target.value)}/>
          </div>
          <div className="portal-shifts">
            {data.shifts.length===0?<div className="empty-state small">
              <CalendarDays/><strong>لم يتم نشر جدول هذا الأسبوع</strong></div>:
              data.shifts.map(shift=><div key={shift.id}
                className={`portal-shift ${shift.day_type}`}>
                <div><strong>{new Date(`${shift.shift_date}T00:00:00`)
                  .toLocaleDateString('ar-EG',{weekday:'long'})}</strong>
                  <span>{shift.shift_date}</span></div>
                <b>{dayTypeLabels[shift.day_type]}</b>
                <span>{shift.start_time?`${shift.start_time} - ${shift.end_time}`:
                  shift.notes??''}</span>
              </div>)}
          </div>
        </article>

        <article className="panel">
          <div className="portal-section-heading">
            <div><h2>طلبات الإجازة</h2><p>قدّم الطلب وتابع قرار المدير.</p></div>
            <button className="button button-primary" onClick={()=>setLeaveOpen(true)}>
              <Send size={17}/> طلب إجازة
            </button>
          </div>
          <div className="portal-requests">
            {data.leave_requests.length===0?<div className="empty-state small">
              <FileText/><strong>لا توجد طلبات إجازة</strong></div>:
              data.leave_requests.slice(0,8).map(request=><div key={request.id}>
                <div><strong>{request.leave_type_name}</strong>
                  <span>{request.starts_on} إلى {request.ends_on}</span></div>
                <span>{request.requested_days} يوم</span>
                <b className={`leave-${request.status}`}>
                  {leaveLabels[request.status]??request.status}</b>
                {request.status==='pending'&&<button className="icon-danger-button"
                  onClick={()=>void cancelLeave(request.id)} title="إلغاء الطلب">
                  <XCircle size={17}/></button>}
              </div>)}
          </div>
        </article>
      </section>

      <section className="portal-grid">
        <article className="panel">
          <div className="portal-section-heading"><div>
            <h2>آخر سجلات الحضور</h2><p>أحدث 30 حركة.</p></div></div>
          <div className="portal-attendance">
            {data.attendance.length===0?<div className="empty-state small">
              <Clock3/><strong>لا توجد حركات حضور</strong></div>:
              data.attendance.slice(0,10).map(item=><div key={item.id}>
                <div><strong>{item.date}</strong><span>{item.branch_name??''}</span></div>
                <span>{item.check_in?.slice(11)??'--:--'} → {item.check_out?.slice(11)??'--:--'}</span>
                <b>{attendanceLabels[item.status]??item.status}</b>
              </div>)}
          </div>
        </article>
        <article className="panel">
          <div className="portal-section-heading"><div>
            <h2>الجزاءات</h2><p>الجزاءات المعتمدة على ملفك.</p></div>
            <ShieldAlert size={24}/></div>
          <div className="portal-penalties">
            {data.penalties.length===0?<div className="empty-state small">
              <CheckCircle2/><strong>لا توجد جزاءات</strong></div>:
              data.penalties.map(p=><div key={p.id}><AlertTriangle/>
                <div><strong>{p.title}</strong><span>{p.reason}</span>
                  <small>{p.effective_date}</small></div>
                <b>{penaltyLabels[p.penalty_type]??p.penalty_type}</b>
                {(p.amount>0||p.deduction_days>0)&&<em>
                  {p.amount>0?`${p.amount.toLocaleString('ar-EG')} جنيه`:
                    `${p.deduction_days} يوم`}</em>}
              </div>)}
          </div>
        </article>
      </section>

      <section className="panel portal-notifications-panel">
        <div className="portal-section-heading"><div>
          <h2>التنبيهات</h2><p>أحدث إشعارات النظام.</p></div><Bell size={24}/></div>
        <div className="portal-notifications">
          {data.notifications.length===0?<div className="empty-state small">
            <Bell/><strong>لا توجد تنبيهات</strong></div>:
            data.notifications.slice(0,10).map(n=><div key={n.id}><Bell/>
              <div><strong>{n.title}</strong><span>{n.body}</span></div>
              <small>{new Date(n.created_at).toLocaleString('ar-EG')}</small>
            </div>)}
        </div>
      </section>
    </>:null}

    {leaveOpen&&data&&<div className="modal-backdrop"
      onMouseDown={e=>{if(e.target===e.currentTarget)setLeaveOpen(false)}}>
      <form className="account-modal" onSubmit={submitLeave}>
        <button type="button" className="modal-close"
          onClick={()=>setLeaveOpen(false)}><XCircle/></button>
        <h2>طلب إجازة جديد</h2>
        <p>سيتم إرسال الطلب إلى المدير المختص.</p>
        <label>نوع الإجازة<select required value={leaveForm.leaveTypeId}
          onChange={e=>setLeaveForm(c=>({...c,leaveTypeId:e.target.value}))}>
          <option value="">اختر نوع الإجازة</option>
          {data.leave_types.map(type=><option key={type.id} value={type.id}>
            {type.name}</option>)}
        </select></label>
        <div className="two-columns">
          <label>من<input type="date" required min={data.today}
            value={leaveForm.startsOn}
            onChange={e=>setLeaveForm(c=>({...c,startsOn:e.target.value}))}/></label>
          <label>إلى<input type="date" required min={leaveForm.startsOn||data.today}
            value={leaveForm.endsOn}
            onChange={e=>setLeaveForm(c=>({...c,endsOn:e.target.value}))}/></label>
        </div>
        <label>السبب<textarea rows={4} value={leaveForm.reason}
          onChange={e=>setLeaveForm(c=>({...c,reason:e.target.value}))}/></label>
        <button className="button button-primary button-full" disabled={working}>
          {working?<Loader2 className="spin" size={18}/>:<Send size={18}/>}
          إرسال الطلب
        </button>
      </form>
    </div>}
  </main>
}
