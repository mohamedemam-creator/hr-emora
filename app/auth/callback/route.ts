import { createServerClient } from '@supabase/ssr'
import type { EmailOtpType } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import type { AppAccess } from '@/lib/app-access'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const requestUrl = request.nextUrl
  const code = requestUrl.searchParams.get('code')
  const tokenHash = requestUrl.searchParams.get('token_hash')
  const otpType = requestUrl.searchParams.get('type')
  const nextParam = requestUrl.searchParams.get('next') || '/setup'
  const origin = requestUrl.origin
  const requestedNext = new URL(nextParam, origin)
  const nextPath = requestedNext.origin === origin
    ? `${requestedNext.pathname}${requestedNext.search}${requestedNext.hash}`
    : '/setup'
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

  if ((!code && !tokenHash) || !supabaseUrl || !supabaseKey) {
    return NextResponse.redirect(new URL('/setup?error=auth', origin))
  }

  const redirectResponse = NextResponse.redirect(new URL(nextPath, origin))
  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          redirectResponse.cookies.set(name, value, options)
        })
      },
    },
  })

  try {
    const { error } = code
      ? await supabase.auth.exchangeCodeForSession(code)
      : !otpType
        ? { error: new Error('Missing email verification type') }
        : await supabase.auth.verifyOtp({
            token_hash: tokenHash!,
            type: otpType as EmailOtpType,
          })

    if (error) {
      return NextResponse.redirect(new URL('/setup?error=auth', origin))
    }
  } catch {
    return NextResponse.redirect(new URL('/setup?error=auth', origin))
  }

  // A confirmed account with an existing company context should not be sent
  // back through onboarding. If the access RPC is not installed yet, keep the
  // safe new-account destination and let setup report the backend dependency.
  try {
    const { data, error } = await supabase.rpc('app_current_access')
    const access = data as AppAccess | null

    if (!error && access?.is_platform_admin) {
      redirectResponse.headers.set('Location', new URL('/platform', origin).toString())
    } else if (!error && access?.company_id && access.employee_id) {
      redirectResponse.headers.set('Location', new URL('/dashboard', origin).toString())
    }
  } catch {
    // A newly confirmed account may not have the access foundation yet.
  }

  return redirectResponse
}
