import { useEffect, useState } from 'react'

type ThemeChoice = 'system' | 'light' | 'amoled'
const storageKey = 'condivisa-theme'

function savedChoice(): ThemeChoice {
  const value = localStorage.getItem(storageKey)
  return value === 'light' || value === 'amoled' ? value : 'system'
}

function applyTheme(choice: ThemeChoice) {
  const dark = choice === 'amoled' || (choice === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'amoled' : 'light'
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#000000' : '#147d68')
  document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.setAttribute('content', dark ? 'black-translucent' : 'default')
}

export function ThemePicker({ compact = false }: { compact?: boolean }) {
  const [choice, setChoice] = useState<ThemeChoice>(savedChoice)
  useEffect(() => {
    const update = () => { const next = savedChoice(); setChoice(next); applyTheme(next) }
    const preference = matchMedia('(prefers-color-scheme: dark)')
    window.addEventListener('condivisa-theme-change', update)
    preference.addEventListener('change', update)
    applyTheme(savedChoice())
    return () => { window.removeEventListener('condivisa-theme-change', update); preference.removeEventListener('change', update) }
  }, [])
  return <label className={`theme-picker ${compact ? 'theme-picker-compact' : ''}`}>
    <span>{compact ? 'Tema' : 'Aspetto'}</span>
    <select aria-label="Tema" value={choice} onChange={(event) => {
      const next = event.target.value as ThemeChoice
      localStorage.setItem(storageKey, next)
      window.dispatchEvent(new Event('condivisa-theme-change'))
    }}>
      <option value="system">Automatico</option>
      <option value="light">Chiaro</option>
      <option value="amoled">Scuro AMOLED</option>
    </select>
  </label>
}
