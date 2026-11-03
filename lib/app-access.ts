export type AppAccess = {
  employee_id?: string | null
  company_id?: string | null
  full_name?: string | null
  permissions?: string[] | null
  roles?: Array<{ id?: string | null; name?: string | null; code?: string | null; source?: string }> | null
  is_platform_admin?: boolean
  memberships?: Array<{ company_id: string; company_name: string }> | null
  platform_context?: { role: 'PLATFORM_SUPER_ADMIN'; selected_company_id: string | null } | null
}

// These are company-scoped roles used for application navigation. Platform
// authority is resolved separately by the server and is never inferred here.
const ADMIN_ROLE_CODES = new Set([
  'COMPANY_OWNER',
  'COMPANY_MODERATOR',
  'HR_SPECIALIST',
  'AREA_MANAGER',
  'BRANCH_MANAGER',
])
const SELF_ONLY_PERMISSIONS = new Set(['shifts.view_own', 'attendance.view_own'])

export function formatAppError(err: unknown, fallback = 'تعذر إكمال العملية'): string {
  if (typeof err === 'string') {
    const text = err.trim()
    if (text && text !== '{}' && text !== '[object Object]') return text
    return fallback
  }

  if (err && typeof err === 'object') {
    const rec = err as Record<string, unknown>
    for (const key of ['message', 'error', 'details', 'hint']) {
      const value = rec[key]
      if (typeof value === 'string') {
        const text = value.trim()
        if (text && text !== '{}' && text !== '[object Object]') return text
      }
    }
  }

  return fallback
}

export function hasAdminAccess(access: AppAccess | null | undefined): boolean {
  if (!access) return false
  if (access.is_platform_admin) return true
  const permissions = access.permissions ?? []
  const roles = new Set((access.roles ?? []).map(role => role.code).filter(Boolean) as string[])
  return (
    [...roles].some(code => ADMIN_ROLE_CODES.has(code)) ||
    permissions.some(code => !SELF_ONLY_PERMISSIONS.has(code))
  )
}
