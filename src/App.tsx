import { useEffect, useState, type FormEvent } from 'react'
import { ArrowDownRight, ArrowUpRight, ChevronRight, CircleHelp, Home, KeyRound, LogOut, Menu, Plus, Settings2, Shield, UsersRound, Wallet, X } from 'lucide-react'
import { api, patch, post, type Group, type User } from './api'
import { Auth } from './Auth'
import { GroupPage } from './GroupPage'
import { InstallGuide } from './InstallGuide'
import { ThemePicker } from './ThemePicker'
import { Avatar, Button, Empty, Field, Modal, Notice, SectionTitle } from './ui'

function currentRoute() { return window.location.hash.replace(/^#\/?/, '') || 'home' }
function go(route: string) { window.location.hash = `/${route}` }

export default function App() {
  const [route, setRoute] = useState(currentRoute())
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [groups, setGroups] = useState<Group[]>([])
  const [refresh, setRefresh] = useState(0)
  const [createOpen, setCreateOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => {
    const listener = () => { setRoute(currentRoute()); setMenuOpen(false) }
    window.addEventListener('hashchange', listener)
    return () => window.removeEventListener('hashchange', listener)
  }, [])
  useEffect(() => {
    Promise.all([api<{ user: User }>('/me').catch(() => null), api<{ needsSetup: boolean }>('/bootstrap-status')])
      .then(([me, status]) => { setUser(me?.user ?? null); setNeedsSetup(status.needsSetup) })
      .catch(() => { setUser(null); setNeedsSetup(false) })
  }, [])
  useEffect(() => { if (user) api<{ groups: Group[] }>('/groups').then((data) => setGroups(data.groups)).catch((error) => setNotice(error.message)) }, [user, refresh])
  const inviteToken = route.startsWith('invite/') ? route.split('/')[1] : undefined
  async function signOut() {
    await post('/logout', {})
    setUser(null); setGroups([]); go('home')
  }
  if (user === undefined) return <div className="loading-screen"><div className="brand"><span className="brand-mark">c</span>condivisa<span className="brand-dot">.</span></div><div className="loading-bar" /></div>
  if (!user) return <Auth needsSetup={needsSetup} inviteToken={inviteToken} onAuthenticated={(next, groupId) => { setUser(next); setNeedsSetup(false); if (groupId) go(`group/${groupId}`); else if (!inviteToken) go('home') }} />
  if (inviteToken) return <InviteAccept token={inviteToken} onAccepted={(id) => { setRefresh((n) => n + 1); go(`group/${id}`) }} onCancel={() => go('home')} />

  const groupMatch = route.match(/^group\/([^/]+)(?:\/(\w+))?/)
  const activeGroup = groupMatch ? groups.find((group) => group.id === groupMatch[1]) : null
  const page = groupMatch ? 'group' : route === 'users' ? 'users' : route === 'profile' ? 'profile' : 'home'
  const canCreateGroup = user.isAdmin || user.canCreateGroups
  const canAddInGroup = Boolean(activeGroup?.canAddExpense)
  const showPrimaryAction = canAddInGroup || canCreateGroup
  return <div className="app-shell">
    <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
      <div className="sidebar-top"><button className="brand" onClick={() => go('home')}><span className="brand-mark">c</span><span>condivisa<span className="brand-dot">.</span></span></button><button className="icon-button close-sidebar" onClick={() => setMenuOpen(false)} aria-label="Chiudi menu"><X size={20} /></button></div>
      <div className="sidebar-section-label">IL TUO SPAZIO</div>
      <nav className="side-nav" aria-label="Navigazione principale"><button className={page === 'home' ? 'active' : ''} onClick={() => go('home')}><Home size={19} /> Panoramica</button>{user.isAdmin && <button className={page === 'users' ? 'active' : ''} onClick={() => go('users')}><Shield size={19} /> Utenti e accessi</button>}</nav>
      <div className="sidebar-groups-head"><span>I TUOI GRUPPI</span>{(user.isAdmin || user.canCreateGroups) && <button aria-label="Crea gruppo" onClick={() => setCreateOpen(true)}><Plus size={18} /></button>}</div>
      <nav className="group-nav" aria-label="Gruppi">{groups.map((group) => <button key={group.id} className={activeGroup?.id === group.id ? 'active' : ''} onClick={() => go(`group/${group.id}`)}><span className="group-dot">{group.name.slice(0, 1).toUpperCase()}</span><span>{group.name}</span><ChevronRight size={15} /></button>)}</nav>
      <div className="sidebar-spacer" />
      <InstallGuide />
      <button className="profile" onClick={() => go('profile')}><Avatar name={user.name} /><span><strong>{user.name}</strong><small>{user.isAdmin ? 'Amministratore' : 'Membro'}</small></span><Settings2 size={18} /></button>
    </aside>
    {menuOpen && <div className="sidebar-scrim" onClick={() => setMenuOpen(false)} />}
    <main className="main-area">
      <header className="topbar"><button className="icon-button mobile-menu" onClick={() => setMenuOpen(true)} aria-label="Apri menu"><Menu size={22} /></button><div className="topbar-trail"><span>Il tuo spazio</span><ChevronRight size={16} /><strong>{page === 'group' ? activeGroup?.name || 'Gruppo' : page === 'users' ? 'Utenti e accessi' : page === 'profile' ? 'Il tuo account' : 'Panoramica'}</strong></div><div className="topbar-actions"><ThemePicker compact /><button className="topbar-profile" onClick={() => go('profile')} aria-label="Apri il tuo account"><Avatar name={user.name} size="sm" /></button></div></header>
      <div className="content-area">
        {page === 'home' && <Dashboard user={user} groups={groups} onCreate={() => setCreateOpen(true)} onOpen={(id) => go(`group/${id}`)} />}
        {page === 'users' && <UsersPage onNotice={setNotice} />}
        {page === 'profile' && <ProfilePage user={user} onNotice={setNotice} onSignOut={signOut} />}
        {groupMatch && <GroupPage key={groupMatch[1]} groupId={groupMatch[1]} tab={groupMatch[2] || 'expenses'} user={user} onTab={(tab) => go(`group/${groupMatch[1]}/${tab}`)} onDeleted={() => { setRefresh((n) => n + 1); go('home') }} onNotice={setNotice} />}
      </div>
    </main>
    <nav className={`mobile-bottom ${showPrimaryAction ? 'has-primary' : ''}`} aria-label="Navigazione mobile">
      <button className={page === 'home' ? 'active' : ''} onClick={() => go('home')}><Home size={22} /><span>Home</span></button>
      {showPrimaryAction && <button className="mobile-add" aria-label={canAddInGroup ? 'Aggiungi spesa' : 'Crea gruppo'} onClick={() => { if (canAddInGroup && activeGroup) go(`group/${activeGroup.id}/add`); else setCreateOpen(true) }}><span className="mobile-add-disc"><Plus size={27} strokeWidth={2.4} /></span><span>{canAddInGroup ? 'Nuova spesa' : 'Nuovo gruppo'}</span></button>}
      <button className={page === 'users' || page === 'profile' ? 'active' : ''} onClick={() => go(user.isAdmin ? 'users' : 'profile')}><Settings2 size={22} /><span>{user.isAdmin ? 'Accessi' : 'Account'}</span></button>
    </nav>
    {createOpen && <CreateGroup onClose={() => setCreateOpen(false)} onCreated={(id) => { setCreateOpen(false); setRefresh((n) => n + 1); go(`group/${id}`) }} />}
    {notice && <Notice message={notice} onClose={() => setNotice('')} />}
  </div>
}

function Dashboard({ user, groups, onCreate, onOpen }: { user: User; groups: Group[]; onCreate: () => void; onOpen: (id: string) => void }) {
  const canCreate = user.isAdmin || user.canCreateGroups
  return <><div className="welcome-banner"><div><span className="eyebrow">IL TUO SPAZIO CONDIVISO</span><h1>Ciao, {user.name.split(' ')[0]} <span className="wave">✳</span></h1><p>Le spese insieme, finalmente in ordine. Tutto quello che ti serve è qui.</p>{canCreate && <Button onClick={onCreate}><Plus size={18} /> Nuovo gruppo</Button>}</div><div className="welcome-art"><div className="art-circle art-a" /><div className="art-circle art-b" /><div className="art-card art-card-one"><ArrowUpRight size={18} /><span>Spese condivise</span><strong>semplici.</strong></div><div className="art-card art-card-two"><div className="avatar-stack"><Avatar name="Anna" size="sm" /><Avatar name="Marco" size="sm" /><Avatar name="Luca" size="sm" /></div><span>insieme è meglio</span></div></div></div>
    <div className="dashboard-stats"><div className="stat-card"><span className="stat-icon mint"><UsersRound size={22} /></span><div><small>GRUPPI ATTIVI</small><strong>{groups.length}</strong><span>Le tue persone, in un posto</span></div></div><div className="stat-card"><span className="stat-icon peach"><Wallet size={22} /></span><div><small>SPESE REGISTRATE</small><strong>{groups.reduce((sum, group) => sum + (group.expenseCount || 0), 0)}</strong><span>Tutti i conti sotto controllo</span></div></div><div className="stat-card"><span className="stat-icon lavender"><Shield size={22} /></span><div><small>IL TUO ACCESSO</small><strong className="stat-word">{user.isAdmin ? 'Admin' : canCreate ? 'Creatore' : 'Membro'}</strong><span>Permessi su misura per te</span></div></div></div>
    <SectionTitle eyebrow="I TUOI GRUPPI" title="Insieme si conta meglio" detail="Apri un gruppo per vedere spese, saldi e attività." action={canCreate && <Button variant="secondary" onClick={onCreate}><Plus size={17} /> Crea gruppo</Button>} />
    {groups.length === 0 ? <Empty icon={<UsersRound size={30} />} title={canCreate ? 'Il tuo primo gruppo ti aspetta' : 'Nessun gruppo ancora'} detail={canCreate ? 'Crea un gruppo e invita le persone con cui condividi le spese.' : 'Chiedi a un amministratore un invito per entrare in un gruppo.'} action={canCreate && <Button onClick={onCreate}>Crea il primo gruppo <ChevronRight size={17} /></Button>} /> : <div className="group-grid">{groups.map((group, index) => <button className="group-card" key={group.id} onClick={() => onOpen(group.id)}><span className={`group-card-icon tone-${index % 5}`}>{group.name.slice(0, 1).toUpperCase()}</span><span className="group-card-body"><strong>{group.name}</strong><small>{group.participantCount} partecipanti · {group.expenseCount} spese</small></span><span className="group-card-bottom"><span>{group.currency}</span><span>Apri gruppo <ChevronRight size={16} /></span></span></button>)}</div>}
    <div className="help-strip"><CircleHelp size={24} /><div><strong>Come funziona?</strong><p>Aggiungi le spese, scegli come dividerle e guarda chi deve cosa. I permessi proteggono ogni gruppo.</p></div><ArrowDownRight size={20} /></div>
  </>
}

function CreateGroup({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState(''), [currency, setCurrency] = useState('EUR'), [people, setPeople] = useState(''), [information, setInformation] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(''); try { const result = await post<{ id: string }>('/groups', { name, currency, information, participants: people.split(',').map((part) => ({ name: part.trim() })).filter((part) => part.name) }); onCreated(result.id) } catch (err) { setError((err as Error).message) } finally { setBusy(false) } }
  return <Modal title="Crea un gruppo" subtitle="Un posto per le vostre spese condivise." onClose={onClose}><form onSubmit={submit} className="form-stack"><Field label="Nome del gruppo"><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="es. Weekend a Lisbona" required minLength={2} /></Field><div className="form-row"><Field label="Valuta"><select value={currency} onChange={(e) => setCurrency(e.target.value)}><option value="EUR">EUR · Euro</option><option value="USD">USD · Dollaro</option><option value="GBP">GBP · Sterlina</option><option value="CHF">CHF · Franco</option><option value="JPY">JPY · Yen</option></select></Field></div><Field label="Partecipanti" hint="Scrivi i nomi separati da virgola. Potrai collegarli agli account più tardi."><input value={people} onChange={(e) => setPeople(e.target.value)} placeholder="Anna, Marco, Luca" required /></Field><Field label="Descrizione (facoltativa)"><textarea value={information} onChange={(e) => setInformation(e.target.value)} rows={3} placeholder="Di cosa parla questo gruppo?" /></Field>{error && <div className="form-error" role="alert">{error}</div>}<div className="modal-actions"><Button variant="secondary" onClick={onClose}>Annulla</Button><Button type="submit" disabled={busy}>{busy ? 'Creo…' : 'Crea gruppo'} <ArrowUpRight size={17} /></Button></div></form></Modal>
}

function InviteAccept({ token, onAccepted, onCancel }: { token: string; onAccepted: (id: string) => void; onCancel: () => void }) {
  const [groupName, setGroupName] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => { api<{ groupName: string }>(`/invites/${token}`).then((result) => setGroupName(result.groupName)).catch((err) => setError(err.message)) }, [token])
  async function accept() { setBusy(true); try { const result = await post<{ groupId: string }>(`/invites/${token}/accept`, {}); onAccepted(result.groupId) } catch (err) { setError((err as Error).message) } finally { setBusy(false) } }
  return <div className="center-page"><div className="invite-card"><span className="stat-icon mint"><UsersRound size={30} /></span><span className="eyebrow">SEI STATO INVITATO</span><h1>Entra in {groupName || 'questo gruppo'}</h1><p>Potrai vedere le spese e collaborare secondo i permessi assegnati dal gruppo.</p>{error && <div className="form-error">{error}</div>}<Button onClick={accept} disabled={busy}>{busy ? 'Entro…' : 'Accetta invito'} <ChevronRight size={17} /></Button><button className="link-plain" onClick={onCancel}>Torna alla panoramica</button></div></div>
}

function ProfilePage({ user, onNotice, onSignOut }: { user: User; onNotice: (message: string) => void; onSignOut: () => void }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  async function changePassword(event: FormEvent) {
    event.preventDefault()
    if (newPassword !== confirmPassword) return onNotice('Le nuove password non coincidono.')
    setBusy(true)
    try {
      await patch('/me/password', { currentPassword, newPassword })
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('')
      onNotice('Password aggiornata. Le altre sessioni sono state disconnesse.')
    } catch (error) { onNotice((error as Error).message) }
    finally { setBusy(false) }
  }
  return <><div className="page-heading"><div><span className="eyebrow">IL TUO ACCOUNT</span><h1>Impostazioni personali</h1><p>Proteggi l’accesso alle tue spese condivise.</p></div></div>
    <div className="profile-grid"><div className="panel profile-card"><Avatar name={user.name} size="lg" /><h2>{user.name}</h2><p>@{user.username}</p><span className="count-pill">{user.isAdmin ? 'Amministratore' : 'Membro'}</span><ThemePicker /><Button variant="secondary" onClick={onSignOut}><LogOut size={17} /> Esci dall’account</Button></div>
      <div className="panel profile-password"><h2>Cambia password</h2><p>Usa almeno 12 caratteri. La modifica disconnette gli altri dispositivi.</p><form className="form-stack" onSubmit={changePassword}><Field label="Password attuale"><input type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></Field><Field label="Nuova password"><input type="password" autoComplete="new-password" minLength={12} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></Field><Field label="Conferma nuova password"><input type="password" autoComplete="new-password" minLength={12} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></Field><Button type="submit" disabled={busy}>{busy ? 'Aggiorno…' : 'Aggiorna password'}</Button></form></div></div>
  </>
}

function UsersPage({ onNotice }: { onNotice: (message: string) => void }) {
  const [users, setUsers] = useState<User[]>([]), [deletedGroups, setDeletedGroups] = useState<{ id: string; name: string; deletedAt: string }[]>([]), [open, setOpen] = useState(false), [refresh, setRefresh] = useState(0)
  const [username, setUsername] = useState(''), [name, setName] = useState(''), [password, setPassword] = useState(''), [allowCreate, setAllowCreate] = useState(false)
  const [resetTarget, setResetTarget] = useState<User | null>(null), [resetPassword, setResetPassword] = useState('')
  useEffect(() => { api<{ users: User[] }>('/users').then((result) => setUsers(result.users)).catch((err) => onNotice(err.message)); api<{ groups: { id: string; name: string; deletedAt: string }[] }>('/deleted-groups').then((result) => setDeletedGroups(result.groups)).catch((err) => onNotice(err.message)) }, [refresh, onNotice])
  async function add(event: FormEvent) { event.preventDefault(); try { await post('/users', { username, name, password, canCreateGroups: allowCreate }); setOpen(false); setRefresh((n) => n + 1); setUsername(''); setName(''); setPassword('') } catch (err) { onNotice((err as Error).message) } }
  async function toggle(user: User, field: 'canCreateGroups' | 'disabled') { try { await api(`/users/${user.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [field]: !user[field] }) }); setRefresh((n) => n + 1) } catch (err) { onNotice((err as Error).message) } }
  async function reset(event: FormEvent) { event.preventDefault(); if (!resetTarget) return; try { await patch(`/users/${resetTarget.id}`, { password: resetPassword }); setResetTarget(null); setResetPassword(''); onNotice('Password aggiornata. Le sessioni precedenti sono state chiuse.') } catch (err) { onNotice((err as Error).message) } }
  return <><div className="page-heading"><div><span className="eyebrow">AMMINISTRAZIONE</span><h1>Utenti e accessi</h1><p>Decidi chi può entrare e chi può creare nuovi gruppi.</p></div><Button onClick={() => setOpen(true)}><Plus size={18} /> Nuovo utente</Button></div><div className="panel"><div className="panel-header"><h2>Persone nel tuo spazio</h2><span className="count-pill">{users.length} utenti</span></div><div className="user-list">{users.map((item) => <div className="user-row" key={item.id}><Avatar name={item.name} /><div className="user-info"><strong>{item.name}</strong><small>@{item.username} · {item.isAdmin ? 'Amministratore' : 'Membro'}</small></div><button className="icon-button" aria-label={`Reimposta password di ${item.name}`} onClick={() => setResetTarget(item)}><KeyRound size={17} /></button><label className="toggle-label"><input type="checkbox" checked={Boolean(item.canCreateGroups)} onChange={() => toggle(item, 'canCreateGroups')} disabled={item.isAdmin} /> Crea gruppi</label><label className="toggle-label"><input type="checkbox" checked={!item.disabled} onChange={() => toggle(item, 'disabled')} /> Attivo</label></div>)}</div></div><div className="info-card"><Shield size={22} /><div><strong>Accessi ai gruppi</strong><p>Apri la sezione “Permessi” di un gruppo per assegnare le azioni consentite a ogni persona.</p></div></div>{deletedGroups.length > 0 && <div className="panel deleted-groups"><div className="panel-header"><h2>Gruppi da ripristinare</h2></div>{deletedGroups.map((group) => <div className="person-row" key={group.id}><div><strong>{group.name}</strong><small>Eliminato il {new Date(group.deletedAt).toLocaleDateString('it-IT')}</small></div><Button variant="secondary" onClick={async () => { try { await post(`/groups/${group.id}/restore`, {}); setRefresh((n) => n + 1) } catch (err) { onNotice((err as Error).message) } }}>Ripristina</Button></div>)}</div>}{resetTarget && <Modal title={`Password di ${resetTarget.name}`} subtitle="Imposta una password temporanea di almeno 12 caratteri. Le sessioni attive saranno chiuse." onClose={() => setResetTarget(null)}><form className="form-stack" onSubmit={reset}><Field label="Nuova password"><input type="password" autoComplete="new-password" minLength={12} required value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} /></Field><div className="modal-actions"><Button variant="secondary" onClick={() => setResetTarget(null)}>Annulla</Button><Button type="submit">Reimposta password</Button></div></form></Modal>}{open && <Modal title="Nuovo utente" subtitle="Crea un account personale senza email o servizi esterni." onClose={() => setOpen(false)}><form className="form-stack" onSubmit={add}><Field label="Nome"><input required value={name} onChange={(e) => setName(e.target.value)} /></Field><Field label="Nome utente"><input required value={username} onChange={(e) => setUsername(e.target.value)} /></Field><Field label="Password temporanea" hint="Almeno 12 caratteri. Condividila con la persona in modo sicuro."><input type="password" minLength={12} required value={password} onChange={(e) => setPassword(e.target.value)} /></Field><label className="check-row"><input type="checkbox" checked={allowCreate} onChange={(e) => setAllowCreate(e.target.checked)} /> Può creare gruppi propri</label><div className="modal-actions"><Button variant="secondary" onClick={() => setOpen(false)}>Annulla</Button><Button type="submit">Crea utente</Button></div></form></Modal>}</>
}
