import Link from 'next/link'
import { ArrowLeft, MapPin, ShieldCheck, TimerReset } from 'lucide-react'
import { Logo } from '@/components/logo'
import { LandingHeroVisual } from '@/components/landing-hero-visual'

export default function Home() {
  return (
    <main className="landing-shell">
      <nav className="landing-nav">
        <Logo light />
        <Link className="button button-ghost" href="/login">تسجيل الدخول</Link>
      </nav>

      <section className="hero-grid">
        <div className="hero-copy">
          <span className="eyebrow">Smart management • More precise attendance • A better team</span>
          <h1>A modern human resources system that starts from the employee's perspective.</h1>
          <p>
            أدِر الفروع والشيفتات والحضور والإجازات من منصة واحدة، مع تحديد نطاق كل فرع
            ومتابعة فريق العمل لحظة بلحظة.
          </p>
          <div className="hero-actions">
            <Link className="button button-primary" href="/setup">
              ابدأ إعداد الشركة <ArrowLeft size={18} />
            </Link>
            <Link className="button button-secondary" href="/login">لدي حساب بالفعل</Link>
          </div>
          <div className="trust-row">
            <span><ShieldCheck size={18} /> صلاحيات دقيقة</span>
            <span><MapPin size={18} /> حضور بالموقع</span>
            <span><TimerReset size={18} /> متابعة مباشرة</span>
          </div>
        </div>

        <LandingHeroVisual />
      </section>
    </main>
  )
}
