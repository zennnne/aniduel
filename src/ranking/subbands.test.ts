import { describe, expect, it } from 'vitest'
import {
  ReplayError,
  appendEvent,
  replay,
  startLog,
  type BandIndex,
  type DuelLog,
  type LogEvent,
  type SubBandIndex,
} from './engine.ts'
import { defaultSettings, score } from './scoring.ts'

const header = { seed: 42, userId: 7, mediaType: 'ANIME' as const }

function logOf(ids: number[], ...events: LogEvent[]): DuelLog {
  const log = startLog({ ...header, ids })
  return { ...log, events: [...log.events, ...events] }
}

const plus = (log: DuelLog, ...events: LogEvent[]): DuelLog => ({ ...log, events: [...log.events, ...events] })
const assign = (id: number, band: BandIndex, sub?: SubBandIndex): LogEvent =>
  sub === undefined ? { type: 'band-assigned', id, band } : { type: 'band-assigned', id, band, sub }
const duel = (a: number, b: number, result: 'a' | 'b' | 'tie'): LogEvent => ({ type: 'duel-answered', a, b, result })
const split = (band: BandIndex, cuts: [number, number], unplaced: [number[], number[], number[]]): LogEvent => ({
  type: 'band-split',
  band,
  cuts,
  unplaced,
})
const undo: LogEvent = { type: 'undo' }

/** Six titles, all Loved. After Rough Sort the first one already has a place (no Duel needed); 2..6 wait. */
const freshLoved = () => logOf([1, 2, 3, 4, 5, 6], ...[1, 2, 3, 4, 5, 6].map((id) => assign(id, 0)))

describe('splitting a fresh Band', () => {
  it('puts each unplaced title into the Sub-band the user chose, and cuts the ranked ones by the cut points', () => {
    // Title 1 (the only ranked title, one Tier) goes to Middle: cuts [0, 1].
    const state = replay(plus(freshLoved(), split(0, [0, 1], [[2], [3, 4], [5, 6]])))
    expect(state.bands[0].subBands).toEqual([
      { tiers: [[2]], unplaced: [] },
      { tiers: [[1]], unplaced: [3, 4] },
      { tiers: [[5]], unplaced: [6] },
    ])
  })

  it('keeps the whole Band in order on the Band itself: Best, then Middle, then Lowest', () => {
    const state = replay(plus(freshLoved(), split(0, [0, 1], [[2], [3, 4], [5, 6]])))
    expect(state.bands[0].tiers).toEqual([[2], [1], [5]])
    expect(state.bands[0].unplaced).toEqual([3, 4, 6])
    expect(state.progress.bands[0]).toEqual({ done: 3, total: 6 })
  })

  it('asks Duels in Best first, then Middle, then Lowest, with bounds over the whole Band', () => {
    const log = plus(freshLoved(), split(0, [0, 1], [[2, 3], [4], [5, 6]]))
    // Best: 2 placed, 3 waits. Middle: 1 placed, 4 waits. Lowest: 5 placed, 6 waits.
    expect(replay(log).prompt).toMatchObject({ kind: 'duel', band: 0, sub: 0, a: 3, b: 2, bounds: { lo: 0, hi: 1, pivot: 0 } })
    const afterBest = plus(log, duel(3, 2, 'b'))
    expect(replay(afterBest).prompt).toMatchObject({ kind: 'duel', band: 0, sub: 1, a: 4, b: 1, bounds: { lo: 2, hi: 3, pivot: 2 } })
    const afterMiddle = plus(afterBest, duel(4, 1, 'a'))
    expect(replay(afterMiddle).prompt).toMatchObject({ kind: 'duel', band: 0, sub: 2, a: 6, b: 5, bounds: { lo: 4, hi: 5, pivot: 4 } })
  })

  it('never lets a Duel cross a Sub-band: every Best title stays above every Middle title', () => {
    // The user would rate 6 highest of all, but put it in Lowest: it still ends below the Middle titles.
    let log = plus(freshLoved(), split(0, [0, 1], [[2], [3, 4], [5, 6]]))
    for (let state = replay(log); state.prompt.kind === 'duel'; state = replay(log)) {
      const { a, b } = state.prompt
      log = plus(log, duel(a, b, a > b ? 'a' : 'b'))
    }
    const state = replay(log)
    expect(state.prompt).toEqual({ kind: 'all-complete' })
    expect(state.bands[0].tiers).toEqual([[2], [4], [3], [1], [6], [5]])
  })

  it('scores a split Band exactly like the same order unsplit: Scoring ignores Sub-bands', () => {
    const answerAll = (start: DuelLog, value: (id: number) => number) => {
      let log = start
      for (let state = replay(log); state.prompt.kind === 'duel'; state = replay(log)) {
        const { a, b } = state.prompt
        log = plus(log, duel(a, b, value(a) > value(b) ? 'a' : 'b'))
      }
      return replay(log)
    }
    const splitRanking = answerAll(plus(freshLoved(), split(0, [0, 1], [[2], [3, 4], [5, 6]])), (id) => id)
    // The same final order, 2 > 4 > 3 > 1 > 6 > 5, reached without a split.
    const order = [2, 4, 3, 1, 6, 5]
    const unsplit = answerAll(freshLoved(), (id) => -order.indexOf(id))
    expect(unsplit.bands[0].tiers).toEqual(splitRanking.bands[0].tiers)
    for (const format of ['POINT_10', 'POINT_100', 'POINT_3'] as const) {
      const settings = defaultSettings(format)
      expect(score(splitRanking, format, settings)).toEqual(score(unsplit, format, settings))
    }
  })

  it('has no Sub-bands on a Band that was never split', () => {
    expect(replay(freshLoved()).bands[0].subBands).toBeUndefined()
    expect(replay(freshLoved()).prompt).not.toHaveProperty('sub')
  })
})

