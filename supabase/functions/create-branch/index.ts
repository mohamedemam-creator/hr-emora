import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('يجب تسجيل الدخول أولًا.')
    const url = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
    const token = authHeader.replace('Bearer ', '')
    const { data: userData, error: userError } = await admin.auth.getUser(token)
    if (userError || !userData.user) throw new Error('جلسة المستخدم غير صالحة.')

    const { data: employee, error: employeeError } = await admin.from('employees').select('id, company_id').eq('user_id', userData.user.id).eq('employment_status', 'active').single()
    if (employeeError || !employee) throw new Error('لا يوجد ملف موظف مرتبط بالحساب.')

    const { data: permissionRows, error: permissionError } = await admin.from('employee_roles').select('role_permissions!inner(permissions!inner(code))').eq('employee_id', employee.id)
    if (permissionError) throw permissionError
    const permissionCodes = new Set<string>()
    for (const row of permissionRows ?? []) {
      const rolePermissions = Array.isArray(row.role_permissions) ? row.role_permissions : [row.role_permissions]
      for (const rp of rolePermissions) {
        const permission = Array.isArray(rp?.permissions) ? rp.permissions[0] : rp?.permissions
        if (permission?.code) permissionCodes.add(permission.code)
      }
    }
    if (!permissionCodes.has('branches.manage') && !permissionCodes.has('branches.view_all')) throw new Error('ليس لديك صلاحية إضافة الفروع.')

    const body = await req.json()
    const branchName = String(body.branchName ?? '').trim()
    const branchCode = String(body.branchCode ?? '').trim().toUpperCase()
    const regionName = String(body.regionName ?? '').trim()
    const regionCode = String(body.regionCode ?? '').trim().toUpperCase()
    const address = String(body.address ?? '').trim()
    const latitude = Number(body.latitude)
    const longitude = Number(body.longitude)
    const accuracy = Number(body.accuracy)
    const radius = Number(body.radius)

    if (!branchName || !branchCode || !regionName || !regionCode) throw new Error('أكمل بيانات الفرع والمنطقة.')
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new Error('إحداثيات الموقع غير صحيحة.')
    if (!Number.isFinite(accuracy) || accuracy > 100) throw new Error('دقة GPS غير كافية. تحرك لمكان مفتوح وأعد المحاولة.')
    if (![50, 100, 150, 200, 300].includes(radius)) throw new Error('نطاق الحضور غير مسموح.')

    let { data: region, error: regionError } = await admin.from('regions').select('id').eq('company_id', employee.company_id).eq('code', regionCode).maybeSingle()
    if (regionError) throw regionError
    if (!region) {
      const created = await admin.from('regions').insert({ company_id: employee.company_id, name: regionName, code: regionCode }).select('id').single()
      if (created.error) throw created.error
      region = created.data
    }

    const { data: branch, error: branchError } = await admin.rpc('insert_branch_with_location', {
      p_company_id: employee.company_id,
      p_region_id: region.id,
      p_name: branchName,
      p_code: branchCode,
      p_address: address,
      p_latitude: latitude,
      p_longitude: longitude,
      p_radius: radius,
      p_accuracy_limit: 100,
    })
    if (branchError) throw branchError

    await admin.from('audit_logs').insert({ company_id: employee.company_id, actor_user_id: userData.user.id, actor_employee_id: employee.id, action: 'branch.created', entity_type: 'branch', entity_id: branch.id, new_data: { branchName, branchCode, regionCode, latitude, longitude, radius, accuracy } })

    return new Response(JSON.stringify({ ok: true, branch }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 })
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'حدث خطأ غير متوقع.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 })
  }
})
