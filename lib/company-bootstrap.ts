import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js'
import { formatAppError, hasAdminAccess, type AppAccess } from '@/lib/app-access'
import { createClient } from '@/lib/supabase/client'

export type CompanySetupPayload = {
  companyName: string
  companyCode: string
  adminName: string
  employeeCode: string
  phone: string
  email: string
}

export async function bootstrapNewCompany(payload: CompanySetupPayload): Promise<void> {
  const supabase = createClient()
  const { data, error: functionError } = await supabase.functions.invoke('bootstrap-company', {
    body: {
      companyName: payload.companyName,
      companyCode: payload.companyCode,
      adminName: payload.adminName,
      employeeCode: payload.employeeCode,
      phone: payload.phone,
    },
  })

  if (functionError) {
    let message = formatAppError(functionError, 'تعذر إنشاء الشركة عبر خدمة الإعداد.')
    if (functionError instanceof FunctionsFetchError) {
      message = 'تعذر الاتصال بدالة bootstrap-company. تأكد من تشغيل Supabase المحلي والدالة محلياً، أو من نشر الدالة على مشروع Supabase المُعدّ للتطبيق.'
    }
    if (functionError instanceof FunctionsHttpError) {
      const body = await functionError.context.json().catch(() => null)
      if (body) message = formatAppError(body, message)
    }
    throw new Error(message)
  }

  if (data?.error) {
    throw new Error(formatAppError(data.error, 'تعذر إنشاء الشركة.'))
  }
  window.localStorage.removeItem('emora_pending_setup')
  window.localStorage.removeItem('emora_pending_verification_email')
  if (data?.auditLogged === false) {
    throw new Error('تم إنشاء الشركة بنجاح، لكن تعذر حفظ سجل التدقيق. لا تعاود إعداد الشركة؛ سجّل الدخول أو تواصل مع مسؤول النظام.')
  }

  const { data: accessData, error: accessError } = await supabase.rpc('app_current_access')
  if (accessError) {
    throw new Error('تم إنشاء الشركة، لكن تعذر تحميل صلاحيات الدخول. لا تعاود إعداد الشركة؛ سجّل الدخول أو تواصل مع الدعم.')
  }

  const access = accessData as AppAccess | null
  const isOwnerOfCreatedCompany =
    access?.company_id === data?.companyId &&
    access?.roles?.some(role => role.code === 'COMPANY_OWNER')
  if (!isOwnerOfCreatedCompany || !hasAdminAccess(access)) {
    throw new Error('تم إنشاء الشركة، لكن تعذر تأكيد صلاحية مالك الشركة. لا تعاود إعداد الشركة؛ سجّل الدخول أو تواصل مع الدعم.')
  }

}
