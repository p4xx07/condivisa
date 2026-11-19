import { useEffect, useState, type FormEvent } from 'react'
import { api, post } from './api'
import { Button, Field, Modal } from './ui'

type Categories = { predefined: string[]; custom: string[] }

export function CategoryManager({ groupId, onClose, onChanged }: { groupId: string; onClose: () => void; onChanged: () => void }) {
  const [categories, setCategories] = useState<Categories | null>(null)
  const [name, setName] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    api<Categories>(`/groups/${groupId}/categories`).then(setCategories).catch((err) => setError((err as Error).message))
  }, [groupId])
  async function add(event: FormEvent) {
    event.preventDefault(); setError(''); setBusy(true)
    try {
      const result = await post<{ name: string }>(`/groups/${groupId}/categories`, { name })
      setCategories((current) => current && { ...current, custom: [...current.custom, result.name].sort((a, b) => a.localeCompare(b, 'it')) })
      setName('')
      onChanged()
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }
  async function merge() {
    if (!from || !to || from === to) return
    setError(''); setBusy(true)
    try {
      await post(`/groups/${groupId}/categories/merge`, { from, to })
      setCategories((current) => current && { ...current, custom: current.custom.filter((item) => item !== from) })
      setFrom(''); setTo('')
      onChanged()
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }
  const options = [...(categories?.predefined || []), ...(categories?.custom || [])]
  return <Modal title="Categorie del gruppo" subtitle="Scegli categorie coerenti per leggere meglio le statistiche." onClose={onClose}>
    <div className="category-manager">
      <div className="subsection"><h3>Predefinite</h3><div className="category-chips">{categories?.predefined.map((item) => <span key={item}>{item}</span>)}</div></div>
      <form className="subsection category-manager-form" onSubmit={add}><h3>Aggiungi una categoria</h3><p>Le categorie aggiunte sono disponibili a tutti nel gruppo.</p><div className="category-add-form"><input aria-label="Nome nuova categoria" placeholder="Es. Animali" maxLength={60} value={name} onChange={(event) => setName(event.target.value)} required /><Button type="submit" disabled={busy}>Aggiungi</Button></div></form>
      <div className="subsection"><h3>Personalizzate</h3>{categories?.custom.length ? <div className="category-chips">{categories.custom.map((item) => <span key={item}>{item}</span>)}</div> : <p>Nessuna categoria aggiunta.</p>}</div>
      <div className="subsection"><h3>Unisci categorie</h3><p>Se hai creato varianti come “Viaggio” e “Viaggi”, sposta le spese e le ricorrenze nella stessa categoria.</p><div className="category-merge-grid"><Field label="Da unire"><select value={from} onChange={(event) => { setFrom(event.target.value); setTo('') }} disabled={!categories?.custom.length}><option value="">Scegli categoria</option>{categories?.custom.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field><Field label="Categoria finale"><select value={to} onChange={(event) => setTo(event.target.value)} disabled={!from}><option value="">Scegli destinazione</option>{options.filter((item) => item !== from).map((item) => <option key={item} value={item}>{item}</option>)}</select></Field></div><Button variant="secondary" onClick={merge} disabled={!from || !to || busy}>Unisci categorie</Button></div>
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="modal-actions"><Button variant="secondary" onClick={onClose}>Chiudi</Button></div>
    </div>
  </Modal>
}
