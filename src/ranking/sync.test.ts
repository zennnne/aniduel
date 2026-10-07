// Sync (issue #13, ADR 0005): titles join and leave the Pool through `titles-added` / `titles-removed` events.
import { describe, expect, it } from 'vitest'
import { ReplayError, appendEvent, replay, startLog, type DuelLog, type LogEvent } from './engine.ts'

const header = { seed: 42, userId: 7, mediaType: 'ANIME' as const }

function logOf(ids: number[], ...events: LogEvent[]): DuelLog {
  return events.reduce(appendEvent, startLog({ ...header, ids }))
}

/** Answers every prompt from `value` (higher = better) and `band`, until the Ranking is finished. */
function finish(log: DuelLog, band: (id: number) => 0 | 1 | 2 | 3 | 4, value: (id: number) => number): DuelLog {
  for (let s = replay(log); s.prompt.kind !== 'all-complete'; s = replay(log)) {
    const p = s.prompt
    if (p.kind === 'rough-sort') log = appendEvent(log, { type: 'band-assigned', id: p.id, band: band(p.id) })
    else if (s.bandChoice) log = appendEvent(log, { type: 'band-selected', band: s.bandChoice.next })
    else {
      const [va, vb] = [value(p.a), value(p.b)]
      log = appendEvent(log, { type: 'duel-answered', a: p.a, b: p.b, result: va === vb ? 'tie' : va > vb ? 'a' : 'b' })
    }
  }
  return log
}

const removed = (...ids: number[]): LogEvent => ({ type: 'titles-removed', ids })
const added = (...ids: number[]): LogEvent => ({ type: 'titles-added', ids })

describe('titles removed in the middle of a Ranking', () => {
  // Five titles in Loved, value = id: finished order 5 > 4 > 3 > 2 > 1.
  const ranked = finish(logOf([1, 2, 3, 4, 5]), () => 0, (id) => id)

  it('takes a placed title out; the rest keep their order', () => {
    const state = replay(appendEvent(ranked, removed(3)))
    expect(state.bands[0].tiers).toEqual([[5], [4], [2], [1]])
    expect(state.prompt).toEqual({ kind: 'all-complete' })
    expect(state.progress.roughSort).toEqual({ done: 4, total: 4 })
    expect(state.progress.ranked).toEqual({ done: 4, total: 4 })
  })

  it('takes out the title being inserted; the next one in the queue is prompted', () => {
    // Loved: 1 placed, then 2 and 3 waiting; 2 is mid-insertion against 1.
    const log = logOf([1, 2, 3], ...[1, 2, 3].map((id): LogEvent => ({ type: 'band-assigned', id, band: 0 })))
    expect(replay(log).prompt).toMatchObject({ kind: 'duel', a: 2, b: 1 })
    const state = replay(appendEvent(log, removed(2)))
    expect(state.prompt).toMatchObject({ kind: 'duel', a: 3, b: 1 })
    expect(state.bands[0].unplaced).toEqual([3])
  })

  it('takes out the pivot of an insertion in progress; the insertion keeps its bounds (ADR 0005)', () => {
    // Loved ranked 5 > 4 > 3 > 2 > 1 by value; then 6 (value 3.5) is added and sorted into Loved.
    const value = (id: number) => (id === 6 ? 3.5 : id)
    let log = appendEvent(ranked, added(6))
    log = appendEvent(log, { type: 'band-assigned', id: 6, band: 0 })
    log = appendEvent(log, { type: 'band-selected', band: 0 })
    const first = replay(log).prompt
    expect(first).toMatchObject({ kind: 'duel', a: 6, b: 3 })
    log = appendEvent(log, { type: 'duel-answered', a: 6, b: 3, result: 'a' }) // 6 is above 3
    const second = replay(log).prompt
    expect(second).toMatchObject({ kind: 'duel', a: 6, b: 4 })
    log = appendEvent(log, removed(4)) // the pivot leaves the Pool
    const state = replay(finish(log, () => 0, value))
    expect(state.bands[0].tiers).toEqual([[5], [6], [3], [2], [1]])
  })

  it('takes a title out of the Rough Sort queue', () => {
    const state = replay(logOf([1, 2, 3], removed(1)))
    expect(state.prompt).toEqual({ kind: 'rough-sort', id: 2 })
    expect(state.progress.roughSort).toEqual({ done: 0, total: 2 })
  })

  it('takes a Forgotten title out of the Forgotten set', () => {
    const state = replay(logOf([1, 2], { type: 'forgotten', id: 1 }, removed(1)))
    expect(state.forgotten).toEqual([])
    expect(state.progress.roughSort).toEqual({ done: 0, total: 1 })
  })

  it('takes a title out of a split Band', () => {
    const ids = [1, 2, 3, 4]
    let log = logOf(ids, ...ids.map((id): LogEvent => ({ type: 'band-assigned', id, band: 0 })))
    log = appendEvent(log, { type: 'band-split', band: 0, cuts: [0, 1], unplaced: [[2], [3], [4]] })
    // 2 and 4 land in empty Sub-bands with no Duel; 3 waits in Middle for a Duel against 1.
    expect(replay(log).bands[0].subBands?.map((sb) => sb.unplaced)).toEqual([[], [3], []])
    const state = replay(appendEvent(log, removed(3)))
    expect(state.bands[0].subBands?.map((sb) => sb.tiers)).toEqual([[[2]], [[1]], [[4]]])
    expect(state.bands[0].unplaced).toEqual([])
  })
})

