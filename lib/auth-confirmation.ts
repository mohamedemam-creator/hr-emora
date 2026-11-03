export function buildEmailConfirmationRedirect(
  appUrl: string | undefined,
  currentOrigin: string,
): string {
  const redirectUrl = new URL('/auth/callback', appUrl || currentOrigin)
  redirectUrl.searchParams.set('next', '/setup')
  return redirectUrl.toString()
}

export async function waitForAuthSession<TSession>(
  readSession: () => Promise<TSession | null>,
  options: { attempts?: number; intervalMs?: number } = {},
): Promise<TSession | null> {
  const attempts = Math.max(1, Math.floor(options.attempts ?? 8))
  const intervalMs = Math.max(0, options.intervalMs ?? 200)

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const session = await readSession()
    if (session) return session

    if (attempt < attempts - 1 && intervalMs > 0) {
      await new Promise(resolve => setTimeout(resolve, intervalMs))
    }
  }

  return null
}
