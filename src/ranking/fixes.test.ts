// Fixing the Ranking (ADR 0005, ADR 0006): Band moved, Re-rank requested, Unforgotten.
import { describe, expect, it } from 'vitest'
import { ReplayError, appendEvent, replay, startLog, type BandIndex, type DuelLog, type LogEvent, type SubBandIndex } from './engine.ts'

const header = { seed: 42, userId: 7, mediaType: 'ANIME' as const }

function logOf(ids: number[], ...events: LogEvent[]): DuelLog {
  return plus(startLog({ ...header, ids }), ...events)
}

const plus = (log: DuelLog, ...events: LogEvent[]): DuelLog => events.reduce(appendEvent, log)
const assign = (id: number, band: BandIndex, sub?: SubBandIndex): LogEvent =>
  sub === undefined ? { type: 'band-assigned', id, band } : { type: 'band-assigned', id, band, sub }
const duel = (a: number, b: number, result: 'a' | 'b' | 'tie'): LogEvent => ({ type: 'duel-answered', a, b, result })
const move = (id: number, band: BandIndex, sub?: SubBandIndex): LogEvent =>
  sub === undefined ? { type: 'band-moved', id, band } : { type: 'band-moved', id, band, sub }
const rerank = (id: number): LogEvent => ({ type: 'rerank-requested', id })
const forget = (id: number): LogEvent => ({ type: 'forgotten', id })
const unforget = (id: number): LogEvent => ({ type: 'unforgotten', id })
const undo: LogEvent = { type: 'undo' }

/** Answers every Duel by `value` (higher is better; equal = tie) until the prompt is no longer a Duel. */
function answerAll(start: DuelLog, value: (id: number) => number): DuelLog {
  let log = start
  for (let state = replay(log); state.prompt.kind === 'duel'; state = replay(log)) {
    const { a, b } = state.prompt
    log = plus(log, duel(a, b, value(a) === value(b) ? 'tie' : value(a) > value(b) ? 'a' : 'b'))
  }
  return log
}

const byId = (id: number) => -id

/** Lower id = better. 1-4 Loved, 5-7 Okay, everything ranked: Loved [1][2][3][4], Okay [5][6][7]. */
const finished = () =>
  answerAll(
    logOf([1, 2, 3, 4, 5, 6, 7], assign(1, 0), assign(2, 0), assign(3, 0), assign(4, 0), assign(5, 2), assign(6, 2), assign(7, 2)),
    byId,
  )

