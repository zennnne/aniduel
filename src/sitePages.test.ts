// #94: AniDuel! and Top Studios link to each other (ADR 0015).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sitePage } from './sitePages.ts'

function openedAt(search: string, { dev }: { dev: boolean }) {
  vi.stubGlobal('window', { location: { search } })
  vi.stubEnv('DEV', dev)
  vi.stubEnv('BASE_URL', '/aniduel/') // Vite's base (vite.config.ts); Vitest itself runs at /
}

describe('the links between the two pages', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('go to /aniduel/studios/ and back to /aniduel/', () => {
    openedAt('', { dev: false })
    expect(sitePage('studios')).toBe('/aniduel/studios/')
    expect(sitePage('aniduel')).toBe('/aniduel/')
  })

  it('carry nothing else from the page they are on', () => {
    openedAt('?user=Somebody', { dev: true })
    expect(sitePage('aniduel')).toBe('/aniduel/')
  })

  it('keep the fake AniList switch under npm run dev, so the fake carries over', () => {
    openedAt('?fake-anilist&user=Fake%20Zen', { dev: true })
    expect(sitePage('studios')).toBe('/aniduel/studios/?fake-anilist')
    expect(sitePage('aniduel')).toBe('/aniduel/?fake-anilist')
  })

  it('never keep it in a production build', () => {
    openedAt('?fake-anilist', { dev: false })
    expect(sitePage('studios')).toBe('/aniduel/studios/')
  })
})
