'use client'

import { ReactNode, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { hasAdminAccess, type AppAccess } from '@/lib/app-access'
import { createClient } from '@/lib/supabase/client'

export function DashboardAccessGuard({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [allowed, setAllowed] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    void (async () => {
      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user) {
        router.replace('/login')
        return
      }
      if (userData.user.user_metadata?.must_change_password) {
        router.replace('/change-password')
        return
      }

      const { data, error } = await supabase.rpc('app_current_access')
      if (error || !data) {
        router.replace('/login')
        return
      }
      if (!hasAdminAccess(data as AppAccess)) {
        router.replace('/portal')
        return
      }
      setAllowed(true)
    })()
  }, [router])

  if (!allowed) {
    return <div className="dashboard-guard"><Loader2 className="spin"/><strong>جارٍ التحقق من الصلاحيات...</strong></div>
  }

  return <>{children}</>
}
