import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildEmailConfirmationRedirect,
  waitForAuthSession,
} from '../lib/auth-confirmation.ts'

test('builds a confirmation callback for the current origin and setup destination', () => {
  assert.equal(
    buildEmailConfirmationRedirect(undefined, 'http://localhost:3000'),
    'http://localhost:3000/auth/callback?next=%2Fsetup',
  )
})

test('waits for a session that becomes available shortly after callback navigation', async () => {
  let calls = 0
  const session = { user: { id: 'user-1' } }

  const result = await waitForAuthSession(async () => {
    calls += 1
    return calls < 3 ? null : session
  }, { attempts: 4, intervalMs: 0 })

  assert.equal(result, session)
  assert.equal(calls, 3)
})

test('returns no session after the bounded callback wait expires', async () => {
  let calls = 0

  const result = await waitForAuthSession(async () => {
    calls += 1
    return null
  }, { attempts: 3, intervalMs: 0 })

  assert.equal(result, null)
  assert.equal(calls, 3)
})
