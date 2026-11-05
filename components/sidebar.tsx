'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import {
  BarChart3,
  Bell,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  CircleDollarSign,
  Clock3,
  Gavel,
  LayoutDashboard,
  MapPinned,
  Settings,
  ShieldCheck,
  Smartphone,
  UserCog,
  UsersRound,
  X,
} from 'lucide-react'
import { Logo } from '@/components/logo'
import { createClient } from '@/lib/supabase/client'

type Access = {
  permissions?: string[]
  roles?: Array<{ code: string; name: string }>
}

type Item = {
  label: string
  href: string
  icon: typeof LayoutDashboard
  visible: (permissions: Set<string>, roles: Set<string>) => boolean
}

const items: Item[] = [
  {
    label: 'الرئيسية',
    href: '/dashboard',
    icon: LayoutDashboard,
    visible: () => true,
  },
  {
    label: 'بوابتي والحضور',
    href: '/portal',
    icon: Smartphone,
    visible: () => true,
  },
  {
    label: 'الموظفون',
    href: '/dashboard/employees',
    icon: UsersRound,
    visible: permissions =>
      permissions.has('employees.view_all') ||
      permissions.has('employees.view_branch') ||
      permissions.has('employees.manage'),
  },
  {
    label: 'المناطق',
    href: '/dashboard/regions',
    icon: MapPinned,
    visible: permissions =>
      permissions.has('regions.view_all') ||
      permissions.has('regions.manage'),
  },
  {
    label: 'الفروع',
    href: '/dashboard/branches',
    icon: Building2,
    visible: (permissions, roles) =>
      permissions.has('branches.view_all') ||
      permissions.has('branches.manage') ||
      roles.has('REGION_MANAGER') ||
      roles.has('BRANCH_MANAGER'),
  },
  {
    label: 'الهيكل الوظيفي',
    href: '/dashboard/organization',
    icon: BriefcaseBusiness,
    visible: permissions =>
      permissions.has('organization.view') ||
      permissions.has('organization.manage'),
  },
  {
    label: 'الأدوار والصلاحيات',
    href: '/dashboard/roles',
    icon: UserCog,
    visible: permissions =>
      permissions.has('roles.view') ||
      permissions.has('roles.manage'),
  },
  {
    label: 'الشيفتات',
    href: '/dashboard/shifts',
    icon: CalendarDays,
    visible: permissions =>
      permissions.has('shifts.manage_branch') ||
      permissions.has('shifts.publish'),
  },
  {
    label: 'الحضور والانصراف',
    href: '/dashboard/attendance',
    icon: Clock3,
    visible: permissions =>
      permissions.has('attendance.view_branch') ||
      permissions.has('attendance.review') ||
      permissions.has('attendance.monitor'),
  },
  {
    label: 'الإجازات',
    href: '/dashboard/leaves',
    icon: ShieldCheck,
    visible: (permissions, roles) =>
      permissions.has('leaves.approve') ||
      roles.has('BRANCH_MANAGER') ||
      roles.has('REGION_MANAGER') ||
      roles.has('SUPER_ADMIN'),
  },
  {
    label: 'الأذونات',
    href: '/dashboard/permissions',
    icon: Clock3,
    visible: (permissions, roles) =>
      permissions.has('leaves.approve') ||
      permissions.has('employees.manage_accounts') ||
      roles.has('BRANCH_MANAGER') ||
      roles.has('REGION_MANAGER') ||
      roles.has('SUPER_ADMIN'),
  },
  {
    label: 'الجزاءات',
    href: '/dashboard/penalties',
    icon: Gavel,
    visible: (permissions, roles) =>
      permissions.has('penalties.view') ||
      permissions.has('penalties.manage') ||
      roles.has('BRANCH_MANAGER') ||
      roles.has('REGION_MANAGER') ||
      roles.has('SUPER_ADMIN'),
  },
  {
    label: 'الرواتب',
    href: '/dashboard/payroll',
    icon: CircleDollarSign,
    visible: permissions =>
      permissions.has('payroll.view') ||
      permissions.has('payroll.manage'),
  },
  {
    label: 'التنبيهات',
    href: '/dashboard/notifications',
    icon: Bell,
    visible: permissions => permissions.has('notifications.view'),
  },
  {
    label: 'التقارير',
    href: '/dashboard/reports',
    icon: BarChart3,
    visible: (permissions, roles) => permissions.has('reports.view') || roles.has('REGION_MANAGER') || roles.has('SUPER_ADMIN'),
  },
  {
    label: 'الإعدادات',
    href: '/dashboard/settings',
    icon: Settings,
    visible: (_permissions, roles) => roles.has('SUPER_ADMIN'),
  },
]

const navigationGroups = [
  { label: 'مساحة العمل', hrefs: ['/dashboard', '/portal'] },
  { label: 'المؤسسة', hrefs: ['/dashboard/employees', '/dashboard/regions', '/dashboard/branches', '/dashboard/organization', '/dashboard/roles'] },
  { label: 'العمليات اليومية', hrefs: ['/dashboard/shifts', '/dashboard/attendance', '/dashboard/leaves', '/dashboard/permissions', '/dashboard/penalties', '/dashboard/payroll'] },
  { label: 'المتابعة', hrefs: ['/dashboard/notifications', '/dashboard/reports'] },
  { label: 'الإدارة', hrefs: ['/dashboard/settings'] },
]

export function Sidebar({
  mobileOpen = false,
  onNavigate,
}: {
  mobileOpen?: boolean
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  const [access, setAccess] = useState<Access>({})

  useEffect(() => {
    const supabase = createClient()
    void supabase.rpc('app_current_access').then(result => {
      if (!result.error && result.data) {
        setAccess(result.data as Access)
      }
    })
  }, [])

  const permissions = useMemo(
    () => new Set(access.permissions ?? []),
    [access.permissions],
  )
  const roles = useMemo(
    () => new Set((access.roles ?? []).map(role => role.code)),
    [access.roles],
  )

  const visibleItems = items.filter(item =>
    item.visible(permissions, roles),
  )

  return (
    <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
      <div className="sidebar-mobile-heading">
        <Link href="/dashboard" className="sidebar-logo-link" aria-label="Emora HR — الرئيسية">
          <Logo light />
        </Link>
        <button
          type="button"
          className="sidebar-close"
          aria-label="إغلاق القائمة"
          onClick={onNavigate}
        >
          <X />
        </button>
      </div>

      <div className="sidebar-desktop-logo">
        <Link href="/dashboard" className="sidebar-logo-link" aria-label="Emora HR — الرئيسية">
          <Logo light />
        </Link>
      </div>

      <nav aria-label="التنقل الرئيسي">
        {navigationGroups.map(group => {
          const groupItems = visibleItems.filter(item => group.hrefs.includes(item.href))
          if (!groupItems.length) return null

          return (
            <section className="sidebar-group" key={group.label}>
              <h2>{group.label}</h2>
              {groupItems.map(item => {
                const Icon = item.icon
                const active = item.href === '/dashboard'
                  ? pathname === '/dashboard'
                  : pathname.startsWith(item.href)

                return (
                  <Link
                    className={active ? 'active' : ''}
                    href={item.href}
                    key={item.label}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                  >
                    <Icon size={19} />
                    <span>{item.label}</span>
                  </Link>
                )
              })}
            </section>
          )
        })}
      </nav>

      <div className="sidebar-footer">
        <strong>Emora HR</strong>
        <span>إدارة الموارد البشرية</span>
      </div>
    </aside>
  )
}

