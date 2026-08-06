import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8899', changeOrigin: true },
    },
  },
  // `vite preview` serwuje zbudowany pakiet i NIE dziedziczy `server.proxy`,
  // więc bez tego bloku wdrożony interfejs dostawałby 404 na każdym wywołaniu
  // API. Ten sam cel co wyżej: przeglądarka rozmawia wyłącznie z tym jednym
  // portem, a API stoi za nim.
  preview: {
    port: 4173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8899', changeOrigin: true },
    },
  },
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
  },
})