describe('Band moved', () => {
  it('takes a ranked title out, keeps the others in order, and prompts its insertion in the new Band next', () => {
    const before = replay(finished())
    expect(before.prompt).toEqual({ kind: 'all-complete' })
    expect(before.bands[0].tiers).toEqual([[1], [2], [3], [4]])
    const state = replay(plus(finished(), move(2, 2)))
    expect(state.bands[0].tiers).toEqual([[1], [3], [4]])
    expect(state.bands[2].unplaced).toEqual([2])
    expect(state.bandChoice).toBeNull()
    expect(state.prompt).toMatchObject({ kind: 'duel', band: 2, a: 2, b: 6 })
  })

  it('goes back to a finished Ranking once the moved title has its place', () => {
    const state = replay(answerAll(plus(finished(), move(2, 2)), byId))
    expect(state.bands[2].tiers).toEqual([[2], [5], [6], [7]])
    expect(state.prompt).toEqual({ kind: 'all-complete' })
    expect(state.bandChoice).toBeNull()
  })

  it('is undone as one step: the title is back exactly where its old answers put it', () => {
    expect(replay(plus(finished(), move(2, 2), undo))).toEqual(replay(finished()))
    const placed = answerAll(plus(finished(), move(2, 2)), byId)
    const duels = placed.events.length - finished().events.length - 1
    expect(replay(plus(placed, ...Array<LogEvent>(duels + 1).fill(undo)))).toEqual(replay(finished()))
  })

  it('moves the pivot of an insertion in progress: it is placed first, then the interrupted insertion goes on', () => {
    // Loved: 3 is placed first; 1, 5, 2, 4 wait. Okay: 6.
    let log = logOf([3, 1, 5, 2, 4, 6], assign(3, 0), assign(1, 0), assign(5, 0), assign(2, 0), assign(4, 0), assign(6, 2))
    for (let s = replay(log); s.prompt.kind === 'duel' && s.prompt.a !== 4; s = replay(log)) {
      const { a, b } = s.prompt
      log = plus(log, duel(a, b, a < b ? 'a' : 'b'))
    }
    expect(replay(log).bands[0].tiers).toEqual([[1], [2], [3], [5]])
    expect(replay(log).prompt).toMatchObject({ kind: 'duel', band: 0, a: 4, b: 3 })

    const moved = plus(log, move(3, 2))
    expect(replay(moved).bands[0].tiers).toEqual([[1], [2], [5]])
    expect(replay(moved).prompt).toMatchObject({ kind: 'duel', band: 2, a: 3, b: 6 })

    const back = plus(moved, duel(3, 6, 'a'))
    expect(replay(back).bands[2].tiers).toEqual([[3], [6]])
    expect(replay(back).bandChoice).toBeNull()
    expect(replay(back).prompt).toMatchObject({ kind: 'duel', band: 0, a: 4, b: 2 })
    expect(replay(answerAll(back, byId)).bands[0].tiers).toEqual([[1], [2], [4], [5]])
  })

  it('moves the title being inserted out of its Duel, then Duels go back to the Band they were in', () => {
    // Loved: 1 placed, 2 and 3 wait. Okay: 5 placed.
    const log = logOf([1, 2, 3, 5], assign(1, 0), assign(2, 0), assign(3, 0), assign(5, 2), duel(2, 1, 'b'))
    expect(replay(log).prompt).toMatchObject({ kind: 'duel', band: 0, a: 3 })
    const moved = plus(log, move(3, 2))
    expect(replay(moved).prompt).toMatchObject({ kind: 'duel', band: 2, a: 3, b: 5 })
    const state = replay(plus(moved, duel(3, 5, 'a')))
    expect(state.bands[2].tiers).toEqual([[3], [5]])
    expect(state.bandChoice).toBeNull()
    expect(state.prompt).toEqual({ kind: 'all-complete' })
  })

  it('is placed at once in an empty Band', () => {
    const state = replay(plus(finished(), move(4, 4)))
    expect(state.bands[4].tiers).toEqual([[4]])
    expect(state.prompt).toEqual({ kind: 'all-complete' })
  })

  it('is refused for a title in no Band (Rough Sort or Forgotten), or in a log older than engine version 5', () => {
    expect(() => replay(logOf([1, 2], move(1, 0)))).toThrow(ReplayError)
    expect(() => replay(plus(finished(), forget(2), move(2, 1)))).toThrow(ReplayError)
    const old = { ...plus(finished(), move(2, 2)), header: { ...finished().header, engine: 4 } }
    expect(() => replay(old)).toThrow(ReplayError)
  })
})

describe('Re-rank requested', () => {
  it('runs only the Duels needed to place that one title, then the Ranking is finished again', () => {
    let log = plus(finished(), rerank(3))
    expect(replay(log).bands[0]).toEqual({ tiers: [[1], [2], [4]], unplaced: [3] })
    expect(replay(log).prompt).toMatchObject({ kind: 'duel', band: 0, a: 3, b: 2 })
    // This time 3 is the worst of Loved.
    let duels = 0
    for (let s = replay(log); s.prompt.kind === 'duel'; s = replay(log), duels++) {
      log = plus(log, duel(s.prompt.a, s.prompt.b, s.prompt.a === 3 ? 'b' : 'a'))
    }
    expect(duels).toBe(2)
    expect(replay(log).bands[0].tiers).toEqual([[1], [2], [4], [3]])
    expect(replay(log).prompt).toEqual({ kind: 'all-complete' })
  })

  it('is undone as one step, and the other titles never lose their order', () => {
    expect(replay(plus(finished(), rerank(3), undo))).toEqual(replay(finished()))
    const state = replay(plus(finished(), rerank(6)))
    expect(state.bands[2]).toEqual({ tiers: [[5], [7]], unplaced: [6] })
    expect(state.bands[0].tiers).toEqual([[1], [2], [3], [4]])
  })

  it('is refused for a title in no Band', () => {
    expect(() => replay(plus(finished(), forget(3), rerank(3)))).toThrow(ReplayError)
  })
})

