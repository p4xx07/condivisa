import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { createHash, randomBytes } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { all, newId, one, run, transaction } from './db.mjs'
import {
  HttpError, createSession, hashPassword, login, logout,
  normalizePermissions, presets, requireAdmin, requireExpenseEdit, verifyPassword,
  requireGroup, requireSameOrigin, requireUser, setMembership, setupAdmin, visibleGroups,
} from './auth.mjs'
import { allocate, calculateBalances, currencyDigits, nextRecurringDate } from './money.mjs'

const app = Fastify({ logger: process.env.NODE_ENV !== 'test', bodyLimit: 6 * 1024 * 1024, trustProxy: true })
const uploadDir = resolve(process.env.UPLOAD_DIR || './data/uploads')
mkdirSync(uploadDir, { recursive: true })
if (process.env.NODE_ENV === 'production') {
  let publicUrl
  try { publicUrl = new URL(process.env.PUBLIC_ORIGIN) } catch { throw new Error('PUBLIC_ORIGIN HTTPS obbligatoria in produzione.') }
  if (publicUrl.protocol !== 'https:' || process.env.PUBLIC_ORIGIN !== publicUrl.origin)
    throw new Error('PUBLIC_ORIGIN deve essere un’origine HTTPS senza percorso o slash finale.')
  if (!one('SELECT id FROM users WHERE is_admin=1') && (!process.env.SETUP_KEY || process.env.SETUP_KEY.length < 24))
    throw new Error('SETUP_KEY di almeno 24 caratteri obbligatoria per la prima configurazione.')
}
const now = () => new Date().toISOString()
const text = (value, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const required = (value, label, max = 200) => {
  if (typeof value !== 'string' || value.trim().length > max) throw new HttpError(400, `${label} non valido.`)
  const result = value.trim()
  if (!result) throw new HttpError(400, `${label} obbligatorio.`)
  return result
}
const groupId = (request) => request.params.id
const activity = (group, user, action, detail = '') =>
  run('INSERT INTO activity(id,group_id,actor_id,action,detail) VALUES(?,?,?,?,?)', newId(), group, user?.id ?? null, action, detail)
const userSummary = (user) => ({
  id: user.id, username: user.username, name: user.name,
  isAdmin: Boolean(user.isAdmin), canCreateGroups: Boolean(user.canCreateGroups),
})
const hash = (token) => createHash('sha256').update(token).digest('hex')
const authAttempts = new Map()
function limitAuth(key) {
  const current = authAttempts.get(key) || { count: 0, until: Date.now() + 15 * 60_000 }
  if (current.until < Date.now()) { current.count = 0; current.until = Date.now() + 15 * 60_000 }
  current.count++
  authAttempts.set(key, current)
  if (authAttempts.size > 10_000) authAttempts.delete(authAttempts.keys().next().value)
  if (current.count > 20) throw new HttpError(429, 'Troppi tentativi. Riprova tra 15 minuti.')
}
const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
function participantUserId(group, value, exceptParticipant = '') {
  if (value == null || value === '') return null
  if (typeof value !== 'string') throw new HttpError(400, 'Account non valido.')
  const linked = one(`SELECT 1 FROM users u WHERE u.id=? AND u.disabled=0 AND
    (EXISTS(SELECT 1 FROM memberships m WHERE m.group_id=? AND m.user_id=u.id AND m.can_view=1)
    OR EXISTS(SELECT 1 FROM groups g WHERE g.id=? AND g.owner_id=u.id))`, value, group, group)
  if (!linked) throw new HttpError(400, 'L’account deve avere accesso al gruppo.')
  if (one('SELECT 1 FROM participants WHERE group_id=? AND user_id=? AND id<>?', group, value, exceptParticipant))
    throw new HttpError(409, 'Questo account è già collegato a un partecipante.')
  return value
}

app.setErrorHandler((error, request, reply) => {
  const status = error instanceof HttpError ? error.status : (error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500)
  if (status === 500) request.log.error(error)
  reply.code(status).send({ error: status === 500 ? 'Errore interno.' : error.message })
})
app.addHook('onRequest', async (request) => {
  if (request.url.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method))
    requireSameOrigin(request)
})

