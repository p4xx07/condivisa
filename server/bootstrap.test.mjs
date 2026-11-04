import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'

process.env.DB_PATH = join(tmpdir(), `condivisa-bootstrap-${randomUUID()}.sqlite`)
process.env.UPLOAD_DIR = join(tmpdir(), `condivisa-upload-${randomUUID()}`)
process.env.SETUP_KEY = 'test-setup-key'
process.env.PUBLIC_ORIGIN = 'http://localhost:3001'
const { app } = await import('./index.mjs')
const { db, one } = await import('./db.mjs')

test('only one concurrent first administrator is created', async () => {
  const setup = (username) => app.inject({ method: 'POST', url: '/api/setup',
    headers: { host: 'localhost:3001', origin: 'http://localhost:3001' },
    payload: { setupKey: 'test-setup-key', username, name: username, password: 'long-and-secret-password' },
  })
  const responses = await Promise.all([setup('first'), setup('second')])
  assert.deepEqual(responses.map((response) => response.statusCode).sort(), [200, 409])
  assert.equal(one('SELECT COUNT(*) AS count FROM users WHERE is_admin=1').count, 1)
})

test.after(async () => {
  await app.close(); db.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${process.env.DB_PATH}${suffix}`, { force: true })
  rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true })
})
