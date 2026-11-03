import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Emora HR | إدارة الموارد البشرية',
  description: 'إيمورا HR — مساحة موحدة لإدارة الموظفين والحضور والعمليات اليومية.',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  )
}