app.get('/api/health', async () => ({ ok: one('SELECT 1 AS ok').ok === 1 }))
app.get('/api/bootstrap-status', async () => ({ needsSetup: !one('SELECT id FROM users WHERE is_admin=1') }))
app.post('/api/setup', async (request, reply) => {
  limitAuth('setup')
  const body = request.body ?? {}
  const username = required(body.username, 'Nome utente', 100).toLowerCase()
  const name = required(body.name, 'Nome', 100)
  const id = await setupAdmin(body.setupKey, username, name, required(body.password, 'Password', 1024))
  createSession(id, reply, request)
  return { user: { id, username, name, isAdmin: true, canCreateGroups: true } }
})
app.post('/api/login', async (request, reply) => {
  const body = request.body ?? {}
  limitAuth(`login:${String(body.username || '').trim().toLowerCase().slice(0, 100)}`)
  const user = await login(required(body.username, 'Nome utente', 100), required(body.password, 'Password', 1024), reply, request)
  return { user: userSummary(user) }
})
app.post('/api/logout', async (request, reply) => {
  logout(request, reply)
  return { ok: true }
})
app.get('/api/me', async (request) => ({ user: userSummary(requireUser(request)) }))
app.patch('/api/me/password', async (request, reply) => {
  const user = requireUser(request)
  limitAuth(`password:${user.id}`)
  const current = required(request.body?.currentPassword, 'Password attuale', 1024)
  const next = required(request.body?.newPassword, 'Nuova password', 1024)
  if (next.length < 12) throw new HttpError(400, 'La nuova password deve avere almeno 12 caratteri.')
  const stored = one('SELECT password_hash FROM users WHERE id=?', user.id)
  if (!(await verifyPassword(current, stored.password_hash))) throw new HttpError(401, 'Password attuale errata.')
  const nextHash = await hashPassword(next)
  transaction(() => {
    const changed = run(`UPDATE users SET password_hash=?,auth_version=auth_version+1,
      failed_logins=0,locked_until=NULL WHERE id=? AND password_hash=?`, nextHash, user.id, stored.password_hash)
    if (!changed.changes) throw new HttpError(409, 'La password è stata modificata nel frattempo. Riprova.')
    run('DELETE FROM sessions WHERE user_id=?', user.id)
  })
  createSession(user.id, reply, request, nextHash)
  return { ok: true }
})

app.get('/api/users', async (request) => {
  requireAdmin(request)
  return { users: all('SELECT id,username,name,is_admin AS isAdmin,can_create_groups AS canCreateGroups,disabled,created_at AS createdAt FROM users ORDER BY name') }
})
app.post('/api/users', async (request) => {
  requireAdmin(request)
  const body = request.body ?? {}
  const username = required(body.username, 'Nome utente', 100).toLowerCase()
  const name = required(body.name, 'Nome', 100)
  const password = required(body.password, 'Password', 1024)
  if (password.length < 12) throw new HttpError(400, 'La password deve avere almeno 12 caratteri.')
  const id = newId()
  run('INSERT INTO users(id,username,name,password_hash,can_create_groups) VALUES(?,?,?,?,?)', id, username, name, await hashPassword(password), Number(Boolean(body.canCreateGroups)))
  return { user: { id, username, name, canCreateGroups: Boolean(body.canCreateGroups) } }
})
app.patch('/api/users/:userId', async (request) => {
  requireAdmin(request)
  const body = request.body ?? {}
  const target = one('SELECT * FROM users WHERE id=?', request.params.userId)
  if (!target) throw new HttpError(404, 'Utente non trovato.')
  const isAdmin = body.isAdmin === undefined ? target.is_admin : Number(Boolean(body.isAdmin))
  const disabled = body.disabled === undefined ? target.disabled : Number(Boolean(body.disabled))
  if (target.is_admin && (!isAdmin || disabled) && one('SELECT COUNT(*) AS count FROM users WHERE is_admin=1 AND disabled=0').count <= 1)
    throw new HttpError(400, 'Deve restare almeno un amministratore attivo.')
  const passwordHash = body.password ? await hashPassword(required(body.password, 'Password', 1024)) : target.password_hash
  if (body.password && body.password.length < 12) throw new HttpError(400, 'La password deve avere almeno 12 caratteri.')
  transaction(() => {
    run('UPDATE users SET name=?,is_admin=?,can_create_groups=?,disabled=?,password_hash=?,auth_version=auth_version+? WHERE id=?',
      body.name === undefined ? target.name : required(body.name, 'Nome', 100),
      isAdmin, body.canCreateGroups === undefined ? target.can_create_groups : Number(Boolean(body.canCreateGroups)),
      disabled, passwordHash, Number(Boolean(disabled || body.password)), target.id)
    if (disabled || body.password) run('DELETE FROM sessions WHERE user_id=?', target.id)
  })
  return { ok: true }
})

