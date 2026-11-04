import { useEffect, useState } from 'react'
import { Check, Copy, Link2, Shield, ShieldCheck, Trash2, UserPlus } from 'lucide-react'
import { api, post, put, remove, type Member, type Permissions } from './api'
import { Avatar, Button, Modal, SectionTitle } from './ui'

const fields: { key: keyof Permissions; label: string; detail: string }[] = [
  { key: 'canView', label: 'Vedere il gruppo', detail: 'Leggere spese, saldi e statistiche' },
  { key: 'canAddExpense', label: 'Aggiungere spese', detail: 'Registrare nuove spese e rimborsi' },
  { key: 'canEditOwn', label: 'Modificare le proprie spese', detail: 'Solo quelle inserite dal proprio account' },
  { key: 'canEditAll', label: 'Modificare tutte le spese', detail: 'Anche quelle degli altri membri' },
  { key: 'canManageGroup', label: 'Gestire il gruppo', detail: 'Impostazioni e partecipanti' },
  { key: 'canManageMembers', label: 'Gestire i permessi', detail: 'Invitare persone e assegnare accessi' },
  { key: 'canExport', label: 'Esportare i dati', detail: 'Scaricare CSV e JSON' },
  { key: 'canDeleteGroup', label: 'Eliminare il gruppo', detail: 'Ripristinabile da un amministratore' },
]
const presets: Record<string, Permissions> = {
  lettore: { canView: true, canAddExpense: false, canEditOwn: false, canEditAll: false, canManageGroup: false, canManageMembers: false, canExport: false, canDeleteGroup: false },
  collaboratore: { canView: true, canAddExpense: true, canEditOwn: true, canEditAll: false, canManageGroup: false, canManageMembers: false, canExport: false, canDeleteGroup: false },
  gestore: { canView: true, canAddExpense: true, canEditOwn: true, canEditAll: true, canManageGroup: true, canManageMembers: true, canExport: true, canDeleteGroup: true },
}
const permissionOnly = (source: Member): Permissions => Object.fromEntries(fields.map(({ key }) => [key, Boolean(source[key])])) as Permissions

export function PermissionsPanel({ groupId, onNotice }: { groupId: string; onNotice: (message: string) => void }) {
  const [members, setMembers] = useState<Member[]>([])
  const [ownerId, setOwnerId] = useState('')
  const [editing, setEditing] = useState<Member | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => { api<{ members: Member[]; ownerId: string }>(`/groups/${groupId}/members`).then((result) => { setMembers(result.members); setOwnerId(result.ownerId) }).catch((err) => onNotice(err.message)) }, [groupId, refresh, onNotice])
  return <><SectionTitle eyebrow="CHI PUÒ FARE COSA" title="Permessi del gruppo" detail="Ogni persona ha un accesso preciso. Puoi modificarlo in qualsiasi momento." action={<Button onClick={() => setInviteOpen(true)}><UserPlus size={17} /> Invita persona</Button>} /><div className="permission-intro"><ShieldCheck size={24} /><div><strong>Il proprietario ha sempre accesso completo</strong><p>I membri invitati possono solo eseguire le azioni che assegni qui. Le modifiche sono effettive subito.</p></div></div><div className="panel member-panel"><div className="panel-header"><h3>Membri del gruppo</h3><span className="count-pill">{members.length + 1} persone</span></div>{members.map((member) => <div className="member-row" key={member.id}><Avatar name={member.name} /><div><strong>{member.name}</strong><small>@{member.username} · {member.canManageMembers ? 'Gestore' : member.canAddExpense ? 'Collaboratore' : 'Lettore'}</small></div><button className="mini-button" onClick={() => setEditing(member)}>Modifica permessi</button><button className="icon-button" aria-label={`Rimuovi ${member.name}`} onClick={async () => { if (!confirm(`Rimuovere ${member.name} dal gruppo?`)) return; try { await remove(`/groups/${groupId}/members/${member.id}`); setRefresh((n) => n + 1) } catch (err) { onNotice((err as Error).message) } }}><Trash2 size={17} /></button></div>)}{members.length === 0 && <div className="member-empty"><Shield size={26} /><strong>Solo il proprietario per ora</strong><p>Invita qualcuno per iniziare a condividere il gruppo.</p></div>}</div>
    {editing && <PermissionEditor member={editing} groupId={groupId} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setRefresh((n) => n + 1) }} onNotice={onNotice} />}
    {inviteOpen && <InviteModal groupId={groupId} onClose={() => setInviteOpen(false)} onNotice={onNotice} />}
    <span className="sr-only">ID proprietario: {ownerId}</span>
  </>
}

function PermissionEditor({ member, groupId, onClose, onSaved, onNotice }: { member: Member; groupId: string; onClose: () => void; onSaved: () => void; onNotice: (message: string) => void }) {
  const [value, setValue] = useState<Permissions>(() => permissionOnly(member))
  const [busy, setBusy] = useState(false)
  async function save() { setBusy(true); try { await put(`/groups/${groupId}/members/${member.id}`, value); onSaved() } catch (err) { onNotice((err as Error).message) } finally { setBusy(false) } }
  return <Modal title={`Permessi di ${member.name}`} subtitle="Le nuove regole si applicano subito a tutti i dispositivi." onClose={onClose}><div className="preset-row">{Object.entries(presets).map(([name, permissions]) => <button key={name} className={fields.every(({ key }) => value[key] === permissions[key]) ? 'selected' : ''} onClick={() => setValue(permissions)}>{name}</button>)}</div><div className="permission-fields">{fields.map(({ key, label, detail }) => <label key={key} className="permission-field"><span><strong>{label}</strong><small>{detail}</small></span><input type="checkbox" checked={value[key]} onChange={(event) => setValue({ ...value, [key]: event.target.checked })} /></label>)}</div><div className="modal-actions"><Button variant="secondary" onClick={onClose}>Annulla</Button><Button disabled={busy} onClick={save}><Check size={17} /> {busy ? 'Salvo…' : 'Salva permessi'}</Button></div></Modal>
}

function InviteModal({ groupId, onClose, onNotice }: { groupId: string; onClose: () => void; onNotice: (message: string) => void }) {
  const [role, setRole] = useState('collaboratore'), [url, setUrl] = useState(''), [busy, setBusy] = useState(false), [copied, setCopied] = useState(false)
  async function create() { setBusy(true); try { const result = await post<{ url: string }>(`/groups/${groupId}/invites`, { permissions: presets[role] }); setUrl(result.url) } catch (err) { onNotice((err as Error).message) } finally { setBusy(false) } }
  async function copy() { await navigator.clipboard.writeText(url); setCopied(true) }
  return <Modal title="Invita una persona" subtitle="Un link personale, valido 7 giorni e utilizzabile una volta." onClose={onClose}><div className="invite-content"><span className="invite-icon"><Link2 size={24} /></span><p>La persona potrà creare un account o accedere e unirsi al gruppo. Il link non concede accesso ad altri gruppi.</p><label className="field"><span>Permessi iniziali</span><select value={role} onChange={(event) => setRole(event.target.value)} disabled={Boolean(url)}><option value="lettore">Lettore · può vedere</option><option value="collaboratore">Collaboratore · aggiunge le proprie spese</option><option value="gestore">Gestore · amministra il gruppo</option></select></label>{url ? <div className="invite-link"><input readOnly value={url} aria-label="Link di invito" /><Button onClick={copy}>{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? 'Copiato' : 'Copia'}</Button></div> : <Button disabled={busy} onClick={create}>{busy ? 'Creo…' : 'Genera link di invito'}</Button>}</div></Modal>
}
