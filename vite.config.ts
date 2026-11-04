import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), VitePWA({
    registerType: 'autoUpdate',
    includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
    manifest: {
      name: 'Condivisa · Spese insieme', short_name: 'Condivisa', lang: 'it',
      description: 'Spese condivise, saldi e permessi per i tuoi gruppi.',
      start_url: '/', scope: '/', display: 'standalone',
      background_color: '#f7faf8', theme_color: '#147d68',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
  })],
  server: { proxy: { '/api': 'http://127.0.0.1:3001' }, host: '127.0.0.1' },
})