app.get('/api/groups', async (request) => ({ groups: visibleGroups(requireUser(request)) }))
app.get('/api/deleted-groups', async (request) => {
  requireAdmin(request)
  return { groups: all('SELECT id,name,deleted_at AS deletedAt FROM groups WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC') }
})
app.post('/api/groups', async (request) => {
  const user = requireUser(request)
  if (!user.isAdmin && !user.canCreateGroups) throw new HttpError(403, 'Non puoi creare gruppi.')
  const body = request.body ?? {}
  const name = required(body.name, 'Nome gruppo', 50)
  const currency = required(body.currency || 'EUR', 'Valuta', 3).toUpperCase()
  currencyDigits(currency)
  const participants = Array.isArray(body.participants) ? body.participants : []
  if (participants.length < 1 || participants.length > 100) throw new HttpError(400, 'Aggiungi da 1 a 100 partecipanti.')
  const names = participants.map((person) => required(person.name, 'Partecipante', 50))
  if (new Set(names.map((name) => name.toLowerCase())).size !== names.length) throw new HttpError(400, 'I nomi dei partecipanti devono essere distinti.')
  const id = newId()
  transaction(() => {
    run('INSERT INTO groups(id,name,currency,information,owner_id) VALUES(?,?,?,?,?)', id, name, currency, text(body.information, 10000), user.id)
    names.forEach((person) => run('INSERT INTO participants(id,group_id,name) VALUES(?,?,?)', newId(), id, person))
    activity(id, user, 'group.created', name)
  })
  return { id }
})

function groupView(user, id) {
  const permissions = requireGroup(user, id)
  const group = one('SELECT id,name,currency,information,owner_id AS ownerId,created_at AS createdAt FROM groups WHERE id=?', id)
  const participants = all('SELECT id,name,user_id AS userId FROM participants WHERE group_id=? ORDER BY name', id)
  return { group, participants, permissions }
}
app.get('/api/groups/:id', async (request) => groupView(requireUser(request), groupId(request)))
app.patch('/api/groups/:id', async (request) => {
  const user = requireUser(request), id = groupId(request)
  requireGroup(user, id, 'canManageGroup')
  const old = one('SELECT * FROM groups WHERE id=?', id), body = request.body ?? {}
  const currency = (body.currency === undefined ? old.currency : required(body.currency, 'Valuta', 3)).toUpperCase()
  currencyDigits(currency)
  if (currency !== old.currency && one('SELECT 1 FROM expenses WHERE group_id=? LIMIT 1', id))
    throw new HttpError(409, 'Non puoi cambiare valuta dopo aver registrato spese nel gruppo.')
  run('UPDATE groups SET name=?,currency=?,information=? WHERE id=?',
    body.name === undefined ? old.name : required(body.name, 'Nome gruppo', 50), currency,
    body.information === undefined ? old.information : text(body.information, 10000), id)
  activity(id, user, 'group.updated')
  return groupView(user, id)
})
app.post('/api/groups/:id/participants', async (request) => {
  const user = requireUser(request), id = groupId(request)
  requireGroup(user, id, 'canManageGroup')
  const participantId = newId()
  const name = required(request.body?.name, 'Nome partecipante', 50)
  if (one('SELECT 1 FROM participants WHERE group_id=? AND name=? COLLATE NOCASE', id, name))
    throw new HttpError(409, 'Questo nome è già presente nel gruppo.')
  run('INSERT INTO participants(id,group_id,name,user_id) VALUES(?,?,?,?)', participantId, id,
    name, participantUserId(id, request.body?.userId))
  activity(id, user, 'participant.added', request.body.name)
  return { id: participantId }
})
app.patch('/api/groups/:id/participants/:participantId', async (request) => {
  const user = requireUser(request), id = groupId(request)
  requireGroup(user, id, 'canManageGroup')
  const participant = one('SELECT * FROM participants WHERE id=? AND group_id=?', request.params.participantId, id)
  if (!participant) throw new HttpError(404, 'Partecipante non trovato.')
  const name = request.body?.name === undefined ? participant.name : required(request.body.name, 'Nome partecipante', 50)
  if (one('SELECT 1 FROM participants WHERE group_id=? AND id<>? AND name=? COLLATE NOCASE', id, participant.id, name))
    throw new HttpError(409, 'Questo nome è già presente nel gruppo.')
  run('UPDATE participants SET name=?,user_id=? WHERE id=?', name,
    request.body?.userId === undefined ? participant.user_id : participantUserId(id, request.body.userId, participant.id), participant.id)
  activity(id, user, 'participant.updated', participant.name)
  return { ok: true }
})
app.delete('/api/groups/:id/participants/:participantId', async (request) => {
  const user = requireUser(request), id = groupId(request)
  requireGroup(user, id, 'canManageGroup')
  const participant = one('SELECT * FROM participants WHERE id=? AND group_id=?', request.params.participantId, id)
  if (!participant) throw new HttpError(404, 'Partecipante non trovato.')
  const used = one('SELECT 1 FROM expenses WHERE payer_id=? UNION SELECT 1 FROM expense_shares WHERE participant_id=? LIMIT 1', participant.id, participant.id)
  if (used) throw new HttpError(409, 'Questo partecipante è già presente nelle spese.')
  run('DELETE FROM participants WHERE id=?', participant.id)
  activity(id, user, 'participant.removed', participant.name)
  return { ok: true }
})

