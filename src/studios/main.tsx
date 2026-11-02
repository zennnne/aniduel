import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { storedToken } from '../auth/session.ts'
import { usableStorage } from '../persistence/usableStorage.ts'
import { StudiosPage } from './ui/StudiosPage.tsx'
import '../ui/theme.css'
import './ui/studios.css'

// Top Studios needs no login, but uses AniDuel!'s if there is one (same origin, #91): the token is sent with each
// lookup, so the user's own private list loads. A browser that blocks storage simply has no login here.
const storage = usableStorage(() => window.localStorage)
const session = {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => window.fetch(input, init),
  token: storage ? storedToken(storage) : null,
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StudiosPage session={session} />
  </StrictMode>,
)