describe('Unforgotten', () => {
  it('goes to the front of its last Band and is placed next', () => {
    const state = replay(plus(finished(), forget(2), unforget(2)))
    expect(state.forgotten).toEqual([])
    expect(state.bands[0]).toEqual({ tiers: [[1], [3], [4]], unplaced: [2] })
    expect(state.bandChoice).toBeNull()
    expect(state.prompt).toMatchObject({ kind: 'duel', band: 0, a: 2, b: 3 })
    expect(replay(answerAll(plus(finished(), forget(2), unforget(2)), byId)).bands[0].tiers).toEqual([[1], [2], [3], [4]])
  })

  it('goes back to Rough Sort if it never had a Band, and is placed straight after its Band is picked', () => {
    const done = answerAll(logOf([1, 2, 3], forget(1), assign(2, 0), assign(3, 0)), byId)
    expect(replay(done).prompt).toEqual({ kind: 'all-complete' })
    const back = plus(done, unforget(1))
    expect(replay(back).prompt).toEqual({ kind: 'rough-sort', id: 1 })
    const state = replay(plus(back, assign(1, 0)))
    expect(state.bandChoice).toBeNull()
    expect(state.prompt).toMatchObject({ kind: 'duel', band: 0, a: 1 })
  })

  it('goes to the front of the Rough Sort queue when Rough Sort is not done', () => {
    expect(replay(logOf([1, 2, 3], forget(2), unforget(2))).prompt).toEqual({ kind: 'rough-sort', id: 2 })
  })

  it('is undone as one step', () => {
    expect(replay(plus(finished(), forget(2), unforget(2), undo))).toEqual(replay(plus(finished(), forget(2))))
  })

  it('treats a title removed by a sync and added again as new: it has no last Band to go back to', () => {
    const readded = plus(
      finished(),
      { type: 'titles-removed', ids: [2] },
      { type: 'titles-added', ids: [2] },
      forget(2),
      unforget(2),
    )
    expect(replay(readded).prompt).toEqual({ kind: 'rough-sort', id: 2 })
  })

  it('is refused for a title that is not Forgotten', () => {
    expect(() => replay(plus(finished(), unforget(2)))).toThrow(ReplayError)
  })
})

describe('fixes with Sub-bands (ADR 0006)', () => {
  // Loved [1][2][3][4] split into Best [1], Middle [2][3], Lowest [4].
  const splitLoved: LogEvent = { type: 'band-split', band: 0, cuts: [1, 3], unplaced: [[], [], []] }
  const split = () => plus(finished(), splitLoved)

  it('moves a title into a Sub-band, to the front of its insertion queue', () => {
    const state = replay(plus(split(), move(4, 0, 0)))
    expect(state.bands[0].subBands?.[0]).toEqual({ tiers: [[1]], unplaced: [4] })
    expect(state.prompt).toMatchObject({ kind: 'duel', band: 0, sub: 0, a: 4, b: 1 })
  })

  it('moves a title between Sub-bands of the same Band', () => {
    const log = plus(split(), move(2, 0, 2))
    const state = replay(log)
    expect(state.bands[0].subBands?.[1]).toEqual({ tiers: [[3]], unplaced: [] })
    expect(state.prompt).toMatchObject({ kind: 'duel', band: 0, sub: 2, a: 2, b: 4 })
    const done = replay(answerAll(log, byId))
    expect(done.bands[0].tiers).toEqual([[1], [3], [2], [4]])
    expect(done.prompt).toEqual({ kind: 'all-complete' })
  })

  it('undoes a move between Sub-bands as one step', () => {
    expect(replay(plus(split(), move(2, 0, 2), undo))).toEqual(replay(split()))
  })

  it('needs a Sub-band for a split Band and refuses one for a Band that is not split', () => {
    expect(() => replay(plus(split(), move(5, 0)))).toThrow(ReplayError)
    expect(() => replay(plus(split(), move(2, 2, 1)))).toThrow(ReplayError)
  })

  it('Re-ranks a title inside its own Sub-band', () => {
    const state = replay(plus(split(), rerank(3)))
    expect(state.bands[0].subBands?.[1]).toEqual({ tiers: [[2]], unplaced: [3] })
    expect(state.prompt).toMatchObject({ kind: 'duel', band: 0, sub: 1, a: 3, b: 2 })
  })

  it('brings a Forgotten title back to its last Sub-band', () => {
    const state = replay(plus(split(), forget(2), unforget(2)))
    expect(state.bands[0].subBands?.[1]).toEqual({ tiers: [[3]], unplaced: [2] })
    expect(state.prompt).toMatchObject({ kind: 'duel', band: 0, sub: 1, a: 2, b: 3 })
  })

  it('sends a title Forgotten before its Band was split through Rough Sort for the second tap', () => {
    // Loved without 2 is [1][3][4]: Best [1], Middle [3], Lowest [4].
    const log = plus(finished(), forget(2), { type: 'band-split', band: 0, cuts: [1, 2], unplaced: [[], [], []] }, unforget(2))
    expect(replay(log).prompt).toEqual({ kind: 'rough-sort', id: 2 })
    const state = replay(plus(log, assign(2, 0, 1)))
    expect(state.bandChoice).toBeNull()
    expect(state.prompt).toMatchObject({ kind: 'duel', band: 0, sub: 1, a: 2, b: 3 })
  })
})

