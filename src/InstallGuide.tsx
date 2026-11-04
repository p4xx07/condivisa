import { useEffect, useState } from 'react'
import { Smartphone } from 'lucide-react'

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

export function InstallGuide() {
  const [prompt, setPrompt] = useState<InstallEvent | null>(null)
  const [installed, setInstalled] = useState(() => window.matchMedia('(display-mode: standalone)').matches || ('standalone' in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone)))
  useEffect(() => {
    const onPrompt = (event: Event) => { event.preventDefault(); setPrompt(event as InstallEvent) }
    const onInstalled = () => { setInstalled(true); setPrompt(null) }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled) }
  }, [])
  if (installed) return null
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
  return <div className="sidebar-install"><Smartphone size={20} /><strong>La tua app, ovunque</strong>
    {prompt ? <button className="install-button" onClick={async () => { await prompt.prompt(); await prompt.userChoice; setPrompt(null) }}>Installa Condivisa</button>
      : <p>{ios ? 'Su Safari, tocca Condividi e poi “Aggiungi alla schermata Home”.' : 'Apri il menu del browser e scegli “Installa app” o “Aggiungi alla schermata Home”.'}</p>}
  </div>
}
