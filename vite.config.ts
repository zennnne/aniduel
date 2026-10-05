import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  // Served from https://zennnne.github.io/aniduel/ (ADR 0004).
  base: '/aniduel/',
  plugins: [react()],
})
