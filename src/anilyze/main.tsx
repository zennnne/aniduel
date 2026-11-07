// The hub reads AniDuel!'s login like the tools do, only to fill in the user's own name; under `?fake-anilist` its
// cards keep the switch.
import { mountPage } from './mountPage.tsx'
import { HubPage } from './ui/HubPage.tsx'
import './ui/anilyze.css'

await mountPage(HubPage)
