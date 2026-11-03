export function getBootstrapPhone(body: Record<string, unknown>): string | null {
  for (const value of [body.phone, body.phone_number]) {
    if (typeof value !== 'string') continue

    const phone = value.trim()
    if (phone) return phone
  }

  return null
}
