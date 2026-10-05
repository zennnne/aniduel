import { describe, expect, it } from 'vitest'
import config from './vite.config.ts'

describe('vite config', () => {
  it('serves the app under /aniduel/ to match the GitHub Pages URL', () => {
    expect(config.base).toBe('/aniduel/')
  })
})
