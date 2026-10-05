import { describe, expect, it } from 'vitest'
import { ReplayError, answeredDuels, replay, startLog, type BandIndex, type DuelLog, type LogEvent } from './engine.ts'

const header = { seed: 42, userId: 7, mediaType: 'ANIME' as const }

function logOf(ids: number[], ...events: LogEvent[]): DuelLog {
  const log = startLog({ ...header, ids })
  return { ...log, events: [...log.events, ...events] }
}

const assign = (id: number, band: BandIndex): LogEvent => ({ type: 'band-assigned', id, band })
const duel = (a: number, b: number, result: 'a' | 'b' | 'tie'): LogEvent => ({ type: 'duel-answered', a, b, result })
const forget = (id: number): LogEvent => ({ type: 'forgotten', id })

/** Answers every prompt through replay with a consistent oracle (higher value = better) until all is complete. */
function answerAll(log: DuelLog, value: (id: number) => number, limit = 100_000): { log: DuelLog; duels: number } {
  let duels = 0
  for (let state = replay(log); state.prompt.kind !== 'all-complete'; state = replay(log)) {
    const p = state.prompt
    if (p.kind !== 'duel') throw new Error(`Expected a Duel, got ${p.kind}`)
    const va = value(p.a)
    const vb = value(p.b)
    log = { ...log, events: [...log.events, duel(p.a, p.b, va === vb ? 'tie' : va > vb ? 'a' : 'b')] }
    if (++duels > limit) throw new Error('Too many Duels')
  }
  return { log, duels }
}

/** Band 0 ranked as 5 > 4 > 3 > 2 > 1 (value = id), then `extra` titles added later (waiting in Rough Sort). */
function rankedBand(extra: number[] = []): DuelLog {
  const ids = [1, 2, 3, 4, 5]
  const { log } = answerAll(logOf(ids, ...ids.map((id) => assign(id, 0))), (id) => id)
  return extra.length ? plus(log, { type: 'titles-added', ids: extra }) : log
}

const plus = (log: DuelLog, ...events: LogEvent[]): DuelLog => ({ ...log, events: [...log.events, ...events] })

describe('Duels inside a Band', () => {
  it('after Rough Sort, asks the second title of a Band against the first', () => {
    const state = replay(logOf([1, 2], assign(1, 0), assign(2, 0)))
    expect(state.prompt).toMatchObject({ kind: 'duel', band: 0, a: 2, b: 1 })
  })

  it('places the winner above the loser, whichever side the answer names', () => {
    const newBetter = replay(logOf([1, 2], assign(1, 0), assign(2, 0), duel(2, 1, 'a')))
    expect(newBetter.bands[0].tiers).toEqual([[2], [1]])
    expect(newBetter.prompt).toEqual({ kind: 'all-complete' })
    const oldBetter = replay(logOf([1, 2], assign(1, 0), assign(2, 0), duel(1, 2, 'a')))
    expect(oldBetter.bands[0].tiers).toEqual([[1], [2]])
  })

  it('compares a new title with the middle of its Band first, then halves the interval', () => {
    // Band: 3 > 2 > 1 after two answers; title 4 starts against the middle (2).
    const ranked = [assign(1, 0), assign(2, 0), assign(3, 0), assign(4, 0), duel(2, 1, 'a'), duel(3, 1, 'a')]
    const s1 = replay(logOf([1, 2, 3, 4], ...ranked))
    expect(s1.prompt).toMatchObject({ kind: 'duel', a: 3, b: 2 })
    const s2 = replay(logOf([1, 2, 3, 4], ...ranked, duel(3, 2, 'a')))
    expect(s2.bands[0].tiers).toEqual([[3], [2], [1]])
    expect(s2.prompt).toMatchObject({ kind: 'duel', a: 4, b: 2, bounds: { lo: 0, hi: 3, pivot: 1 } })
    const s3 = replay(logOf([1, 2, 3, 4], ...ranked, duel(3, 2, 'a'), duel(4, 2, 'b')))
    expect(s3.prompt).toMatchObject({ kind: 'duel', a: 4, b: 1, bounds: { lo: 2, hi: 3, pivot: 2 } })
    const s4 = replay(logOf([1, 2, 3, 4], ...ranked, duel(3, 2, 'a'), duel(4, 2, 'b'), duel(4, 1, 'a')))
    expect(s4.bands[0].tiers).toEqual([[3], [2], [4], [1]])
    expect(s4.prompt).toEqual({ kind: 'all-complete' })
  })

  it('"about the same" puts the title into the existing Tier, which then counts as one place', () => {
    const tied = [assign(1, 2), assign(2, 2), assign(3, 2), duel(2, 1, 'tie')]
    const s1 = replay(logOf([1, 2, 3], ...tied))
    expect(s1.bands[2].tiers).toEqual([[1, 2]])
    // A Tier pivot shows its first-inserted member.
    expect(s1.prompt).toMatchObject({ kind: 'duel', band: 2, a: 3, b: 1, bounds: { lo: 0, hi: 1, pivot: 0 } })
    const s2 = replay(logOf([1, 2, 3], ...tied, duel(3, 1, 'b')))
    expect(s2.bands[2].tiers).toEqual([[1, 2], [3]])
    expect(s2.prompt).toEqual({ kind: 'all-complete' })
  })

  it('reports placed titles per Band and overall', () => {
    const state = replay(logOf([1, 2, 3, 4], assign(1, 0), assign(2, 0), assign(3, 0), assign(4, 1), duel(2, 1, 'b')))
    expect(state.progress.bands.slice(0, 2)).toEqual([
      { done: 2, total: 3 },
      { done: 1, total: 1 },
    ])
    expect(state.progress.ranked).toEqual({ done: 3, total: 4 })
    expect(state.bands[0].unplaced).toEqual([3])
  })
})