describe('titles added in the middle of a Ranking', () => {
  const ranked = finish(logOf([1, 2, 3]), () => 0, (id) => id)

  it('go to Rough Sort first, then a Band choice is due again (#8)', () => {
    let log = appendEvent(ranked, added(10, 11))
    expect(replay(log).prompt).toEqual({ kind: 'rough-sort', id: 10 })
    expect(replay(log).progress.roughSort).toEqual({ done: 3, total: 5 })
    log = appendEvent(log, { type: 'band-assigned', id: 10, band: 0 })
    log = appendEvent(log, { type: 'band-assigned', id: 11, band: 3 })
    const state = replay(log)
    expect(state.bandChoice).toEqual({ finished: null, next: 0 })
    expect(state.prompt).toMatchObject({ kind: 'duel', band: 0, a: 10 })
  })

  it('are placed by Duels inside their Band', () => {
    const value = (id: number) => (id === 10 ? 2.5 : id)
    const log = finish(appendEvent(ranked, added(10)), () => 0, value)
    expect(replay(log).bands[0].tiers).toEqual([[3], [10], [2], [1]])
  })

  it('in a split Band need the Sub-band (the second tap); never Middle by default', () => {
    const ids = [1, 2, 3, 4]
    let log = logOf(ids, ...ids.map((id): LogEvent => ({ type: 'band-assigned', id, band: 0 })))
    log = appendEvent(log, { type: 'band-split', band: 0, cuts: [0, 1], unplaced: [[2], [3], [4]] })
    log = appendEvent(log, added(9))
    expect(() => replay(appendEvent(log, { type: 'band-assigned', id: 9, band: 0 }))).toThrow(ReplayError)
    const state = replay(appendEvent(log, { type: 'band-assigned', id: 9, band: 0, sub: 2 }))
    expect(state.bands[0].subBands?.[2]).toEqual({ tiers: [[4]], unplaced: [9] })
  })

  it('a title removed and added again starts again from Rough Sort, with no place and not Forgotten', () => {
    let log = appendEvent(appendEvent(ranked, { type: 'forgotten', id: 2 }), removed(2))
    log = appendEvent(log, added(2))
    const state = replay(log)
    expect(state.prompt).toEqual({ kind: 'rough-sort', id: 2 })
    expect(state.forgotten).toEqual([])
    expect(state.bands[0].tiers).toEqual([[3], [1]])
  })
})

describe('sync events and Undo', () => {
  it('are a barrier: Undo never cancels them or anything before them', () => {
    const log = logOf([1, 2], { type: 'band-assigned', id: 1, band: 0 }, removed(2), { type: 'undo' })
    const state = replay(log)
    expect(state.bands[0].tiers).toEqual([[1]])
    expect(state.canUndo).toBe(false)
  })

  it('answers after a sync can still be undone', () => {
    const log = logOf([1], added(2), { type: 'band-assigned', id: 1, band: 0 }, { type: 'undo' })
    expect(replay(log).prompt).toEqual({ kind: 'rough-sort', id: 1 })
  })
})

describe('a titles-removed the engine cannot trust', () => {
  it('fails loudly for a title that is not in the Pool', () => {
    expect(() => replay(logOf([1], removed(9)))).toThrow(ReplayError)
    expect(() => replay(logOf([1], removed(1), removed(1)))).toThrow(ReplayError)
  })

  it('is refused in a log whose header says an engine older than 4', () => {
    const log = logOf([1, 2], removed(2))
    expect(() => replay({ ...log, header: { ...log.header, engine: 3 } })).toThrow(ReplayError)
  })
})

describe('a golden sync log', () => {
  // Fixed log + fixed result: if this breaks, saved progress with syncs would replay differently (ADR 0005).
  // 1 is removed mid-Ranking (it was 2's Duel opponent), the Undo can't cross the sync, and 1 comes back as new.
  const golden: DuelLog = {
    header: { format: 1, engine: 4, seed: 987654321, userId: 5, mediaType: 'ANIME' },
    events: [
      { type: 'titles-added', ids: [1, 2, 3, 4] },
      { type: 'band-assigned', id: 1, band: 0 },
      { type: 'band-assigned', id: 2, band: 0 },
      { type: 'band-assigned', id: 3, band: 0 },
      { type: 'forgotten', id: 4 },
      { type: 'duel-answered', a: 2, b: 1, result: 'a' },
      { type: 'titles-removed', ids: [1, 4] },
      { type: 'undo' },
      { type: 'titles-added', ids: [1, 5] },
      { type: 'band-assigned', id: 1, band: 2 },
    ],
  }

  it('replays to the same state every time', () => {
    const expected = {
      prompt: { kind: 'rough-sort', id: 5 },
      bands: [
        { tiers: [[2]], unplaced: [3] },
        { tiers: [], unplaced: [] },
        { tiers: [[1]], unplaced: [] },
        { tiers: [], unplaced: [] },
        { tiers: [], unplaced: [] },
      ],
      forgotten: [],
      progress: {
        roughSort: { done: 3, total: 4 },
        bands: [
          { done: 1, total: 2 },
          { done: 0, total: 0 },
          { done: 1, total: 1 },
          { done: 0, total: 0 },
          { done: 0, total: 0 },
        ],
        ranked: { done: 2, total: 3 },
      },
      bandChoice: null,
      canUndo: true,
    }
    expect(replay(golden)).toEqual({ ...expected, board: expect.anything() }) // the Board is display only
    expect(replay(structuredClone(golden))).toEqual({ ...expected, board: expect.anything() })
  })
})
