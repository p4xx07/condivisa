import { HttpError } from './auth.mjs'

export const currencyDigits = (currency) => {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits
  } catch {
    throw new HttpError(400, 'Valuta non valida.')
  }
}

export function allocate(amountMinor, mode, shares) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || amountMinor > 1_000_000_000)
    throw new HttpError(400, 'Importo non valido.')
  if (!Array.isArray(shares) || shares.length === 0 || shares.length > 100)
    throw new HttpError(400, 'Seleziona almeno un partecipante.')
  const ids = shares.map((row) => row.participantId)
  if (new Set(ids).size !== ids.length || ids.some((id) => typeof id !== 'string'))
    throw new HttpError(400, 'Partecipanti duplicati o non validi.')
  if (mode === 'EXACT') {
    const values = shares.map((row) => Number(row.value))
    if (values.some((value) => !Number.isSafeInteger(value) || value < 0) || values.reduce((a, b) => a + b, 0) !== amountMinor)
      throw new HttpError(400, 'Le quote esatte devono sommare l’importo totale.')
    return shares.map((row, index) => ({ participantId: row.participantId, amountMinor: values[index], weight: values[index] }))
  }
  if (!['EQUAL', 'SHARES', 'PERCENT'].includes(mode))
    throw new HttpError(400, 'Metodo di divisione non valido.')
  const weights = shares.map((row) => mode === 'EQUAL' ? 1 : Number(row.value))
  if (weights.some((value) => !Number.isFinite(value) || value <= 0))
    throw new HttpError(400, 'Le quote devono essere positive.')
  const total = weights.reduce((a, b) => a + b, 0)
  if (mode === 'PERCENT' && Math.abs(total - 100) > 0.001)
    throw new HttpError(400, 'Le percentuali devono sommare 100.')
  const raw = weights.map((weight) => amountMinor * weight / total)
  const floor = raw.map(Math.floor)
  let remainder = amountMinor - floor.reduce((a, b) => a + b, 0)
  const order = shares.map((row, index) => index).sort((a, b) => {
    const fraction = (raw[b] - floor[b]) - (raw[a] - floor[a])
    return fraction || shares[a].participantId.localeCompare(shares[b].participantId)
  })
  for (const index of order) {
    if (remainder-- <= 0) break
    floor[index]++
  }
  return shares.map((row, index) => ({ participantId: row.participantId, amountMinor: floor[index], weight: weights[index] }))
}

export function calculateBalances(participants, expenses, simplify = true) {
  const balances = new Map(participants.map((p) => [p.id, 0]))
  const direct = new Map()
  for (const expense of expenses) {
    balances.set(expense.payer_id, (balances.get(expense.payer_id) ?? 0) + expense.amount_minor)
    for (const share of expense.shares) {
      balances.set(share.participant_id, (balances.get(share.participant_id) ?? 0) - share.amount_minor)
      if (share.participant_id !== expense.payer_id && share.amount_minor > 0) {
        const key = `${share.participant_id}:${expense.payer_id}`
        direct.set(key, (direct.get(key) ?? 0) + share.amount_minor)
      }
    }
  }
  const list = participants.map((p) => ({ ...p, balanceMinor: balances.get(p.id) ?? 0 }))
  const directSettlements = []
  const ids = participants.map((p) => p.id)
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const difference = (direct.get(`${ids[i]}:${ids[j]}`) ?? 0) - (direct.get(`${ids[j]}:${ids[i]}`) ?? 0)
    if (difference) directSettlements.push({ from: difference > 0 ? ids[i] : ids[j], to: difference > 0 ? ids[j] : ids[i], amountMinor: Math.abs(difference) })
  }
  const debtors = list.filter((p) => p.balanceMinor < 0).map((p) => ({ ...p, remaining: -p.balanceMinor })).sort((a, b) => b.remaining - a.remaining)
  const creditors = list.filter((p) => p.balanceMinor > 0).map((p) => ({ ...p, remaining: p.balanceMinor })).sort((a, b) => b.remaining - a.remaining)
  const settlements = []
  let d = 0, c = 0
  while (d < debtors.length && c < creditors.length) {
    const amountMinor = Math.min(debtors[d].remaining, creditors[c].remaining)
    settlements.push({ from: debtors[d].id, to: creditors[c].id, amountMinor })
    debtors[d].remaining -= amountMinor
    creditors[c].remaining -= amountMinor
    if (!debtors[d].remaining) d++
    if (!creditors[c].remaining) c++
  }
  return { balances: list, settlements: simplify && settlements.length <= directSettlements.length ? settlements : directSettlements }
}

export function nextRecurringDate(date, interval, anchorDay) {
  const [year, month, day] = date.split('-').map(Number)
  const current = new Date(Date.UTC(year, month - 1, day))
  if (interval === 'DAILY') current.setUTCDate(current.getUTCDate() + 1)
  else if (interval === 'WEEKLY') current.setUTCDate(current.getUTCDate() + 7)
  else if (interval === 'MONTHLY') {
    const nextMonth = new Date(Date.UTC(year, month, 1))
    const lastDay = new Date(Date.UTC(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth() + 1, 0)).getUTCDate()
    nextMonth.setUTCDate(Math.min(anchorDay || day, lastDay))
    return nextMonth.toISOString().slice(0, 10)
  } else throw new HttpError(400, 'Ricorrenza non valida.')
  return current.toISOString().slice(0, 10)
}
