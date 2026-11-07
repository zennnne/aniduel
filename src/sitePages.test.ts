// #94, #102: the site's pages link to each other (ADR 0015, ADR 0016).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { movedStudiosUrl, sitePage, toolLink } from './sitePages.ts'

function openedAt(search: string, { dev }: { dev: boolean }) {
  vi.stubGlobal('window', { location: { search } })
  vi.stubEnv('DEV', dev)
  vi.stubEnv('BASE_URL', '/aniduel/') // Vite's base (vite.config.ts); Vitest itself runs at /
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('the links between the pages', () => {
  it('put AniLyze and its tools under /aniduel/anilyze/, and AniDuel! at /aniduel/', () => {
    openedAt('', { dev: false })
    expect(sitePage('aniduel')).toBe('/aniduel/')
    expect(sitePage('anilyze')).toBe('/aniduel/anilyze/')
    expect(sitePage('studios')).toBe('/aniduel/anilyze/studios/')
    expect(sitePage('directors')).toBe('/aniduel/anilyze/directors/')
  })

  it('carry nothing else from the page they are on', () => {
    openedAt('?user=Somebody', { dev: true })
    expect(sitePage('aniduel')).toBe('/aniduel/')
    expect(sitePage('anilyze')).toBe('/aniduel/anilyze/')
  })

  it('keep the fake AniList switch under npm run dev, so the fake carries over', () => {
    openedAt('?fake-anilist&user=Fake%20Zen', { dev: true })
    expect(sitePage('anilyze')).toBe('/aniduel/anilyze/?fake-anilist')
    expect(sitePage('studios')).toBe('/aniduel/anilyze/studios/?fake-anilist')
    expect(sitePage('aniduel')).toBe('/aniduel/?fake-anilist')
  })

  it('never keep it in a production build', () => {
    openedAt('?fake-anilist', { dev: false })
    expect(sitePage('anilyze')).toBe('/aniduel/anilyze/')
    expect(sitePage('studios')).toBe('/aniduel/anilyze/studios/')
  })
})

describe('a link to a tool for one user', () => {
  it('opens the tool with ?user=, so the result loads at once', () => {
    openedAt('', { dev: false })
    expect(toolLink('studios', 'Zen')).toBe('/aniduel/anilyze/studios/?user=Zen')
    expect(toolLink('directors', 'Zen')).toBe('/aniduel/anilyze/directors/?user=Zen')
  })

  it('encodes the name', () => {
    openedAt('', { dev: false })
    expect(toolLink('studios', 'Fake Zen&co')).toBe('/aniduel/anilyze/studios/?user=Fake%20Zen%26co')
  })

  it('opens the tool blank without a name', () => {
    openedAt('', { dev: false })
    expect(toolLink('studios', '')).toBe('/aniduel/anilyze/studios/')
    expect(toolLink('studios', '  ')).toBe('/aniduel/anilyze/studios/')
  })

  it('keeps the fake AniList switch under npm run dev, beside the name', () => {
    openedAt('?fake-anilist', { dev: true })
    expect(toolLink('studios', 'Fake Zen')).toBe('/aniduel/anilyze/studios/?fake-anilist&user=Fake%20Zen')
    expect(toolLink('studios', '')).toBe('/aniduel/anilyze/studios/?fake-anilist')
  })
})

describe('the old Top Studios path, /aniduel/studios/', () => {
  it('forwards to /aniduel/anilyze/studios/ with the user kept', () => {
    openedAt('', { dev: false })
    expect(movedStudiosUrl({ search: '?user=Friend', hash: '' })).toBe('/aniduel/anilyze/studios/?user=Friend')
  })

  it('keeps every other parameter and the hash, as they were', () => {
    openedAt('', { dev: false })
    expect(movedStudiosUrl({ search: '?fake-anilist&user=Fake%20Zen&x=1', hash: '#top' })).toBe(
      '/aniduel/anilyze/studios/?fake-anilist&user=Fake%20Zen&x=1#top',
    )
  })

  it('forwards a bare link to the bare page', () => {
    openedAt('', { dev: false })
    expect(movedStudiosUrl({ search: '', hash: '' })).toBe('/aniduel/anilyze/studios/')
  })
})
