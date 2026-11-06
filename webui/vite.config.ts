import {fileURLToPath, URL} from 'node:url'
import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: {'@': fileURLToPath(new URL('./src', import.meta.url))},
  },
  build: {outDir: 'dist', emptyOutDir: true, sourcemap: false},
  server: {
    port: 5173,
    proxy: {'/api': 'http://127.0.0.1:17863'},
  },
})
