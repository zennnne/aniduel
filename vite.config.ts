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
      // One page each, no router (ADR 0004, ADR 0016): AniDuel! at /aniduel/, the AniLyze hub at /aniduel/anilyze/,
      // Top Studios and Top Directors under it, and Top Studios' old path /aniduel/studios/, which only forwards there.
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        anilyze: fileURLToPath(new URL('./anilyze/index.html', import.meta.url)),
        studios: fileURLToPath(new URL('./anilyze/studios/index.html', import.meta.url)),
        directors: fileURLToPath(new URL('./anilyze/directors/index.html', import.meta.url)),
        studiosRedirect: fileURLToPath(new URL('./studios/index.html', import.meta.url)),
      },
    },
  },
  // Agent worktrees live under .claude/: their copies of the tests are not this checkout's.
  test: { exclude: [...configDefaults.exclude, '.claude/**'] },
})
