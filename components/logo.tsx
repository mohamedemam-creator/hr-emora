import type { SVGProps } from 'react'

type LogoProps = { compact?: boolean; light?: boolean }

function Mark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" {...props}>
      <rect width="48" height="48" rx="15" fill="#29245F" />
      <path d="M14 14h21v5H19v5h13v5H19v5h16v5H14V14Z" fill="#F7F8FF" />
      <path d="M30 14h5v5h-5zM30 24h5v5h-5zM30 34h5v5h-5z" fill="#22D3EE" />
    </svg>
  )
}

export function Logo({ compact = false, light = false }: LogoProps) {
  return (
    <div className="brand-lockup">
      <Mark className="brand-mark" />
      {!compact && (
        <div>
          <div className={`brand-name ${light ? 'brand-name-light' : ''}`}>Emora <span>HR</span></div>
          <div className={`brand-subtitle ${light ? 'brand-subtitle-light' : ''}`}>إدارة الموارد البشرية</div>
        </div>
      )}
    </div>
  )
}
