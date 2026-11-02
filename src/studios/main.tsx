import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { StudiosPage } from './ui/StudiosPage.tsx'
import '../ui/theme.css'
import './ui/studios.css'

// Top Studios needs no login: it reads any public list by user name (#88).
const session = { fetch: (input: RequestInfo | URL, init?: RequestInit) => window.fetch(input, init), token: null }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StudiosPage session={session} />
  </StrictMode>,
)
