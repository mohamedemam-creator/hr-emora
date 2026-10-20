import Link from 'next/link'
import { ArrowLeft, Building2, MapPin, ShieldCheck, TimerReset } from 'lucide-react'
import { Logo } from '@/components/logo'

export default function Home() {
  return (
    <main className="landing-shell">
      <nav className="landing-nav">
        <Logo />
        <Link className="button button-ghost" href="/login">تسجيل الدخول</Link>
      </nav>

      <section className="hero-grid">
        <div className="hero-copy">
          <span className="eyebrow">Smart management • More precise attendance • A better team</span>
          <h1>A modern human resources system that starts from the employee's perspective. </h1>
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

        <div className="hero-visual">
          <div className="phone-mockup">
            <div className="phone-top"><span>9:41</span><span>● ● ●</span></div>
            <div className="phone-content">
              <div className="avatar">م</div>
              <h3> good morrning , ali </h3>
              <p> You are within the Zayed branch area </p>
              <div className="attendance-ring"><strong>12:00</strong><span> Arrival time </span></div>
              <button> sign in </button>
              <div className="mini-grid">
                <div><Building2 size={20}/><span>branche</span></div>
                <div><TimerReset size={20}/><span>shift</span></div>
                <div><MapPin size={20}/><span>location</span></div>
              </div>
            </div>
          </div>
          <div className="floating-card card-a"><span> Those present today </span><strong>287</strong><small>+12% عن أمس</small></div>
          <div className="floating-card card-b"><span> accurate location</span><strong>8 m</strong><small>داخل النطاق</small></div>
        </div>
      </section>
    </main>
  )
}
