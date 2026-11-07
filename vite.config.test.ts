import { build } from 'vite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import config from './vite.config.ts'

describe('vite config', () => {
  it('serves the app under /aniduel/ to match the GitHub Pages URL', () => {
    expect(config.base).toBe('/aniduel/')
  })
})

describe('the production bundle', () => {
  afterEach(() => vi.unstubAllEnvs())

  async function productionBuild() {
    // Vitest runs with NODE_ENV=test, which Vite would build as a dev bundle.
    vi.stubEnv('NODE_ENV', 'production')
    const built = await build({ logLevel: 'silent', build: { write: false } })
    return [built].flat().flatMap((b) => ('output' in b ? b.output : []))
  }

  it('has the app, AniLyze, both tools and the old path, and on none the fake AniList or the switch that opens it (#68, #88, #93, #102, #103)', async () => {
    const files = await productionBuild()
    const code = files.map((file) => (file.type === 'chunk' ? file.code : '')).join('\n')
    const pages = files.filter((file) => file.fileName.endsWith('.html')).map((file) => file.fileName)

    expect(pages).toEqual(
      expect.arrayContaining([
        'index.html',
        'anilyze/index.html',
        'anilyze/studios/index.html',
        'anilyze/directors/index.html',
        'studios/index.html',
      ]),
    )
    expect(code).toContain('graphql.anilist.co') // the app itself is in there
    expect(code).toContain('POINT_10_DECIMAL') // and the tools' list query
    expect(code).toContain('Type a username, pick a tool') // and the hub
    expect(code).toContain('staff(sort: [RELEVANCE]') // and Top Directors
    expect(code).not.toContain('Yuzuru Tachikawa') // nor the fake's Directors
    expect(code).not.toContain('Naoko Yamada')
    expect(code).not.toContain('fake-anilist') // the switch
    expect(code).not.toContain('Fake Zen') // the fake's viewer
    expect(code).not.toContain('unexpected query') // the fake's fetch
    expect(code).not.toContain('Mob Psycho') // the fake's fixed list
    expect(code).not.toContain('Aniplex') // and its studios
  }, 60_000)

  it('gives each page its own title, description and link preview, and the old path Top Studios’ (#94, #102, #103)', async () => {
    const files = await productionBuild()
    const html = (name: string) => {
      const file = files.find((f) => f.fileName === name)
      return file?.type === 'asset' ? String(file.source) : ''
    }
    const title = (page: string) => /<title>([^<]*)<\/title>/.exec(html(page))?.[1]
    const meta = (page: string, key: string) =>
      new RegExp(`<meta\\s+(?:property|name)="${key}"\\s+content="([^"]*)"`).exec(html(page))?.[1]

    expect(title('index.html')).toBe('AniDuel!')
    expect(meta('index.html', 'og:url')).toBe('https://zennnne.github.io/aniduel/') // AniDuel!'s own stay as they were

    expect(title('anilyze/index.html')).toBe('AniLyze · AniDuel!')
    expect(meta('anilyze/index.html', 'description')).toMatch(/AniLyze/)
    expect(meta('anilyze/index.html', 'og:title')).toBe('AniLyze · AniDuel!')
    expect(meta('anilyze/index.html', 'og:description')).toMatch(/AniList username/)
    expect(meta('anilyze/index.html', 'og:url')).toBe('https://zennnne.github.io/aniduel/anilyze/')

    const studios = 'anilyze/studios/index.html'
    expect(title(studios)).toBe('Top Studios · AniDuel!')
    expect(meta(studios, 'description')).toMatch(/top animation studios/)
    expect(meta(studios, 'og:title')).toBe('Top Studios · AniDuel!')
    expect(meta(studios, 'og:description')).toMatch(/top animation studios/)
    expect(meta(studios, 'og:url')).toBe('https://zennnne.github.io/aniduel/anilyze/studios/')

    const directors = 'anilyze/directors/index.html'
    expect(title(directors)).toBe('Top Directors · AniDuel!')
    expect(meta(directors, 'description')).toMatch(/top anime directors/)
    expect(meta(directors, 'og:title')).toBe('Top Directors · AniDuel!')
    expect(meta(directors, 'og:description')).toMatch(/top anime directors/)
    expect(meta(directors, 'og:url')).toBe('https://zennnne.github.io/aniduel/anilyze/directors/')

    for (const page of ['index.html', 'anilyze/index.html', studios, directors]) {
      // Full URLs, as link previews need (ADR 0004).
      expect(meta(page, 'og:image')).toMatch(/^https:\/\/zennnne\.github\.io\/aniduel\//)
    }

    // A link shared before the move previews as Top Studios does (ADR 0016), and forwards without a script too.
    const old = 'studios/index.html'
    expect(title(old)).toBe(title(studios))
    for (const key of ['description', 'og:title', 'og:description', 'og:url', 'og:image', 'og:image:alt', 'twitter:card']) {
      expect(meta(old, key), key).toBe(meta(studios, key))
    }
    expect(html(old)).toMatch(/<noscript>\s*<meta http-equiv="refresh" content="0; url=\/aniduel\/anilyze\/studios\/"/)
  }, 60_000)
})
