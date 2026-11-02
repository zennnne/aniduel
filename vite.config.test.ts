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

  it('has the app and the Top Studios page, and on neither the fake AniList nor the switch that opens it (#68, #88, #93)', async () => {
    const files = await productionBuild()
    const code = files.map((file) => (file.type === 'chunk' ? file.code : '')).join('\n')
    const pages = files.filter((file) => file.fileName.endsWith('.html')).map((file) => file.fileName)

    expect(pages).toEqual(expect.arrayContaining(['index.html', 'studios/index.html']))
    expect(code).toContain('graphql.anilist.co') // the app itself is in there
    expect(code).toContain('POINT_10_DECIMAL') // and Top Studios' list query
    expect(code).not.toContain('fake-anilist') // the switch
    expect(code).not.toContain('Fake Zen') // the fake's viewer
    expect(code).not.toContain('unexpected query') // the fake's fetch
    expect(code).not.toContain('Mob Psycho') // the fake's fixed list
    expect(code).not.toContain('Aniplex') // and its studios
  }, 60_000)

  it('gives the Top Studios page its own title, description and link preview (#94)', async () => {
    const files = await productionBuild()
    const html = (name: string) => {
      const file = files.find((f) => f.fileName === name)
      return file?.type === 'asset' ? String(file.source) : ''
    }
    const meta = (page: string, key: string) =>
      new RegExp(`<meta\\s+(?:property|name)="${key}"\\s+content="([^"]*)"`).exec(html(page))?.[1]

    expect(html('studios/index.html')).toContain('<title>Top Studios · AniDuel!</title>')
    expect(meta('studios/index.html', 'description')).toMatch(/top animation studios/)
    expect(meta('studios/index.html', 'og:title')).toBe('Top Studios · AniDuel!')
    expect(meta('studios/index.html', 'og:description')).toMatch(/top animation studios/)
    // Full URLs, as link previews need (ADR 0004).
    expect(meta('studios/index.html', 'og:url')).toBe('https://zennnne.github.io/aniduel/studios/')
    expect(meta('studios/index.html', 'og:image')).toMatch(/^https:\/\/zennnne\.github\.io\/aniduel\//)
    expect(meta('index.html', 'og:url')).toBe('https://zennnne.github.io/aniduel/') // AniDuel!'s own stay as they were
  }, 60_000)
})
