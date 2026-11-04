import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { chromium } from '@playwright/test'

const url = process.env.PROD_URL || 'http://127.0.0.1:13000'
const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const browser = await chromium.launch({ headless: true, ...(existsSync(macChrome) ? { executablePath: macChrome } : {}) })
try {
  const page = await browser.newPage()
  const external = []
  page.on('request', (request) => { if (!request.url().startsWith(url)) external.push(request.url()) })
  await page.goto(url)
  const manifest = await page.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]')
    return link && (await fetch(link.href)).json()
  })
  assert.equal(manifest.display, 'standalone')
  assert.equal(manifest.lang, 'it')
  const serviceWorker = await page.evaluate(async () => {
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Service worker non attivo')), 10000)),
    ])
    return registration.active?.scriptURL
  })
  assert.ok(serviceWorker?.endsWith('/sw.js'))
  assert.deepEqual(external, [], `Richieste esterne inattese: ${external.join(', ')}`)
  console.log('Production PWA passed: manifest, service worker and local assets')
} finally { await browser.close() }
