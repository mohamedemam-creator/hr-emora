export function normalizeSignupOtp(value: string): string {
  return value.replace(/\D/g, '').slice(0, 8)
}

export function isSignupOtpValid(value: string): boolean {
  return /^\d{8}$/.test(value)
}

export function applySignupOtpInput(
  currentDigits: string[],
  rawValue: string,
  position: number,
): { digits: string[]; focusIndex: number } {
  const digits = Array.from({ length: 8 }, (_, index) => currentDigits[index] ?? '')
  const incoming = normalizeSignupOtp(rawValue)
  const values = incoming.length > 1 ? incoming.split('') : incoming ? [incoming] : []

  if (values.length === 0) digits[position] = ''

  values.forEach((digit, offset) => {
    const targetIndex = position + offset
    if (targetIndex < digits.length) digits[targetIndex] = digit
  })

  const lastChangedIndex = Math.min(position + Math.max(values.length - 1, 0), 7)
  return {
    digits,
    focusIndex: values.length === 0
      ? position
      : values.length > 1
        ? lastChangedIndex
        : Math.min(position + 1, 7),
  }
}

export function getSignupOtpBackspaceTarget(position: number, hasValue: boolean): number {
  if (hasValue || position === 0) return position
  return position - 1
}
