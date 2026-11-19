import { useEffect, useState } from 'react'
import { Activity, ArrowLeftRight, BarChart3, CalendarDays, ChevronRight, MoreHorizontal, Plus, ReceiptText, Search, Settings2, Shield, Trash2, UserPlus, UsersRound, Wallet } from 'lucide-react'
import { api, money, patch, post, remove, type Balance, type Expense, type Group, type Participant, type Permissions, type Settlement, type User } from './api'
import { ExpenseForm } from './ExpenseForm'
import { CategoryManager } from './CategoryManager'
import { PermissionsPanel } from './PermissionsPanel'
import { Avatar, Button, Empty, Field, Modal, SectionTitle } from './ui'
import { toneFor } from './colors'

type GroupData = { group: Group; participants: Participant[]; permissions: Permissions }
type Stats = { totalMinor: number; count: number; byCategory: { name: string; amountMinor: number }[]; byMonth: { month: string; amountMinor: number }[] }
type Audit = { id: string; action: string; detail: string; actor: string | null; createdAt: string }
type Rule = { id: string; interval: string; nextDate: string; active: number; template: string }
const tabs = [
  { id: 'expenses', label: 'Spese', icon: ReceiptText }, { id: 'balances', label: 'Saldi', icon: Wallet },
  { id: 'insights', label: 'Statistiche', icon: BarChart3 }, { id: 'people', label: 'Persone', icon: UsersRound },
  { id: 'permissions', label: 'Permessi', icon: Shield }, { id: 'activity', label: 'Attività', icon: Activity },
]

