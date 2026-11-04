export type User = { id: string; username: string; name: string; isAdmin: boolean; canCreateGroups: boolean; disabled?: boolean; createdAt?: string }
export type Group = { id: string; name: string; currency: string; information: string; ownerId: string; createdAt: string; participantCount?: number; expenseCount?: number; canAddExpense?: boolean }
export type Participant = { id: string; name: string; userId?: string | null }
export type Permissions = { canView: boolean; canAddExpense: boolean; canEditOwn: boolean; canEditAll: boolean; canManageGroup: boolean; canManageMembers: boolean; canExport: boolean; canDeleteGroup: boolean }
export type Expense = { id: string; title: string; amountMinor: number; originalAmountMinor?: number | null; originalCurrency?: string | null; exchangeRate?: number | null; date: string; category: string; payerId: string; splitMode: 'EQUAL' | 'SHARES' | 'PERCENT' | 'EXACT'; notes: string; isReimbursement: boolean; createdBy: string | null; creatorName: string | null; recurrenceId: string | null; shares: { participantId: string; amountMinor: number; weight: number }[]; documents: { id: string; name: string; mimeType: string; size: number }[] }
export type Balance = { id: string; name: string; balanceMinor: number }
export type Settlement = { from: string; to: string; amountMinor: number }
export type Member = User & Permissions

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      ...options, credentials: 'same-origin',
      headers: { ...(options.body && typeof options.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    })
  } catch { throw new Error('Connessione non disponibile. Riprova quando sei online.') }
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.error || `Errore ${response.status}`)
  }
  return response.json() as Promise<T>
}
export const post = <T>(path: string, body: unknown) => api<T>(path, { method: 'POST', body: JSON.stringify(body) })
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body: JSON.stringify(body) })
export const put = <T>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body: JSON.stringify(body) })
export const remove = <T>(path: string) => api<T>(path, { method: 'DELETE' })

export function money(minor: number, currency: string) {
  const formatter = new Intl.NumberFormat('it-IT', { style: 'currency', currency })
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2
  return formatter.format(minor / 10 ** digits)
}
export function toMinor(value: string, currency: string) {
  const digits = new Intl.NumberFormat('it-IT', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
  return Math.round(Number(value.replace(',', '.')) * 10 ** digits)
}
export function fromMinor(value: number, currency: string) {
  const digits = new Intl.NumberFormat('it-IT', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
  return String(value / 10 ** digits)
}
export const today = () => new Date().toISOString().slice(0, 10)