app.get('/api/groups/:id/members', async (request) => {
  const user = requireUser(request), id = groupId(request)
  requireGroup(user, id, 'canManageMembers')
  return { members: all(`SELECT u.id,u.username,u.name,m.can_view AS canView,m.can_add_expense AS canAddExpense,
    m.can_edit_own AS canEditOwn,m.can_edit_all AS canEditAll,m.can_manage_group AS canManageGroup,
    m.can_manage_members AS canManageMembers,m.can_export AS canExport,m.can_delete_group AS canDeleteGroup
    FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.group_id=? ORDER BY u.name`, id),
    ownerId: one('SELECT owner_id FROM groups WHERE id=?', id).owner_id }
})
app.get('/api/groups/:id/eligible-users', async (request) => {
  const user = requireUser(request), id = groupId(request)
  requireGroup(user, id, 'canManageGroup')
  return { users: all(`SELECT u.id,u.name,u.username FROM users u JOIN groups g ON g.id=?
    WHERE u.disabled=0 AND (u.id=g.owner_id OR EXISTS (
      SELECT 1 FROM memberships m WHERE m.group_id=g.id AND m.user_id=u.id AND m.can_view=1)) ORDER BY u.name`, id) }
})
app.put('/api/groups/:id/members/:userId', async (request) => {
  const user = requireUser(request), id = groupId(request)
  const own = requireGroup(user, id, 'canManageMembers')
  const target = one('SELECT id FROM users WHERE id=? AND disabled=0', request.params.userId)
  if (!target) throw new HttpError(404, 'Utente non trovato.')
  const requested = normalizePermissions(request.body)
  if (!user.isAdmin && Object.entries(requested).some(([key, value]) => value && !own[key]))
    throw new HttpError(403, 'Non puoi concedere permessi che non possiedi.')
  if (one('SELECT owner_id FROM groups WHERE id=?', id).owner_id === target.id)
    throw new HttpError(400, 'I permessi del proprietario non possono essere rimossi.')
  setMembership(id, target.id, requested)
  activity(id, user, 'permissions.updated', target.id)
  return { permissions: requested }
})
app.delete('/api/groups/:id/members/:userId', async (request) => {
  const user = requireUser(request), id = groupId(request)
  requireGroup(user, id, 'canManageMembers')
  if (one('SELECT owner_id FROM groups WHERE id=?', id).owner_id === request.params.userId)
    throw new HttpError(400, 'Il proprietario non può essere rimosso.')
  run('DELETE FROM memberships WHERE group_id=? AND user_id=?', id, request.params.userId)
  activity(id, user, 'member.removed', request.params.userId)
  return { ok: true }
})

app.post('/api/groups/:id/invites', async (request) => {
  const user = requireUser(request), id = groupId(request)
  const own = requireGroup(user, id, 'canManageMembers')
  const permissions = normalizePermissions(request.body?.permissions || presets.contributor)
  if (!permissions.canView) throw new HttpError(400, 'Un invito deve consentire la visualizzazione del gruppo.')
  if (!user.isAdmin && Object.entries(permissions).some(([key, value]) => value && !own[key]))
    throw new HttpError(403, 'Non puoi concedere permessi che non possiedi.')
  const token = randomBytes(24).toString('hex')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  run('INSERT INTO invites(token_hash,group_id,permissions_json,expires_at,created_by) VALUES(?,?,?,?,?)',
    hash(token), id, JSON.stringify(permissions), expiresAt, user.id)
  activity(id, user, 'invite.created')
  return { url: `${process.env.PUBLIC_ORIGIN || ''}/#/invite/${token}`, expiresAt }
})
const inviteByToken = (token) => one(`SELECT i.*,g.name AS group_name FROM invites i
  JOIN groups g ON g.id=i.group_id WHERE i.token_hash=? AND i.used_by IS NULL
  AND i.expires_at>? AND g.deleted_at IS NULL`, hash(token), now())