/** Loved ranked as 5 > 4 = 6 > 3 > 2 > 1 (higher id better, 6 tied with 4), then `extra` titles assigned to Loved. */
function rankedLoved(extra: number[] = []): DuelLog {
  const ids = [1, 2, 3, 4, 5, 6]
  let log = logOf([...ids, ...extra], ...[...ids, ...extra].map((id) => assign(id, 0)))
  const value = (id: number) => (id === 6 ? 4 : id)
  for (let state = replay(log); state.prompt.kind === 'duel' && ids.includes(state.prompt.a); state = replay(log)) {
    const va = value(state.prompt.a)
    const vb = value(state.prompt.b)
    log = plus(log, duel(state.prompt.a, state.prompt.b, va === vb ? 'tie' : va > vb ? 'a' : 'b'))
  }
  return log
}

describe('splitting a Band that already has ranked titles and Tiers', () => {
  it('cuts the ranked titles by their existing order on Tier edges, keeping every Tier whole', () => {
    const log = rankedLoved([7, 8])
    expect(replay(log).bands[0].tiers).toEqual([[5], [4, 6], [3], [2], [1]])
    const state = replay(plus(log, split(0, [2, 4], [[7], [], [8]])))
    expect(state.bands[0].subBands).toEqual([
      { tiers: [[5], [4, 6]], unplaced: [7] },
      { tiers: [[3], [2]], unplaced: [] },
      { tiers: [[1]], unplaced: [8] },
    ])
    expect(state.prompt).toMatchObject({ kind: 'duel', sub: 0, a: 7, b: 4, bounds: { lo: 0, hi: 2, pivot: 1 } })
  })

  it('allows an empty Sub-band', () => {
    const state = replay(plus(rankedLoved([7]), split(0, [0, 5], [[], [7], []])))
    expect(state.bands[0].subBands?.map((s) => s.tiers.length)).toEqual([0, 5, 0])
  })
})

/** 7 has beaten 3 (it belongs somewhere above 3) and is now asked against 4 = 6. */
const midway = () => plus(rankedLoved([7]), duel(7, 3, 'a'))

