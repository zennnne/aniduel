// Score New Titles (ADR 0009, #43): replaying a log that starts from an Anchor snapshot. Every Duel is a new title
// against an Anchor, and a plain search over the Anchor score levels places each title. Driven through `replay`.
import { describe, expect, it } from 'vitest'
import type { ScoreFormat } from '../anilist/types.ts'
import { ReplayError, appendEvent, replay, startLog, startNewTitlesLog, type AnchorScore, type DuelLog, type LogEvent, type RankingState } from './engine.ts'

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

const header = { seed: 42, userId: 7, mediaType: 'ANIME' as const }
const plus = (log: DuelLog, ...events: LogEvent[]): DuelLog => events.reduce(appendEvent, log)

/** Anchors 101.. on the given levels, in order. */
const anchorsOn = (...levels: number[]): AnchorScore[] => levels.map((level, i) => ({ id: 101 + i, level }))

const logOf = (anchors: AnchorScore[], ids: number[], format: ScoreFormat = 'POINT_10') =>
  startNewTitlesLog({ ...header, format, anchors, ids })

/** The Anchor's score, looked up in the snapshot the test made. */
const levelOf = (anchors: AnchorScore[], id: number) => anchors.find((a) => a.id === id)?.level

/**
 * Answers every prompt with an oracle that knows each new title's true score: about the same as an Anchor on that
 * score, better than a lower one. Returns the final state and how many Duels it took.
 */
function play(log: DuelLog, anchors: AnchorScore[], truth: ReadonlyMap<number, number>, random = rng(1)) {
  let duels = 0
  for (let state = replay(log); ; state = replay(log)) {
    const p = state.prompt
    if (p.kind === 'all-complete') return { state, log, duels }
    if (p.kind !== 'anchor-duel') throw new Error(`unexpected ${p.kind}`)
    const mine = truth.get(p.a)!
    const theirs = levelOf(anchors, p.b)!
    // Name the pair in a random order: the answer is by id, so order must not matter.
    const [x, y] = random() < 0.5 ? [p.a, p.b] : [p.b, p.a]
    const better = mine === theirs ? null : mine > theirs ? p.a : p.b
    log = appendEvent(log, { type: 'duel-answered', a: x, b: y, result: better === null ? 'tie' : better === x ? 'a' : 'b' })
    if (++duels > 10_000) throw new Error('runaway')
  }
}

/** Each new title's score once settled, by id. */
const settledScores = (state: RankingState) =>
  new Map(state.newTitles!.titles.filter((t) => t.settled).map((t) => [t.id, t.levels[0]]))

describe('a Score New Titles Ranking', () => {
  it('starts straight on Duels, a new title against an Anchor, with no Rough Sort and no Bands', () => {
    const anchors = anchorsOn(9, 8, 7, 7, 6)
    const state = replay(logOf(anchors, [1, 2, 3]))
    expect(state.sortGoal).toBe('score-new-titles')
    expect(state.prompt).toMatchObject({ kind: 'anchor-duel', a: 1 })
    const p = state.prompt as Extract<RankingState['prompt'], { kind: 'anchor-duel' }>
    expect(anchors.map((a) => a.id)).toContain(p.b)
    expect([p.left, p.right].sort()).toEqual([p.a, p.b].sort())
    expect(state.bands.every((b) => b.tiers.length === 0 && b.unplaced.length === 0)).toBe(true)
    expect(state.board.open).toBe(false)
    expect(state.progress.ranked).toEqual({ done: 0, total: 3 })
  })
})