app.get('/api/invites/:token', async (request) => {
  const invite = inviteByToken(request.params.token)
  if (!invite) throw new HttpError(404, 'Invito non valido o scaduto.')
  return { groupName: invite.group_name, expiresAt: invite.expires_at }
})
app.post('/api/invites/:token/accept', async (request) => {
  const user = requireUser(request)
  const invite = inviteByToken(request.params.token)
  if (!invite) throw new HttpError(404, 'Invito non valido o scaduto.')
  transaction(() => {
    const updated = run('UPDATE invites SET used_by=? WHERE token_hash=? AND used_by IS NULL', user.id, invite.token_hash)
    if (!updated.changes) throw new HttpError(409, 'Invito già utilizzato.')
    setMembership(invite.group_id, user.id, JSON.parse(invite.permissions_json))
    activity(invite.group_id, user, 'invite.accepted')
  })
  return { groupId: invite.group_id }
})
app.post('/api/invites/:token/register', async (request, reply) => {
  limitAuth(`invite:${request.params.token}`)
  const invite = inviteByToken(request.params.token)
  if (!invite) throw new HttpError(404, 'Invito non valido o scaduto.')
  const body = request.body ?? {}
  const username = required(body.username, 'Nome utente', 100).toLowerCase()
  const name = required(body.name, 'Nome', 100)
  const password = required(body.password, 'Password', 1024)
  if (password.length < 12) throw new HttpError(400, 'La password deve avere almeno 12 caratteri.')
  const passwordHash = await hashPassword(password)
  const userId = newId()
  transaction(() => {
    run('INSERT INTO users(id,username,name,password_hash) VALUES(?,?,?,?)', userId, username, name, passwordHash)
    const updated = run('UPDATE invites SET used_by=? WHERE token_hash=? AND used_by IS NULL', userId, invite.token_hash)
    if (!updated.changes) throw new HttpError(409, 'Invito già utilizzato.')
    setMembership(invite.group_id, userId, JSON.parse(invite.permissions_json))
    activity(invite.group_id, { id: userId }, 'invite.accepted')
  })
  createSession(userId, reply, request)
  return { groupId: invite.group_id, user: { id: userId, username, name, isAdmin: false, canCreateGroups: false } }
})

