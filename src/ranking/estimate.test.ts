import { describe, expect, it } from 'vitest'
import { replay, startLog, type BandIndex, type DuelLog, type LogEvent } from './engine.ts'
import { duelsFromBands } from './estimate.ts'

function logOf(ids: number[], ...events: LogEvent[]): DuelLog {
  const log = startLog({ seed: 1, userId: 7, mediaType: 'ANIME', ids })
  return { ...log, events: [...log.events, ...events] }
}
const assign = (id: number, band: BandIndex): LogEvent => ({ type: 'band-assigned', id, band })

// #1 US8: before Rough Sort the estimate assumes equal Bands; after it, it uses the real Band sizes.
describe('Duel estimate from the real Band sizes', () => {
  it('is unknown until Rough Sort is done', () => {
    expect(duelsFromBands(replay(logOf([1, 2, 3], assign(1, 0))))).toBeNull()
  })

  it('sums the expected Duels of each Band once Rough Sort is done', () => {
    // Bands of 3 and 2: log2(3!) + log2(2!) = 2.58 + 1 ≈ 4. Five equal Bands of 1 would expect 0.
    const state = replay(logOf([1, 2, 3, 4, 5], assign(1, 0), assign(2, 0), assign(3, 0), assign(4, 2), assign(5, 2)))
    expect(duelsFromBands(state)).toBe(4)
  })

  it('counts a split Band Sub-band by Sub-band, since Duels never cross a Sub-band', () => {
    const part = (n: number) => ({ tiers: [], unplaced: Array.from({ length: n }, (_, i) => i) })
    const empty = part(0)
    const state = {
      progress: { roughSort: { done: 8, total: 8 } },
      // One split Band of 8: Sub-bands 4 / 2 / 2 → log2(4!) + 1 + 1 ≈ 6.58 → 7 (a whole Band of 8 would be ≈ 15).
      bands: [{ ...part(8), subBands: [part(4), part(2), part(2)] }, empty, empty, empty, empty],
    }
    expect(duelsFromBands(state)).toBe(7)
  })
})