describe('Forgotten during a Duel', () => {
  it('takes the title being inserted out of the Band and moves on to the next one', () => {
    const state = replay(logOf([1, 2, 3], assign(1, 0), assign(2, 0), assign(3, 0), forget(2)))
    expect(state.forgotten).toEqual([2])
    expect(state.bands[0].unplaced).toEqual([3])
    expect(state.prompt).toMatchObject({ kind: 'duel', a: 3, b: 1 })
  })

  it('takes a placed title out of the Ranking, and the others keep their order', () => {
    const state = replay(plus(rankedBand(), forget(3)))
    expect(state.bands[0].tiers).toEqual([[5], [4], [2], [1]])
    expect(state.progress.bands[0]).toEqual({ done: 4, total: 4 })
  })

  it("keeps the inserting title's bounds when the pivot is marked Forgotten", () => {
    // Title 6 beats 3, so it sits above 3; the next pivot is 4. Forgetting 4 keeps "above 3".
    const log = plus(rankedBand([6]), assign(6, 0))
    const s1 = replay(plus(log, duel(6, 3, 'a')))
    expect(s1.prompt).toMatchObject({ kind: 'duel', a: 6, b: 4 })
    const s2 = replay(plus(log, duel(6, 3, 'a'), forget(4)))
    expect(s2.bands[0].tiers).toEqual([[5], [3], [2], [1]])
    expect(s2.prompt).toMatchObject({ kind: 'duel', a: 6, b: 5, bounds: { lo: 0, hi: 1, pivot: 0 } })
  })

  it('moves a bound one Tier outward when the bound Tier disappears', () => {
    // 6 is known to be better than 3; forgetting 3 makes the bound "better than 2".
    const log = plus(rankedBand([6]), assign(6, 0), duel(6, 3, 'a'), forget(3))
    const state = replay(log)
    expect(state.bands[0].tiers).toEqual([[5], [4], [2], [1]])
    expect(state.prompt).toMatchObject({ kind: 'duel', a: 6, b: 4, bounds: { lo: 0, hi: 2, pivot: 1 } })
  })

  it("shows the next still-present member when a Tier pivot's face is Forgotten", () => {
    const log = logOf([1, 2, 3], assign(1, 1), assign(2, 1), assign(3, 1), duel(2, 1, 'tie'), forget(1))
    const state = replay(log)
    expect(state.bands[1].tiers).toEqual([[2]])
    expect(state.prompt).toMatchObject({ kind: 'duel', a: 3, b: 2 })
  })
})

describe('the order Duels are asked in', () => {
  it('never starts a Duel while a title waits in Rough Sort', () => {
    const state = replay(logOf([1, 2, 3], assign(1, 0), assign(2, 0)))
    expect(state.prompt).toEqual({ kind: 'rough-sort', id: 3 })
  })

  it('works through the Bands from the top down', () => {
    const log = logOf([1, 2, 3, 4], assign(1, 3), assign(2, 3), assign(3, 0), assign(4, 0))
    expect(replay(log).prompt).toMatchObject({ kind: 'duel', band: 0, a: 4, b: 3 })
    expect(replay(plus(log, duel(4, 3, 'a'))).prompt).toMatchObject({ kind: 'duel', band: 3, a: 2, b: 1 })
  })
})

describe('a log with a Duel answer the engine would not prompt', () => {
  it('fails loudly when the pair is not the one prompted', () => {
    const log = logOf([1, 2, 3], assign(1, 0), assign(2, 0), assign(3, 0))
    expect(() => replay(plus(log, duel(3, 1, 'a')))).toThrow(ReplayError)
    expect(() => replay(plus(log, duel(2, 1, 'a'), duel(3, 2, 'a')))).toThrow(ReplayError)
  })

  it('fails loudly when a Duel answer comes during Rough Sort or after everything is ranked', () => {
    expect(() => replay(logOf([1, 2, 3], assign(1, 0), assign(2, 0), duel(2, 1, 'a')))).toThrow(ReplayError)
    expect(() => replay(logOf([1, 2], assign(1, 0), assign(2, 0), duel(2, 1, 'a'), duel(2, 1, 'a')))).toThrow(ReplayError)
  })

  it('accepts the pair in either order, because the answer names the winner by id', () => {
    const state = replay(logOf([1, 2], assign(1, 0), assign(2, 0), duel(1, 2, 'b')))
    expect(state.bands[0].tiers).toEqual([[2], [1]])
  })
})

