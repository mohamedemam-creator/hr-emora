import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

type AccountContext = {
  employee_id: string
  company_id: string
  email: string | null
  full_name: string
  user_id: string | null
  has_login: boolean
  login_enabled: boolean
  employment_status: string
  account_invited_at: string | null
}

async function writeAudit(admin: ReturnType<typeof createClient>, event: Record<string, unknown>) {
  try {
    const { error } = await admin.from('audit_logs').insert(event)
    if (!error) return true
    console.error('[audit] manage-employee-account insert failed', {
      action: event.action, company_id: event.company_id ?? null,
      entity_id: event.entity_id ?? null, code: error.code,
    })
  } catch (error) {
    console.error('[audit] manage-employee-account insert threw', {
      action: event.action, error_type: error instanceof Error ? error.name : 'unknown',
    })
  }
  return false
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  let admin: ReturnType<typeof createClient> | null = null
  let actorUserId: string | null = null
  let target: AccountContext | null = null
  let action = 'authenticate'

  try {
    const token = req.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
    if (!token) throw new HttpError(401, 'Sign in before managing an employee account.')
    const url = Deno.env.get('SUPABASE_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !serviceKey) throw new Error('server configuration unavailable')
    admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

    const { data: authData, error: authError } = await admin.auth.getUser(token)
    if (authError || !authData.user) throw new HttpError(401, 'The signed-in user could not be verified.')
    actorUserId = authData.user.id
    const body = await req.json()
    action = String(body.action ?? '')
    const employeeId = String(body.employeeId ?? '')
    if (!employeeId) throw new HttpError(400, 'Employee ID is required.')

    const { data: contextData, error: contextError } = await admin.rpc('service_employee_account_context', {
      p_actor_user_id: actorUserId,
      p_employee_id: employeeId,
    })
    if (contextError || !contextData) {
      console.error('[manage-employee-account] authorization denied', {
        action, actor_user_id: actorUserId, code: contextError?.code ?? null,
      })
      throw new HttpError(403, 'You cannot manage this employee account or the employee is outside your company.')
    }
    target = contextData as AccountContext

    if (action === 'create' || action === 'invite') {
      if (!target.email) throw new HttpError(400, 'Save an email address for this employee before sending an invitation.')
      if (target.user_id) throw new HttpError(409, 'This employee already has a linked sign-in account.')
      const appUrl = Deno.env.get('APP_URL')
      if (!appUrl) throw new Error('APP_URL is required to create an invitation redirect.')
      const redirect = new URL('/auth/callback', appUrl)
      redirect.searchParams.set('next', '/accept-invitation')
      const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(target.email, {
        data: { full_name: target.full_name, emora_pending_employee_invitation: true },
        redirectTo: redirect.toString(),
      })
      if (inviteError) {
        const normalized = inviteError.message.toLowerCase()
        if (normalized.includes('already registered') || normalized.includes('already exists') || normalized.includes('already been invited')) {
          throw new HttpError(409, 'An Auth account already uses this email. The employee must sign in with that account and accept the pending company invitation; no duplicate account was created.')
        }
        console.error('[manage-employee-account] invitation failed', { actor_user_id: actorUserId, employee_id: employeeId, code: inviteError.code ?? null })
        throw new HttpError(502, 'The Auth invitation could not be sent. The employee record is saved; you can retry the invitation.')
      }
      const { error: stateError } = await admin.rpc('service_set_employee_account_state', {
        p_actor_user_id: actorUserId,
        p_employee_id: employeeId,
        p_login_enabled: null,
        p_must_change_password: false,
        p_invited_at: new Date().toISOString(),
      })
      const auditLogged = await writeAudit(admin, {
        actor_user_id: actorUserId, actor_company_role: null, actor_platform_role: null,
        company_id: target.company_id, action: 'employee.account.invited', category: 'identity',
        entity_type: 'employee', entity_id: employeeId, status: 'success',
        context: { source: 'manage-employee-account' },
      })
      if (stateError) {
        console.error('[manage-employee-account] invite sent but employee marker failed', { actor_user_id: actorUserId, employee_id: employeeId, code: stateError.code })
        return json({ ok: true, inviteSent: true, partial: true, auditLogged, message: 'Invitation sent. The employee can activate the account from the email link.' })
      }
      return json({ ok: true, inviteSent: true, auditLogged, message: 'Invitation sent to the employee email.' })
    }

    if (!target.user_id) throw new HttpError(409, 'This employee has not activated an Auth account yet.')

    if (action === 'reset-password') {
      const password = String(body.password ?? '')
      if (password.length < 8) throw new HttpError(400, 'Temporary password must contain at least 8 characters.')
      const { data: current, error: getError } = await admin.auth.admin.getUserById(target.user_id)
      if (getError || !current.user) throw new HttpError(409, 'The linked Auth account no longer exists.')
      const { error: updateError } = await admin.auth.admin.updateUserById(target.user_id, {
        password,
        user_metadata: { ...(current.user.user_metadata ?? {}), must_change_password: true },
      })
      if (updateError) throw new HttpError(502, 'Password reset failed; no employee data was changed.')
      const { error: stateError } = await admin.rpc('service_set_employee_account_state', {
        p_actor_user_id: actorUserId, p_employee_id: employeeId,
        p_login_enabled: null, p_must_change_password: true, p_invited_at: null,
      })
      if (stateError) console.error('[manage-employee-account] password changed; DB flag sync failed', { actor_user_id: actorUserId, employee_id: employeeId, code: stateError.code })
      const auditLogged = await writeAudit(admin, {
        actor_user_id: actorUserId, actor_company_role: null, actor_platform_role: null,
        company_id: target.company_id, action: 'employee.account.password_reset', category: 'identity',
        entity_type: 'employee', entity_id: employeeId, status: 'success',
        context: { source: 'manage-employee-account', db_flag_synced: !stateError },
      })
      return json({ ok: true, auditLogged, partial: Boolean(stateError), message: stateError ? 'Password changed; the database reminder flag could not be synchronized.' : 'Temporary password set. The employee must change it at next sign-in.' })
    }

    if (action === 'disable' || action === 'enable') {
      const enabled = action === 'enable'
      if (enabled && target.employment_status !== 'active') throw new HttpError(409, 'Set the employee status to active before enabling sign-in.')
      if (enabled) {
        const { error } = await admin.auth.admin.updateUserById(target.user_id, { ban_duration: 'none' })
        if (error) throw new HttpError(502, 'Auth could not enable this account.')
      }
      const { error: stateError } = await admin.rpc('service_set_employee_account_state', {
        p_actor_user_id: actorUserId, p_employee_id: employeeId,
        p_login_enabled: enabled, p_must_change_password: null, p_invited_at: null,
      })
      if (stateError) throw new HttpError(502, 'The Auth status changed but company access could not be synchronized; contact support before retrying.')
      if (!enabled) {
        const { error } = await admin.auth.admin.updateUserById(target.user_id, { ban_duration: '876000h' })
        if (error) console.error('[manage-employee-account] company access disabled but Auth ban failed', { actor_user_id: actorUserId, employee_id: employeeId, code: error.code })
      }
      const auditLogged = await writeAudit(admin, {
        actor_user_id: actorUserId, actor_company_role: null, actor_platform_role: null,
        company_id: target.company_id, action: `employee.account.${action}d`, category: 'identity',
        entity_type: 'employee', entity_id: employeeId, status: 'success',
        context: { source: 'manage-employee-account' },
      })
      return json({ ok: true, auditLogged, partial: !enabled, message: enabled ? 'Employee sign-in enabled.' : 'Company access disabled; existing Auth sessions may take time to expire.' })
    }

    if (action === 'update-email') {
      throw new HttpError(409, 'A manager cannot directly replace an Auth email. The employee must initiate and confirm the email change from their signed-in account.')
    }
    throw new HttpError(400, 'Unsupported employee account action.')
  } catch (error) {
    if (admin && actorUserId) {
      await writeAudit(admin, {
        actor_user_id: actorUserId, actor_company_role: null, actor_platform_role: null,
        company_id: target?.company_id ?? null, action: `employee.account.${action}.failed`,
        category: 'identity', entity_type: 'employee', entity_id: target?.employee_id ?? null,
        status: 'failure', context: { source: 'manage-employee-account' },
      })
    }
    if (error instanceof HttpError) return json({ error: error.message }, error.status)
    console.error('[manage-employee-account] request failed', {
      action, actor_user_id: actorUserId, employee_id: target?.employee_id ?? null,
      error_type: error instanceof Error ? error.name : 'unknown',
    })
    return json({ error: 'Employee account operation failed. The employee record was preserved.' }, 500)
  }
})
