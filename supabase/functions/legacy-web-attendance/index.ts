import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

  try {
    const token = req.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
    if (!token) return json({ error: 'Sign in before using attendance.' }, 401)
    const url = Deno.env.get('SUPABASE_URL')
    const publishableKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')
    if (!url || !publishableKey) throw new Error('server configuration unavailable')

    // Pass the caller JWT to PostgREST so auth.uid() and database authorization
    // remain the signed-in employee, rather than a service-role identity.
    const supabase = createClient(url, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data: authData, error: authError } = await supabase.auth.getUser(token)
    if (authError || !authData.user) return json({ error: 'The signed-in account could not be verified.' }, 401)

    const body = await req.json()
    const action = String(body.action ?? '')
    const deviceId = typeof body.deviceId === 'string' ? body.deviceId.slice(0, 160) : ''
    const { data: access, error: accessError } = deviceId
      ? await supabase.rpc('app_my_web_attendance_access_for_device', { p_device_id: deviceId })
      : await supabase.rpc('app_my_web_attendance_access')
    const requestHost = new URL(url).hostname.toLowerCase()
    const isLocalSupabase = ['localhost', '127.0.0.1', '::1', '[::1]', 'kong', 'host.docker.internal'].includes(requestHost)
    const demoMode = Deno.env.get('DEMO_MODE') === 'true' && isLocalSupabase
    if ((accessError || !access?.allowed) && !demoMode) {
      if (action === 'attendance' && deviceId) {
        const { data: request, error: requestError } = await supabase.rpc(
          'app_request_my_mobile_device',
          { p_device_id: deviceId },
        )
        if (!requestError) {
          return json({
            error: request?.status === 'revoked'
              ? 'هذا الجهاز ملغي التفعيل. تواصل مع مسؤول الشركة لإعادة إتاحته.'
              : 'تم تسجيل طلب تفعيل هذا الجهاز. يلزم موافقة مسؤول الشركة قبل الحضور.',
            deviceStatus: request?.status ?? 'released',
          }, 403)
        }
      }
      return json({ error: 'Web attendance is not enabled for this employee.' }, 403)
    }

    if (action === 'status') return json({ ok: true, allowed: true, demoMode })

    if (action === 'position') {
      const { data, error } = await supabase.rpc('app_report_attendance_position', {
        p_latitude: Number(body.latitude),
        p_longitude: Number(body.longitude),
        p_accuracy_m: Number(body.accuracy),
      })
      if (error) return json({ error: error.message }, 400)
      return json(data as Record<string, unknown>)
    }

    if (action === 'attendance') {
      const { data, error } = await supabase.rpc('app_attendance_action', {
        p_action: String(body.attendanceAction ?? ''),
        p_latitude: Number(body.latitude),
        p_longitude: Number(body.longitude),
        p_accuracy_m: Number(body.accuracy),
        p_device_id: deviceId || 'web_exception',
      })
      if (error) return json({ error: error.message }, 400)
      return json(data as Record<string, unknown>)
    }

    return json({ error: 'Unsupported attendance action.' }, 400)
  } catch (error) {
    console.error('[legacy-web-attendance] request failed', {
      error_type: error instanceof Error ? error.name : 'unknown',
    })
    return json({ error: 'Attendance request failed. Try again or contact support.' }, 500)
  }
})
