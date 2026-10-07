import { describe, expect, it } from 'vitest'
import { replay, startLog, type BandIndex, type DuelLog, type LogEvent } from './engine.ts'
import { duelsForBandSizes, duelsFromBands, duelsLeft, duelsLeftIn, fullRankingExtra } from './estimate.ts'
import { defaultSettings } from './scoring.ts'

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

// ADR 0007: on Scores, Duels stop once every level is settled, so titles sharing a level need no order.
describe('Duel estimate on Scores', () => {
  const formats = ['POINT_100', 'POINT_10_DECIMAL', 'POINT_10', 'POINT_5', 'POINT_3'] as const
  const sizes = [40, 40, 40, 40, 40]
  const on = (format: (typeof formats)[number]) => duelsForBandSizes(sizes, { format, settings: defaultSettings(format, 'whole') })

  it('is lower than Full Ranking for every Score Format on its whole step', () => {
    for (const format of formats) expect(on(format)).toBeLessThan(duelsForBandSizes(sizes))
  })

  it('saves more on coarser formats', () => {
    expect(on('POINT_3')).toBeLessThan(on('POINT_5'))
    expect(on('POINT_5')).toBeLessThan(on('POINT_10'))
  })

  it('agrees with Full Ranking when every level holds a single title', () => {
    // 10 point, 10..1 over ten titles: one level each.
    const scale = { format: 'POINT_10' as const, settings: { distribution: 'linear' as const, step: 'whole' as const, best: 10, worst: 1 } }
    expect(duelsForBandSizes([4, 3, 3, 0, 0], scale)).toBe(duelsForBandSizes([4, 3, 3, 0, 0]))
  })

  it('follows the Sort Goal of a Ranking once Rough Sort is done', () => {
    const ids = Array.from({ length: 30 }, (_, i) => i + 1)
    const sorted = (log: DuelLog) => replay({ ...log, events: [...log.events, ...ids.map((id) => assign(id, (id % 2) as BandIndex))] })
    const scores = sorted(startLog({ seed: 1, userId: 7, mediaType: 'ANIME', ids, scoreFormat: 'POINT_5' }))
    const full = sorted(startLog({ seed: 1, userId: 7, mediaType: 'ANIME', ids }))
    const scale = { format: 'POINT_5' as const, settings: defaultSettings('POINT_5', 'whole') }
    expect(duelsFromBands(scores)).toBe(duelsForBandSizes([15, 15, 0, 0, 0], scale))
    expect(duelsFromBands(scores)).toBeLessThan(duelsFromBands(full)!)
    expect(duelsFromBands(full)).toBe(duelsForBandSizes([15, 15, 0, 0, 0]))
    // Duels left in a Band follow the Sort Goal too.
    expect(duelsLeftIn(scores, 0)).toBeGreaterThan(0)
    expect(duelsLeftIn(scores, 0)).toBeLessThan(duelsLeftIn(full, 0))
    expect(duelsLeftIn(full, 0)).toBe(duelsLeft(full.bands[0]))
  })

  it('leaves no Duels in a Band whose titles are all settled', () => {
    // Two titles on 3 smileys, 3..1: whatever their order, each title's level is open, so they Duel once.
    let log = startLog({ seed: 1, userId: 7, mediaType: 'ANIME', ids: [1, 2], scoreFormat: 'POINT_3' })
    log = { ...log, events: [...log.events, assign(1, 0), assign(2, 0)] }
    expect(duelsLeftIn(replay(log), 0)).toBe(1)
    const prompt = replay(log).prompt
    if (prompt.kind !== 'duel') throw new Error('expected a Duel')
    log = { ...log, events: [...log.events, { type: 'duel-answered', a: prompt.a, b: prompt.b, result: 'a' }] }
    expect(duelsLeftIn(replay(log), 0)).toBe(0)
  })
})

// #28: "+~N Duels" before switching Scores to Full Ranking, the difference between the two estimates.
describe('Duels Full Ranking adds', () => {
  const ids = Array.from({ length: 10 }, (_, i) => i + 1)
  const scoresLog = () => startLog({ seed: 1, userId: 7, mediaType: 'ANIME', ids, scoreFormat: 'POINT_3' })

  it('is what Scores saves on the real Band sizes once Rough Sort is done', () => {
    // Ten titles in one Band on 3 smileys, 3..1: levels 3,3,3 · 2,2,2,2 · 1,1,1. Full Ranking log2(10!) ≈ 21.8 → 22;
    // Scores saves 0.42 · (log2 3! + log2 4! + log2 3!) ≈ 4.1 → 18. So about 4 more.
    const log = scoresLog()
    const state = replay({ ...log, events: [...log.events, ...ids.map((id) => assign(id, 0))] })
    expect(fullRankingExtra(state)).toBe(4)
  })

  it('assumes equal Bands while Rough Sort is not done', () => {
    const big = Array.from({ length: 200 }, (_, i) => i + 1)
    const state = replay(startLog({ seed: 1, userId: 7, mediaType: 'ANIME', ids: big, scoreFormat: 'POINT_10_DECIMAL' }))
    // Measured on #26: about 36% of ~800 Duels.
    expect(fullRankingExtra(state)).toBeGreaterThan(150)
  })

  it('is 0 on Full Ranking', () => {
    expect(fullRankingExtra(replay(logOf(ids)))).toBe(0)
  })
})
