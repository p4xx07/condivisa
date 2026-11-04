import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { all, newId, one, run, transaction } from './db.mjs'

const derive = promisify(scrypt)
const cookieName = 'condivisa_session'
const days = 30

export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export async function hashPassword(password) {
  const salt = randomBytes(16)
  const hash = await derive(password, salt, 64)
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`
}

export async function verifyPassword(password, stored) {
  const [type, saltHex, hashHex] = stored?.split(':') ?? []
  if (type !== 'scrypt' || !saltHex || !hashHex) return false
  const expected = Buffer.from(hashHex, 'hex')
  if (expected.length !== 64) return false
  const actual = await derive(password, Buffer.from(saltHex, 'hex'), 64)
  return timingSafeEqual(expected, actual)
}

const digest = (value) => createHash('sha256').update(value).digest('hex')
const sessionToken = (request) => {
  const cookies = request.headers.cookie?.split(';') ?? []
  const match = cookies.find((part) => part.trim().startsWith(`${cookieName}=`))
  return match?.trim().slice(cookieName.length + 1) ?? null
}

export function currentUser(request) {
  const token = sessionToken(request)
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null
  return one(
    `SELECT u.id, u.username, u.name, u.is_admin AS isAdmin,
            u.can_create_groups AS canCreateGroups
     FROM sessions s JOIN users u ON u.id=s.user_id
     WHERE s.token_hash=? AND s.expires_at>? AND s.auth_version=u.auth_version AND u.disabled=0`,
    digest(token), new Date().toISOString(),
  ) ?? null
}

export function requireUser(request) {
  const user = currentUser(request)
  if (!user) throw new HttpError(401, 'Accedi per continuare.')
  return user
}

export function requireAdmin(request) {
  const user = requireUser(request)
  if (!user.isAdmin) throw new HttpError(403, 'Permesso amministratore richiesto.')
  return user
}

export function requireSameOrigin(request) {
  const origin = request.headers.origin
  const expected = process.env.PUBLIC_ORIGIN || `${request.protocol}://${request.headers.host}`
  if (origin !== expected) throw new HttpError(403, 'Origine non valida.')
}

export function setSessionCookie(reply, request, token, expiry) {
  const secure = (process.env.PUBLIC_ORIGIN || `${request.protocol}://${request.headers.host}`).startsWith('https:')
  const maxAge = token ? days * 24 * 60 * 60 : 0
  reply.header('Set-Cookie', `${cookieName}=${token ?? ''}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}${expiry ? `; Expires=${expiry.toUTCString()}` : ''}`)
}

export function createSession(userId, reply, request, expectedPasswordHash = null) {
  const token = randomBytes(32).toString('hex')
  const expiry = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
  const result = run(`INSERT INTO sessions(token_hash,user_id,expires_at,auth_version)
    SELECT ?,id,?,auth_version FROM users
    WHERE id=? AND disabled=0 AND (? IS NULL OR password_hash=?)`,
    digest(token), expiry.toISOString(), userId, expectedPasswordHash, expectedPasswordHash)
  if (!result.changes) throw new HttpError(401, 'Credenziali non valide.')
  setSessionCookie(reply, request, token, expiry)
}

export function logout(request, reply) {
  const token = sessionToken(request)
  if (token) run('DELETE FROM sessions WHERE token_hash=?', digest(token))
  setSessionCookie(reply, request, null)
}

export async function setupAdmin(key, username, name, password) {
  if (!process.env.SETUP_KEY || key !== process.env.SETUP_KEY) throw new HttpError(403, 'Chiave di configurazione errata.')
  if (password.length < 12) throw new HttpError(400, 'La password deve avere almeno 12 caratteri.')
  const id = newId()
  const passwordHash = await hashPassword(password)
  return transaction(() => {
    if (one('SELECT id FROM users WHERE is_admin=1')) throw new HttpError(409, 'Amministratore già configurato.')
    run('INSERT INTO users(id,username,name,password_hash,is_admin,can_create_groups) VALUES(?,?,?,?,1,1)', id, username.toLowerCase(), name, passwordHash)
    return id
  })
}

