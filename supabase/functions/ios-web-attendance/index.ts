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

function decodeBase64(value: string) {
  const binary = atob(value)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

function validCoordinates(body: Record<string, unknown>) {
  return typeof body.latitude === 'number' && Number.isFinite(body.latitude) &&
    typeof body.longitude === 'number' && Number.isFinite(body.longitude) &&
    typeof body.accuracy === 'number' && Number.isFinite(body.accuracy)
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  try {
    const token = req.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
    if (!token) return json({ error: 'Sign in before using attendance.' }, 401)
    const url = Deno.env.get('SUPABASE_URL')
    const publicKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')
    if (!url || !publicKey) throw new Error('server configuration unavailable')

    const supabase = createClient(url, publicKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data: authData, error: authError } = await supabase.auth.getUser(token)
    if (authError || !authData.user) return json({ error: 'The signed-in account could not be verified.' }, 401)

    const body = await req.json() as Record<string, unknown>
    const action = String(body.action ?? '')
    if (action === 'status') {
      const browserId = String(body.browserId ?? '')
      const publicKeySpki = String(body.publicKeySpki ?? '')
      if (!browserId || !publicKeySpki) return json({ bound: false, pending: false })
      const { data, error } = await supabase.rpc('app_my_ios_web_device_status', {
        p_browser_id: browserId,
        p_public_key_spki: publicKeySpki,
      })
      if (error) return json({ error: error.message }, 403)
      return json(data as Record<string, unknown>)
    }

    if (action === 'request_binding') {
      const browserId = String(body.browserId ?? '')
      const publicKeySpki = String(body.publicKeySpki ?? '')
      if (!browserId || !publicKeySpki) return json({ error: 'Browser key registration is incomplete.' }, 400)
      const { data, error } = await supabase.rpc('app_request_ios_web_binding', {
        p_browser_id: browserId,
        p_public_key_spki: publicKeySpki,
        p_user_agent: '',
      })
      if (error) return json({ error: error.message }, 400)
      return json(data as Record<string, unknown>)
    }

    if (action !== 'signed') return json({ error: 'Unsupported attendance action.' }, 400)
    const payload = String(body.payload ?? '')
    const signatureText = String(body.signature ?? '')
    if (!payload || payload.length > 4096 || !signatureText || signatureText.length > 512) {
      return json({ error: 'Signed request is malformed.' }, 400)
    }

    let signed: Record<string, unknown>
    try {
      signed = JSON.parse(payload)
    } catch {
      return json({ error: 'Signed request payload is invalid.' }, 400)
    }
    const browserId = String(signed.browserId ?? '')
    const nonce = String(signed.nonce ?? '')
    const timestampText = String(signed.timestamp ?? '')
    const timestamp = new Date(timestampText)
    const now = Date.now()
    if (!browserId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(nonce) ||
        !Number.isFinite(timestamp.getTime()) || Math.abs(now - timestamp.getTime()) > 120_000) {
      return json({ error: 'Signed request expired or is incomplete.' }, 401)
    }
    const signedAction = String(signed.action ?? '')
    if (!['attendance', 'report_position'].includes(signedAction)) return json({ error: 'Unsupported signed action.' }, 400)

    const { data: publicKeySpki, error: keyError } = await supabase.rpc('app_my_ios_web_device_public_key', {
      p_browser_id: browserId,
    })
    if (keyError || typeof publicKeySpki !== 'string') return json({ error: 'An approved attendance browser is required.' }, 403)

    const verifyKey = await crypto.subtle.importKey(
      'spki', decodeBase64(publicKeySpki), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'],
    )
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' }, verifyKey, decodeBase64(signatureText), new TextEncoder().encode(payload),
    )
    if (!valid) return json({ error: 'Device signature is invalid.' }, 401)

    const { error: nonceError } = await supabase.rpc('app_consume_ios_web_nonce', {
      p_browser_id: browserId,
      p_nonce: nonce,
      p_timestamp: timestamp.toISOString(),
    })
    if (nonceError) return json({ error: nonceError.message }, 401)

    if (!validCoordinates(signed)) return json({ error: 'Valid GPS coordinates and accuracy are required.' }, 400)
    if (signedAction === 'report_position') {
      const { data, error } = await supabase.rpc('app_report_attendance_position', {
        p_latitude: signed.latitude,
        p_longitude: signed.longitude,
        p_accuracy_m: signed.accuracy,
      })
      if (error) return json({ error: error.message }, 400)
      return json(data as Record<string, unknown>)
    }

    const attendanceAction = String(signed.attendanceAction ?? '')
    if (!['check_in', 'check_out'].includes(attendanceAction)) return json({ error: 'Unsupported attendance action.' }, 400)
    const { data, error } = await supabase.rpc('app_attendance_action', {
      p_action: attendanceAction,
      p_latitude: signed.latitude,
      p_longitude: signed.longitude,
      p_accuracy_m: signed.accuracy,
      p_device_id: `ios:${browserId}`,
    })
    if (error) return json({ error: error.message }, 400)
    return json(data as Record<string, unknown>)
  } catch (error) {
    console.error('[ios-web-attendance] request failed', {
      error_type: error instanceof Error ? error.name : 'unknown',
    })
    return json({ error: 'Attendance request failed. Try again or contact support.' }, 500)
  }
})