describe('splitting while an insertion is in progress', () => {
  it('counts the title as unplaced', () => {
    expect(replay(midway()).prompt).toMatchObject({ kind: 'duel', a: 7, b: 4, bounds: { lo: 0, hi: 2, pivot: 1 } })
    expect(replay(midway()).bands[0].unplaced).toEqual([7])
    expect(() => replay(plus(midway(), split(0, [1, 3], [[], [], []])))).toThrow(ReplayError)
  })

  it('keeps a bound that falls inside its new Sub-band', () => {
    // Middle = 5, 4 = 6, 3, 2: "above 3" still holds there, so it goes on against 4 = 6, not 3.
    const state = replay(plus(midway(), split(0, [0, 4], [[], [7], []])))
    expect(state.prompt).toMatchObject({ kind: 'duel', sub: 1, a: 7, b: 4, bounds: { lo: 0, hi: 2, pivot: 1 } })
    // Middle = 3, 2: "above 3" puts it on top of Middle with no more Duels.
    const top = replay(plus(midway(), split(0, [2, 4], [[], [7], []])))
    expect(top.bands[0].subBands?.[1]).toEqual({ tiers: [[7], [3], [2]], unplaced: [] })
  })

  it('drops a bound that falls outside its new Sub-band', () => {
    // Middle = 4 = 6 only: 3 is in Lowest, so the insertion spans all of Middle again.
    const state = replay(plus(midway(), split(0, [1, 2], [[], [7], []])))
    expect(state.prompt).toMatchObject({ kind: 'duel', sub: 1, a: 7, b: 4, bounds: { lo: 1, hi: 2, pivot: 1 } })
    // Best = 5 only: it starts over against 5.
    const best = replay(plus(midway(), split(0, [1, 4], [[7], [], []])))
    expect(best.prompt).toMatchObject({ kind: 'duel', sub: 0, a: 7, b: 5, bounds: { lo: 0, hi: 1, pivot: 0 } })
  })
})

describe('undoing a split', () => {
  it('cancels the whole split in one step', () => {
    const state = replay(plus(midway(), split(0, [1, 4], [[7], [], []]), undo))
    expect(state).toEqual(replay(midway()))
    expect(state.bands[0].subBands).toBeUndefined()
  })

  it('cannot reach back past a sync', () => {
    const state = replay(plus(freshLoved(), split(0, [0, 1], [[2], [3, 4], [5, 6]]), { type: 'titles-added', ids: [9] }, undo))
    expect(state.bands[0].subBands).toBeDefined()
    expect(state.canUndo).toBe(false)
  })
})

describe('after a split', () => {
  const splitLog = () => plus(freshLoved(), split(0, [0, 1], [[2], [3, 4], [5, 6]]), { type: 'titles-added', ids: [9] })

  it('a new title assigned to the split Band goes to the Sub-band picked with the second tap', () => {
    const state = replay(plus(splitLog(), assign(9, 0, 2)))
    expect(state.bands[0].subBands?.[2].unplaced).toEqual([6, 9])
  })

  it('refuses a Band choice for a split Band without a Sub-band, and a Sub-band for a Band that is not split', () => {
    expect(() => replay(plus(splitLog(), assign(9, 0)))).toThrow(ReplayError)
    expect(() => replay(plus(splitLog(), assign(9, 1, 0)))).toThrow(ReplayError)
  })

  it('splits a Band only once', () => {
    expect(() => replay(plus(splitLog(), split(0, [0, 0], [[], [], []])))).toThrow(ReplayError)
  })

  it('lets a Forgotten title leave a Sub-band like any Band', () => {
    const state = replay(plus(splitLog(), { type: 'forgotten', id: 5 }))
    expect(state.bands[0].subBands?.[2]).toEqual({ tiers: [[6]], unplaced: [] })
  })
})

