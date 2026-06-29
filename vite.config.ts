import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin, type ViteDevServer } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

function rawKuromojiDictPlugin(): Plugin {
  return {
    name: 'raw-kuromoji-dict',
    configureServer(server: ViteDevServer) {
      const dictRoot = join(process.cwd(), 'public', 'dict')

      server.middlewares.use('/dict', (request, response, next) => {
        const pathname = decodeURIComponent(request.url?.split('?')[0] ?? '').replace(/^\/+/, '')
        if (!pathname.endsWith('.dat.gz')) {
          next()
          return
        }

        const filePath = join(dictRoot, pathname)
        if (relative(dictRoot, filePath).startsWith('..')) {
          next()
          return
        }

        response.statusCode = 200
        response.setHeader('Content-Type', 'application/octet-stream')
        response.setHeader('Cache-Control', 'no-cache')
        response.end(readFileSync(filePath))
      })
    },
  }
}

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
    rawKuromojiDictPlugin(),
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
