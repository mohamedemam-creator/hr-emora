import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Emora | Time & Attendance',
description: 'Human Resources Innovation, Attendance and Departure System',}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  )
}
