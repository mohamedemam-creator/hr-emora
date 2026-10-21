import { Suspense } from 'react'
import { SetupForm } from './setup-form'

export default function SetupPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center p-4">جارٍ التحميل...</div>}>
      <SetupForm />
    </Suspense>
  )
}