export async function login(username, password, reply, request) {
  const user = one('SELECT * FROM users WHERE username=? COLLATE NOCASE', username)
  if (!user) {
    await hashPassword(password)
    throw new HttpError(401, 'Credenziali non valide.')
  }
  if (user.disabled || (user.locked_until && user.locked_until > new Date().toISOString()))
    throw new HttpError(401, 'Credenziali non valide.')
  if (!(await verifyPassword(password, user.password_hash))) {
    const count = user.failed_logins + 1
    const until = count >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null
    run('UPDATE users SET failed_logins=?,locked_until=? WHERE id=? AND password_hash=?', count, until, user.id, user.password_hash)
    throw new HttpError(401, 'Credenziali non valide.')
  }
  run('UPDATE users SET failed_logins=0,locked_until=NULL WHERE id=? AND password_hash=?', user.id, user.password_hash)
  createSession(user.id, reply, request, user.password_hash)
  return currentUser(request) || { id: user.id, username: user.username, name: user.name, isAdmin: user.is_admin, canCreateGroups: user.can_create_groups }
}

export const capabilities = [
  'canView', 'canAddExpense', 'canEditOwn', 'canEditAll',
  'canManageGroup', 'canManageMembers', 'canExport', 'canDeleteGroup',
]
const columns = {
  canView: 'can_view', canAddExpense: 'can_add_expense', canEditOwn: 'can_edit_own',
  canEditAll: 'can_edit_all', canManageGroup: 'can_manage_group',
  canManageMembers: 'can_manage_members', canExport: 'can_export',
  canDeleteGroup: 'can_delete_group',
}
export const presets = {
  viewer: { canView: true },
  contributor: { canView: true, canAddExpense: true, canEditOwn: true },
  manager: Object.fromEntries(capabilities.map((key) => [key, true])),
}

export function normalizePermissions(value) {
  return Object.fromEntries(capabilities.map((key) => [key, Boolean(value?.[key])]))
}

export function permissionFor(user, groupId) {
  const group = one('SELECT owner_id,deleted_at FROM groups WHERE id=?', groupId)
  if (!group || group.deleted_at) return null
  if (user.isAdmin || group.owner_id === user.id) return normalizePermissions(presets.manager)
  const row = one('SELECT * FROM memberships WHERE group_id=? AND user_id=?', groupId, user.id)
  if (!row) return null
  return Object.fromEntries(capabilities.map((key) => [key, Boolean(row[columns[key]])]))
}

export function requireGroup(user, groupId, capability = 'canView') {
  const permissions = permissionFor(user, groupId)
  if (!permissions?.canView || !permissions?.[capability]) throw new HttpError(403, 'Non hai accesso a questa azione.')
  return permissions
}

export function requireExpenseEdit(user, groupId, expenseId) {
  const permissions = requireGroup(user, groupId)
  const expense = one('SELECT created_by FROM expenses WHERE id=? AND group_id=?', expenseId, groupId)
  if (!expense) throw new HttpError(404, 'Spesa non trovata.')
  if (!permissions.canEditAll && !(permissions.canEditOwn && expense.created_by === user.id))
    throw new HttpError(403, 'Non puoi modificare questa spesa.')
}

export function setMembership(groupId, userId, permissions) {
  const p = normalizePermissions(permissions)
  run(`INSERT INTO memberships(group_id,user_id,can_view,can_add_expense,can_edit_own,can_edit_all,can_manage_group,can_manage_members,can_export,can_delete_group)
    VALUES(?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(group_id,user_id) DO UPDATE SET
    can_view=excluded.can_view,can_add_expense=excluded.can_add_expense,
    can_edit_own=excluded.can_edit_own,can_edit_all=excluded.can_edit_all,
    can_manage_group=excluded.can_manage_group,can_manage_members=excluded.can_manage_members,
    can_export=excluded.can_export,can_delete_group=excluded.can_delete_group`,
    groupId, userId, ...capabilities.map((key) => Number(p[key])))
  return p
}

export function visibleGroups(user) {
  return all(`SELECT DISTINCT g.id,g.name,g.currency,g.information,g.owner_id AS ownerId,g.created_at AS createdAt,
    (SELECT COUNT(*) FROM participants p WHERE p.group_id=g.id) AS participantCount,
    (SELECT COUNT(*) FROM expenses e WHERE e.group_id=g.id) AS expenseCount
    FROM groups g LEFT JOIN memberships m ON m.group_id=g.id AND m.user_id=?
    WHERE g.deleted_at IS NULL AND (g.owner_id=? OR ?=1 OR (m.user_id IS NOT NULL AND m.can_view=1))
    ORDER BY g.created_at DESC`, user.id, user.id, user.isAdmin)
}
