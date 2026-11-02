import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  // Served from https://zennnne.github.io/aniduel/ (ADR 0004).
  base: '/aniduel/',
  plugins: [react()],
  build: {
    rolldownOptions: {
      // Two pages, no router (ADR 0004): AniDuel! at /aniduel/ and Top Studios at /aniduel/studios/.
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        studios: fileURLToPath(new URL('./studios/index.html', import.meta.url)),
      },
    },
  },
  // Agent worktrees live under .claude/: their copies of the tests are not this checkout's.
  test: { exclude: [...configDefaults.exclude, '.claude/**'] },
})
