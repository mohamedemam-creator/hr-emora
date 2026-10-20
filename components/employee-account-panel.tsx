'use client'

import { FormEvent, useEffect, useState } from 'react'
import { CheckCircle2, KeyRound, Loader2, Mail, Power, Smartphone, X } from 'lucide-react'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'

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
  status:'none'|'active'|'blocked'|'released'
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
}

type EmployeeAccount = {
  id: string
  full_name: string
  email: string | null
  has_login: boolean
  login_enabled: boolean
  must_change_password: boolean
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
  const [email, setEmail] = useState(employee.email ?? '')
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
          email,
          password,
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

  function submit(event: FormEvent) {
    event.preventDefault()
    void invoke(employee.has_login ? 'reset-password' : 'create')
  }

  return (
    <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <section className="account-modal">
        <button className="modal-close" onClick={onClose}><X/></button>
        <div className="module-placeholder-icon"><KeyRound size={30}/></div>
        <h2>حساب دخول {employee.full_name}</h2>
        <p>{employee.has_login ? 'يمكنك تحديث بريد تسجيل الدخول أو إعادة تعيين كلمة المرور أو تفعيل وإيقاف الحساب.' : 'أنشئ بريدًا وكلمة مرور مؤقتة للموظف.'}</p>
        <form className="form-stack" onSubmit={submit}>
          <label>
            بريد تسجيل الدخول
            <input
              type="email"
              required
              value={email}
              onChange={event => setEmail(event.target.value)}
            />
          </label>
          {employee.has_login && (
            <button
              type="button"
              className="button button-ghost button-full"
              disabled={loading || !email.trim()}
              onClick={() => void invoke('update-email')}
            >
              {loading ? <Loader2 className="spin" size={18}/> : <Mail size={18}/>}
              تحديث ومزامنة بريد الدخول
            </button>
          )}
          <label>{employee.has_login ? 'كلمة مرور مؤقتة جديدة' : 'كلمة المرور المؤقتة'}<input type="password" required minLength={8} value={password} onChange={event => setPassword(event.target.value)} placeholder="8 أحرف على الأقل"/></label>
          <div className="form-note">سيُطلب من الموظف تغيير كلمة المرور عند أول دخول.</div>
          {error && <div className="form-error">{error}</div>}
          {success && <div className="form-success"><CheckCircle2 size={18}/>{success}</div>}
          <button className="button button-primary button-full" disabled={loading}>
            {loading ? <Loader2 className="spin" size={18}/> : <KeyRound size={18}/>}
            {employee.has_login ? 'تعيين كلمة مرور جديدة' : 'إنشاء حساب الدخول'}
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
              <span>{device?.status==='active'?'مرتبط ومفعل':device?.status==='blocked'?'الجهاز السابق محظور':device?.status==='released'?'تم السماح بإعادة استخدام الجهاز':'لم يتم تفعيل جهاز'}</span>
            </div>
          </div>
          {device?.has_device && <>
            <small>{device.manufacturer??''} {device.model??''} • Android {device.os_version??''}</small>
            <small>رمز الجهاز: {device.device_id_short??'---'}</small>
          </>}
          {device?.status==='active' && device.can_reset && <button type="button" className="button button-danger-soft button-full" disabled={loading} onClick={()=>void resetDevice()}>
            <Smartphone size={18}/> فك ربط الجهاز والسماح بهاتف جديد
          </button>}
          {device?.status==='blocked' && device.can_release && <button type="button" className="button button-ghost button-full" disabled={loading} onClick={()=>void releaseDevice()}>
            <Smartphone size={18}/> السماح بإعادة استخدام الهاتف المحظور
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
