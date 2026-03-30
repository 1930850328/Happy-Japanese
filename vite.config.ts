import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-app.svg'],
      workbox: {
        globIgnores: ['**/assets/ort-wasm-*.wasm'],
      },
      manifest: {
        name: 'YuruNihongo',
        short_name: 'YuruNihongo',
        description: '轻松、治愈、可坚持的日语自学小站',
        theme_color: '#fff8f5',
        background_color: '#fffdf9',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/icon-app.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
})
