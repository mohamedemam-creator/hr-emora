'use client'

import { ReactNode, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
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
      const access = data as {
        permissions?: string[]
        roles?: Array<{ code: string }>
      }
      const permissions = access.permissions ?? []
      const roles = new Set((access.roles ?? []).map(role => role.code))
      const hasAdminAccess =
        permissions.some(code =>
          !['shifts.view_own', 'attendance.view_own'].includes(code),
        ) ||
        roles.has('BRANCH_MANAGER') ||
        roles.has('REGION_MANAGER') ||
        roles.has('SUPER_ADMIN')
      if (!hasAdminAccess) {
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
