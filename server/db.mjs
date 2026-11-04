import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

export const dbPath = resolve(process.env.DB_PATH || './data/condivisa.sqlite')
mkdirSync(dirname(dbPath), { recursive: true })
export const db = new DatabaseSync(dbPath, { timeout: 5000 })
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;')

const migrations = [
  `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  can_create_groups INTEGER NOT NULL DEFAULT 0,
  disabled INTEGER NOT NULL DEFAULT 0,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  information TEXT NOT NULL DEFAULT '',
  owner_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS memberships (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  can_view INTEGER NOT NULL DEFAULT 1,
  can_add_expense INTEGER NOT NULL DEFAULT 0,
  can_edit_own INTEGER NOT NULL DEFAULT 0,
  can_edit_all INTEGER NOT NULL DEFAULT 0,
  can_manage_group INTEGER NOT NULL DEFAULT 0,
  can_manage_members INTEGER NOT NULL DEFAULT 0,
  can_export INTEGER NOT NULL DEFAULT 0,
  can_delete_group INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS memberships_user_idx ON memberships(user_id);
CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(group_id, name),
  UNIQUE(group_id, user_id)
);
CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  original_amount_minor INTEGER,
  original_currency TEXT,
  exchange_rate REAL,
  date TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Other',
  payer_id TEXT NOT NULL REFERENCES participants(id),
  split_mode TEXT NOT NULL DEFAULT 'EQUAL',
  notes TEXT NOT NULL DEFAULT '',
  is_reimbursement INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  recurrence_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS expenses_group_date_idx ON expenses(group_id, date DESC);
CREATE TABLE IF NOT EXISTS expense_shares (
  expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES participants(id),
  amount_minor INTEGER NOT NULL,
  weight REAL NOT NULL DEFAULT 1,
  PRIMARY KEY (expense_id, participant_id)
);
CREATE TABLE IF NOT EXISTS recurring_rules (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  template_json TEXT NOT NULL,
  interval TEXT NOT NULL,
  next_date TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  stored_name TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS invites (
  token_hash TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  permissions_json TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  used_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`,
  `ALTER TABLE users ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0;`,
]
const currentVersion = db.prepare('PRAGMA user_version').get().user_version
if (currentVersion > migrations.length)
  throw new Error(`Database versione ${currentVersion} più recente del server (${migrations.length}). Aggiorna l’immagine prima di avviare.`)
for (let index = currentVersion; index < migrations.length; index++) {
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(migrations[index])
    db.exec(`PRAGMA user_version=${index + 1}`)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}


export const newId = () => randomUUID()
export const one = (sql, ...args) => db.prepare(sql).get(...args)
export const all = (sql, ...args) => db.prepare(sql).all(...args)
export const run = (sql, ...args) => db.prepare(sql).run(...args)
export function transaction(fn) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const value = fn()
    db.exec('COMMIT')
    return value
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
