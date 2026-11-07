// How every AniLyze page starts (the hub and each tool): in the theme picked on AniDuel!, with AniDuel!'s login if there
// is one, or under `npm run dev` with `?fake-anilist`, the fake AniList's.
import { StrictMode, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { storedToken } from '../auth/session.ts'
import { usableStorage } from '../persistence/usableStorage.ts'
import { storedTheme } from '../ui/theme.ts'
import type { ToolSession } from './types.ts'
import '../ui/theme.css'
import './ui/tool.css'

/**
 * Renders `Page` into #root. An AniLyze page needs no login, but uses AniDuel!'s if there is one (same origin, #91):
 * the token is sent with each lookup, so the user's own private list loads. A browser that blocks storage simply has no
 * login here.
 */
export async function mountPage(Page: ComponentType<{ session: ToolSession }>): Promise<void> {
  const storage = usableStorage(() => window.localStorage)
  // The theme picked on AniDuel! (else the system's, theme.css): the page looks like the rest of the site.
  const theme = storage && storedTheme(storage)
  if (theme) document.documentElement.dataset.theme = theme
  // Dev only (#93): `?fake-anilist` opens the page logged in as the fake AniList's user, on its fixed list. The
  // production build drops this branch, and the fake with it (vite.config.test.ts).
  const session: ToolSession =
    import.meta.env.DEV && new URLSearchParams(window.location.search).has('fake-anilist')
      ? (await import('../dev/fakeSession.ts')).fakeToolSession()
      : {
          fetch: (input: RequestInfo | URL, init?: RequestInit) => window.fetch(input, init),
          token: storage ? storedToken(storage) : null,
        }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Page session={session} />
    </StrictMode>,
  )
}
