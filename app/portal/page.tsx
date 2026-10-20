'use client'

import { FormEvent, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle, Bell, CalendarDays, CheckCircle2, Clock3, FileText,
  Loader2, LogIn, LogOut, MapPin, Send, ShieldAlert, Smartphone, UserRound,
  WalletCards, XCircle,
} from 'lucide-react'
import { Logo } from '@/components/logo'
import { FunctionsHttpError } from '@supabase/supabase-js'
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
type HourPermissionBalance = {
  monthly_limit_minutes:number; monthly_limit_hours:number;
  approved_minutes:number; pending_minutes:number;
  remaining_minutes:number; available_to_request_minutes:number;
  month:string;
}
type HourPermission = {
  id:string; permission_date:string;
  permission_type:'late_arrival'|'early_leave';
  requested_minutes:number; reason:string|null; status:string;
  review_note:string|null; reviewed_at:string|null; created_at:string;
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
const hourPermissionTypeLabels:Record<string,string>={
  late_arrival:'تأخير حضور',
  early_leave:'انصراف مبكر',
}
function formatPermissionMinutes(minutes:number){
  if(minutes===0)return '0 ساعة'
  if(minutes===60)return 'ساعة'
  if(minutes===120)return 'ساعتان'
  if(minutes===240)return '4 ساعات'
  const hours=Math.floor(minutes/60)
  const rest=minutes%60
  return rest?`${hours} س ${rest} د`:`${hours} ساعة`
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
  const [webExceptionAllowed,setWebExceptionAllowed]=useState(false)
  const [iosStatus,setIosStatus]=useState<IosWebStatus|null>(null)
  const [leaveOpen,setLeaveOpen]=useState(false)
  const [leaveForm,setLeaveForm]=useState({
    leaveTypeId:'',startsOn:'',endsOn:'',reason:'',
  })
  const [hourBalance,setHourBalance]=useState<HourPermissionBalance|null>(null)
  const [hourPermissions,setHourPermissions]=useState<HourPermission[]>([])
  const [permissionOpen,setPermissionOpen]=useState(false)
  const [permissionWorking,setPermissionWorking]=useState(false)
  const [permissionError,setPermissionError]=useState('')
  const [permissionForm,setPermissionForm]=useState<{
    permissionDate:string;
    permissionType:'late_arrival'|'early_leave';
    requestedMinutes:number;
    reason:string;
  }>({
    permissionDate:'',
    permissionType:'late_arrival',
    requestedMinutes:60,
    reason:'',
  })
  const watchId=useRef<number|null>(null)
  const lastSent=useRef(0)
  const secureWebMode=iosMode||webExceptionAllowed
  const attendanceReady=iosMode?Boolean(iosStatus?.bound):webExceptionAllowed
  const attendancePending=iosMode?Boolean(iosStatus?.pending):false


  async function invokeIosWeb(body: Record<string, unknown>) {
    const supabase=createClient()
    const {data:result,error:functionError}=await supabase.functions.invoke(
      'ios-web-attendance',
      {body},
    )

    if(functionError){
      if(functionError instanceof FunctionsHttpError){
        let payload:any=null
        try{payload=await functionError.context.json()}catch{}
        if(payload){
          const trace=payload.traceId?` — مرجع الخطأ: ${payload.traceId}`:''
          throw new Error(
            `${payload.error??payload.message??`فشل الطلب برمز ${functionError.context.status}.`}${trace}`,
          )
        }
      }
      throw functionError
    }

    if(result?.error){
      const trace=result?.traceId?` — مرجع الخطأ: ${result.traceId}`:''
      throw new Error(`${String(result.error)}${trace}`)
    }
    return result
  }

  async function invokeLegacyWeb(body: Record<string, unknown>) {
    const supabase=createClient()
    const {data:result,error:functionError}=await supabase.functions.invoke(
      'legacy-web-attendance',
      {body},
    )

    if(functionError){
      if(functionError instanceof FunctionsHttpError){
        let payload:any=null
        try{payload=await functionError.context.json()}catch{}
        if(payload){
          throw new Error(
            payload.error??
            payload.message??
            `فشل الطلب برمز ${functionError.context.status}.`,
          )
        }
      }
      throw functionError
    }

    if(result?.error){
      throw new Error(String(result.error))
    }
    return result
  }

  async function refreshIosStatus() {
    const ios=isIosBrowser()
    setIosMode(ios)

    if(!ios){
      const supabase=createClient()
      const {data:access,error:accessError}=await supabase.rpc(
        'app_my_web_attendance_access',
      )

      if(accessError){
        setWebExceptionAllowed(false)
        setIosStatus(null)
        return
      }

      const exceptionAllowed=Boolean(access?.allowed)
      setWebExceptionAllowed(exceptionAllowed)
      setIosStatus(null)

      if(!exceptionAllowed)return

      try{
        await invokeLegacyWeb({action:'status'})
      }catch(caught){
        setError(
          caught instanceof Error
            ? caught.message
            : 'تعذر التحقق من صلاحية الحضور من المتصفح.',
        )
      }
      return
    }

    setWebExceptionAllowed(false)

    try{
      const existing=await getExistingIosWebKey(false)
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

      if(result?.code==='KEY_CHANGED'&&result?.message){
        setError(String(result.message))
      }
    }catch(caught){
      setIosStatus({bound:false,pending:false})
      setError(
        caught instanceof Error
          ? caught.message
          : 'تعذر التحقق من تفعيل جهاز الحضور عبر المتصفح.',
      )
    }
  }

  async function requestIosActivation() {
    setWorking(true);setError('');setSuccess('')
    try{
      const key=await ensureIosWebKey(webExceptionAllowed)
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
        setSuccess('هذا المتصفح مفعل بالفعل للحضور لهذا الحساب.')
      }else{
        setSuccess(
          `تم إرسال طلب تفعيل جهاز الحضور${result?.requestCode?` — كود الطلب ${result.requestCode}`:''}. بانتظار موافقة مدير المنطقة أو مدير النظام.`,
        )
      }
    }catch(caught){
      setError(caught instanceof Error?caught.message:'تعذر إرسال طلب تفعيل جهاز الحضور.')
    }finally{setWorking(false)}
  }

  async function signIosRequest(
    action:string,
    extra:Record<string,unknown>={},
  ){
    const key=await getExistingIosWebKey(false)
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
  async function loadHourPermissions(){
    setPermissionError('')
    const supabase=createClient()
    const [balanceResult,listResult]=await Promise.all([
      supabase.rpc('app_my_hour_permission_balance'),
      supabase.rpc('app_list_my_hour_permissions'),
    ])

    if(balanceResult.error){
      setPermissionError(balanceResult.error.message)
      setHourBalance(null)
    }else{
      setHourBalance(balanceResult.data as HourPermissionBalance)
    }

    if(listResult.error){
      setPermissionError(current=>current||listResult.error.message)
      setHourPermissions([])
    }else{
      setHourPermissions((listResult.data??[]) as HourPermission[])
    }
  }
  useEffect(()=>{void load()},[weekStart])
  useEffect(()=>{void loadHourPermissions()},[])
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
    if(!secureWebMode||!attendanceReady)return
    watchId.current=navigator.geolocation.watchPosition(
      position=>{
        const now=Date.now()
        if(now-lastSent.current<45000)return
        lastSent.current=now

        const positionBody={
          latitude:position.coords.latitude,
          longitude:position.coords.longitude,
          accuracy:position.coords.accuracy,
        }

        const requestPromise=iosMode
          ? signIosRequest('report_position',positionBody)
              .then(request=>invokeIosWeb({
                action:'signed',
                ...request,
              }))
          : invokeLegacyWeb({
              action:'position',
              ...positionBody,
            })

        void requestPromise.then((report:any)=>{
          if(!report)return
          if(report.accuracy_ok===false)setMonitorInfo('دقة الموقع ضعيفة.')
          else if(report.in_range===false)
            setMonitorInfo(`تنبيه: خارج نطاق الفرع (${report.distance_m??0} متر).`)
          else setMonitorInfo(`متابعة الموقع نشطة — داخل النطاق (${report.distance_m??0} متر).`)
        }).catch(caught=>setMonitorInfo(
          caught instanceof Error
            ? `تعذر تحديث الموقع: ${caught.message}`
            : 'تعذر تحديث متابعة الموقع.',
        ))
      },
      ()=>setMonitorInfo('تعذر متابعة الموقع أثناء الشيفت.'),
      {enableHighAccuracy:true,maximumAge:15000,timeout:20000},
    )
    return()=>{
      if(watchId.current!==null){
        navigator.geolocation.clearWatch(watchId.current);watchId.current=null
      }
    }
  },[data?.open_session?.id,iosMode,webExceptionAllowed,iosStatus?.bound,attendanceReady])

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
    if(!secureWebMode){
      setError(
        'تسجيل الحضور والانصراف من المتصفح غير مصرح لهذا الحساب. استخدم تطبيق Selin Team.',
      )
      return
    }

    if(iosMode&&!iosStatus?.bound){
      setError(iosStatus?.pending?
        'طلب تفعيل جهاز الحضور ما زال بانتظار موافقة مدير المنطقة أو مدير النظام.':
        'يلزم تفعيل جهاز الحضور عبر المتصفح أولًا قبل تسجيل الحضور أو الانصراف.')
      return
    }

    if(!iosMode&&!webExceptionAllowed){
      setError('الحضور من المتصفح غير مفعل لهذا الحساب.')
      return
    }

    setWorking(true);setError('');setSuccess('');setLocationInfo('')
    try{
      const position=await readLocation()
      setLocationInfo(`دقة GPS: ${Math.round(position.coords.accuracy)} متر`)

      let result:any

      if(iosMode){
        const request=await signIosRequest('attendance',{
          attendanceAction:action,
          latitude:position.coords.latitude,
          longitude:position.coords.longitude,
          accuracy:position.coords.accuracy,
        })
        result=await invokeIosWeb({action:'signed',...request})
      }else{
        result=await invokeLegacyWeb({
          action:'attendance',
          attendanceAction:action,
          latitude:position.coords.latitude,
          longitude:position.coords.longitude,
          accuracy:position.coords.accuracy,
        })
      }

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

  async function submitHourPermission(event:FormEvent<HTMLFormElement>){
    event.preventDefault()
    setPermissionWorking(true)
    setPermissionError('')
    setSuccess('')
    try{
      const supabase=createClient()
      const {data:result,error:rpcError}=await supabase.rpc(
        'app_request_hour_permission',
        {
          p_permission_date:permissionForm.permissionDate,
          p_permission_type:permissionForm.permissionType,
          p_requested_minutes:permissionForm.requestedMinutes,
          p_reason:permissionForm.reason,
        },
      )
      if(rpcError)throw rpcError
      setPermissionOpen(false)
      setPermissionForm({
        permissionDate:'',
        permissionType:'late_arrival',
        requestedMinutes:60,
        reason:'',
      })
      setSuccess(
        result?.message
          ? String(result.message)
          : 'تم إرسال طلب الإذن للمراجعة.',
      )
      await loadHourPermissions()
    }catch(caught){
      setPermissionError(
        caught instanceof Error?caught.message:'تعذر إرسال طلب الإذن.',
      )
    }finally{
      setPermissionWorking(false)
    }
  }

  async function cancelHourPermission(id:string){
    if(!confirm('إلغاء طلب الإذن؟'))return
    setPermissionWorking(true)
    setPermissionError('')
    try{
      const supabase=createClient()
      const {error:rpcError}=await supabase.rpc(
        'app_cancel_hour_permission',
        {p_permission_id:id},
      )
      if(rpcError)throw rpcError
      setSuccess('تم إلغاء طلب الإذن.')
      await loadHourPermissions()
    }catch(caught){
      setPermissionError(
        caught instanceof Error?caught.message:'تعذر إلغاء طلب الإذن.',
      )
    }finally{
      setPermissionWorking(false)
    }
  }

  function openHourPermission(){
    setPermissionError('')
    setPermissionForm({
      permissionDate:data?.today??'',
      permissionType:'late_arrival',
      requestedMinutes:60,
      reason:'',
    })
    setPermissionOpen(true)
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
          <span>الحساب مثبت على متصفح الحضور الحالي</span>
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
                iosStatus?.bound?'الحضور متاح من Safari المفعّل':
                iosStatus?.pending?'بانتظار اعتماد جهاز الحضور':
                'فعّل جهاز الحضور عبر Safari':
              webExceptionAllowed?
                'الحضور متاح من متصفح Android المسموح':
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
            disabled={working||attendancePending}
            onClick={()=>void requestIosActivation()}>
            {working?<Loader2 className="spin" size={20}/>:<Smartphone size={20}/>}
            {attendancePending?'بانتظار الموافقة':'طلب تفعيل جهاز الحضور'}
          </button>:
          <button className={`button button-attendance ${data.open_session?'checkout':''}`}
            disabled={working||!attendanceReady||todayShift?.day_type!=='work'}
            onClick={()=>void attendanceAction(data.open_session?'check_out':'check_in')}>
            {working?<Loader2 className="spin" size={20}/>:
              data.open_session?<LogOut size={20}/>:<LogIn size={20}/>}
            {attendanceReady?
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

      {hourBalance&&<section className="portal-balance-grid">
        <article><Clock3/><div>
          <span>رصيد الأذونات الشهري</span>
          <strong>{formatPermissionMinutes(hourBalance.monthly_limit_minutes)}</strong>
          <small>يتجدد تلقائيًا كل شهر</small>
        </div></article>
        <article><CheckCircle2/><div>
          <span>المستخدم المعتمد</span>
          <strong>{formatPermissionMinutes(hourBalance.approved_minutes)}</strong>
          <small>{hourBalance.pending_minutes>0
            ? `${formatPermissionMinutes(hourBalance.pending_minutes)} قيد المراجعة`
            : 'لا توجد طلبات معلقة'}</small>
        </div></article>
        <article><WalletCards/><div>
          <span>المتبقي المتاح</span>
          <strong>{formatPermissionMinutes(hourBalance.available_to_request_minutes)}</strong>
          <small>الحد الأقصى 4 ساعات شهريًا</small>
        </div></article>
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

      <section className="panel portal-notifications-panel">
        <div className="portal-section-heading">
          <div>
            <h2>أذون الساعات</h2>
            <p>رصيد شهري 4 ساعات للتأخير أو الانصراف المبكر.</p>
          </div>
          <button
            className="button button-primary"
            onClick={openHourPermission}
            disabled={permissionWorking||hourBalance?.available_to_request_minutes===0}
          >
            <Send size={17}/> طلب إذن
          </button>
        </div>

        {permissionError&&<div className="form-error">{permissionError}</div>}

        <div className="portal-requests">
          {hourPermissions.length===0?<div className="empty-state small">
            <Clock3/><strong>لا توجد أذونات هذا الشهر</strong>
            <span>يمكنك استخدام الرصيد على ساعة أو ساعتين أو 4 ساعات.</span>
          </div>:
          hourPermissions.slice(0,12).map(request=><div key={request.id}>
            <div>
              <strong>{hourPermissionTypeLabels[request.permission_type]??request.permission_type}</strong>
              <span>{request.permission_date}{request.reason?` • ${request.reason}`:''}</span>
            </div>
            <span>{formatPermissionMinutes(request.requested_minutes)}</span>
            <b className={`leave-${request.status}`}>
              {leaveLabels[request.status]??request.status}
            </b>
            {request.status==='pending'&&<button
              className="icon-danger-button"
              disabled={permissionWorking}
              onClick={()=>void cancelHourPermission(request.id)}
              title="إلغاء طلب الإذن"
            >
              <XCircle size={17}/>
            </button>}
          </div>)}
        </div>
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

    {permissionOpen&&data&&<div className="modal-backdrop"
      onMouseDown={e=>{if(e.target===e.currentTarget)setPermissionOpen(false)}}>
      <form className="account-modal" onSubmit={submitHourPermission}>
        <button type="button" className="modal-close"
          onClick={()=>setPermissionOpen(false)}><XCircle/></button>
        <h2>طلب إذن ساعات</h2>
        <p>
          الرصيد المتاح حاليًا: {' '}
          <strong>{formatPermissionMinutes(hourBalance?.available_to_request_minutes??0)}</strong>.
          الوقت الحقيقي للحضور والانصراف يظل محفوظًا، والجزء المعتمد لا يُخصم من المرتب.
        </p>

        {permissionError&&<div className="form-error">{permissionError}</div>}

        <label>التاريخ
          <input
            type="date"
            required
            value={permissionForm.permissionDate}
            onChange={e=>setPermissionForm(c=>({...c,permissionDate:e.target.value}))}
          />
        </label>

        <label>نوع الإذن
          <select
            required
            value={permissionForm.permissionType}
            onChange={e=>setPermissionForm(c=>({
              ...c,
              permissionType:e.target.value as 'late_arrival'|'early_leave',
            }))}
          >
            <option value="late_arrival">تأخير حضور</option>
            <option value="early_leave">انصراف مبكر</option>
          </select>
        </label>

        <label>مدة الإذن
          <select
            required
            value={permissionForm.requestedMinutes}
            onChange={e=>setPermissionForm(c=>({
              ...c,
              requestedMinutes:Number(e.target.value),
            }))}
          >
            <option value={60}>ساعة</option>
            <option value={120}>ساعتان</option>
            <option value={240}>4 ساعات</option>
          </select>
        </label>

        <label>السبب
          <textarea
            rows={4}
            value={permissionForm.reason}
            onChange={e=>setPermissionForm(c=>({...c,reason:e.target.value}))}
            placeholder="اختياري"
          />
        </label>

        <button
          className="button button-primary button-full"
          disabled={permissionWorking}
        >
          {permissionWorking?<Loader2 className="spin" size={18}/>:<Send size={18}/>}
          إرسال طلب الإذن
        </button>
      </form>
    </div>}
  </main>
}
