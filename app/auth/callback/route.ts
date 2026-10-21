import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const nextParam = requestUrl.searchParams.get('next') || '/setup'
  const nextPath = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/setup'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(new URL(nextPath, requestUrl.origin))
    }
  }

  return NextResponse.redirect(new URL('/setup?error=auth', requestUrl.origin))
}
