'use client'

import { FormEvent, useEffect, useState } from 'react'
import { CheckCircle2, KeyRound, Loader2, Power, Smartphone, X } from 'lucide-react'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { activateEmployeeMobileDevice, resetEmployeePassword } from '@/app/dashboard/employees/actions'

type IosWebDeviceStatus = {
  has_device:boolean
  status:'none'|'active'|'blocked'
  browser_id_short?:string
  last_seen_at?:string|null
  pending?:boolean
  request_id?:string
  request_code?:string
  requested_at?:string|null
  can_manage?:boolean
}

type WebAttendanceExceptionStatus = {
  enabled:boolean
  reason?:string|null
  can_manage?:boolean
}

type MobileDeviceStatus = {
  has_device:boolean
  status:'none'|'active'|'revoked'|'released'
  device_id?:string
  device_id_short?:string
  model?:string|null
  manufacturer?:string|null
  os_version?:string|null
  app_version?:string|null
  last_seen_at?:string|null
  block_reason?:string|null
  can_reset?:boolean
  can_release?:boolean
  can_activate?:boolean
}

type EmployeeAccount = {
  id: string
  full_name: string
  email: string | null
  has_login: boolean
  login_enabled: boolean
  must_change_password: boolean
  account_invited_at: string | null
}

