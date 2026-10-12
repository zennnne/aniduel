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

  it('has neither the fake AniList nor the switch that opens it (#68)', async () => {
    // Vitest runs with NODE_ENV=test, which Vite would build as a dev bundle.
    vi.stubEnv('NODE_ENV', 'production')
    const built = await build({ logLevel: 'silent', build: { write: false } })
    const code = [built]
      .flat()
      .flatMap((b) => ('output' in b ? b.output : []))
      .map((file) => (file.type === 'chunk' ? file.code : ''))
      .join('\n')
    expect(code).toContain('graphql.anilist.co') // the app itself is in there
    expect(code).not.toContain('fake-anilist') // the switch
    expect(code).not.toContain('Fake Zen') // the fake's viewer
    expect(code).not.toContain('unexpected query') // the fake's fetch
  }, 60_000)
})
