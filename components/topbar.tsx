'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { Bell, Menu, Search } from 'lucide-react'
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
  const [access, setAccess] = useState<Access>({})
  const [unreadCount, setUnreadCount] = useState(0)

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

      <div className="search-box">
        <Search size={18} />
        <input placeholder="ابحث في النظام..." />
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
