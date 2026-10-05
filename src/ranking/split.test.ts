import { describe, expect, it } from 'vitest'
import { replay, startLog, type BandIndex, type DuelLog, type LogEvent } from './engine.ts'
import { defaultCuts, offerSavings, splitOffers, splitSavings, worstCaseDuels } from './split.ts'

const range = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i)

/** `counts[b]` titles assigned to Band b, Rough Sort finished, no Duel answered. */
function afterRoughSort(counts: number[]): DuelLog {
  const ids = range(1, counts.reduce((a, b) => a + b, 0))
  let next = 0
  const events: LogEvent[] = counts.flatMap((n, band) =>
    range(0, n).map(() => ({ type: 'band-assigned', id: ids[next++], band: band as BandIndex }) as LogEvent),
  )
  const log = startLog({ seed: 1, userId: 1, mediaType: 'ANIME', ids })
  return { ...log, events: [...log.events, ...events] }
}

describe('the worst-case Duel count', () => {
  it('is Σ⌈log₂(i+1)⌉ over every title inserted, starting from the places a Segment already has', () => {
    // Inserting into 0, 1, 2, 3 places costs 0, 1, 2, 2 Duels at most.
    expect(worstCaseDuels([{ places: 0, unplaced: 4 }])).toBe(5)
    expect(worstCaseDuels([{ places: 2, unplaced: 2 }])).toBe(4)
    expect(worstCaseDuels([{ places: 0, unplaced: 2 }, { places: 0, unplaced: 2 }])).toBe(2)
  })
})

describe('the savings estimate of a split ("up to −X Duels", ADR 0006)', () => {
  it('first reaches 100 at 68 unplaced titles with a ¼ / ½ / ¼ split', () => {
    const quarter = (n: number) => {
      const q = Math.round(n / 4)
      return splitSavings({ places: 0, unplaced: n }, [
        { places: 0, unplaced: q },
        { places: 0, unplaced: n - 2 * q },
        { places: 0, unplaced: q },
      ])
    }
    expect(quarter(67)).toBe(99)
    expect(quarter(68)).toBe(100)
  })

  it('is about 220 for 150 titles split ¼ / ½ / ¼', () => {
    expect(splitSavings({ places: 0, unplaced: 150 }, [
      { places: 0, unplaced: 38 },
      { places: 0, unplaced: 74 },
      { places: 0, unplaced: 38 },
    ])).toBe(224)
  })

  it('is nothing when everything stays in one Sub-band', () => {
    expect(splitSavings({ places: 3, unplaced: 100 }, [
      { places: 0, unplaced: 0 },
      { places: 3, unplaced: 100 },
      { places: 0, unplaced: 0 },
    ])).toBe(0)
  })
})

describe('which Bands are offered a split', () => {
  it('offers a Band with at least 90 titles that have no place yet', () => {
    expect(splitOffers(replay(afterRoughSort([91, 5, 5, 5, 5])))).toEqual([0])
    // After Rough Sort the first title of each Band already has a place, so 90 in the Band is 89 unplaced.
    expect(splitOffers(replay(afterRoughSort([90, 5, 5, 5, 5])))).toEqual([])
    expect(splitOffers(replay(afterRoughSort([120, 100, 0, 0, 0])))).toEqual([0, 1])
  })

  it('never offers a Band that is already split', () => {
    const log = afterRoughSort([95, 0, 0, 0, 0])
    const unplaced = replay(log).bands[0].unplaced
    const split: LogEvent = { type: 'band-split', band: 0, cuts: [0, 1], unplaced: [[], [...unplaced], []] }
    expect(splitOffers(replay({ ...log, events: [...log.events, split] }))).toEqual([])
  })

  it('estimates the offer with a ¼ / ½ / ¼ split of the unplaced titles and of the ranked ones', () => {
    // 95 in Loved: 1 placed, 94 unplaced. Default cuts put the single Tier in Middle.
    const band = replay(afterRoughSort([95, 0, 0, 0, 0])).bands[0]
    // Worst case: 538 Duels as one Band; 89 + 219 + 89 split 24 / (1 + 46) / 24.
    expect(offerSavings(band)).toBe(141)
  })
})

describe('the default cut points for the ranked titles', () => {
  it('fall near ¼ and ¾ of the titles, snapped to the nearest Tier edge', () => {
    // 8 single-title Tiers: cut after 2 and after 6.
    expect(defaultCuts([1, 1, 1, 1, 1, 1, 1, 1])).toEqual([2, 6])
    // A big Tier in the middle can't be cut: the edges nearest 2 and 6 titles are after Tier 1 (1 title) / Tier 2 (7).
    expect(defaultCuts([1, 6, 1])).toEqual([1, 2])
  })

  it('puts a Band with a single Tier into Middle, and an empty Band at [0, 0]', () => {
    expect(defaultCuts([1])).toEqual([0, 1])
    expect(defaultCuts([])).toEqual([0, 0])
  })
})
