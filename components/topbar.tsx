'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { Bell, Menu } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type Access = {
  full_name?: string
  roles?: Array<{ name: string; code: string }>
}

export function Topbar({
  onMenuToggle,
}: {
  onMenuToggle?: () => void
}) {
  const pathname = usePathname()
  const [access, setAccess] = useState<Access>({})
  const [unreadCount, setUnreadCount] = useState(0)

  const pageTitle = useMemo(() => {
    const titles: Array<[string, string]> = [
      ['/dashboard/employees', 'الموظفون'],
      ['/dashboard/branches', 'الفروع'],
      ['/dashboard/regions', 'المناطق'],
      ['/dashboard/organization', 'الهيكل الوظيفي'],
      ['/dashboard/roles', 'الأدوار والصلاحيات'],
      ['/dashboard/shifts', 'الشيفتات'],
      ['/dashboard/attendance', 'الحضور والانصراف'],
      ['/dashboard/leaves', 'الإجازات'],
      ['/dashboard/permissions', 'الأذونات'],
      ['/dashboard/penalties', 'الجزاءات'],
      ['/dashboard/payroll', 'الرواتب'],
      ['/dashboard/notifications', 'التنبيهات'],
      ['/dashboard/reports', 'التقارير'],
      ['/dashboard/settings', 'الإعدادات'],
      ['/portal', 'بوابتي والحضور'],
    ]
    return titles.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? 'نظرة عامة'
  }, [pathname])

  useEffect(() => {
    const supabase = createClient()

    void Promise.all([
      supabase.rpc('app_current_access'),
      supabase.rpc('app_notification_unread_count'),
    ]).then(([accessResult, notificationResult]) => {
      if (!accessResult.error && accessResult.data) {
        setAccess(accessResult.data as Access)
      }
      if (!notificationResult.error) {
        setUnreadCount(Number(notificationResult.data ?? 0))
      }
    })
  }, [])

  const initials = useMemo(() => {
    const name = access.full_name?.trim() || 'م'
    return name
      .split(/\s+/)
      .slice(0, 2)
      .map(part => part[0])
      .join('')
  }, [access.full_name])

  return (
    <header className="topbar">
      <button
        type="button"
        className="icon-button menu-button"
        aria-label="فتح القائمة"
        onClick={onMenuToggle}
      >
        <Menu />
      </button>

      <div className="topbar-context" aria-live="polite">
        <span>مساحة العمل</span>
        <strong>{pageTitle}</strong>
      </div>

      <div className="topbar-actions">
        <Link
          href="/dashboard/notifications"
          className="notification-button"
          aria-label="فتح التنبيهات"
          title="التنبيهات"
        >
          <Bell size={20} />
          {unreadCount > 0 && (
            <>
              <span />
              <b>{unreadCount > 99 ? '99+' : unreadCount}</b>
            </>
          )}
        </Link>

        <div className="user-chip">
          <div className="avatar small">{initials}</div>
          <div>
            <strong>{access.full_name || 'المستخدم الحالي'}</strong>
            <span>
              {access.roles?.map(role => role.name).join('، ') ||
                'Emora HR'}
            </span>
          </div>
        </div>
      </div>
    </header>
  )
}