/** Small seeded PRNG (mulberry32), so every case is reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('a consistent oracle that keeps fixing the Ranking', () => {
  it('ends with every Band in the oracle order, each title in the Band it was last moved to', () => {
    const random = rng(11)
    for (let trial = 0; trial < 100; trial++) {
      const n = 2 + Math.floor(random() * 30)
      const ids = Array.from({ length: n }, (_, i) => 100 + i)
      const value = new Map(ids.map((id) => [id, Math.floor(random() * 12)]))
      const bandOf = new Map(ids.map((id) => [id, Math.floor(random() * 3) as BandIndex]))
      let log = startLog({ ...header, ids })
      let fixes = 0
      for (let s = replay(log); s.prompt.kind !== 'all-complete' || fixes < 3; s = replay(log)) {
        const p = s.prompt
        if (p.kind === 'closer-to') throw new Error('a closer-to prompt is Score New Titles only')
        if (p.kind === 'rough-sort') {
          log = plus(log, assign(p.id, bandOf.get(p.id)!))
          continue
        }
        const placed = s.bands.flatMap((b) => b.tiers.flat())
        if (p.kind === 'all-complete' || random() < 0.1) {
          // Move or Re-rank the inserting title, its opponent (a pivot), or any placed title.
          const pick = p.kind === 'duel' ? [p.a, p.b, placed[Math.floor(random() * placed.length)]] : placed
          const id = pick[Math.floor(random() * pick.length)]
          if (random() < 0.5) {
            log = plus(log, rerank(id))
          } else {
            const band = Math.floor(random() * 3) as BandIndex
            bandOf.set(id, band)
            log = plus(log, move(id, band))
          }
          fixes++
          continue
        }
        const va = value.get(p.a)!
        const vb = value.get(p.b)!
        log = plus(log, duel(p.a, p.b, va === vb ? 'tie' : va > vb ? 'a' : 'b'))
      }
      const state = replay(log)
      for (const band of [0, 1, 2] as const) {
        const tiers = state.bands[band].tiers
        expect(state.bands[band].unplaced).toEqual([])
        expect(tiers.flat().every((id) => bandOf.get(id) === band)).toBe(true)
        for (const tier of tiers) expect(new Set(tier.map((id) => value.get(id))).size).toBe(1)
        for (let i = 1; i < tiers.length; i++) expect(value.get(tiers[i][0])!).toBeLessThan(value.get(tiers[i - 1][0])!)
      }
      expect(state.progress.ranked).toEqual({ done: n, total: n })
    }
  })
})