export function EmployeeAccountPanel({
  employee,
  onClose,
  onUpdated,
}: {
  employee: EmployeeAccount
  onClose: () => void
  onUpdated: () => Promise<void> | void
}) {
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [device, setDevice] = useState<MobileDeviceStatus|null>(null)
  const [iosWeb, setIosWeb] = useState<IosWebDeviceStatus|null>(null)
  const [webException, setWebException] = useState<WebAttendanceExceptionStatus|null>(null)

  async function loadDevice() {
    const supabase = createClient()
    const [androidResult,iosResult,exceptionResult] = await Promise.all([
      supabase.rpc('app_employee_mobile_device_status', {
        p_employee_id: employee.id,
      }),
      supabase.rpc('app_employee_ios_web_status', {
        p_employee_id: employee.id,
      }),
      supabase.rpc('app_employee_web_attendance_exception_status', {
        p_employee_id: employee.id,
      }),
    ])
    if (androidResult.data) setDevice(androidResult.data as MobileDeviceStatus)
    if (iosResult.data) setIosWeb(iosResult.data as IosWebDeviceStatus)
    if (exceptionResult.data) {
      setWebException(exceptionResult.data as WebAttendanceExceptionStatus)
    }
  }

  useEffect(() => { void loadDevice() }, [employee.id])

  async function setWebAttendanceException(enabled:boolean) {
    const promptText=enabled
      ? 'سبب السماح لهذا الموظف بالحضور من المتصفح (مثال: الهاتف لا يدعم التطبيق):'
      : 'سبب إلغاء استثناء الحضور من المتصفح:'
    const reason=window.prompt(promptText)
    if(!reason)return

    setLoading(true);setError('');setSuccess('')
    const supabase=createClient()
    const {data:result,error:rpcError}=await supabase.rpc(
      'app_set_employee_web_attendance_exception',
      {
        p_employee_id:employee.id,
        p_enabled:enabled,
        p_reason:reason,
      },
    )
    if(rpcError)setError(rpcError.message)
    else{
      setSuccess(
        result?.message
          ? String(result.message)
          : enabled
            ? 'تم السماح بالحضور الآمن من المتصفح.'
            : 'تم إلغاء استثناء الحضور من المتصفح.',
      )
      await loadDevice()
    }
    setLoading(false)
  }

  async function approveIosWeb() {
    if(!iosWeb?.request_id)return
    if(!confirm(`اعتماد جهاز الحضور عبر المتصفح؟ كود الطلب: ${iosWeb.request_code??''}`))return
    setLoading(true);setError('');setSuccess('')
    const supabase=createClient()
    const {error:rpcError}=await supabase.rpc('app_approve_employee_ios_web',{
      p_employee_id:employee.id,
      p_request_id:iosWeb.request_id,
    })
    if(rpcError)setError(rpcError.message)
    else{
      setSuccess('تم اعتماد هذا المتصفح للحضور والانصراف.')
      await loadDevice()
    }
    setLoading(false)
  }

  async function resetIosWeb() {
    const reason=window.prompt('سبب فك تفعيل جهاز الحضور عبر المتصفح:')
    if(!reason)return
    setLoading(true);setError('');setSuccess('')
    const supabase=createClient()
    const {error:rpcError}=await supabase.rpc('app_reset_employee_ios_web',{
      p_employee_id:employee.id,
      p_reason:reason,
    })
    if(rpcError)setError(rpcError.message)
    else{
      setSuccess('تم إلغاء تفعيل المتصفح. أي تفعيل جديد يحتاج موافقة جديدة.')
      await loadDevice()
    }
    setLoading(false)
  }

  async function resetDevice() {
    const reason = window.prompt('سبب فك ربط جهاز الموظف:')
    if (!reason) return
    setLoading(true); setError(''); setSuccess('')
    const supabase = createClient()
    const { error: rpcError } = await supabase.rpc(
      'app_reset_employee_mobile_device',
      { p_employee_id: employee.id, p_reason: reason },
    )
    if (rpcError) setError(rpcError.message)
    else {
      setSuccess('تم فك ربط الجهاز. الهاتف القديم أصبح محظورًا، ويمكن للموظف تفعيل هاتف جديد.')
      await loadDevice()
    }
    setLoading(false)
  }

  async function releaseDevice() {
    if (!device?.device_id) return
    const reason = window.prompt('سبب السماح بإعادة استخدام هذا الهاتف:')
    if (!reason) return
    setLoading(true); setError(''); setSuccess('')
    const supabase = createClient()
    const { error: rpcError } = await supabase.rpc(
      'app_release_mobile_device',
      { p_device_id: device.device_id, p_reason: reason },
    )
    if (rpcError) setError(rpcError.message)
    else {
      setSuccess('تم السماح بإعادة استخدام الهاتف. يمكن الآن تفعيله لحساب موظف عند الحاجة.')
      await loadDevice()
    }
    setLoading(false)
  }

  async function activateDevice() {
    if (!device?.device_id) return
    setLoading(true); setError(''); setSuccess('')
    const result = await activateEmployeeMobileDevice(employee.id, device.device_id)
    if (!result.ok) setError(result.message)
    else {
      setSuccess(result.message)
      await loadDevice()
    }
    setLoading(false)
  }

  async function invoke(action: string) {
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      const supabase = createClient()
      const { data, error: functionError } = await supabase.functions.invoke('manage-employee-account', {
        body: {
          action,
          employeeId: employee.id,
          password: employee.has_login ? password : undefined,
        },
      })
      if (functionError) {
        if (functionError instanceof FunctionsHttpError) {
          try {
            const payload = await functionError.context.json()
            throw new Error(
              payload?.error ??
                payload?.message ??
                `فشل الطلب برمز ${functionError.context.status}.`,
            )
          } catch (parseError) {
            if (parseError instanceof Error) throw parseError
          }
        }
        throw functionError
      }
      if (data?.error) throw new Error(data.error)
      setSuccess(data?.message ?? 'تم تنفيذ العملية بنجاح.')
      setPassword('')
      await onUpdated()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'تعذر تنفيذ العملية.')
    } finally {
      setLoading(false)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!employee.has_login) {
      void invoke('invite')
      return
    }

    setLoading(true)
    setError('')
    setSuccess('')
    try {
      const result = await resetEmployeePassword(employee.id, password)
      if (!result.ok) throw new Error(result.message)
      setSuccess(result.auditLogged === false
        ? `${result.message} تعذر حفظ سجل التدقيق؛ لا تكرر العملية.`
        : result.message)
      setPassword('')
      await onUpdated()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'تعذر إعادة تعيين كلمة المرور.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <section className="account-modal">
        <button className="modal-close" onClick={onClose}><X/></button>
        <div className="module-placeholder-icon"><KeyRound size={30}/></div>
        <h2>حساب دخول {employee.full_name}</h2>
        <p>{employee.has_login ? 'يمكنك إعادة تعيين كلمة المرور أو إيقاف وتفعيل الدخول. يغيّر الموظف بريده من حسابه بعد التحقق.' : employee.account_invited_at ? 'تم إرسال دعوة لهذا البريد. على الموظف فتح رسالة الدعوة أو تسجيل الدخول بحسابه الحالي لقبولها.' : 'سنرسل دعوة تفعيل آمنة إلى بريد الموظف؛ لا نضع كلمة مرور مؤقتة نيابة عنه.'}</p>
        <form className="form-stack" onSubmit={submit}>
          <label>
            بريد تسجيل الدخول
            <input
              type="email"
              required
              value={employee.email ?? ''}
              readOnly
            />
          </label>
          {employee.has_login && <label>كلمة مرور مؤقتة جديدة<input type="password" required minLength={8} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} placeholder="8 أحرف على الأقل"/></label>}
          {employee.has_login && <div className="form-note">سيُطلب من الموظف تغيير كلمة المرور عند أول دخول.</div>}
          {error && <div className="form-error">{error}</div>}
          {success && <div className="form-success"><CheckCircle2 size={18}/>{success}</div>}
          <button className="button button-primary button-full" disabled={loading || (!employee.has_login && Boolean(employee.account_invited_at))}>
            {loading ? <Loader2 className="spin" size={18}/> : <KeyRound size={18}/>}
            {employee.has_login ? 'تعيين كلمة مرور جديدة' : 'إرسال دعوة التفعيل'}
          </button>
        </form>
        {employee.has_login && <button className={`button button-full ${employee.login_enabled ? 'button-danger-soft' : 'button-ghost'}`} disabled={loading} onClick={() => void invoke(employee.login_enabled ? 'disable' : 'enable')}>
          <Power size={18}/> {employee.login_enabled ? 'إيقاف دخول الموظف' : 'تفعيل دخول الموظف'}
        </button>}

        <div className="employee-device-box">
          <div className="employee-device-heading">
            <Smartphone size={20}/>
            <div>
              <strong>جهاز Emora Team</strong>
              <span>{device?.status==='active'?'مرتبط ومفعل':device?.status==='revoked'?'الجهاز ملغي التفعيل':device?.status==='released'?'طلب التفعيل بانتظار المراجعة':'لم يتم تفعيل جهاز'}</span>
            </div>
          </div>
          {device?.has_device && <>
            <small>{device.manufacturer??''} {device.model??''} • Android {device.os_version??''}</small>
            <small>رمز الجهاز: {device.device_id_short??'---'}</small>
          </>}
          {device?.status==='active' && device.can_reset && <button type="button" className="button button-danger-soft button-full" disabled={loading} onClick={()=>void resetDevice()}>
            <Smartphone size={18}/> فك ربط الجهاز والسماح بهاتف جديد
          </button>}
          {device?.status==='revoked' && device.can_release && <button type="button" className="button button-ghost button-full" disabled={loading} onClick={()=>void releaseDevice()}>
            <Smartphone size={18}/> السماح بإعادة استخدام الهاتف المحظور
          </button>}
          {device?.status==='released' && device.can_activate && <button type="button" className="button button-primary button-full" disabled={loading} onClick={()=>void activateDevice()}>
            {loading?<Loader2 className="spin" size={18}/>:<CheckCircle2 size={18}/>} تفعيل الجهاز
          </button>}
        </div>

        {webException?.can_manage&&
        <div className="employee-device-box">
          <div className="employee-device-heading">
            <Smartphone size={20}/>
            <div>
              <strong>استثناء الحضور من المتصفح</strong>
              <span>{webException.enabled
                ? 'مسموح — يحتاج تفعيل المتصفح واعتماده'
                : 'غير مسموح — يستخدم تطبيق Emora Team'}</span>
            </div>
          </div>
          {webException.reason&&<small>السبب: {webException.reason}</small>}
          <button
            type="button"
            className={`button button-full ${
              webException.enabled?'button-danger-soft':'button-ghost'
            }`}
            disabled={loading}
            onClick={()=>void setWebAttendanceException(!webException.enabled)}
          >
            <Smartphone size={18}/>
            {webException.enabled
              ? 'إلغاء استثناء الحضور من المتصفح'
              : 'السماح بالحضور من المتصفح'}
          </button>
        </div>}

        <div className="employee-device-box ios-web-device-box">
          <div className="employee-device-heading">
            <Smartphone size={20}/>
            <div>
              <strong>جهاز الحضور الآمن عبر المتصفح</strong>
              <span>{iosWeb?.status==='active'?'مفعل للحضور':
                iosWeb?.pending?'طلب تفعيل بانتظار الموافقة':
                iosWeb?.status==='blocked'?'تم إلغاء التفعيل':
                'غير مفعل'}</span>
            </div>
          </div>
          {iosWeb?.pending&&<>
            <small>كود الطلب: <b>{iosWeb.request_code??'---'}</b></small>
            <small>الطلب خاص بهذا الموظف ويجب مطابقته قبل الاعتماد.</small>
          </>}
          {iosWeb?.status==='active'&&<>
            <small>رمز المتصفح: {iosWeb.browser_id_short??'---'}</small>
            <small>آخر اتصال: {iosWeb.last_seen_at?
              new Date(iosWeb.last_seen_at).toLocaleString('ar-EG'):'---'}</small>
          </>}
          {iosWeb?.pending&&iosWeb.can_manage&&
            <button type="button" className="button button-primary button-full"
              disabled={loading} onClick={()=>void approveIosWeb()}>
              <CheckCircle2 size={18}/> اعتماد هذا المتصفح
            </button>}
          {(iosWeb?.status==='active'||iosWeb?.pending)&&iosWeb?.can_manage&&
            <button type="button" className="button button-danger-soft button-full"
              disabled={loading} onClick={()=>void resetIosWeb()}>
              <Smartphone size={18}/> إلغاء تفعيل المتصفح
            </button>}
        </div>
      </section>
    </div>
  )
}
