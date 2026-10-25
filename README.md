# Emora — Time & Attendance

نسخة البداية من نظام سيلين لإدارة الموارد البشرية والحضور والانصراف.

## الموجود حاليًا

- هوية بصرية وشعار Emora.
- صفحة تعريفية حديثة.
- تسجيل الدخول عبر Supabase Auth.
- إعداد الشركة ومدير النظام لأول مرة من داخل البرنامج.
- لوحة تحكم عربية RTL.
- شاشة إضافة فرع أثناء الزيارة باستخدام GPS.
- Edge Functions آمنة لإنشاء الشركة والفرع.
- إعداد جاهز للنشر على Cloudflare Workers.

## 1) تجهيز قاعدة البيانات

أنت نفذت بالفعل ملف `001_time_attendance_core.sql`.
نفّذ الآن مرة واحدة فقط الملف:

`supabase/migrations/002_app_bootstrap_support.sql`

هذا الملف لا يضيف بيانات الشركة أو الفروع؛ بل يضيف وظيفة داخلية آمنة تستخدمها شاشة إضافة الفرع.

## 2) إعداد متغيرات المشروع

انسخ `.env.example` إلى `.env.local` ثم ضع Project URL وPublishable Key من Supabase > Connect.

```bash
cp .env.example .env.local
```

## 3) تثبيت وتشغيل الواجهة

```bash
npm install
npm run dev
```

افتح `http://localhost:3000`.

## 4) نشر Edge Functions

بعد تثبيت Supabase CLI وتسجيل الدخول:

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy bootstrap-company
supabase functions deploy create-branch
```

مفتاح `SUPABASE_SERVICE_ROLE_KEY` متاح تلقائيًا داخل Supabase Edge Functions المستضافة. لا تضعه في `.env.local` ولا في كود المتصفح.

## 5) إعداد Auth

للتجربة السريعة يمكنك تعطيل تأكيد البريد مؤقتًا من:
Authentication > Providers > Email

في الإنتاج يفضّل إبقاء التأكيد مفعّلًا وربط SMTP خاص بالشركة.

## 6) اختبار Cloudflare

```bash
npm run preview
```

## 7) النشر على Cloudflare Workers

```bash
npm run deploy
```

أضف متغيري Supabase في إعدادات Worker ضمن Build Variables and secrets:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

## التدفق

1. افتح `/setup`.
2. أنشئ الشركة ومدير النظام من البرنامج.
3. انتقل إلى لوحة التحكم.
4. افتح المناطق والفروع.
5. أثناء وجودك بالفرع اضغط استخدام موقعي الحالي ثم احفظ الفرع.

## معاينة فورية بدون تثبيت

افتح الملف `preview/index.html` مباشرة في المتصفح لمشاهدة التصميم والتنقل بين لوحة التحكم، إعداد الشركة، وإضافة الفرع. هذه معاينة واجهة فقط؛ الربط الفعلي موجود في مشروع Next.js.