describe('left and right on the Duel card', () => {
  function sidesFor(seed: number, first: number, second: number) {
    const log = startLog({ ...header, seed, ids: [first, second] })
    const state = replay(plus(log, assign(first, 0), assign(second, 0)))
    if (state.prompt.kind !== 'duel') throw new Error('expected a Duel')
    return { left: state.prompt.left, right: state.prompt.right, inserting: state.prompt.a }
  }

  it('depends only on the seed and the pair, not on which title is being inserted', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const one = sidesFor(seed, 10, 20)
      const other = sidesFor(seed, 20, 10)
      expect([one.left, one.right].sort()).toEqual([10, 20])
      expect(other.left).toBe(one.left)
      expect(sidesFor(seed, 10, 20)).toEqual(one)
    }
  })

  it('puts the new title on either side, depending on the seed', () => {
    let newOnLeft = 0
    for (let seed = 1; seed <= 200; seed++) {
      const s = sidesFor(seed, 10, 20)
      if (s.left === s.inserting) newOnLeft++
    }
    expect(newOnLeft).toBeGreaterThan(60)
    expect(newOnLeft).toBeLessThan(140)
  })

  it('never affects replay: the stored answer names ids, not sides', () => {
    for (const seed of [1, 2, 3, 4]) {
      const log = startLog({ ...header, seed, ids: [1, 2] })
      const state = replay(plus(log, assign(1, 0), assign(2, 0), duel(2, 1, 'a')))
      expect(state.bands[0].tiers).toEqual([[2], [1]])
    }
  })
})

describe('a golden log with Duels', () => {
  // Fixed log + fixed result: if this breaks, saved progress would replay differently (ADR 0005).
  const golden: DuelLog = {
    header: { format: 1, engine: 1, seed: 99, userId: 5, mediaType: 'ANIME' },
    events: [
      { type: 'titles-added', ids: [1, 2, 3, 4, 5, 6] },
      { type: 'band-assigned', id: 1, band: 0 },
      { type: 'band-assigned', id: 2, band: 0 },
      { type: 'band-assigned', id: 3, band: 0 },
      { type: 'band-assigned', id: 4, band: 1 },
      { type: 'band-assigned', id: 5, band: 0 },
      { type: 'band-assigned', id: 6, band: 1 },
      { type: 'duel-answered', a: 2, b: 1, result: 'a' },
      { type: 'duel-answered', a: 1, b: 3, result: 'tie' },
      { type: 'duel-answered', a: 5, b: 1, result: 'a' },
      { type: 'forgotten', id: 2 },
      { type: 'duel-answered', a: 4, b: 6, result: 'b' },
      { type: 'undo' },
      { type: 'duel-answered', a: 6, b: 4, result: 'tie' },
    ],
  }

  it('replays to the same Ranking every time', () => {
    const expected = {
      prompt: { kind: 'all-complete' },
      bands: [
        { tiers: [[5], [1, 3]], unplaced: [] },
        { tiers: [[4, 6]], unplaced: [] },
        { tiers: [], unplaced: [] },
        { tiers: [], unplaced: [] },
        { tiers: [], unplaced: [] },
      ],
      forgotten: [2],
      progress: {
        roughSort: { done: 6, total: 6 },
        bands: [
          { done: 3, total: 3 },
          { done: 2, total: 2 },
          { done: 0, total: 0 },
          { done: 0, total: 0 },
          { done: 0, total: 0 },
        ],
        ranked: { done: 5, total: 5 },
      },
      bandChoice: null,
      canUndo: true,
    }
    expect(replay(golden)).toEqual(expected)
    expect(replay(golden)).toEqual(expected)
  })
})

describe('Undo of Duel answers', () => {
  it('cancels the last answers and asks those Duels again', () => {
    const log = logOf([1, 2, 3], assign(1, 0), assign(2, 0), assign(3, 0), duel(2, 1, 'a'), duel(3, 1, 'tie'))
    const state = replay(plus(log, { type: 'undo' }, { type: 'undo' }))
    expect(state.bands[0].tiers).toEqual([[1]])
    expect(state.prompt).toMatchObject({ kind: 'duel', a: 2, b: 1 })
  })
})

describe('Answered Duels (the Start over count)', () => {
  it('counts only the Duel answers that still count, not the ones Undo cancelled', () => {
    const log = logOf([1, 2, 3], assign(1, 0), assign(2, 0), assign(3, 0), duel(2, 1, 'a'), duel(3, 1, 'tie'))
    expect(answeredDuels(log)).toBe(2)
    expect(answeredDuels(plus(log, { type: 'undo' }))).toBe(1)
    expect(answeredDuels(plus(log, { type: 'undo' }, { type: 'undo' }))).toBe(0)
  })
})