function expenseInput(body, id) {
  const title = required(body.title, 'Titolo spesa', 200)
  const amountMinor = Number(body.amountMinor)
  const date = required(body.date, 'Data', 10)
  if (!validDate(date))
    throw new HttpError(400, 'Data non valida.')
  const participants = all('SELECT id FROM participants WHERE group_id=?', id)
  const validIds = new Set(participants.map((row) => row.id))
  const payerId = required(body.payerId, 'Pagante', 64)
  if (!validIds.has(payerId)) throw new HttpError(400, 'Pagante non nel gruppo.')
  const splitMode = body.splitMode || 'EQUAL'
  const shares = allocate(amountMinor, splitMode, body.shares)
  if (shares.some((row) => !validIds.has(row.participantId)))
    throw new HttpError(400, 'Quota assegnata a un partecipante esterno al gruppo.')
  let originalAmountMinor = null, originalCurrency = null, exchangeRate = null
  if (body.originalAmountMinor != null || body.originalCurrency || body.exchangeRate != null) {
    originalAmountMinor = Number(body.originalAmountMinor)
    originalCurrency = required(body.originalCurrency, 'Valuta originale', 3).toUpperCase()
    exchangeRate = Number(body.exchangeRate)
    currencyDigits(originalCurrency)
    if (!Number.isSafeInteger(originalAmountMinor) || originalAmountMinor <= 0 ||
        !Number.isFinite(exchangeRate) || exchangeRate <= 0 || exchangeRate > 1_000_000)
      throw new HttpError(400, 'Cambio valuta non valido.')
  }
  return {
    title, amountMinor, date, payerId, splitMode, shares,
    category: text(body.category || 'Other', 60) || 'Other',
    notes: text(body.notes, 5000),
    isReimbursement: Number(Boolean(body.isReimbursement)),
    originalAmountMinor, originalCurrency, exchangeRate,
  }
}
function insertExpense(group, user, value, recurrenceId = null) {
  const id = newId()
  run(`INSERT INTO expenses(id,group_id,title,amount_minor,original_amount_minor,original_currency,
    exchange_rate,date,category,payer_id,split_mode,notes,is_reimbursement,created_by,recurrence_id)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, group, value.title, value.amountMinor,
    value.originalAmountMinor, value.originalCurrency, value.exchangeRate, value.date,
    value.category, value.payerId, value.splitMode, value.notes, value.isReimbursement,
    user?.id ?? null, recurrenceId)
  for (const row of value.shares)
    run('INSERT INTO expense_shares(expense_id,participant_id,amount_minor,weight) VALUES(?,?,?,?)', id, row.participantId, row.amountMinor, row.weight)
  activity(group, user, 'expense.created', value.title)
  return id
}
function materializeRecurring(group) {
  const today = new Date().toISOString().slice(0, 10)
  const rules = all('SELECT * FROM recurring_rules WHERE group_id=? AND active=1 AND next_date<=?', group, today)
  for (const rule of rules) transaction(() => {
    let nextDate = rule.next_date, count = 0
    const template = JSON.parse(rule.template_json)
    while (nextDate <= today && count++ < 36) {
      insertExpense(group, rule.created_by ? { id: rule.created_by } : null, { ...template, date: nextDate }, rule.id)
      nextDate = nextRecurringDate(nextDate, rule.interval, Number(template.date.slice(8, 10)))
    }
    run('UPDATE recurring_rules SET next_date=? WHERE id=?', nextDate, rule.id)
  })
}
function expenseRows(group, query = '') {
  const search = `%${query.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
  const expenses = all(`SELECT e.*,u.name AS creator_name FROM expenses e LEFT JOIN users u ON u.id=e.created_by
    WHERE e.group_id=? AND e.title LIKE ? ESCAPE '\\' ORDER BY e.date DESC,e.created_at DESC`, group, search)
  return expenses.map((row) => ({
    id: row.id, groupId: row.group_id, title: row.title, amountMinor: row.amount_minor,
    originalAmountMinor: row.original_amount_minor, originalCurrency: row.original_currency,
    exchangeRate: row.exchange_rate, date: row.date, category: row.category,
    payerId: row.payer_id, splitMode: row.split_mode, notes: row.notes,
    isReimbursement: Boolean(row.is_reimbursement), createdBy: row.created_by,
    creatorName: row.creator_name, recurrenceId: row.recurrence_id,
    shares: all('SELECT participant_id AS participantId,amount_minor AS amountMinor,weight FROM expense_shares WHERE expense_id=?', row.id),
    documents: all('SELECT id,original_name AS name,mime_type AS mimeType,size FROM documents WHERE expense_id=?', row.id),
  }))
}
app.get('/api/groups/:id/expenses', async (request) => {
  const user = requireUser(request), id = groupId(request)
  requireGroup(user, id)
  materializeRecurring(id)
  return { expenses: expenseRows(id, text(request.query?.search, 200)) }
})
app.post('/api/groups/:id/expenses', async (request) => {
  const user = requireUser(request), id = groupId(request)
  requireGroup(user, id, 'canAddExpense')
  const value = expenseInput(request.body ?? {}, id)
  const interval = request.body?.recurrence
  if (interval && !['DAILY','WEEKLY','MONTHLY'].includes(interval)) throw new HttpError(400, 'Ricorrenza non valida.')
  const result = transaction(() => {
    let recurrenceId = null
    if (interval) {
      recurrenceId = newId()
      run('INSERT INTO recurring_rules(id,group_id,template_json,interval,next_date,created_by) VALUES(?,?,?,?,?,?)',
        recurrenceId, id, JSON.stringify(value), interval,
        nextRecurringDate(value.date, interval, Number(value.date.slice(8, 10))), user.id)
    }
    return insertExpense(id, user, value, recurrenceId)
  })
  return { id: result }
})
app.patch('/api/groups/:id/expenses/:expenseId', async (request) => {
  const user = requireUser(request), id = groupId(request), expenseId = request.params.expenseId
  requireExpenseEdit(user, id, expenseId)
  const value = expenseInput(request.body ?? {}, id)
  transaction(() => {
    run(`UPDATE expenses SET title=?,amount_minor=?,original_amount_minor=?,original_currency=?,exchange_rate=?,
      date=?,category=?,payer_id=?,split_mode=?,notes=?,is_reimbursement=?,updated_at=? WHERE id=? AND group_id=?`,
      value.title, value.amountMinor, value.originalAmountMinor, value.originalCurrency, value.exchangeRate,
      value.date, value.category, value.payerId, value.splitMode, value.notes, value.isReimbursement, now(), expenseId, id)
    run('DELETE FROM expense_shares WHERE expense_id=?', expenseId)
    for (const row of value.shares)
      run('INSERT INTO expense_shares(expense_id,participant_id,amount_minor,weight) VALUES(?,?,?,?)', expenseId, row.participantId, row.amountMinor, row.weight)
    activity(id, user, 'expense.updated', value.title)
  })
  return { ok: true }
})
app.delete('/api/groups/:id/expenses/:expenseId', async (request) => {
  const user = requireUser(request), id = groupId(request), expenseId = request.params.expenseId
  requireExpenseEdit(user, id, expenseId)
  const expense = one('SELECT title FROM expenses WHERE id=?', expenseId)
  const files = all('SELECT stored_name FROM documents WHERE expense_id=?', expenseId)
  run('DELETE FROM expenses WHERE id=?', expenseId)
  for (const file of files) rmSync(join(uploadDir, file.stored_name), { force: true })
  activity(id, user, 'expense.deleted', expense.title)
  return { ok: true }
})

app.get('/api/groups/:id/balances', async (request) => {
  const user = requireUser(request), id = groupId(request)
  requireGroup(user, id)
  materializeRecurring(id)
  const participants = all('SELECT id,name FROM participants WHERE group_id=? ORDER BY name', id)
  const expenses = all('SELECT id,payer_id,amount_minor FROM expenses WHERE group_id=?', id)
    .map((expense) => ({ ...expense, shares: all('SELECT participant_id,amount_minor FROM expense_shares WHERE expense_id=?', expense.id) }))
  return calculateBalances(participants, expenses)
})
app.get('/api/groups/:id/stats', async (request) => {
  const user = requireUser(request), id = groupId(request)
  requireGroup(user, id)
  materializeRecurring(id)
  const expenses = all('SELECT amount_minor,date,category,is_reimbursement FROM expenses WHERE group_id=?', id)
  const normal = expenses.filter((row) => !row.is_reimbursement)
  const totalMinor = normal.reduce((sum, row) => sum + row.amount_minor, 0)
  const byCategory = Object.entries(Object.groupBy(normal, (row) => row.category))
    .map(([name, rows]) => ({ name, amountMinor: rows.reduce((sum, row) => sum + row.amount_minor, 0) }))
    .sort((a, b) => b.amountMinor - a.amountMinor)
  const byMonth = Object.entries(Object.groupBy(normal, (row) => row.date.slice(0, 7)))
    .map(([month, rows]) => ({ month, amountMinor: rows.reduce((sum, row) => sum + row.amount_minor, 0) }))
    .sort((a, b) => a.month.localeCompare(b.month))
  return { totalMinor, count: normal.length, byCategory, byMonth }
})
app.get('/api/groups/:id/activity', async (request) => {
  const user = requireUser(request), id = groupId(request)
  requireGroup(user, id)
  return { activity: all(`SELECT a.id,a.action,a.detail,a.created_at AS createdAt,u.name AS actor
    FROM activity a LEFT JOIN users u ON u.id=a.actor_id WHERE a.group_id=? ORDER BY a.created_at DESC LIMIT 200`, id) }
})
app.get('/api/groups/:id/recurring', async (request) => {
  const user = requireUser(request), id = groupId(request)
  requireGroup(user, id)
  return { rules: all('SELECT id,interval,next_date AS nextDate,active,template_json AS template FROM recurring_rules WHERE group_id=? ORDER BY next_date', id) }
})
app.patch('/api/groups/:id/recurring/:ruleId', async (request) => {
  const user = requireUser(request), id = groupId(request)
  requireGroup(user, id, 'canEditAll')
  const rule = one('SELECT id FROM recurring_rules WHERE id=? AND group_id=?', request.params.ruleId, id)
  if (!rule) throw new HttpError(404, 'Ricorrenza non trovata.')
  run('UPDATE recurring_rules SET active=? WHERE id=?', Number(Boolean(request.body?.active)), rule.id)
  activity(id, user, 'recurrence.updated')
  return { ok: true }
})
app.get('/api/groups/:id/export/:format', async (request, reply) => {
  const user = requireUser(request), id = groupId(request)
  requireGroup(user, id, 'canExport')
  const group = one('SELECT name,currency FROM groups WHERE id=?', id)
  const expenses = expenseRows(id)
  const filename = `condivisa-${id}.${request.params.format}`
  reply.header('Content-Disposition', `attachment; filename="${filename}"`)
  reply.header('Cache-Control', 'private, no-store')
  if (request.params.format === 'json') return { group, expenses }
  if (request.params.format !== 'csv') throw new HttpError(404, 'Formato non disponibile.')
  const escapeCsv = (value) => {
    const safe = String(value ?? '').replace(/^[=+\-@\t\r]/, "'$&")
    return `"${safe.replaceAll('"', '""')}"`
  }
  const digits = currencyDigits(group.currency)
  reply.type('text/csv; charset=utf-8')
  return ['data,titolo,importo,valuta,categoria,pagante,note', ...expenses.map((expense) => [
    expense.date, expense.title, (expense.amountMinor / 10 ** digits).toFixed(digits), group.currency, expense.category,
    expense.payerId, expense.notes,
  ].map(escapeCsv).join(','))].join('\n')
})
app.post('/api/groups/:id/delete', async (request) => {
  const user = requireUser(request), id = groupId(request)
  requireGroup(user, id, 'canDeleteGroup')
  run('UPDATE groups SET deleted_at=? WHERE id=?', now(), id)
  activity(id, user, 'group.deleted')
  return { ok: true }
})
app.post('/api/groups/:id/restore', async (request) => {
  const user = requireUser(request), id = groupId(request)
  const group = one('SELECT owner_id,deleted_at FROM groups WHERE id=?', id)
  if (!group) throw new HttpError(404, 'Gruppo non trovato.')
  if (!user.isAdmin && group.owner_id !== user.id) throw new HttpError(403, 'Solo il proprietario può ripristinare il gruppo.')
  if (!group.deleted_at) throw new HttpError(400, 'Gruppo non eliminato.')
  run('UPDATE groups SET deleted_at=NULL WHERE id=?', id)
  activity(id, user, 'group.restored')
  return { ok: true }
})

app.addContentTypeParser(
  ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  { parseAs: 'buffer' },
  (_request, body, done) => done(null, body),
)
app.post('/api/groups/:id/expenses/:expenseId/documents', async (request) => {
  const user = requireUser(request), id = groupId(request)
  requireExpenseEdit(user, id, request.params.expenseId)
  const content = request.body
  if (!Buffer.isBuffer(content) || content.length < 1 || content.length > 5 * 1024 * 1024)
    throw new HttpError(400, 'Il file deve essere tra 1 byte e 5 MB.')
  const mimeType = request.headers['content-type']
  if (!['image/jpeg','image/png','image/webp','application/pdf'].includes(mimeType))
    throw new HttpError(400, 'Formato file non supportato.')
  let name = 'documento'
  try { name = basename(decodeURIComponent(text(request.headers['x-file-name'] || 'documento', 150))) }
  catch { throw new HttpError(400, 'Nome file non valido.') }
  const documentId = newId(), storedName = `${documentId}.bin`
  writeFileSync(join(uploadDir, storedName), content, { flag: 'wx', mode: 0o600 })
  run('INSERT INTO documents(id,expense_id,stored_name,original_name,mime_type,size) VALUES(?,?,?,?,?,?)',
    documentId, request.params.expenseId, storedName, name, mimeType, content.length)
  activity(id, user, 'document.added', name)
  return { id: documentId }
})
app.get('/api/groups/:id/expenses/:expenseId/documents/:documentId', async (request, reply) => {
  const user = requireUser(request), id = groupId(request)
  requireGroup(user, id)
  const document = one(`SELECT d.* FROM documents d JOIN expenses e ON e.id=d.expense_id
    WHERE d.id=? AND d.expense_id=? AND e.group_id=?`, request.params.documentId, request.params.expenseId, id)
  if (!document) throw new HttpError(404, 'Documento non trovato.')
  reply.type(document.mime_type)
  reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(document.original_name)}"`)
  reply.header('Cache-Control', 'private, no-store')
  return reply.send(createReadStream(join(uploadDir, document.stored_name)))
})
app.delete('/api/groups/:id/expenses/:expenseId/documents/:documentId', async (request) => {
  const user = requireUser(request), id = groupId(request)
  requireExpenseEdit(user, id, request.params.expenseId)
  const document = one('SELECT stored_name FROM documents WHERE id=? AND expense_id=?', request.params.documentId, request.params.expenseId)
  const result = run('DELETE FROM documents WHERE id=? AND expense_id=?', request.params.documentId, request.params.expenseId)
  if (!result.changes) throw new HttpError(404, 'Documento non trovato.')
  rmSync(join(uploadDir, document.stored_name), { force: true })
  activity(id, user, 'document.removed')
  return { ok: true }
})
app.get('/api/exchange-rate', async (request) => {
  requireUser(request)
  const from = required(request.query?.from, 'Valuta originale', 3).toUpperCase()
  const to = required(request.query?.to, 'Valuta gruppo', 3).toUpperCase()
  currencyDigits(from); currencyDigits(to)
  if (from === to) return { rate: 1 }
  const date = text(request.query?.date, 10)
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'Data non valida.')
  const endpoint = `https://api.frankfurter.dev/v2/rate/${encodeURIComponent(from)}/${encodeURIComponent(to)}${date ? `/${date}` : ''}`
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(5000) })
  if (!response.ok) throw new HttpError(502, 'Cambio valuta non disponibile.')
  const data = await response.json()
  return { rate: data.rate, date: data.date }
})

const dist = resolve('dist')
if (existsSync(dist)) {
  await app.register(fastifyStatic, { root: dist, prefix: '/' })
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'Endpoint non trovato.' })
    return reply.type('text/html').send(createReadStream(join(dist, 'index.html')))
  })
}

export { app }
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await app.listen({ port: Number(process.env.PORT || 3001), host: '0.0.0.0' })
}
