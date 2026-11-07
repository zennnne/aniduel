import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { storedToken } from '../auth/session.ts'
import { usableStorage } from '../persistence/usableStorage.ts'
import { storedTheme } from '../ui/theme.ts'
import { StudiosPage } from './ui/StudiosPage.tsx'
import '../ui/theme.css'
import '../anilyze/ui/tool.css'

// Top Studios needs no login, but uses AniDuel!'s if there is one (same origin, #91): the token is sent with each
// lookup, so the user's own private list loads. A browser that blocks storage simply has no login here.
const storage = usableStorage(() => window.localStorage)
// The theme picked on AniDuel! (else the system's, theme.css): the page looks like the rest of the site.
const theme = storage && storedTheme(storage)
if (theme) document.documentElement.dataset.theme = theme
// Dev only (#93): `?fake-anilist` opens the page logged in as the fake AniList's user, on its fixed list. The
// production build drops this branch, and the fake with it (vite.config.test.ts).
const session =
  import.meta.env.DEV && new URLSearchParams(window.location.search).has('fake-anilist')
    ? (await import('../dev/fakeSession.ts')).fakeStudiosSession()
    : {
        fetch: (input: RequestInfo | URL, init?: RequestInit) => window.fetch(input, init),
        token: storage ? storedToken(storage) : null,
      }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StudiosPage session={session} />
  </StrictMode>,
)
