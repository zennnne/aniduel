import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  // Served from https://zennnne.github.io/aniduel/ (ADR 0004).
  base: '/aniduel/',
  plugins: [react()],
  // Agent worktrees live under .claude/: their copies of the tests are not this checkout's.
  test: { exclude: [...configDefaults.exclude, '.claude/**'] },
})
