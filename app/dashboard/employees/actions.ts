'use server'

import { createClient as createAdminClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

type AccountContext = {
  company_id: string
  employee_id: string
  user_id: string | null
  has_login: boolean
}

type ResetPasswordResult = {
  ok: boolean
  message: string
  auditLogged?: boolean
}

export async function activateEmployeeMobileDevice(
  employeeId: string,
  deviceId: string,
): Promise<{ ok: boolean; message: string }> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(employeeId)
    || !deviceId.trim() || deviceId.length > 160) {
    return { ok: false, message: 'بيانات الجهاز غير صالحة.' }
  }

  const sessionClient = await createClient()
  const { data: authData, error: authError } = await sessionClient.auth.getUser()
  if (authError || !authData.user) return { ok: false, message: 'انتهت جلسة الدخول. سجّل الدخول مجددًا.' }

  const { error } = await sessionClient.rpc('app_activate_employee_mobile_device', {
    p_employee_id: employeeId,
    p_device_id: deviceId,
  })
  if (error) {
    console.error('[employee-account] mobile device activation failed', { code: error.code })
    return { ok: false, message: 'تعذر تفعيل الجهاز. تحقق من صلاحيتك ومن وجود طلب تفعيل ساري.' }
  }
  return { ok: true, message: 'تم تفعيل الجهاز بنجاح.' }
}

export async function resetEmployeePassword(
  employeeId: string,
  password: string,
): Promise<ResetPasswordResult> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(employeeId)) {
    return { ok: false, message: 'معرّف الموظف غير صالح.' }
  }
  if (password.length < 8 || password.length > 128) {
    return { ok: false, message: 'يجب أن تتكون كلمة المرور من 8 إلى 128 حرفًا.' }
  }

  const sessionClient = await createClient()
  const { data: authData, error: authError } = await sessionClient.auth.getUser()
  if (authError || !authData.user) {
    return { ok: false, message: 'انتهت جلسة الدخول. سجّل الدخول ثم أعد المحاولة.' }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    return { ok: false, message: 'خدمة إدارة الحساب غير مهيأة على الخادم.' }
  }

  const admin = createAdminClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: contextData, error: contextError } = await admin.rpc(
    'service_employee_account_context',
    { p_actor_user_id: authData.user.id, p_employee_id: employeeId },
  )
  if (contextError || !contextData) {
    return { ok: false, message: 'ليس لديك صلاحية إدارة حساب هذا الموظف.' }
  }

  const context = contextData as AccountContext
  if (context.employee_id !== employeeId || !context.user_id || !context.has_login) {
    return { ok: false, message: 'لا يوجد حساب دخول مرتبط بهذا الموظف.' }
  }

  const { data: currentData, error: currentError } = await admin.auth.admin.getUserById(context.user_id)
  if (currentError || !currentData.user) {
    return { ok: false, message: 'تعذر العثور على حساب الدخول المرتبط بالموظف.' }
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(context.user_id, {
    password,
    user_metadata: {
      ...(currentData.user.user_metadata ?? {}),
      must_change_password: true,
    },
  })
  if (updateError) {
    return { ok: false, message: 'تعذر تحديث كلمة المرور. لم يتم تغيير بيانات الموظف.' }
  }

  const { error: stateError } = await admin.rpc('service_set_employee_account_state', {
    p_actor_user_id: authData.user.id,
    p_employee_id: employeeId,
    p_login_enabled: null,
    p_must_change_password: true,
    p_invited_at: null,
  })

  let auditLogged = false
  try {
    const { error: auditError } = await admin.from('audit_logs').insert({
      actor_user_id: authData.user.id,
      actor_company_role: null,
      actor_platform_role: null,
      company_id: context.company_id,
      action: 'employee.account.password_reset',
      category: 'identity',
      entity_type: 'employee',
      entity_id: employeeId,
      status: 'success',
      context: { source: 'next-server-action', db_flag_synced: !stateError },
    })
    auditLogged = !auditError
    if (auditError) {
      console.error('[employee-account] password reset audit insert failed', {
        code: auditError.code,
      })
    }
  } catch (error) {
    console.error('[employee-account] password reset audit insert threw', {
      error_type: error instanceof Error ? error.name : 'unknown',
    })
  }

  if (stateError) {
    console.error('[employee-account] password reset state sync failed', {
      code: stateError.code,
    })
  }

  return {
    ok: true,
    auditLogged,
    message: stateError
      ? 'تم تغيير كلمة المرور، لكن تعذر مزامنة تذكير تغييرها مع ملف الموظف.'
      : 'تم تعيين كلمة مرور مؤقتة. سيُطلب من الموظف تغييرها عند تسجيل الدخول.',
  }
}
