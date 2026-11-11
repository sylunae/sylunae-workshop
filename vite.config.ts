import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'
import { legalPagesPlugin } from './scripts/legalPagesPlugin'

export default defineConfig({
  plugins: [react(), tailwindcss(), legalPagesPlugin(), {
    name: 'local-development-csp', apply: 'serve',
    transformIndexHtml: { order: 'post', handler: (html) => html.replace(/<meta\s+http-equiv="Content-Security-Policy"[^>]*>/i, '') },
  }],
  // This is a public, read-only CDN address.  Keeping the same prefix as the
  // desktop process means web and desktop builds use one resource setting.
  envPrefix: ['VITE_', 'MAIN_VITE_'],
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  server: { watch: { ignored: ['**/.android-tools/**', '**/.android-signing/**', '**/android/**', '**/out/**', '**/release/**'] } },
  base: './',
  build: { outDir: 'dist', rollupOptions: { input: { app: resolve('index.html'), privacy: resolve('privacy.html'), terms: resolve('terms.html') } } },
})
