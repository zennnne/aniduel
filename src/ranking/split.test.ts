import { describe, expect, it } from 'vitest'
import { replay, startLog, type BandIndex, type DuelLog, type LogEvent } from './engine.ts'
import { autoOfferDue, defaultCuts, offerSavings, splitOffers, splitSavings, unplacedToSort, worstCaseDuels } from './split.ts'

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

  describe('on Scores (US29)', () => {
    /** Like `afterRoughSort`, on Scores with 3 smileys: few levels, so a whole Band can be settled with no Duel. */
    const onScores = (counts: number[]): DuelLog => {
      const fr = afterRoughSort(counts)
      const ids = fr.events.flatMap((event) => (event.type === 'titles-added' ? event.ids : []))
      const log = startLog({ seed: 1, userId: 1, mediaType: 'ANIME', ids, scoreFormat: 'POINT_3' })
      return { ...log, events: [...log.events, ...fr.events.filter((event) => event.type === 'band-assigned')] }
    }

    it('counts only titles not settled yet: a big Band that is all settled is not offered', () => {
      // Loved's 95 titles all sit on the top smiley of 395, so they are settled with 94 of them still unplaced.
      const state = replay(onScores([95, 0, 0, 0, 300]))
      expect(state.bands[0].unplaced.length).toBe(94)
      expect(state.progress.bands[0]).toEqual({ done: 95, total: 95 })
      expect(splitOffers(state)).toEqual([4])
    })

    it('is not offered again after a sync once the big Band is settled', () => {
      const log = onScores([95, 0, 0, 0, 300])
      const synced = replay({ ...log, events: [...log.events, { type: 'titles-added', ids: [1000] }, { type: 'band-assigned', id: 1000, band: 4 }] })
      expect(autoOfferDue({ ...log, events: [...log.events, { type: 'titles-added', ids: [1000] }] })).toBe(true)
      expect(splitOffers(synced)).toEqual([4])
    })

    it('leaves settled titles out of the estimate, though they are still unplaced', () => {
      // The same 94 unplaced Loved titles estimate up to −141 on Full Ranking (below); settled, they need no Duel.
      const state = replay(onScores([95, 0, 0, 0, 300]))
      expect(unplacedToSort(state, state.bands[0])).toEqual([])
      expect(offerSavings(state, state.bands[0])).toBe(0)
      expect(unplacedToSort(state, state.bands[4])).toHaveLength(299)
      expect(offerSavings(state, state.bands[4])).toBe(448)
    })
  })

  it('estimates the offer with a ¼ / ½ / ¼ split of the unplaced titles and of the ranked ones', () => {
    // 95 in Loved: 1 placed, 94 unplaced. Default cuts put the single Tier in Middle.
    const state = replay(afterRoughSort([95, 0, 0, 0, 0]))
    // Worst case: 538 Duels as one Band; 89 + 219 + 89 split 24 / (1 + 46) / 24.
    expect(offerSavings(state, state.bands[0])).toBe(141)
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

describe('when the split offer shows on its own', () => {
  const answerFirstDuel = (log: DuelLog): DuelLog => {
    const p = replay(log).prompt
    if (p.kind !== 'duel') throw new Error('expected a Duel')
    return { ...log, events: [...log.events, { type: 'duel-answered', a: p.a, b: p.b, result: 'a' }] }
  }
  const push = (log: DuelLog, event: LogEvent): DuelLog => ({ ...log, events: [...log.events, event] })

  it('right after Rough Sort, before any Duel is answered', () => {
    const log = afterRoughSort([95])
    expect(autoOfferDue(log)).toBe(true)
    expect(autoOfferDue(answerFirstDuel(log))).toBe(false)
  })

  it('again after a sync adds titles, until the next Duel answer', () => {
    let log = push(answerFirstDuel(afterRoughSort([95])), { type: 'titles-added', ids: [500] })
    expect(autoOfferDue(log)).toBe(true)
    log = push(log, { type: 'band-assigned', id: 500, band: 0 })
    expect(autoOfferDue(log)).toBe(true)
    expect(autoOfferDue(answerFirstDuel(log))).toBe(false)
  })

  it('not after a sync that only removed titles', () => {
    const log = push(answerFirstDuel(afterRoughSort([95])), { type: 'titles-removed', ids: [3] })
    expect(autoOfferDue(log)).toBe(false)
  })
})
