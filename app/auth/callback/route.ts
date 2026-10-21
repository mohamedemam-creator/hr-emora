import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const requestUrl = request.nextUrl
  const code = requestUrl.searchParams.get('code')
  const nextParam = requestUrl.searchParams.get('next') || '/setup'
  const nextPath = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/setup'
  const origin = requestUrl.origin
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

  if (!code || !supabaseUrl || !supabaseKey) {
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

  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    return NextResponse.redirect(new URL('/setup?error=auth', origin))
  }

  return redirectResponse
}
