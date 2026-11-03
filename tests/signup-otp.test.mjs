import assert from 'node:assert/strict'
import test from 'node:test'
import { isSignupOtpValid, normalizeSignupOtp } from '../lib/signup-otp.ts'

test('normalizes pasted OTP digits and limits input to eight characters', () => {
  assert.equal(normalizeSignupOtp(' 12-34 5678 '), '12345678')
})

test('accepts only eight-digit signup codes', () => {
  assert.equal(isSignupOtpValid('12345678'), true)
  assert.equal(isSignupOtpValid('1234567'), false)
  assert.equal(isSignupOtpValid('12a45678'), false)
  assert.equal(isSignupOtpValid('123456789'), false)
})
