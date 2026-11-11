import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'
import { legalPagesPlugin } from './scripts/legalPagesPlugin'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve('electron/main/index.ts') } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve('electron/preload/index.ts') } },
  },
  renderer: {
    root: '.',
    plugins: [react(), tailwindcss(), legalPagesPlugin()],
    resolve: { alias: { '@': resolve('src') } },
    build: { rollupOptions: { input: { app: resolve('index.html'), privacy: resolve('privacy.html'), terms: resolve('terms.html') } } },
  },
})
