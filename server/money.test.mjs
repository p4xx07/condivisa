import assert from 'node:assert/strict'
import { test } from 'node:test'
import { allocate, calculateBalances, nextRecurringDate } from './money.mjs'

const shares = (values) => values.map((value, index) => ({ participantId: `p${index + 1}`, value }))

test('all four split methods conserve the amount in minor units', () => {
  const cases = [
    ['EQUAL', 100, shares([1, 1, 1]), [34, 33, 33]],
    ['SHARES', 120, shares([1, 2, 3]), [20, 40, 60]],
    ['PERCENT', 999, shares([40, 60]), [400, 599]],
    ['EXACT', 501, shares([100, 401]), [100, 401]],
  ]
  for (const [mode, amount, input, expected] of cases) {
    const result = allocate(amount, mode, input)
    assert.deepEqual(result.map((row) => row.amountMinor), expected)
    assert.equal(result.reduce((sum, row) => sum + row.amountMinor, 0), amount)
  }
  assert.throws(() => allocate(501, 'EXACT', shares([100, 400])), { status: 400 })
  assert.throws(() => allocate(999, 'PERCENT', shares([40, 59])), { status: 400 })
})

test('balances settle every participant and monthly recurrence preserves the anchor day', () => {
  const participants = [{ id: 'a', name: 'Anna' }, { id: 'b', name: 'Bruno' }, { id: 'c', name: 'Carla' }]
  const expenses = [{ payer_id: 'a', amount_minor: 3000, shares: [
    { participant_id: 'a', amount_minor: 1000 },
    { participant_id: 'b', amount_minor: 1000 },
    { participant_id: 'c', amount_minor: 1000 },
  ] }]
  const result = calculateBalances(participants, expenses)
  assert.equal(result.balances.reduce((sum, row) => sum + row.balanceMinor, 0), 0)
  assert.equal(result.settlements.reduce((sum, row) => sum + row.amountMinor, 0), 2000)
  assert.equal(nextRecurringDate('2026-01-31', 'MONTHLY', 31), '2026-02-28')
  assert.equal(nextRecurringDate('2026-02-28', 'MONTHLY', 31), '2026-03-31')
})

test('simplification replaces a chain of two direct reimbursements with one without changing balances', () => {
  const participants = ['a', 'b', 'c'].map((id) => ({ id, name: id }))
  const expenses = [
    { payer_id: 'b', amount_minor: 1000, shares: [{ participant_id: 'a', amount_minor: 1000 }] },
    { payer_id: 'c', amount_minor: 1000, shares: [{ participant_id: 'b', amount_minor: 1000 }] },
  ]
  const direct = calculateBalances(participants, expenses, false)
  const simple = calculateBalances(participants, expenses, true)
  assert.deepEqual(direct.settlements, [
    { from: 'a', to: 'b', amountMinor: 1000 },
    { from: 'b', to: 'c', amountMinor: 1000 },
  ])
  assert.deepEqual(simple.settlements, [{ from: 'a', to: 'c', amountMinor: 1000 }])
  assert.deepEqual(simple.balances, direct.balances)
})
