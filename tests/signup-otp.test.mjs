import assert from 'node:assert/strict'
import test from 'node:test'
import { isSignupOtpValid, normalizeSignupOtp } from '../lib/signup-otp.ts'

test('normalizes pasted OTP digits and limits input to six characters', () => {
  assert.equal(normalizeSignupOtp(' 12-34 567 '), '123456')
})

test('accepts only six-digit signup codes', () => {
  assert.equal(isSignupOtpValid('123456'), true)
  assert.equal(isSignupOtpValid('12345'), false)
  assert.equal(isSignupOtpValid('12a456'), false)
  assert.equal(isSignupOtpValid('1234567'), false)
})
