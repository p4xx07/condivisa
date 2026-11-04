import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

function databasePath() { return join(tmpdir(), `condivisa-migration-${randomUUID()}.sqlite`) }
function closeAndRemove(db, path) {
  db?.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true })
}
function startWith(path) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', 'import("./db.mjs")'], {
    cwd: fileURLToPath(new URL('.', import.meta.url)),
    env: { ...process.env, DB_PATH: path }, encoding: 'utf8',
  })
}

test('a populated v1 database migrates to v3 without losing sessions', () => {
  const path = databasePath()
  let db = new DatabaseSync(path)
  try {
    db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,password_hash TEXT NOT NULL);
      CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires_at TEXT NOT NULL);
      CREATE TABLE groups(id TEXT PRIMARY KEY,name TEXT NOT NULL);
      INSERT INTO users(id,password_hash) VALUES('old-user','old-hash');
      INSERT INTO sessions(token_hash,user_id,expires_at) VALUES('old-token','old-user','2099-01-01');
      INSERT INTO groups(id,name) VALUES('old-group','Old group');
      PRAGMA user_version=1;`)
    db.close(); db = null
    const result = startWith(path)
    assert.equal(result.status, 0, result.stderr)
    db = new DatabaseSync(path)
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 3)
    assert.equal(db.prepare("SELECT simplify_settlements FROM groups WHERE id='old-group'").get().simplify_settlements, 1)
    const user = db.prepare('SELECT id,password_hash,auth_version FROM users').get()
    assert.equal(user.id, 'old-user')
    assert.equal(user.password_hash, 'old-hash')
    assert.equal(user.auth_version, 0)
    const session = db.prepare('SELECT token_hash,user_id,auth_version FROM sessions').get()
    assert.equal(session.token_hash, 'old-token')
    assert.equal(session.user_id, 'old-user')
    assert.equal(session.auth_version, 0)
  } finally { closeAndRemove(db, path) }
})

test('failed migration rolls back and newer databases are rejected', () => {
  const path = databasePath()
  let db = new DatabaseSync(path)
  try {
    db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,auth_version INTEGER);
      CREATE TABLE sessions(token_hash TEXT PRIMARY KEY);
      PRAGMA user_version=1;`)
    db.close(); db = null
    const failed = startWith(path)
    assert.notEqual(failed.status, 0)
    db = new DatabaseSync(path)
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1)
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM pragma_table_info('sessions') WHERE name='auth_version'").get().count, 0)
    db.exec('PRAGMA user_version=99;')
    db.close(); db = null
    const future = startWith(path)
    assert.notEqual(future.status, 0)
    assert.match(future.stderr, /più recente del server/)
  } finally { closeAndRemove(db, path) }
})
