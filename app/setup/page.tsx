import { Suspense } from 'react'
import { SetupForm } from './setup-form'

export default function SetupPage() {
  return (
    <Suspense fallback={
      <main className="setup-page">
        <div className="form-success" role="status" aria-live="polite">
          جارٍ استعادة جلسة الدخول بعد تأكيد البريد الإلكتروني...
        </div>
      </main>
    }>
      <SetupForm />
    </Suspense>
  )
}
