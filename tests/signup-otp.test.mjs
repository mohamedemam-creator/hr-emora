import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applySignupOtpInput,
  getSignupOtpBackspaceTarget,
} from '../lib/signup-otp.ts'

const emptyOtp = () => Array.from({ length: 8 }, () => '')

test('pasted 8-digit codes fill all OTP boxes and leave focus on the final box', () => {
  const result = applySignupOtpInput(emptyOtp(), '12-34 5678', 0)

  assert.deepEqual(result.digits, ['1', '2', '3', '4', '5', '6', '7', '8'])
  assert.equal(result.focusIndex, 7)
})

test('typing one digit advances focus to the next OTP box', () => {
  const result = applySignupOtpInput(emptyOtp(), '5', 2)

  assert.deepEqual(result.digits, ['', '', '5', '', '', '', '', ''])
  assert.equal(result.focusIndex, 3)
})

test('clearing a digit keeps focus in its current box', () => {
  const current = ['1', '2', '3', '4', '', '', '', '']
  const result = applySignupOtpInput(current, '', 3)

  assert.deepEqual(result.digits, ['1', '2', '3', '', '', '', '', ''])
  assert.equal(result.focusIndex, 3)
})

test('backspace clears the current box or moves to the previous empty box', () => {
  assert.equal(getSignupOtpBackspaceTarget(3, true), 3)
  assert.equal(getSignupOtpBackspaceTarget(3, false), 2)
  assert.equal(getSignupOtpBackspaceTarget(0, false), 0)
})