describe('a Band split the engine cannot trust', () => {
  it('fails loudly when the cut points are not Tier edges of the Band', () => {
    const log = freshLoved() // one Tier
    expect(() => replay(plus(log, split(0, [0, 2], [[2], [3, 4], [5, 6]])))).toThrow(ReplayError)
    expect(() => replay(plus(log, split(0, [1, 0], [[2], [3, 4], [5, 6]])))).toThrow(ReplayError)
    expect(() => replay(plus(log, split(0, [0.5, 1], [[2], [3, 4], [5, 6]])))).toThrow(ReplayError)
  })

  it('fails loudly unless the unplaced titles are exactly those of the Band', () => {
    const log = freshLoved()
    expect(() => replay(plus(log, split(0, [0, 1], [[2], [3, 4], [5]])))).toThrow(ReplayError)
    expect(() => replay(plus(log, split(0, [0, 1], [[2], [3, 4], [5, 6, 1]])))).toThrow(ReplayError)
    expect(() => replay(plus(log, split(0, [0, 1], [[2, 3], [3, 4], [5, 6]])))).toThrow(ReplayError)
  })

  it('refuses a split or a Sub-band in a log written by engine version 1', () => {
    const v1 = (log: DuelLog): DuelLog => ({ ...log, header: { ...log.header, engine: 1 } })
    expect(() => replay(v1(plus(freshLoved(), split(0, [0, 1], [[2], [3, 4], [5, 6]]))))).toThrow(ReplayError)
    expect(() => replay(v1(logOf([1], assign(1, 0, 1))))).toThrow(ReplayError)
  })

  it('upgrades an engine version 1 log when an event is appended, so the split replays', () => {
    const old: DuelLog = { ...freshLoved(), header: { ...freshLoved().header, engine: 1 } }
    const state = replay(appendEvent(old, split(0, [0, 1], [[2], [3, 4], [5, 6]])))
    expect(state.bands[0].subBands).toBeDefined()
  })
})

describe('a golden log with a Band split', () => {
  // Fixed log + fixed result: if this breaks, saved progress would replay differently (ADR 0005).
  const golden: DuelLog = {
    header: { format: 1, engine: 2, seed: 7, userId: 5, mediaType: 'ANIME' },
    events: [
      { type: 'titles-added', ids: [1, 2, 3, 4, 5, 6, 7] },
      { type: 'band-assigned', id: 1, band: 0 },
      { type: 'band-assigned', id: 2, band: 0 },
      { type: 'band-assigned', id: 3, band: 0 },
      { type: 'band-assigned', id: 4, band: 0 },
      { type: 'band-assigned', id: 5, band: 0 },
      { type: 'band-assigned', id: 6, band: 2 },
      { type: 'band-assigned', id: 7, band: 0 },
      { type: 'duel-answered', a: 2, b: 1, result: 'a' },
      { type: 'duel-answered', a: 3, b: 1, result: 'b' },
      { type: 'band-split', band: 0, cuts: [1, 1], unplaced: [[], [5, 7], [4]] },
      { type: 'undo' },
      { type: 'band-split', band: 0, cuts: [1, 2], unplaced: [[5], [7], [4]] },
      { type: 'titles-added', ids: [8] },
      { type: 'band-assigned', id: 8, band: 0, sub: 1 },
      { type: 'duel-answered', a: 5, b: 2, result: 'tie' },
      { type: 'duel-answered', a: 7, b: 1, result: 'b' },
    ],
  }

  it('replays to the same Ranking every time', () => {
    const expected = {
      prompt: { kind: 'duel', band: 0, sub: 1, a: 8, b: 7, left: 8, right: 7, bounds: { lo: 1, hi: 3, pivot: 2 } },
      bands: [
        {
          tiers: [[2, 5], [1], [7], [3]],
          unplaced: [8, 4],
          subBands: [
            { tiers: [[2, 5]], unplaced: [] },
            { tiers: [[1], [7]], unplaced: [8] },
            { tiers: [[3]], unplaced: [4] },
          ],
        },
        { tiers: [], unplaced: [] },
        { tiers: [[6]], unplaced: [] },
        { tiers: [], unplaced: [] },
        { tiers: [], unplaced: [] },
      ],
      forgotten: [],
      progress: {
        roughSort: { done: 8, total: 8 },
        bands: [
          { done: 5, total: 7 },
          { done: 0, total: 0 },
          { done: 1, total: 1 },
          { done: 0, total: 0 },
          { done: 0, total: 0 },
        ],
        ranked: { done: 6, total: 8 },
      },
      bandChoice: null,
      canUndo: true,
    }
    expect(replay(golden)).toEqual(expected)
    expect(replay(golden)).toEqual(expected)
  })
})