export function GroupPage({ groupId, tab, user, onTab, onDeleted, onNotice }: { groupId: string; tab: string; user: User; onTab: (tab: string) => void; onDeleted: () => void; onNotice: (message: string) => void }) {
  const [data, setData] = useState<GroupData | null>(null)
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [balances, setBalances] = useState<Balance[]>([])
  const [settlements, setSettlements] = useState<Settlement[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [audit, setAudit] = useState<Audit[]>([])
  const [rules, setRules] = useState<Rule[]>([])
  const [eligibleUsers, setEligibleUsers] = useState<Pick<User, 'id' | 'name' | 'username'>[]>([])
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [editExpense, setEditExpense] = useState<Expense | null | 'new'>(null)
  const [reimbursement, setReimbursement] = useState<Settlement | null>(null)
  const [newPersonOpen, setNewPersonOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const reload = () => setRevision((value) => value + 1)
  useEffect(() => {
    if (tab !== 'add' || !data) return
    const timeout = window.setTimeout(() => {
      if (data.permissions.canAddExpense) setEditExpense('new')
      else onNotice('Non hai il permesso di aggiungere spese a questo gruppo.')
      onTab('expenses')
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [tab, data, onTab, onNotice])
  useEffect(() => {
    Promise.all([
      api<GroupData>(`/groups/${groupId}`),
      api<{ expenses: Expense[] }>(`/groups/${groupId}/expenses`),
      api<{ balances: Balance[]; settlements: Settlement[] }>(`/groups/${groupId}/balances`),
    ]).then(([group, list, balance]) => { setData(group); setExpenses(list.expenses); setBalances(balance.balances); setSettlements(balance.settlements); setError('') })
      .catch((err) => setError(err.message)).finally(() => setLoading(false))
  }, [groupId, revision])
  useEffect(() => {
    if (tab === 'insights') {
      api<Stats>(`/groups/${groupId}/stats`).then(setStats).catch((err) => onNotice(err.message))
      api<{ rules: Rule[] }>(`/groups/${groupId}/recurring`).then((result) => setRules(result.rules)).catch(() => {})
    }
    if (tab === 'activity') api<{ activity: Audit[] }>(`/groups/${groupId}/activity`).then((result) => setAudit(result.activity)).catch((err) => onNotice(err.message))
  }, [groupId, tab, revision, onNotice])
  useEffect(() => {
    if (tab === 'people' && data?.permissions.canManageGroup)
      api<{ users: Pick<User, 'id' | 'name' | 'username'>[] }>(`/groups/${groupId}/eligible-users`)
        .then((result) => setEligibleUsers(result.users)).catch((err) => onNotice(err.message))
  }, [groupId, tab, data?.permissions.canManageGroup, revision, onNotice])
  if (loading && !data) return <div className="skeleton-page"><div /><div /><div /></div>
  if (error || !data) return <Empty icon={<Shield size={28} />} title="Gruppo non disponibile" detail={error || 'Non hai accesso a questo gruppo.'} />
  const { group, participants, permissions } = data
  const canEdit = (expense: Expense) => permissions.canEditAll || (permissions.canEditOwn && expense.createdBy === user.id)
  const total = expenses.filter((expense) => !expense.isReimbursement).reduce((sum, expense) => sum + expense.amountMinor, 0)
  const visible = expenses.filter((expense) => `${expense.title} ${expense.category} ${expense.notes}`.toLowerCase().includes(search.toLowerCase()))
  const names = Object.fromEntries(participants.map((person) => [person.id, person.name]))
  return <>
    <div className="group-hero"><div className={`group-hero-icon tone-${toneFor(group.name)}`}>{group.name.slice(0, 1).toUpperCase()}</div><div className="group-hero-copy"><span className="eyebrow">GRUPPO CONDIVISO</span><h1>{group.name}</h1><p>{group.information || `${participants.length} persone · Spese in ${group.currency}`}</p><div className="hero-avatars">{participants.slice(0, 4).map((person) => <Avatar key={person.id} name={person.name} size="sm" />)}<span>{participants.length} partecipanti</span></div></div><div className="group-hero-actions"><button className="icon-button hero-more" onClick={() => setMoreOpen(!moreOpen)} aria-label="Altre azioni"><MoreHorizontal size={22} /></button>{moreOpen && <div className="more-menu">{permissions.canExport && <><a href={`/api/groups/${groupId}/export/csv`} download>Esporta CSV</a><a href={`/api/groups/${groupId}/export/json`} download>Esporta JSON</a></>}{permissions.canManageGroup && <><button onClick={() => { setSettingsOpen(true); setMoreOpen(false) }}>Impostazioni</button><button onClick={() => { setCategoriesOpen(true); setMoreOpen(false) }}>Categorie</button></>}{permissions.canDeleteGroup && <button className="danger-text" onClick={async () => { if (!confirm(`Eliminare ${group.name}? Puoi ripristinarlo dalla sezione Accessi.`)) return; try { await post(`/groups/${groupId}/delete`, {}); onDeleted() } catch (err) { onNotice((err as Error).message) } }}>Elimina gruppo</button>}</div>}{permissions.canAddExpense && <Button onClick={() => setEditExpense('new')}><Plus size={18} /> Aggiungi spesa</Button>}</div></div>
    <div className="group-summary"><div><span className="summary-icon mint"><ReceiptText size={21} /></span><span><small>SPESA TOTALE</small><strong>{money(total, group.currency)}</strong></span></div><div><span className="summary-icon peach"><UsersRound size={21} /></span><span><small>PARTECIPANTI</small><strong>{participants.length}</strong></span></div><div><span className="summary-icon lavender"><ArrowLeftRight size={21} /></span><span><small>DA SISTEMARE</small><strong>{settlements.length} {settlements.length === 1 ? 'saldo' : 'saldi'}</strong></span></div></div>
    <div className="tab-strip" role="tablist" aria-label="Sezioni del gruppo">{tabs.filter((item) => item.id !== 'permissions' || permissions.canManageMembers).map(({ id, label, icon: Icon }) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => onTab(id)}><Icon size={18} /> {label}</button>)}</div>
    {tab === 'expenses' && <><SectionTitle title="Le spese del gruppo" detail="Ogni spesa racconta un pezzo della vostra storia." action={<div className="search-box"><Search size={18} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cerca una spesa" aria-label="Cerca una spesa" /></div>} />{visible.length === 0 ? <Empty icon={<ReceiptText size={30} />} title={search ? 'Nessun risultato' : 'Si parte dalla prima spesa'} detail={search ? 'Prova un altro termine di ricerca.' : 'Aggiungi una spesa e scegli come dividerla.'} action={permissions.canAddExpense && !search && <Button onClick={() => setEditExpense('new')}><Plus size={17} /> Aggiungi spesa</Button>} /> : <div className="expense-list">{visible.map((expense) => <button key={expense.id} className="expense-row" onClick={() => setEditExpense(expense)}><span className="expense-date"><strong>{new Date(`${expense.date}T12:00:00`).toLocaleDateString('it-IT', { day: '2-digit' })}</strong><small>{new Date(`${expense.date}T12:00:00`).toLocaleDateString('it-IT', { month: 'short' })}</small></span><span className="expense-icon"><ReceiptText size={19} /></span><span className="expense-main"><strong>{expense.title}</strong><small>{expense.isReimbursement ? 'Rimborso' : expense.category} · Pagato da {names[expense.payerId] || '—'}</small></span><span className="expense-amount"><strong>{money(expense.amountMinor, group.currency)}</strong><small>{expense.shares.length} quote</small></span><ChevronRight size={18} className="expense-chevron" /></button>)}</div>}</>}
    {tab === 'balances' && <>
      <SectionTitle eyebrow="I CONTI TORNANO" title="Saldi e rimborsi" detail="Chi ha anticipato e chi deve ancora contribuire." />
      <div className="balance-grid">{balances.map((balance) => <div className="balance-card" key={balance.id}><Avatar name={balance.name} /><div><strong>{balance.name}</strong><small>{balance.balanceMinor > 0 ? 'Deve ricevere' : balance.balanceMinor < 0 ? 'Deve dare' : 'In pari'}</small></div><strong className={balance.balanceMinor > 0 ? 'positive' : balance.balanceMinor < 0 ? 'negative' : ''}>{money(Math.abs(balance.balanceMinor), group.currency)}</strong></div>)}</div>
      <div className="settlement-option"><div><strong>Semplifica spese</strong><p>{group.simplifySettlements ? 'Compensa i saldi tra tutti per proporre meno passaggi.' : 'Mostra i rimborsi tra chi ha condiviso ogni spesa, compensati a coppie.'}</p></div>{permissions.canManageGroup ? <label className="settlement-switch"><input type="checkbox" aria-label="Semplifica spese" checked={group.simplifySettlements ?? true} onChange={async (event) => { try { await patch(`/groups/${groupId}`, { simplifySettlements: event.target.checked }); reload() } catch (err) { onNotice((err as Error).message) } }} /><span aria-hidden="true" /></label> : <small>{group.simplifySettlements ? 'Attiva' : 'Disattiva'}</small>}</div>
      <SectionTitle title="Come saldare" detail={group.simplifySettlements ? 'Rimborsi compensati tra tutti i partecipanti.' : 'Rimborsi diretti tra partecipanti, compensati a coppie.'} />
      {settlements.length === 0 ? <Empty icon={<Wallet size={30} />} title="Tutti in pari!" detail="Non ci sono rimborsi da fare." /> : <div className="settlement-list">{settlements.map((settlement, index) => <div className="settlement-row" key={index}><Avatar name={names[settlement.from]} size="sm" /><strong>{names[settlement.from]}</strong><ArrowLeftRight size={17} /><Avatar name={names[settlement.to]} size="sm" /><strong>{names[settlement.to]}</strong><span>{money(settlement.amountMinor, group.currency)}</span>{permissions.canAddExpense && <Button variant="secondary" onClick={() => { setReimbursement(settlement); setEditExpense('new') }}>Registra rimborso</Button>}</div>)}</div>}
    </>}
    {tab === 'insights' && <><SectionTitle eyebrow="UNO SGUARDO AI NUMERI" title="Le vostre statistiche" detail="Capisci dove vanno le spese del gruppo." />{stats ? <><div className="insight-tiles"><div><small>SPESA TOTALE</small><strong>{money(stats.totalMinor, group.currency)}</strong><span>Esclusi i rimborsi</span></div><div><small>NUMERO SPESE</small><strong>{stats.count}</strong><span>Nel gruppo</span></div><div><small>MEDIA PER SPESA</small><strong>{money(stats.count ? Math.round(stats.totalMinor / stats.count) : 0, group.currency)}</strong><span>Per ogni registrazione</span></div></div><div className="chart-grid"><div className="panel chart-panel"><h3>Per categoria</h3>{stats.byCategory.length ? stats.byCategory.map((row) => <div className="bar-row" key={row.name}><span>{row.name}</span><div><i style={{ width: `${Math.max(5, row.amountMinor / (stats.byCategory[0]?.amountMinor || 1) * 100)}%` }} /></div><strong>{money(row.amountMinor, group.currency)}</strong></div>) : <p className="muted">Ancora nessuna spesa.</p>}</div><div className="panel chart-panel"><h3>Nel tempo</h3>{stats.byMonth.map((row) => <div className="bar-row" key={row.month}><span>{row.month}</span><div><i className="bar-peach" style={{ width: `${Math.max(5, row.amountMinor / Math.max(...stats.byMonth.map((x) => x.amountMinor), 1) * 100)}%` }} /></div><strong>{money(row.amountMinor, group.currency)}</strong></div>)}</div></div></> : <div className="loading-bar" />}<SectionTitle title="Spese ricorrenti" detail="Ripetizioni automatiche, con controllo quando vuoi." />{rules.length ? <div className="panel rule-list">{rules.map((rule) => <div key={rule.id} className="rule-row"><CalendarDays size={20} /><span><strong>{JSON.parse(rule.template).title}</strong><small>{rule.interval === 'DAILY' ? 'Ogni giorno' : rule.interval === 'WEEKLY' ? 'Ogni settimana' : 'Ogni mese'} · prossima {rule.nextDate}</small></span>{permissions.canEditAll && <button className={`toggle ${rule.active ? 'on' : ''}`} aria-label={rule.active ? 'Disattiva ricorrenza' : 'Attiva ricorrenza'} onClick={async () => { try { await patch(`/groups/${groupId}/recurring/${rule.id}`, { active: !rule.active }); reload() } catch (err) { onNotice((err as Error).message) } }} />}</div>)}</div> : <Empty icon={<CalendarDays size={28} />} title="Nessuna ricorrenza" detail="Quando aggiungi una spesa puoi scegliere di ripeterla automaticamente." />}</>}
    {tab === 'people' && <><SectionTitle eyebrow="LE PERSONE" title="Partecipanti" detail="I partecipanti rappresentano chi paga o divide le spese." action={permissions.canManageGroup && <Button variant="secondary" onClick={() => setNewPersonOpen(true)}><UserPlus size={17} /> Aggiungi</Button>} /><div className="panel people-list">{participants.map((person) => <div className="person-row" key={person.id}><Avatar name={person.name} /><div><strong>{person.name}</strong><small>{person.userId ? 'Collegato a un account' : 'Solo partecipante'}</small></div>{permissions.canManageGroup && <select className="person-account" aria-label={`Account di ${person.name}`} value={person.userId || ''} onChange={async (event) => { try { await patch(`/groups/${groupId}/participants/${person.id}`, { userId: event.target.value || null }); reload() } catch (err) { onNotice((err as Error).message) } }}><option value="">Nessun account</option>{eligibleUsers.map((account) => <option value={account.id} key={account.id}>{account.name} (@{account.username})</option>)}</select>}{permissions.canManageGroup && <button className="icon-button" aria-label={`Rimuovi ${person.name}`} onClick={async () => { if (!confirm(`Rimuovere ${person.name}?`)) return; try { await remove(`/groups/${groupId}/participants/${person.id}`); reload() } catch (err) { onNotice((err as Error).message) } }}><Trash2 size={17} /></button>}</div>)}</div>{permissions.canManageGroup && <div className="info-card"><Settings2 size={23} /><div><strong>Impostazioni del gruppo</strong><p>Modifica nome, valuta e descrizione.</p></div><Button variant="secondary" onClick={() => setSettingsOpen(true)}>Modifica <ChevronRight size={16} /></Button></div>}</>}
    {tab === 'permissions' && permissions.canManageMembers && <PermissionsPanel groupId={groupId} onNotice={onNotice} />}
    {tab === 'activity' && <><SectionTitle eyebrow="CRONOLOGIA" title="Attività del gruppo" detail="Le modifiche registrate con l’account di chi le ha fatte." /><div className="panel activity-list">{audit.map((row) => <div className="activity-row" key={row.id}><span className="activity-dot" /><div><strong>{row.actor || 'Sistema'}</strong> {actionLabel(row.action)} {row.detail && <span className="activity-detail">“{row.detail}”</span>}<small>{new Date(row.createdAt).toLocaleString('it-IT')}</small></div></div>)}{audit.length === 0 && <p className="muted">Nessuna attività registrata.</p>}</div></>}
    {editExpense && <ExpenseForm group={group} participants={participants} expense={editExpense === 'new' ? undefined : editExpense} reimbursement={reimbursement} canEdit={editExpense === 'new' ? true : canEdit(editExpense)} onClose={() => { setEditExpense(null); setReimbursement(null) }} onSaved={() => { setEditExpense(null); setReimbursement(null); reload() }} onNotice={onNotice} />}
    {newPersonOpen && <AddPerson groupId={groupId} onClose={() => setNewPersonOpen(false)} onDone={() => { setNewPersonOpen(false); reload() }} onNotice={onNotice} />}
    {settingsOpen && <GroupSettings group={group} onClose={() => setSettingsOpen(false)} onDone={() => { setSettingsOpen(false); reload() }} onNotice={onNotice} />}
    {categoriesOpen && <CategoryManager groupId={groupId} onClose={() => setCategoriesOpen(false)} onChanged={reload} />}
  </>
}

function actionLabel(action: string) { return ({ 'group.created': 'ha creato il gruppo', 'group.updated': 'ha aggiornato il gruppo', 'expense.created': 'ha aggiunto una spesa', 'expense.updated': 'ha modificato una spesa', 'expense.deleted': 'ha eliminato una spesa', 'category.created': 'ha creato una categoria', 'category.merged': 'ha unito le categorie', 'participant.added': 'ha aggiunto un partecipante', 'participant.updated': 'ha modificato un partecipante', 'participant.removed': 'ha rimosso un partecipante', 'invite.created': 'ha creato un invito', 'invite.accepted': 'ha accettato un invito', 'permissions.updated': 'ha aggiornato i permessi', 'member.removed': 'ha rimosso un membro' } as Record<string, string>)[action] || action }

function AddPerson({ groupId, onClose, onDone, onNotice }: { groupId: string; onClose: () => void; onDone: () => void; onNotice: (message: string) => void }) {
  const [name, setName] = useState('')
  return <Modal title="Aggiungi partecipante" onClose={onClose}><form className="form-stack" onSubmit={async (event) => { event.preventDefault(); try { await post(`/groups/${groupId}/participants`, { name }); onDone() } catch (err) { onNotice((err as Error).message) } }}><Field label="Nome"><input autoFocus required value={name} onChange={(event) => setName(event.target.value)} placeholder="Es. Giulia" /></Field><div className="modal-actions"><Button variant="secondary" onClick={onClose}>Annulla</Button><Button type="submit">Aggiungi</Button></div></form></Modal>
}
function GroupSettings({ group, onClose, onDone, onNotice }: { group: Group; onClose: () => void; onDone: () => void; onNotice: (message: string) => void }) {
  const [name, setName] = useState(group.name), [currency, setCurrency] = useState(group.currency), [information, setInformation] = useState(group.information)
  return <Modal title="Impostazioni gruppo" onClose={onClose}><form className="form-stack" onSubmit={async (event) => { event.preventDefault(); try { await patch(`/groups/${group.id}`, { name, currency, information }); onDone() } catch (err) { onNotice((err as Error).message) } }}><Field label="Nome"><input value={name} onChange={(event) => setName(event.target.value)} required /></Field><Field label="Valuta"><input value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} maxLength={3} required /></Field><Field label="Descrizione"><textarea value={information} onChange={(event) => setInformation(event.target.value)} rows={4} /></Field><div className="modal-actions"><Button variant="secondary" onClick={onClose}>Annulla</Button><Button type="submit">Salva modifiche</Button></div></form></Modal>
}