describe('placing new titles against Anchor score levels', () => {
  it('settles every new title on its true Anchor score when a consistent oracle answers, in every Score Format', () => {
    const random = rng(7)
    const formats: [ScoreFormat, number[]][] = [
      ['POINT_10', [10, 9, 8, 7, 6, 5, 4, 3]],
      ['POINT_100', [95, 90, 85, 80, 72, 60, 45]],
      ['POINT_10_DECIMAL', [9.5, 9, 8.5, 8, 7, 6.3]],
      ['POINT_5', [5, 4, 3, 2, 1]],
      ['POINT_3', [3, 2, 1]],
    ]
    for (let trial = 0; trial < 60; trial++) {
      const [format, scale] = formats[trial % formats.length]
      const used = scale.filter(() => random() < 0.7)
      if (used.length === 0) used.push(scale[0])
      const anchors = Array.from({ length: used.length + Math.floor(random() * 40) }, (_, i) => ({
        id: 500 + i,
        level: used[i < used.length ? i : Math.floor(random() * used.length)],
      }))
      const ids = Array.from({ length: 1 + Math.floor(random() * 25) }, (_, i) => 1 + i)
      const truth = new Map(ids.map((id) => [id, used[Math.floor(random() * used.length)]]))
      const log = startNewTitlesLog({ seed: Math.floor(random() * 2 ** 32), userId: 1, mediaType: 'ANIME', format, anchors, ids })
      const { state, duels } = play(log, anchors, truth, random)
      expect(settledScores(state)).toEqual(truth)
      expect(state.progress.ranked).toEqual({ done: ids.length, total: ids.length })
      // A plain binary search over 2k+1 places (k levels and the gaps around them).
      expect(duels).toBeLessThanOrEqual(ids.length * Math.ceil(Math.log2(2 * used.length + 1)))
    }
  })

  it('settles a title that ties no Anchor on an Anchor score next to where it sits', () => {
    const anchors = anchorsOn(9, 8, 7, 6, 5)
    const truth = new Map([
      [1, 7.5],
      [2, 9.5],
      [3, 4],
      [4, 5.5],
    ])
    const { state } = play(logOf(anchors, [1, 2, 3, 4]), anchors, truth)
    const scores = settledScores(state)
    expect(scores.size).toBe(4)
    expect([8, 7]).toContain(scores.get(1))
    expect(scores.get(2)).toBe(9)
    expect(scores.get(3)).toBe(5)
    expect([6, 5]).toContain(scores.get(4))
  })

  it("gives a new title the Anchor's score at once when it is about the same", () => {
    const anchors = anchorsOn(9, 8, 7, 6, 5)
    const log = logOf(anchors, [1])
    const p = replay(log).prompt as Extract<RankingState['prompt'], { kind: 'anchor-duel' }>
    const state = replay(plus(log, { type: 'duel-answered', a: p.a, b: p.b, result: 'tie' }))
    expect(state.prompt).toEqual({ kind: 'all-complete' })
    expect(state.newTitles!.titles).toEqual([{ id: 1, settled: true, levels: [levelOf(anchors, p.b)] }])
  })

  it('shows the scores a title can still get while it is being placed', () => {
    const anchors = anchorsOn(9, 8, 7, 6, 5)
    const log = logOf(anchors, [1, 2])
    const before = replay(log)
    expect(before.newTitles!.levels.map((l) => l.level)).toEqual([9, 8, 7, 6, 5])
    expect(before.newTitles!.titles[0]).toEqual({ id: 1, settled: false, levels: [9, 8, 7, 6, 5] })
    const p = before.prompt as Extract<RankingState['prompt'], { kind: 'anchor-duel' }>
    expect(levelOf(anchors, p.b)).toBe(7)
    const won = replay(plus(log, { type: 'duel-answered', a: p.a, b: p.b, result: 'a' }))
    expect(won.newTitles!.titles[0]).toEqual({ id: 1, settled: false, levels: [9, 8, 7] })
  })

  it('picks the Anchor of each Duel from the log alone, and refuses an answer against any other Anchor', () => {
    const anchors = anchorsOn(9, 8, 8, 8, 8, 7)
    const log = logOf(anchors, [1, 2, 3, 4])
    const again = logOf([...anchors].reverse(), [1, 2, 3, 4])
    expect(replay(again).prompt).toEqual(replay(log).prompt)
    const p = replay(log).prompt as Extract<RankingState['prompt'], { kind: 'anchor-duel' }>
    const other = anchors.find((a) => a.level === levelOf(anchors, p.b) && a.id !== p.b)!.id
    expect(() => replay(plus(log, { type: 'duel-answered', a: p.a, b: other, result: 'tie' }))).toThrow(ReplayError)
  })

  it('meets different Anchors of one score across new titles', () => {
    const anchors = anchorsOn(9, 8, 8, 8, 8, 8, 8, 7)
    const ids = Array.from({ length: 12 }, (_, i) => 1 + i)
    let log = logOf(anchors, ids)
    const met = new Set<number>()
    for (let state = replay(log); state.prompt.kind === 'anchor-duel'; state = replay(log)) {
      met.add(state.prompt.b)
      log = plus(log, { type: 'duel-answered', a: state.prompt.a, b: state.prompt.b, result: 'tie' })
    }
    expect(settledScores(replay(log))).toEqual(new Map(ids.map((id) => [id, 8])))
    expect(met.size).toBeGreaterThan(2)
  })
})

