'use client'

import { ReactNode, useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Sidebar } from '@/components/sidebar'
import { Topbar } from '@/components/topbar'

export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  useEffect(() => {
    setSidebarCollapsed(window.localStorage.getItem('emora.sidebar-collapsed') === 'true')
  }, [])

  function toggleSidebar() {
    const nextCollapsed = !sidebarCollapsed
    setSidebarCollapsed(nextCollapsed)
    window.localStorage.setItem('emora.sidebar-collapsed', String(nextCollapsed))
  }

  useEffect(() => {
    setMobileMenuOpen(false)
  }, [pathname])

  useEffect(() => {
    document.body.style.overflow = mobileMenuOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [mobileMenuOpen])

  return (
    <div className={`dashboard-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <Sidebar
        mobileOpen={mobileMenuOpen}
        collapsed={sidebarCollapsed}
        onNavigate={() => setMobileMenuOpen(false)}
      />

      {mobileMenuOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="إغلاق القائمة"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      <div className="dashboard-main">
        <Topbar
          onMenuToggle={() => setMobileMenuOpen(value => !value)}
          onSidebarToggle={toggleSidebar}
          sidebarCollapsed={sidebarCollapsed}
        />
        {children}
      </div>
    </div>
  )
}
