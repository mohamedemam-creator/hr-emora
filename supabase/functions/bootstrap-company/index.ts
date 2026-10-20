import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('جلسة المستخدم غير موجودة.')

    const url = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
    const token = authHeader.replace('Bearer ', '')
    const { data: userData, error: userError } = await admin.auth.getUser(token)
    if (userError || !userData.user) throw new Error('تعذر التحقق من المستخدم.')

    const { count, error: countError } = await admin.from('companies').select('id', { count: 'exact', head: true })
    if (countError) throw countError
    if ((count ?? 0) > 0) throw new Error('تم إعداد الشركة بالفعل. سجّل الدخول بحساب مدير النظام.')

    const body = await req.json()
    const companyName = String(body.companyName ?? '').trim()
    const companyCode = String(body.companyCode ?? '').trim().toUpperCase()
    const adminName = String(body.adminName ?? '').trim()
    const employeeCode = String(body.employeeCode ?? '').trim().toUpperCase()
    const phone = String(body.phone ?? '').trim()
    if (!companyName || !companyCode || !adminName || !employeeCode) throw new Error('أكمل جميع البيانات المطلوبة.')

    const { data: company, error: companyError } = await admin.from('companies').insert({ name: companyName, code: companyCode }).select().single()
    if (companyError) throw companyError

    const { data: department, error: departmentError } = await admin.from('departments').insert({ company_id: company.id, name: 'الإدارة العامة', code: 'ADMIN' }).select().single()
    if (departmentError) throw departmentError

    const { data: jobTitle, error: jobError } = await admin.from('job_titles').insert({ company_id: company.id, department_id: department.id, name: 'مدير النظام', code: 'SUPER_ADMIN' }).select().single()
    if (jobError) throw jobError

    const { error: profileError } = await admin.from('profiles').insert({ user_id: userData.user.id, full_name: adminName, phone: phone || null })
    if (profileError) throw profileError

    const { data: employee, error: employeeError } = await admin.from('employees').insert({
      company_id: company.id,
      user_id: userData.user.id,
      employee_code: employeeCode,
      full_name: adminName,
      phone: phone || null,
      email: userData.user.email,
      department_id: department.id,
      job_title_id: jobTitle.id,
    }).select().single()
    if (employeeError) throw employeeError

    const { data: role, error: roleError } = await admin.from('roles').insert({ company_id: company.id, name: 'مدير النظام', code: 'SUPER_ADMIN', is_system: true }).select().single()
    if (roleError) throw roleError

    const { data: permissions, error: permissionsError } = await admin.from('permissions').select('id')
    if (permissionsError) throw permissionsError
    if (permissions?.length) {
      const { error: rolePermissionsError } = await admin.from('role_permissions').insert(permissions.map((permission) => ({ role_id: role.id, permission_id: permission.id })))
      if (rolePermissionsError) throw rolePermissionsError
    }

    const { error: employeeRoleError } = await admin.from('employee_roles').insert({ employee_id: employee.id, role_id: role.id, assigned_by: employee.id })
    if (employeeRoleError) throw employeeRoleError

    return new Response(JSON.stringify({ ok: true, companyId: company.id }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 })
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'حدث خطأ غير متوقع.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 })
  }
})
