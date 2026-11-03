export function normalizeSignupOtp(value: string): string {
  return value.replace(/\D/g, '').slice(0, 6)
}

export function isSignupOtpValid(value: string): boolean {
  return /^\d{6}$/.test(value)
}
