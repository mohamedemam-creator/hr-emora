import assert from 'node:assert/strict'
import test from 'node:test'
import { getBootstrapPhone } from '../supabase/functions/bootstrap-company/phone.ts'

test('reads and trims the setup form phone field', () => {
  assert.equal(getBootstrapPhone({ phone: '  01001234567  ' }), '01001234567')
})

test('accepts the phone_number alias used by older clients', () => {
  assert.equal(getBootstrapPhone({ phone_number: '01001234567' }), '01001234567')
})

test('falls back to phone_number when phone is blank', () => {
  assert.equal(
    getBootstrapPhone({ phone: '   ', phone_number: '01001234567' }),
    '01001234567',
  )
})

test('maps missing or blank phone values to null for the SQL RPC', () => {
  assert.equal(getBootstrapPhone({ phone: '' }), null)
  assert.equal(getBootstrapPhone({}), null)
})
