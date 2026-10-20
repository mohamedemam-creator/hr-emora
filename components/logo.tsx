import type { SVGProps } from 'react'

type LogoProps = { compact?: boolean; light?: boolean }

function Mark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" {...props}>
      <defs>
        <linearGradient id="EmoraGradient" x1="8" y1="8" x2="56" y2="56">
          <stop stopColor="#ff9a4c" />
          <stop offset="0.48" stopColor="#3d5dff" />
          <stop offset="1" stopColor="#1d952d" />
        </linearGradient>
      </defs>
      <path d="M42 10c-5-6-14-6-20-1C9 19 8 40 22 51c11 9 27 4 33-8-6 6-17 8-25 2-10-7-11-22-3-30 4-4 10-6 15-5Z" fill="url(#EmoraGradient)" />
      <path d="M26 30l6 6 12-14" fill="none" stroke="black" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M29 8c2-5 7-7 12-7-1 5-5 9-12 7Zm-5 0c-3-4-7-5-11-4 2 5 6 7 11 4Z" fill="#ff674c" />
    </svg>
  )
}

export function Logo({ compact = false, light = false }: LogoProps) {
  return (
    <div className="brand-lockup">
      <Mark className="brand-mark" />
      {!compact && (
        <div>
          <div className={`brand-name ${light ? 'brand-name-light' : ''}`}>Emora</div>
          <div className={`brand-subtitle ${light ? 'brand-subtitle-light' : ''}`}>TIME &amp; ATTENDANCE</div>
        </div>
      )}
    </div>
  )
}