describe('the Anchor snapshot', () => {
  it('is refused by an engine older than 8', () => {
    const log = logOf(anchorsOn(9, 8, 7), [1])
    expect(() => replay({ ...log, header: { ...log.header, engine: 7 } })).toThrow(ReplayError)
  })

  it('must start the Ranking: refused after a title or a Sort Goal', () => {
    const anchorsSet: LogEvent = { type: 'anchors-set', format: 'POINT_10', anchors: anchorsOn(9, 8, 7) }
    expect(() => replay(plus(startLog({ ...header, ids: [1], scoreFormat: 'POINT_10' }), anchorsSet))).toThrow(ReplayError)
    expect(() => replay(plus(startLog({ ...header, ids: [1] }), anchorsSet))).toThrow(ReplayError)
  })

  it('is refused with a score that is not a level of its Score Format, or an Anchor listed twice', () => {
    expect(() => replay(logOf([{ id: 101, level: 7.5 }], [1]))).toThrow(ReplayError)
    expect(() => replay(logOf([{ id: 101, level: 7 }, { id: 101, level: 8 }], [1]))).toThrow(ReplayError)
  })

  it('never lets an Anchor be added as a new title', () => {
    expect(() => replay(logOf(anchorsOn(9, 8, 7), [1, 102]))).toThrow(ReplayError)
    expect(() => replay(plus(logOf(anchorsOn(9, 8, 7), [1]), { type: 'titles-added', ids: [101] }))).toThrow(ReplayError)
  })

  it('takes no Rough Sort, Band or Sort Goal events after it', () => {
    const log = logOf(anchorsOn(9, 8, 7), [1, 2])
    const refused: LogEvent[] = [
      { type: 'band-assigned', id: 1, band: 0 },
      { type: 'bands-from-scores', bands: [[1], [], [], [], []] },
      { type: 'band-selected', band: 0 },
      { type: 'sort-goal-set', goal: 'scores' },
      { type: 'sort-goal-set', goal: 'full-ranking' },
    ]
    for (const event of refused) expect(() => replay(plus(log, event))).toThrow(ReplayError)
  })
})

describe('Forgotten and Undo on a new title', () => {
  it('Forgotten takes the title out of the Ranking; Undo brings back the prompt it was marked at', () => {
    const log = logOf(anchorsOn(9, 8, 7), [1, 2])
    const forgotten = replay(plus(log, { type: 'forgotten', id: 1 }))
    expect(forgotten.forgotten).toEqual([1])
    expect(forgotten.newTitles!.titles.map((t) => t.id)).toEqual([2])
    expect(forgotten.prompt).toMatchObject({ kind: 'anchor-duel', a: 2 })
    expect(replay(plus(log, { type: 'forgotten', id: 1 }, { type: 'undo' })).prompt).toEqual(replay(log).prompt)
  })

  it('Undo cancels the last answer', () => {
    const log = logOf(anchorsOn(9, 8, 7), [1])
    const p = replay(log).prompt as Extract<RankingState['prompt'], { kind: 'anchor-duel' }>
    const undone = replay(plus(log, { type: 'duel-answered', a: p.a, b: p.b, result: 'tie' }, { type: 'undo' }))
    expect(undone.prompt).toEqual(p)
    expect(undone.canUndo).toBe(false)
  })
})
