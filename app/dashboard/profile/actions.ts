'use server'

import { createClient } from '@/lib/supabase/server'

export type PersonalProfile = {
  fullName: string
  email: string
  phone: string
}

export async function getPersonalProfile(): Promise<PersonalProfile> {
  const sessionClient = await createClient()
  const { data: authData, error: authError } = await sessionClient.auth.getUser()
  if (authError || !authData.user) throw new Error('انتهت جلسة الدخول. سجّل الدخول مجددًا.')

  const { data: profileData, error } = await sessionClient.rpc('app_my_profile')
  const profile = profileData as { full_name?: string | null; phone?: string | null } | null
  if (error) console.error('[profile] profile RPC failed', { code: error.code })

  return {
    fullName: profile?.full_name ?? String(authData.user.user_metadata?.full_name ?? authData.user.user_metadata?.name ?? ''),
    email: authData.user.email ?? '',
    phone: profile?.phone ?? String(authData.user.user_metadata?.phone ?? ''),
  }
}
