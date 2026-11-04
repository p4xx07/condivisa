import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync, rmSync } from 'node:fs'

process.env.DB_PATH = join(tmpdir(), `condivisa-test-${randomUUID()}.sqlite`)
process.env.UPLOAD_DIR = join(tmpdir(), `condivisa-upload-${randomUUID()}`)
process.env.SETUP_KEY = 'test-setup-key'
process.env.PUBLIC_ORIGIN = 'http://localhost:3001'
const { app } = await import('./index.mjs')
const { db, one } = await import('./db.mjs')
const { createSession } = await import('./auth.mjs')

async function request(method, url, body, cookie, extraHeaders = {}) {
  const response = await app.inject({
    method, url,
    headers: { host: 'localhost:3001', origin: 'http://localhost:3001', ...(cookie ? { cookie } : {}), ...extraHeaders },
    ...(body === undefined ? {} : { payload: body }),
  })
  return { status: response.statusCode, body: response.json(), cookie: response.headers['set-cookie']?.split(';')[0] }
}

test('permissions are enforced on direct API requests and revoked immediately', async () => {
  const setup = await request('POST', '/api/setup', { setupKey: 'test-setup-key', username: 'admin', name: 'Admin', password: 'very-long-admin-password' })
  assert.equal(setup.status, 200)
  const admin = setup.cookie
  const groupResult = await request('POST', '/api/groups', { name: 'Weekend', currency: 'EUR', participants: [{ name: 'Anna' }, { name: 'Bruno' }] }, admin)
  assert.equal(groupResult.status, 200)
  const groupId = groupResult.body.id
  assert.equal((await request('GET', '/api/groups', undefined, admin)).body.groups.find((item) => item.id === groupId).canAddExpense, true)
  const group = await request('GET', `/api/groups/${groupId}`, undefined, admin)
  const [anna, bruno] = group.body.participants
  const expense = { title: 'Cena', amountMinor: 3000, date: '2026-11-03', category: 'Cibo', payerId: anna.id, splitMode: 'EQUAL', shares: [{ participantId: anna.id, value: 1 }, { participantId: bruno.id, value: 1 }] }
  const adminExpense = await request('POST', `/api/groups/${groupId}/expenses`, expense, admin)
  assert.equal(adminExpense.status, 200)

  const invite = await request('POST', `/api/groups/${groupId}/invites`, {}, admin)
  assert.equal(invite.status, 200)
  const token = invite.body.url.split('/').pop()
  const registered = await request('POST', `/api/invites/${token}/register`, { username: 'guest', name: 'Ospite', password: 'very-long-guest-password' })
  assert.equal(registered.status, 200)
  const guest = registered.cookie
  assert.equal((await request('GET', '/api/groups', undefined, guest)).body.groups.find((item) => item.id === groupId).canAddExpense, true)
  assert.equal((await request('POST', '/api/groups', { name: 'Privato', currency: 'EUR', participants: [{ name: 'Io' }] }, guest)).status, 403)
  const privateGroup = await request('POST', '/api/groups', { name: 'Solo admin', participants: [{ name: 'Admin' }] }, admin)
  assert.equal(privateGroup.status, 200)
  assert.equal((await request('GET', `/api/groups/${privateGroup.body.id}`, undefined, guest)).status, 403)
  assert.equal((await request('GET', '/api/deleted-groups', undefined, guest)).status, 403)
  assert.equal((await request('PATCH', `/api/groups/${groupId}/participants/${bruno.id}`, { userId: registered.body.user.id }, admin)).status, 200)
  assert.equal((await request('GET', `/api/groups/${groupId}`, undefined, guest)).body.participants.find((row) => row.id === bruno.id).userId, registered.body.user.id)
  assert.equal((await request('GET', `/api/groups/${groupId}`, undefined, guest)).status, 200)
  assert.equal((await request('PATCH', `/api/groups/${groupId}/expenses/${adminExpense.body.id}`, expense, guest)).status, 403)
  assert.equal((await request('GET', `/api/groups/${groupId}/export/json`, undefined, guest)).status, 403)
  const ownExpense = await request('POST', `/api/groups/${groupId}/expenses`, { ...expense, title: 'Taxi' }, guest)
  assert.equal(ownExpense.status, 200)
  assert.equal((await request('PATCH', `/api/groups/${groupId}/expenses/${ownExpense.body.id}`, { ...expense, title: 'Taxi sera' }, guest)).status, 200)
  const upload = await request('POST', `/api/groups/${groupId}/expenses/${ownExpense.body.id}/documents`, Buffer.from('fake-image-for-parser-test'), guest, { 'content-type': 'image/png', 'x-file-name': 'scontrino.png' })
  assert.equal(upload.status, 200)
  const download = await app.inject({ method: 'GET', url: `/api/groups/${groupId}/expenses/${ownExpense.body.id}/documents/${upload.body.id}`, headers: { cookie: guest } })
  assert.equal(download.statusCode, 200)
  assert.equal(download.body, 'fake-image-for-parser-test')
  const storedName = one('SELECT stored_name FROM documents WHERE id=?', upload.body.id).stored_name
  assert.equal(existsSync(join(process.env.UPLOAD_DIR, storedName)), true)
  assert.equal((await request('POST', `/api/groups/${groupId}/expenses/${adminExpense.body.id}/documents`, Buffer.from('no'), guest, { 'content-type': 'image/png' })).status, 403)
  const balances = await request('GET', `/api/groups/${groupId}/balances`, undefined, guest)
  assert.equal(balances.status, 200)
  assert.equal(balances.body.balances.reduce((sum, row) => sum + row.balanceMinor, 0), 0)
  assert.equal((await request('POST', `/api/invites/${token}/register`, { username: 'another', name: 'Another', password: 'very-long-guest-password' })).status, 404)

  const viewer = { canView: true, canAddExpense: false, canEditOwn: false, canEditAll: false, canManageGroup: false, canManageMembers: false, canExport: false, canDeleteGroup: false }
  assert.equal((await request('PUT', `/api/groups/${groupId}/members/${registered.body.user.id}`, viewer, admin)).status, 200)
  assert.equal((await request('GET', '/api/groups', undefined, guest)).body.groups.find((item) => item.id === groupId).canAddExpense, false)
  assert.equal((await request('POST', `/api/groups/${groupId}/expenses`, expense, guest)).status, 403)
  assert.equal((await request('GET', `/api/groups/${groupId}/expenses`, undefined, guest)).status, 200)
  assert.equal((await request('POST', `/api/groups/${privateGroup.body.id}/delete`, {}, admin)).status, 200)
  assert.equal((await request('GET', `/api/groups/${privateGroup.body.id}`, undefined, admin)).status, 403)
  assert.equal((await request('GET', '/api/deleted-groups', undefined, admin)).body.groups.length, 1)
  assert.equal((await request('POST', `/api/groups/${privateGroup.body.id}/restore`, {}, admin)).status, 200)
  assert.equal((await request('GET', `/api/groups/${privateGroup.body.id}`, undefined, admin)).status, 200)
  assert.equal((await request('POST', `/api/groups/${groupId}/expenses`, { ...expense, date: '2026-02-30' }, admin)).status, 400)
  assert.equal((await request('PATCH', `/api/groups/${groupId}`, { currency: 'USD' }, admin)).status, 409)

  const revoked = await request('DELETE', `/api/groups/${groupId}/members/${registered.body.user.id}`, undefined, admin)
  assert.equal(revoked.status, 200)
  assert.equal((await request('GET', `/api/groups/${groupId}`, undefined, guest)).status, 403)
  assert.equal((await request('GET', `/api/groups/${groupId}/expenses`, undefined, guest)).status, 403)
  assert.equal((await app.inject({ method: 'GET', url: `/api/groups/${groupId}/expenses/${ownExpense.body.id}/documents/${upload.body.id}`, headers: { cookie: guest } })).statusCode, 403)
  assert.equal((await request('GET', '/api/groups', undefined, guest)).body.groups.length, 0)
  assert.equal((await request('GET', `/api/groups/${groupId}/expenses/${ownExpense.body.id}/documents/${upload.body.id}`, undefined, guest)).status, 403)
  assert.equal((await request('DELETE', `/api/groups/${groupId}/expenses/${ownExpense.body.id}/documents/${upload.body.id}`, undefined, admin)).status, 200)
  assert.equal(existsSync(join(process.env.UPLOAD_DIR, storedName)), false)
  assert.equal((await request('PATCH', '/api/me/password', { currentPassword: 'wrong', newPassword: 'another-long-password' }, guest)).status, 401)
  const stalePasswordHash = one('SELECT password_hash FROM users WHERE id=?', registered.body.user.id).password_hash
  const [racingLogin, changed] = await Promise.all([
    request('POST', '/api/login', { username: 'guest', password: 'very-long-guest-password' }),
    request('PATCH', '/api/me/password', { currentPassword: 'very-long-guest-password', newPassword: 'another-long-password' }, guest),
  ])
  assert.equal(changed.status, 200)
  assert.throws(() => createSession(registered.body.user.id, { header() {} }, { protocol: 'http', headers: { host: 'localhost:3001' } }, stalePasswordHash), { status: 401 })
  assert.ok([200, 401].includes(racingLogin.status))
  if (racingLogin.status === 200) assert.equal((await request('GET', '/api/me', undefined, racingLogin.cookie)).status, 401)
  assert.equal((await request('GET', '/api/me', undefined, guest)).status, 401)
  assert.equal((await request('GET', '/api/me', undefined, changed.cookie)).status, 200)
  assert.equal((await request('POST', '/api/login', { username: 'guest', password: 'very-long-guest-password' })).status, 401)
  assert.equal((await request('POST', '/api/login', { username: 'guest', password: 'another-long-password' })).status, 200)
  const [racingResetLogin, reset] = await Promise.all([
    request('POST', '/api/login', { username: 'guest', password: 'another-long-password' }),
    request('PATCH', `/api/users/${registered.body.user.id}`, { password: 'third-long-password' }, admin),
  ])
  assert.equal(reset.status, 200)
  assert.ok([200, 401].includes(racingResetLogin.status))
  if (racingResetLogin.status === 200) assert.equal((await request('GET', '/api/me', undefined, racingResetLogin.cookie)).status, 401)
  assert.equal((await request('GET', '/api/me', undefined, changed.cookie)).status, 401)
})

test.after(async () => {
  await app.close()
  db.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${process.env.DB_PATH}${suffix}`, { force: true })
  rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true })
})
