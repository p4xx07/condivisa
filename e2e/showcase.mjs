import { chromium, request } from '@playwright/test'
import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const baseURL = process.env.SHOWCASE_URL || 'http://127.0.0.1:13001'
const setupKey = process.env.SHOWCASE_SETUP_KEY
if (!setupKey) throw new Error('Imposta SHOWCASE_SETUP_KEY e avvia un container Condivisa con un database vuoto.')

const output = resolve('docs/screenshots')
mkdirSync(output, { recursive: true })
const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const browser = await chromium.launch({ headless: true, ...(existsSync(macChrome) ? { executablePath: macChrome } : {}) })

try {
  const desktop = await browser.newContext({ baseURL, viewport: { width: 1365, height: 930 }, deviceScaleFactor: 1 })
  const page = await desktop.newPage()
  await page.goto(baseURL)
  await page.getByText('Crea il tuo spazio').waitFor()
  await page.getByPlaceholder('Dal tuo stack Docker').fill(setupKey)
  await page.getByPlaceholder('Come vuoi apparire').fill('Giulia Rossi')
  await page.getByPlaceholder('es. enrico').fill('giulia.demo')
  await page.getByPlaceholder('••••••••••••').fill('demo-password-very-long')
  await page.getByRole('button', { name: /Crea amministratore/ }).click()
  await page.getByText('Insieme si conta meglio').waitFor()

  async function api(method, path, data, client = desktop.request) {
    const response = await client.fetch(`/api${path}`, { method, headers: { origin: baseURL }, ...(data === undefined ? {} : { data }) })
    if (!response.ok()) throw new Error(`${method} ${path}: ${response.status()} ${await response.text()}`)
    return response.json()
  }

  const created = await api('POST', '/groups', {
    name: 'Weekend a Lisbona', currency: 'EUR',
    information: 'Quattro amici, un weekend e tutte le spese in ordine.',
    participants: ['Giulia', 'Marco', 'Sofia', 'Luca'].map((name) => ({ name })),
  })
  const groupId = created.id
  const { participants } = await api('GET', `/groups/${groupId}`)
  const person = Object.fromEntries(participants.map((item) => [item.name, item.id]))
  for (const item of [
    { title: 'Cena da Ramiro', amountMinor: 8460, date: '2026-11-01', category: 'Cibo e bevande', payer: 'Giulia' },
    { title: 'Taxi aeroporto', amountMinor: 3200, date: '2026-11-02', category: 'Trasporti', payer: 'Marco' },
    { title: 'Tram per Belém', amountMinor: 1840, date: '2026-11-03', category: 'Viaggi', payer: 'Sofia' },
  ]) {
    await api('POST', `/groups/${groupId}/expenses`, {
      title: item.title, amountMinor: item.amountMinor, date: item.date, category: item.category,
      payerId: person[item.payer], splitMode: 'EQUAL',
      shares: participants.map((participant) => ({ participantId: participant.id, value: 1 })), notes: '',
    })
  }
  const invite = await api('POST', `/groups/${groupId}/invites`, {})
  const guest = await request.newContext({ baseURL })
  const joined = await api('POST', `/invites/${invite.url.split('/').pop()}/register`, {
    username: 'marco.demo', name: 'Marco Bianchi', password: 'demo-guest-password-long',
  }, guest)
  await guest.dispose()
  await api('PATCH', `/groups/${groupId}/participants/${person.Marco}`, { userId: joined.user.id })

  await page.goto(`${baseURL}/#/home`)
  await page.reload()
  await page.getByText('Insieme si conta meglio').waitFor()
  await page.locator('.group-card').getByText('Weekend a Lisbona').waitFor()
  await page.getByRole('combobox', { name: 'Tema' }).selectOption('light')
  await page.screenshot({ path: `${output}/panoramica-desktop.png` })

  await page.goto(`${baseURL}/#/group/${groupId}`)
  await page.getByText('Le spese del gruppo').waitFor()
  await page.getByText('Cena da Ramiro').waitFor()
  await page.locator('.topbar-trail strong').getByText('Weekend a Lisbona').waitFor()
  await page.screenshot({ path: `${output}/spese-desktop.png` })

  await page.getByRole('tab', { name: 'Permessi' }).click()
  await page.getByText('Permessi del gruppo').waitFor()
  await page.getByText('Marco Bianchi').waitFor()
  await page.screenshot({ path: `${output}/permessi-desktop.png` })
  await page.getByRole('button', { name: 'Modifica permessi' }).click()
  await page.getByRole('dialog', { name: 'Permessi di Marco Bianchi' }).screenshot({ path: `${output}/editor-permessi.png` })

  const mobile = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true })
  const phone = await mobile.newPage()
  await phone.goto(baseURL)
  await phone.getByPlaceholder('es. enrico').fill('giulia.demo')
  await phone.getByPlaceholder('••••••••••••').fill('demo-password-very-long')
  await phone.getByRole('button', { name: /Accedi/ }).click()
  await phone.getByText('Insieme si conta meglio').waitFor()
  await phone.locator('.group-card').getByText('Weekend a Lisbona').waitFor()
  await phone.getByRole('combobox', { name: 'Tema' }).selectOption('amoled')
  await phone.waitForTimeout(250)
  await phone.screenshot({ path: `${output}/panoramica-amoled-mobile.png` })

  await phone.goto(`${baseURL}/#/group/${groupId}`)
  await phone.getByText('Le spese del gruppo').waitFor()
  await phone.getByText('Cena da Ramiro').waitFor()
  await phone.locator('.topbar-trail strong').getByText('Weekend a Lisbona').waitFor()
  await phone.screenshot({ path: `${output}/spese-amoled-mobile.png` })
  await phone.locator('.mobile-add').click()
  await phone.getByRole('dialog', { name: 'Nuova spesa' }).screenshot({ path: `${output}/nuova-spesa-amoled-mobile.png` })

  console.log(`Screenshot dimostrativi salvati in ${output}`)
} finally {
  await browser.close()
}
