import { useEffect, useState, type FormEvent } from 'react'
import { Paperclip, Plus, Trash2, Upload } from 'lucide-react'
import { api, fromMinor, money, post, patch, remove, toMinor, today, type Expense, type Group, type Participant, type Settlement } from './api'
import { Button, Field, Modal } from './ui'

type Categories = { predefined: string[]; custom: string[] }
export function ExpenseForm({ group, participants, expense, reimbursement, canEdit, canAddCategory, onClose, onSaved, onNotice }: {
  group: Group; participants: Participant[]; expense?: Expense; reimbursement?: Settlement | null; canEdit: boolean; canAddCategory: boolean; onClose: () => void; onSaved: () => void; onNotice: (message: string) => void
}) {
  const [title, setTitle] = useState(expense?.title || (reimbursement ? 'Rimborso' : ''))
  const [amount, setAmount] = useState(expense ? fromMinor(expense.amountMinor, group.currency) : reimbursement ? fromMinor(reimbursement.amountMinor, group.currency) : '')
  const [date, setDate] = useState(expense?.date || today())
  const [payerId, setPayerId] = useState(expense?.payerId || reimbursement?.from || participants[0]?.id || '')
  const [category, setCategory] = useState(expense?.category || (reimbursement ? 'Rimborso' : ''))
  const [categories, setCategories] = useState<Categories | null>(null)
  const [addingCategory, setAddingCategory] = useState(false)
  const [newCategory, setNewCategory] = useState('')
  const [categoryError, setCategoryError] = useState('')
  const [categoryBusy, setCategoryBusy] = useState(false)
  const [notes, setNotes] = useState(expense?.notes || '')
  const [mode, setMode] = useState<Expense['splitMode']>(expense?.splitMode || 'EQUAL')
  const [selected, setSelected] = useState<string[]>(expense?.shares.map((share) => share.participantId) || (reimbursement ? [reimbursement.to] : participants.map((person) => person.id)))
  const [weights, setWeights] = useState<Record<string, string>>(() => Object.fromEntries(participants.map((person) => {
    const value = expense?.shares.find((share) => share.participantId === person.id)?.weight
    return [person.id, value === undefined ? '1' : expense?.splitMode === 'EXACT' ? fromMinor(value, group.currency) : String(value)]
  })))
  const [originalCurrency, setOriginalCurrency] = useState(expense?.originalCurrency || '')
  const [originalAmount, setOriginalAmount] = useState(expense?.originalAmountMinor && expense.originalCurrency ? fromMinor(expense.originalAmountMinor, expense.originalCurrency) : '')
  const [rate, setRate] = useState(expense?.exchangeRate ? String(expense.exchangeRate) : '')
  const [recurrence, setRecurrence] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => {
    let active = true
    api<Categories>(`/groups/${group.id}/categories`).then((result) => {
      if (!active) return
      setCategories(result)
      setCategory((current) => current || result.predefined[0])
    }).catch((err) => { if (active) setCategoryError((err as Error).message) })
    return () => { active = false }
  }, [group.id])
  const amountMinor = toMinor(amount || '0', group.currency)
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  const changeMode = (next: Expense['splitMode']) => {
    if (next !== mode) {
      const defaultValue = next === 'PERCENT' ? String(100 / Math.max(selected.length, 1)) : next === 'EXACT' ? fromMinor(Math.floor(amountMinor / Math.max(selected.length, 1)), group.currency) : '1'
      setWeights(Object.fromEntries(participants.map((person) => [person.id, defaultValue])))
      setMode(next)
    }
  }
  async function fetchRate() {
    try { const result = await api<{ rate: number }>(`/exchange-rate?from=${encodeURIComponent(originalCurrency)}&to=${group.currency}&date=${date}`); setRate(String(result.rate)); if (originalAmount) setAmount(String(Number(originalAmount.replace(',', '.')) * result.rate)) }
    catch (err) { onNotice((err as Error).message) }
  }
  async function uploadFile(id: string) {
    if (!file) return
    const response = await fetch(`/api/groups/${group.id}/expenses/${id}/documents`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) }, body: file })
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'Caricamento non riuscito.')
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setError('')
    if (!categories && !reimbursement) return setError('Attendi il caricamento delle categorie.')
    if (!selected.length) return setError('Seleziona almeno un partecipante.')
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) return setError('Inserisci un importo valido.')
    const shares = selected.map((participantId) => ({ participantId, value: mode === 'EQUAL' ? 1 : mode === 'EXACT' ? toMinor(weights[participantId] || '0', group.currency) : Number((weights[participantId] || '0').replace(',', '.')) }))
    const body = { title, amountMinor, date, category, payerId, splitMode: mode, shares, notes, isReimbursement: Boolean(reimbursement || expense?.isReimbursement), recurrence: recurrence || undefined, originalCurrency: originalCurrency || null, originalAmountMinor: originalCurrency && originalAmount ? toMinor(originalAmount, originalCurrency) : null, exchangeRate: rate ? Number(rate.replace(',', '.')) : null }
    setBusy(true)
    try { const result = expense ? await patch<{ ok: boolean }>(`/groups/${group.id}/expenses/${expense.id}`, body) : await post<{ id: string }>(`/groups/${group.id}/expenses`, body); await uploadFile(expense?.id || ('id' in result ? result.id : '')); onSaved() }
    catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }
  async function addCategory() {
    if (categoryBusy) return
    setCategoryError(''); setCategoryBusy(true)
    try {
      const result = await post<{ name: string }>(`/groups/${group.id}/categories`, { name: newCategory })
      setCategories((current) => current && { ...current, custom: [...current.custom, result.name].sort((a, b) => a.localeCompare(b, 'it')) })
      setCategory(result.name)
      setNewCategory('')
      setAddingCategory(false)
    } catch (err) { setCategoryError((err as Error).message) } finally { setCategoryBusy(false) }
  }
  async function deleteExpense() { if (!expense || !confirm(`Eliminare “${expense.title}”?`)) return; try { await remove(`/groups/${group.id}/expenses/${expense.id}`); onSaved() } catch (err) { setError((err as Error).message) } }
  return <Modal title={expense ? canEdit ? 'Modifica spesa' : 'Dettaglio spesa' : reimbursement ? 'Registra rimborso' : 'Nuova spesa'} onClose={onClose} wide>
    <form onSubmit={save} className="expense-form"><div className="expense-form-main"><div className="form-grid">
      <Field label="Titolo"><input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} required disabled={!canEdit} placeholder="es. Cena del sabato" /></Field>
      <Field label={`Importo (${group.currency})`}><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required disabled={!canEdit} placeholder="0,00" /></Field>
      <Field label="Data"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} required disabled={!canEdit} /></Field>
      <Field label="Pagato da"><select value={payerId} onChange={(e) => setPayerId(e.target.value)} disabled={!canEdit}>{participants.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></Field>
      <div className="category-field"><Field label="Categoria"><select aria-label="Categoria" value={category} onChange={(e) => setCategory(e.target.value)} disabled={!canEdit || !categories || Boolean(reimbursement)} required>{reimbursement ? <option value="Rimborso">Rimborso</option> : categories ? <><optgroup label="Predefinite">{categories.predefined.map((item) => <option key={item} value={item}>{item}</option>)}</optgroup>{categories.custom.length > 0 && <optgroup label="Del gruppo">{categories.custom.map((item) => <option key={item} value={item}>{item}</option>)}</optgroup>}</> : <option value="">Caricamento…</option>}</select></Field>{canEdit && canAddCategory && !reimbursement && <button type="button" className="category-add-toggle" onClick={() => { setAddingCategory(!addingCategory); setCategoryError('') }}><Plus size={15} /> Aggiungi categoria</button>}{addingCategory && <div className="category-add-form"><input aria-label="Nome nuova categoria" placeholder="Nome della nuova categoria" maxLength={60} value={newCategory} onChange={(e) => setNewCategory(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addCategory() } }} /><Button variant="secondary" onClick={addCategory} disabled={!newCategory.trim() || categoryBusy}>Aggiungi</Button></div>}{categoryError && <small className="category-error" role="alert">{categoryError}</small>}</div>
      <Field label="Ripeti">{expense ? <span>{expense.recurrenceId ? 'Spesa ricorrente' : 'Non ricorrente'}</span> : <select value={recurrence} onChange={(e) => setRecurrence(e.target.value)} disabled={!canEdit}><option value="">Non ripetere</option><option value="DAILY">Ogni giorno</option><option value="WEEKLY">Ogni settimana</option><option value="MONTHLY">Ogni mese</option></select>}</Field>
    </div><Field label="Note"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} disabled={!canEdit} placeholder="Un dettaglio utile per tutti" /></Field>
    <div className="subsection"><h3>Valuta originale <span className="optional">facoltativa</span></h3><p>Registra il cambio se hai pagato in un’altra valuta.</p><div className="form-grid"><Field label="Valuta"><input value={originalCurrency} onChange={(e) => setOriginalCurrency(e.target.value.toUpperCase())} maxLength={3} placeholder="USD" disabled={!canEdit} /></Field><Field label="Importo originale"><input value={originalAmount} onChange={(e) => setOriginalAmount(e.target.value)} inputMode="decimal" disabled={!canEdit} /></Field><Field label="Tasso di cambio"><div className="input-action"><input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" disabled={!canEdit} />{canEdit && <button type="button" onClick={fetchRate}>Trova</button>}</div></Field></div></div>
    <div className="subsection"><h3>Allegati</h3><p>Immagini o PDF fino a 5 MB.</p>{expense?.documents.map((document) => <div className="document-row" key={document.id}><Paperclip size={16} /><a href={`/api/groups/${group.id}/expenses/${expense.id}/documents/${document.id}`}>{document.name}</a>{canEdit && <button type="button" onClick={async () => { try { await remove(`/groups/${group.id}/expenses/${expense.id}/documents/${document.id}`); onSaved() } catch (err) { onNotice((err as Error).message) } }} aria-label={`Rimuovi ${document.name}`}><Trash2 size={16} /></button>}</div>)}{canEdit && <label className="upload-zone"><Upload size={20} />{file ? file.name : 'Scegli un’immagine o PDF'}<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} /></label>}</div></div>
    <aside className="split-panel"><h3>Dividi la spesa</h3><p>Scegli chi partecipa e come suddividere l’importo.</p><div className="split-modes">{([['EQUAL','Uguale'],['SHARES','Quote'],['PERCENT','%'],['EXACT','Importi']] as const).map(([value,label]) => <button type="button" key={value} className={mode === value ? 'active' : ''} onClick={() => changeMode(value)} disabled={!canEdit}>{label}</button>)}</div><div className="share-list">{participants.map((person) => <div className="share-row" key={person.id}><label><input type="checkbox" checked={selected.includes(person.id)} onChange={() => toggle(person.id)} disabled={!canEdit} />{person.name}</label>{selected.includes(person.id) && mode !== 'EQUAL' ? <input aria-label={`Quota di ${person.name}`} value={weights[person.id] || ''} onChange={(e) => setWeights({ ...weights, [person.id]: e.target.value })} inputMode="decimal" disabled={!canEdit} /> : null}</div>)}</div><div className="split-total"><span>Totale da dividere</span><strong>{Number.isFinite(amountMinor) ? money(amountMinor, group.currency) : '—'}</strong></div></aside>
    {error && <div className="form-error expense-error" role="alert">{error}</div>}<div className="expense-form-actions">{expense && canEdit && <Button variant="danger" onClick={deleteExpense}><Trash2 size={17} /> Elimina</Button>}<span /><Button variant="secondary" onClick={onClose}>Chiudi</Button>{canEdit && <Button type="submit" disabled={busy || (!categories && !reimbursement)}>{busy ? 'Salvo…' : expense ? 'Salva modifiche' : 'Aggiungi spesa'}</Button>}</div></form>
  </Modal>
}
