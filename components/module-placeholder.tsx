import Link from 'next/link'
import { Construction, Database, ArrowLeft } from 'lucide-react'

export function ModulePlaceholder({ title, description, nextStep }: { title: string; description: string; nextStep: string }) {
  return (
    <main className="dashboard-content">
      <section className="page-heading"><div><span className="eyebrow">وحدة تشغيلية</span><h1>{title}</h1><p>{description}</p></div></section>
      <section className="panel module-placeholder">
        <div className="module-placeholder-icon"><Construction size={36}/></div>
        <h2>الزر يعمل والصفحة مرتبطة فعليًا</h2>
        <p>هذه الوحدة لا تعرض بيانات تجريبية. سيتم تفعيل منطقها وقاعدة بياناتها في المرحلة التالية.</p>
        <div className="form-note"><Database size={18}/> الخطوة التالية: {nextStep}</div>
        <Link className="button button-ghost" href="/dashboard"><ArrowLeft size={18}/> العودة للرئيسية</Link>
      </section>
    </main>
  )
}
