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

export type CompanyBootstrapReceipt = {
  companyId: string
  employeeId: string
  auditLogged?: boolean
}

const PENDING_SETUP_KEY = 'emora_pending_setup'
const PENDING_EMAIL_KEY = 'emora_pending_verification_email'
const COMPLETED_SETUP_KEY = 'emora_completed_setup'

function clearPendingSetup() {
  window.localStorage.removeItem(PENDING_SETUP_KEY)
  window.localStorage.removeItem(PENDING_EMAIL_KEY)
  window.localStorage.removeItem(COMPLETED_SETUP_KEY)
}

function readCompletedSetup(): CompanyBootstrapReceipt | null {
  try {
    const value = window.localStorage.getItem(COMPLETED_SETUP_KEY)
    if (!value) return null
    const receipt = JSON.parse(value) as Partial<CompanyBootstrapReceipt>
    if (!receipt.companyId || !receipt.employeeId) return null
    return {
      companyId: receipt.companyId,
      employeeId: receipt.employeeId,
      auditLogged: receipt.auditLogged !== false,
    }
  } catch {
    return null
  }
}

export function hasCompletedCompanyBootstrap(): boolean {
  return readCompletedSetup() !== null
}

async function verifyCompanyAccess(companyId: string, employeeId: string): Promise<void> {
  const supabase = createClient()
  const delays = [0, 250, 700]

  for (const delay of delays) {
    if (delay) await new Promise(resolve => window.setTimeout(resolve, delay))
    const { data, error } = await supabase.rpc('app_current_access')
    if (error) continue

    const access = data as AppAccess | null
    const isOwnerOfCreatedCompany =
      access?.company_id === companyId &&
      access?.employee_id === employeeId &&
      access?.roles?.some(role => role.code === 'COMPANY_OWNER')
    if (isOwnerOfCreatedCompany && hasAdminAccess(access)) return
  }

  throw new Error('تم إنشاء الشركة، لكن تعذر تأكيد صلاحية مالك الشركة. بيانات الإنشاء محفوظة؛ أعد محاولة المتابعة دون إعادة التسجيل.')
}

export async function resumeCompletedCompanySetup(): Promise<void> {
  const receipt = readCompletedSetup()
  if (!receipt) throw new Error('لا توجد عملية إنشاء مكتملة لاستعادتها.')
  if (receipt.auditLogged === false) {
    throw new Error('تم إنشاء الشركة، لكن سجل التدقيق غير مؤكد. أوقف المتابعة وتواصل مع مسؤول النظام قبل دخول لوحة التحكم.')
  }
  await verifyCompanyAccess(receipt.companyId, receipt.employeeId)
  clearPendingSetup()
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

  const receipt: CompanyBootstrapReceipt = {
    companyId: String(data?.companyId ?? ''),
    employeeId: String(data?.employeeId ?? ''),
    auditLogged: data?.auditLogged !== false,
  }
  if (!receipt.companyId || !receipt.employeeId) {
    throw new Error('استجاب الخادم دون تأكيد نتيجة إنشاء الشركة. لم تُحذف بيانات التسجيل؛ أعد المحاولة بأمان.')
  }

  window.localStorage.setItem(COMPLETED_SETUP_KEY, JSON.stringify(receipt))
  if (data?.auditLogged === false) {
    throw new Error('تم إنشاء الشركة، لكن تعذر تأكيد سجل التدقيق. لا تعاود التسجيل؛ أعد محاولة المتابعة أو تواصل مع مسؤول النظام.')
  }

  await verifyCompanyAccess(receipt.companyId, receipt.employeeId)
  clearPendingSetup()
}
