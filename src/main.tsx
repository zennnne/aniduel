import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/App.tsx'
import './ui/theme.css'

// Dev only (#68): `?fake-anilist` opens the app signed in against a fake AniList. The production build drops this
// branch, and the fake with it (vite.config.test.ts).
const fake =
  import.meta.env.DEV && new URLSearchParams(window.location.search).has('fake-anilist')
    ? (await import('./dev/fakeSession.ts')).fakeSession(localStorage)
    : undefined

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App fake={fake} />
  </StrictMode>,
)
