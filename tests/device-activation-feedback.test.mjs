import test from 'node:test'
import assert from 'node:assert/strict'
import { getDeviceActivationErrorNotice } from '../lib/device-activation-feedback.ts'

test('explains when the mobile activation RPC is missing from the schema cache', () => {
  const message = getDeviceActivationErrorNotice({
    code: 'PGRST202',
    message: 'Could not find the function public.app_request_my_mobile_device in the schema cache',
  })

  assert.match(message, /migration 0018/)
  assert.match(message, /Schema Cache/)
})

test('turns unexpected activation failures into friendly Arabic guidance', () => {
  const message = getDeviceActivationErrorNotice({ code: 'XX000', message: 'internal database detail' })

  assert.equal(
    message,
    'تعذر إرسال طلب تفعيل الجهاز الآن. تحقق من الاتصال وحاول مرة أخرى، أو أبلغ مسؤول الشركة إذا استمرت المشكلة.',
  )
  assert.doesNotMatch(message, /internal database detail/)
})

test('explains that an inactive attendance device must be approved', () => {
  const message = getDeviceActivationErrorNotice({
    message: 'attendance device is not active for this employee',
  })

  assert.match(message, /الجهاز غير مفعّل/)
  assert.match(message, /طلب تفعيل جديد/)
})
