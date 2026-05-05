import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@paddleocr') || id.includes('@techstark/opencv-js')) {
            return 'paddleocr'
          }

          if (id.includes('onnxruntime-web')) {
            return 'onnxruntime'
          }

          return undefined
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util', '@huggingface/transformers'],
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-app.svg'],
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        globIgnores: [
          '**/assets/ort-wasm-*.wasm',
          '**/assets/ffmpeg-core-*.wasm',
          '**/assets/paddleocr-*.js',
          '**/assets/onnxruntime-*.js',
          '**/assets/worker-entry-*.js',
        ],
        skipWaiting: true,
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
