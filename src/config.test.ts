import { describe, expect, it } from 'vitest'
import { aniListClientId } from './config.ts'

describe('aniListClientId', () => {
  // Spike #3: one AniList app per redirect URL.
  it('uses the dev app (redirect http://localhost:5173/aniduel/) in development', () => {
    expect(aniListClientId({ dev: true })).toBe(52827)
  })

  it('uses the production app (redirect https://zennnne.github.io/aniduel/) in builds', () => {
    expect(aniListClientId({ dev: false })).toBe(52824)
  })
})
