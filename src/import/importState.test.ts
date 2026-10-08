import { describe, expect, it } from 'vitest'
import { formatDuration, newImport, timeLeftMs } from './importState.ts'

const START = 1_760_000_000_000

describe('Import progress', () => {
  const state = newImport(
    [
      { mediaId: 1, scoreRaw: 90, oldScore100: 0 },
      { mediaId: 2, scoreRaw: 70, oldScore100: 50 },
      { mediaId: 3, scoreRaw: 30, oldScore100: 80 },
      { mediaId: 4, scoreRaw: 20, oldScore100: 10 },
    ],
    { hash: 'h', format: 'POINT_100' },
  )
  state.writes[0].status = 'done'

  it('estimates the time left from the titles still to write and the current spacing', () => {
    expect(timeLeftMs(state, { phase: 'writing', mediaId: 2, spacingMs: 2200 }, START)).toBe(3 * 2200)
    expect(timeLeftMs(state, { phase: 'writing', mediaId: 2, spacingMs: 4000 }, START)).toBe(3 * 4000)
  })

  it('adds the rest of a rate-limit wait', () => {
    expect(timeLeftMs(state, { phase: 'waiting', until: START + 42_000 }, START)).toBe(42_000 + 3 * 2200)
  })

  it('shows a duration as minutes and seconds', () => {
    expect(formatDuration(84_000)).toBe('1 min 24 s')
    expect(formatDuration(33_400)).toBe('34 s')
    expect(formatDuration(120_000)).toBe('2 min 0 s')
  })
})
