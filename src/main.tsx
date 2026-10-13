import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { usableStorage } from './persistence/usableStorage.ts'
import { App } from './ui/App.tsx'
import { StorageBlockedScreen } from './ui/storageblocked/StorageBlockedScreen.tsx'
import './ui/theme.css'

// The one place that reaches the browser's storage (#76): checked here, then handed to everything that saves.
const storage = usableStorage(() => window.localStorage)

// Dev only (#68): `?fake-anilist` opens the app signed in against a fake AniList. The production build drops this
// branch, and the fake with it (vite.config.test.ts).
const fake =
  import.meta.env.DEV && storage && new URLSearchParams(window.location.search).has('fake-anilist')
    ? (await import('./dev/fakeSession.ts')).fakeSession(storage)
    : undefined

createRoot(document.getElementById('root')!).render(
  <StrictMode>{storage ? <App storage={storage} fake={fake} /> : <StorageBlockedScreen />}</StrictMode>,
)
