import { useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, KeyRound, LockKeyhole, ShieldCheck, Sparkles, UsersRound } from 'lucide-react'
import { api, post, type User } from './api'
import { Button, Field } from './ui'
import { ThemePicker } from './ThemePicker'

export function Auth({ needsSetup, inviteToken, onAuthenticated }: { needsSetup: boolean; inviteToken?: string; onAuthenticated: (user: User, groupId?: string) => void }) {
  const [username, setUsername] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [setupKey, setSetupKey] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [register, setRegister] = useState(Boolean(inviteToken))
  useEffect(() => {
    if (!inviteToken) return
    api<{ groupName: string }>(`/invites/${inviteToken}`).then((data) => setInviteName(data.groupName)).catch((err) => setError(err.message))
  }, [inviteToken])
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const result = needsSetup
        ? await post<{ user: User; groupId?: string }>('/setup', { setupKey, username, name, password })
        : inviteToken && register
          ? await post<{ user: User; groupId?: string }>(`/invites/${inviteToken}/register`, { username, name, password })
          : await post<{ user: User; groupId?: string }>('/login', { username, password })
      onAuthenticated(result.user, result.groupId)
    } catch (err) { setError((err as Error).message) }
    finally { setBusy(false) }
  }
  return <div className="auth-layout">
    <div className="auth-visual">
      <div className="brand brand-light"><span className="brand-mark">c</span><span>condivisa<span className="brand-dot">.</span></span></div>
      <div className="auth-illustration"><div className="floating-card card-one"><span>Weekend a Lisbona</span><strong>€ 327,50</strong><small>4 amici · 8 spese</small></div><div className="floating-orb"><UsersRound size={45} /></div><div className="floating-card card-two"><span>Conti in ordine</span><strong>✓ Tutto torna</strong></div></div>
      <div className="auth-copy"><span className="pill pill-light"><Sparkles size={14} /> Spese condivise, senza complicazioni</span><h1>Più tempo insieme.<br /><em>Meno conti da fare.</em></h1><p>Organizza le spese del gruppo, controlla i saldi e decidi chi può fare cosa.</p><div className="auth-benefits"><span><ShieldCheck size={18} /> I tuoi dati, sul tuo server</span><span><UsersRound size={18} /> Permessi per ogni persona</span></div></div>
    </div>
    <div className="auth-panel"><div className="auth-card"><ThemePicker /><span className="auth-icon"><LockKeyhole size={24} /></span><span className="eyebrow">{needsSetup ? 'PRIMA CONFIGURAZIONE' : inviteToken ? 'INVITO AL GRUPPO' : 'BENTORNATO'}</span><h2>{needsSetup ? 'Crea il tuo spazio' : inviteToken && register ? `Entra in ${inviteName || 'questo gruppo'}` : 'Accedi al tuo spazio'}</h2><p>{needsSetup ? 'Configura l’account amministratore. Servirà per creare gruppi e gestire gli accessi.' : inviteToken ? 'Crea un account personale o accedi se ne hai già uno.' : 'I tuoi gruppi e i tuoi saldi ti aspettano.'}</p>
      <form onSubmit={submit} className="form-stack">
        {needsSetup && <Field label="Chiave iniziale"><div className="input-icon"><KeyRound size={18} /><input value={setupKey} onChange={(e) => setSetupKey(e.target.value)} required autoComplete="off" placeholder="Dal tuo stack Docker" /></div></Field>}
        {(needsSetup || (inviteToken && register)) && <Field label="Il tuo nome"><input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Come vuoi apparire" /></Field>}
        <Field label="Nome utente"><input value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="username" placeholder="es. enrico" /></Field>
        <Field label="Password" hint={needsSetup || register ? 'Almeno 12 caratteri' : undefined}><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete={needsSetup || register ? 'new-password' : 'current-password'} placeholder="••••••••••••" minLength={needsSetup || register ? 12 : undefined} /></Field>
        {error && <div className="form-error" role="alert">{error}</div>}
        <Button type="submit" disabled={busy} className="full">{busy ? 'Un momento…' : needsSetup ? 'Crea amministratore' : inviteToken && register ? 'Crea account ed entra' : 'Accedi'} <ArrowRight size={18} /></Button>
      </form>
      {inviteToken && <button className="auth-switch" onClick={() => { setRegister(!register); setError('') }}>{register ? 'Hai già un account? Accedi' : 'Non hai un account? Registrati con l’invito'}</button>}
      <p className="auth-footnote">Installabile su iPhone e Android direttamente dal browser.</p>
    </div></div>
  </div>
}
