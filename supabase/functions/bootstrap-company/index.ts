import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getBootstrapPhone } from './phone.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type BootstrapResult = { company_id?: string; employee_id?: string }

function publicError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (message.includes('already linked to a company') || message.includes('platform account')) {
    return 'هذا الحساب مرتبط بشركة أو بإدارة المنصة بالفعل، ولا يمكنه إنشاء شركة من صفحة الإعداد.'
  }
  if (message.includes('invalid company') || message.includes('invalid owner') || message.includes('invalid employee')) {
    return 'راجع اسم الشركة والأكواد وبيانات المالك المطلوبة.'
  }
  if (message.includes('duplicate key') || message.includes('unique constraint')) {
    return 'كود الشركة أو الموظف مستخدم بالفعل. اختر كوداً آخر.'
  }
  if (message === 'جلسة المستخدم غير موجودة.' || message === 'تعذر التحقق من المستخدم.') return message
  return 'تعذر إنشاء الشركة بأمان. حاول مرة أخرى لاحقاً أو تواصل مع الدعم.'
}

async function writeAuditEvent(
  admin: ReturnType<typeof createClient>,
  event: Record<string, unknown>,
): Promise<boolean> {
  try {
    const { error } = await admin.from('audit_logs').insert(event)
    if (!error) return true
    console.error('[audit] bootstrap-company write failed', {
      action: event.action,
      company_id: event.company_id ?? null,
      entity_id: event.entity_id ?? null,
      code: error.code,
    })
  } catch (error) {
    console.error('[audit] bootstrap-company write threw', {
      action: event.action,
      company_id: event.company_id ?? null,
      entity_id: event.entity_id ?? null,
      error_type: error instanceof Error ? error.name : 'unknown',
    })
  }
  return false
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 405,
    })
  }

  let admin: ReturnType<typeof createClient> | null = null
  let actorUserId: string | null = null
  let actorEmployeeId: string | null = null
  let companyId: string | null = null
  let phase = 'authenticate'

  try {
    const authorization = req.headers.get('Authorization')
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
    if (!token) throw new Error('جلسة المستخدم غير موجودة.')

    const url = Deno.env.get('SUPABASE_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !serviceKey) throw new Error('server configuration unavailable')

    admin = createClient(url, serviceKey, { auth: { persistSession: false } })
    const { data: userData, error: userError } = await admin.auth.getUser(token)
    if (userError || !userData.user) throw new Error('تعذر التحقق من المستخدم.')
    actorUserId = userData.user.id

    phase = 'validate_input'
    const body = await req.json() as Record<string, unknown>
    const companyName = String(body.companyName ?? '').trim()
    const companyCode = String(body.companyCode ?? '').trim().toUpperCase()
    const ownerName = String(body.adminName ?? '').trim()
    const employeeCode = String(body.employeeCode ?? '').trim().toUpperCase()
    const phone = getBootstrapPhone(body)
    if (
      !companyName || companyName.length > 160 ||
      !/^[A-Z0-9_-]{2,20}$/.test(companyCode) ||
      !ownerName || ownerName.length > 160 ||
      !/^[A-Z0-9_-]{2,32}$/.test(employeeCode)
    ) throw new Error('invalid company or owner input')

    phase = 'bootstrap_transaction'
    const { data, error } = await admin.rpc('service_bootstrap_company', {
      p_user_id: actorUserId,
      p_company_name: companyName,
      p_company_code: companyCode,
      p_owner_name: ownerName,
      p_employee_code: employeeCode,
      p_phone: phone,
    })
    if (error) {
      console.error('[bootstrap-company] database transaction failed', {
        phase,
        actor_user_id: actorUserId,
        code: error.code,
        hint: error.hint ? 'present' : 'absent',
      })
      throw new Error(error.message)
    }

    const result = data as BootstrapResult | null
    if (!result?.company_id || !result.employee_id) {
      console.error('[bootstrap-company] transaction returned an invalid result', { phase, actor_user_id: actorUserId })
      throw new Error('invalid bootstrap result')
    }
    companyId = result.company_id
    actorEmployeeId = result.employee_id

    return new Response(JSON.stringify({
      ok: true,
      companyId,
      employeeId: actorEmployeeId,
      // service_bootstrap_company writes this event in the same transaction
      // as company, owner, membership, and role creation.
      auditLogged: true,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 })
  } catch (error) {
    if (admin && actorUserId) {
      await writeAuditEvent(admin, {
        actor_user_id: actorUserId,
        actor_employee_id: actorEmployeeId,
        actor_company_role: null,
        actor_platform_role: null,
        company_id: companyId,
        action: 'company.setup',
        category: 'company',
        entity_type: 'company',
        entity_id: companyId,
        status: 'failure',
        context: { source: 'bootstrap-company', phase },
      })
    }
    return new Response(JSON.stringify({ error: publicError(error) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
