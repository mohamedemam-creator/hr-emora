import { DashboardAccessGuard } from '@/components/dashboard-access-guard'
import { DashboardShell } from '@/components/dashboard-shell'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <DashboardAccessGuard>
      <DashboardShell>{children}</DashboardShell>
    </DashboardAccessGuard>
  )
}
