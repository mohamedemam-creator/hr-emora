export type DeviceActivationError = {
  code?: string
  message?: string
}

const schemaSetupNotice =
  'طلب تفعيل الجهاز غير متاح بعد بسبب إعداد قاعدة البيانات. يرجى إبلاغ مسؤول النظام بتطبيق migration 0018 وتحديث Schema Cache في Supabase.'

const retryNotice =
  'تعذر إرسال طلب تفعيل الجهاز الآن. تحقق من الاتصال وحاول مرة أخرى، أو أبلغ مسؤول الشركة إذا استمرت المشكلة.'

export function getDeviceActivationErrorNotice(error: DeviceActivationError): string {
  const code = error.code?.toUpperCase()
  const message = error.message ?? ''

  if (
    code === 'PGRST202' ||
    code === 'PGRST203' ||
    code === '42883' ||
    /app_request_my_mobile_device.*(schema cache|does not exist|not found)/i.test(message)
  ) {
    return schemaSetupNotice
  }

  if (code === '42501') {
    return 'تعذر التحقق من صلاحية حسابك لطلب تفعيل الجهاز. سجّل الدخول إلى الشركة الصحيحة، وإذا استمرت المشكلة تواصل مع مسؤول الشركة.'
  }

  if (/attendance device is not active|device is not active/i.test(message)) {
    return 'هذا الجهاز غير مفعّل للحضور. أرسل طلب تفعيل جديدًا وانتظر موافقة مسؤول الشركة قبل تسجيل الحضور.'
  }

  return retryNotice
}
