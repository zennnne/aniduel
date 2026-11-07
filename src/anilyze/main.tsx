import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { storedToken } from '../auth/session.ts'
import { usableStorage } from '../persistence/usableStorage.ts'
import { storedTheme } from '../ui/theme.ts'
import { HubPage } from './ui/HubPage.tsx'
import '../ui/theme.css'
import './ui/tool.css'
import './ui/anilyze.css'

// The hub reads AniDuel!'s login like Top Studios does (same origin), only to fill in the user's own name.
const storage = usableStorage(() => window.localStorage)
const theme = storage && storedTheme(storage)
if (theme) document.documentElement.dataset.theme = theme
// Dev only: `?fake-anilist` opens the hub logged in as the fake AniList's user, and its cards keep the switch. The
// production build drops this branch, and the fake with it (vite.config.test.ts).
const session =
  import.meta.env.DEV && new URLSearchParams(window.location.search).has('fake-anilist')
    ? (await import('../dev/fakeSession.ts')).fakeToolSession()
    : {
        fetch: (input: RequestInfo | URL, init?: RequestInit) => window.fetch(input, init),
        token: storage ? storedToken(storage) : null,
      }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HubPage session={session} />
  </StrictMode>,
)
