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

/** One Duel the oracle answered: new title `title` against Anchor `anchor`, and how the title did. */
type Met = { title: number; anchor: number; result: 'win' | 'tie' | 'loss' }

/**
 * Answers every prompt with an oracle that knows each new title's true score: about the same as an Anchor on that
 * score, better than a lower one. An Anchor in `drift` is judged by that true score instead of its own (its old
 * score drifted). Returns the final state, how many Duels it took, and every Duel answered.
 */
function play(
  log: DuelLog,
  anchors: AnchorScore[],
  truth: ReadonlyMap<number, number>,
  random = rng(1),
  drift: ReadonlyMap<number, number> = new Map(),
) {
  let duels = 0
  const met: Met[] = []
  for (let state = replay(log); ; state = replay(log)) {
    const p = state.prompt
    if (p.kind === 'all-complete') return { state, log, duels, met }
    if (p.kind !== 'anchor-duel') throw new Error(`unexpected ${p.kind}`)
    const mine = truth.get(p.a)!
    const theirs = drift.get(p.b) ?? levelOf(anchors, p.b)!
    // Name the pair in a random order: the answer is by id, so order must not matter.
    const [x, y] = random() < 0.5 ? [p.a, p.b] : [p.b, p.a]
    const better = mine === theirs ? null : mine > theirs ? p.a : p.b
    log = appendEvent(log, { type: 'duel-answered', a: x, b: y, result: better === null ? 'tie' : better === x ? 'a' : 'b' })
    met.push({ title: p.a, anchor: p.b, result: better === null ? 'tie' : better === p.a ? 'win' : 'loss' })
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
      // A binary search over 2k+1 places (k levels and the gaps around them), each step confirmed by a second
      // Anchor: about twice the plain search (ADR 0009).
      expect(duels).toBeLessThanOrEqual(2 * ids.length * Math.ceil(Math.log2(2 * used.length + 1)))
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

  it("gives a new title an Anchor's score once a second Anchor of that score agrees it is about the same", () => {
    const anchors = anchorsOn(9, 8, 7, 7, 7, 6, 5)
    const log = logOf(anchors, [1])
    const first = replay(log).prompt as Extract<RankingState['prompt'], { kind: 'anchor-duel' }>
    expect(levelOf(anchors, first.b)).toBe(7)
    const once = plus(log, { type: 'duel-answered', a: first.a, b: first.b, result: 'tie' })
    const unconfirmed = replay(once)
    expect(unconfirmed.newTitles!.titles).toMatchObject([{ id: 1, settled: false }])
    const second = unconfirmed.prompt as Extract<RankingState['prompt'], { kind: 'anchor-duel' }>
    expect(second).toMatchObject({ kind: 'anchor-duel', a: 1 })
    expect(levelOf(anchors, second.b)).toBe(7)
    expect(second.b).not.toBe(first.b)
    const state = replay(plus(once, { type: 'duel-answered', a: second.a, b: second.b, result: 'tie' }))
    expect(state.prompt).toEqual({ kind: 'all-complete' })
    expect(state.newTitles!.titles).toEqual([{ id: 1, settled: true, levels: [7] }])
  })

  it('shows the scores a title can still get while it is being placed', () => {
    const anchors = anchorsOn(9, 8, 7, 7, 6, 5)
    const log = logOf(anchors, [1, 2])
    const before = replay(log)
    expect(before.newTitles!.levels.map((l) => l.level)).toEqual([9, 8, 7, 6, 5])
    expect(before.newTitles!.titles[0]).toEqual({ id: 1, settled: false, levels: [9, 8, 7, 6, 5] })
    const p = before.prompt as Extract<RankingState['prompt'], { kind: 'anchor-duel' }>
    expect(levelOf(anchors, p.b)).toBe(7)
    const once = plus(log, { type: 'duel-answered', a: p.a, b: p.b, result: 'a' })
    expect(replay(once).newTitles!.titles[0]).toEqual({ id: 1, settled: false, levels: [9, 8, 7, 6, 5] })
    const q = replay(once).prompt as Extract<RankingState['prompt'], { kind: 'anchor-duel' }>
    const won = replay(plus(once, { type: 'duel-answered', a: q.a, b: q.b, result: 'a' }))
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

describe('confirming every boundary with two Anchors', () => {
  const metOn = (met: Met[], anchors: AnchorScore[], title: number, level: number) =>
    met.filter((m) => m.title === title && levelOf(anchors, m.anchor) === level)

  it('asks a third Anchor of a score when the first two disagree, and the two that agree decide', () => {
    const anchors = anchorsOn(9, 9, 9, 8, 8, 8, 7, 7, 7)
    const truth = new Map([[1, 8]])
    // Drift whichever Anchor on 8 the title meets first: it now plays like a 6.
    const firstOn8 = metOn(play(logOf(anchors, [1]), anchors, truth).met, anchors, 1, 8)[0].anchor
    const { state, met } = play(logOf(anchors, [1]), anchors, truth, rng(1), new Map([[firstOn8, 6]]))
    expect(settledScores(state)).toEqual(truth)
    const on8 = metOn(met, anchors, 1, 8)
    expect(on8.map((m) => m.anchor).sort()).toEqual([104, 105, 106])
    expect(on8.map((m) => m.result).sort()).toEqual(['tie', 'tie', 'win'])
  })

  it('confirms a score that has a single Anchor against the Anchors of the scores next to it', () => {
    const anchors = anchorsOn(9, 9, 9, 8, 7, 7, 7)
    const truth = new Map([[1, 8]])
    let log = logOf(anchors, [1])
    for (let state = replay(log); levelOf(anchors, (state.prompt as { b: number }).b) !== 8; state = replay(log)) {
      const p = state.prompt as Extract<RankingState['prompt'], { kind: 'anchor-duel' }>
      log = plus(log, { type: 'duel-answered', a: p.a, b: p.b, result: levelOf(anchors, p.b)! > 8 ? 'b' : 'a' })
    }
    const tied = replay(plus(log, { type: 'duel-answered', a: 1, b: 104, result: 'tie' }))
    expect(tied.newTitles!.titles).toMatchObject([{ id: 1, settled: false }])
    const { state, met } = play(log, anchors, truth)
    expect(settledScores(state)).toEqual(truth)
    expect(metOn(met, anchors, 1, 9).length).toBeGreaterThan(0)
    expect(metOn(met, anchors, 1, 7).length).toBeGreaterThan(0)
  })

  it("stops counting a Forgotten Anchor's answer: two other Anchors must agree", () => {
    const anchors = anchorsOn(9, 8, 7, 7, 7, 6, 5)
    let log = logOf(anchors, [1])
    const first = replay(log).prompt as Extract<RankingState['prompt'], { kind: 'anchor-duel' }>
    expect(levelOf(anchors, first.b)).toBe(7)
    log = plus(log, { type: 'duel-answered', a: 1, b: first.b, result: 'tie' }, { type: 'forgotten', id: first.b })
    const asked = [first.b]
    for (let n = 0; n < 2; n++) {
      const state = replay(log)
      expect(state.newTitles!.titles).toMatchObject([{ id: 1, settled: false }])
      const p = state.prompt as Extract<RankingState['prompt'], { kind: 'anchor-duel' }>
      expect(levelOf(anchors, p.b)).toBe(7)
      expect(asked).not.toContain(p.b)
      asked.push(p.b)
      log = plus(log, { type: 'duel-answered', a: 1, b: p.b, result: 'tie' })
    }
    expect(replay(log).newTitles!.titles).toEqual([{ id: 1, settled: true, levels: [7] }])
  })

  it('does not let the drifted single Anchor of a score put a new title on the wrong score', () => {
    const anchors = anchorsOn(9, 9, 9, 8, 7, 7, 7, 6, 6, 6)
    const truth = new Map([
      [1, 7],
      [2, 8],
      [3, 9],
      [4, 6],
    ])
    for (const plays of [6, 7.5, 9]) {
      const { state } = play(logOf(anchors, [1, 2, 3, 4]), anchors, truth, rng(plays), new Map([[104, plays]]))
      expect(settledScores(state)).toEqual(truth)
    }
  })

  it('settles every new title on its true score despite drifted Anchors, each score backed by two Anchors', () => {
    const random = rng(45)
    const formats: [ScoreFormat, number[]][] = [
      ['POINT_10', [10, 9, 8, 7, 6, 5, 4, 3]],
      ['POINT_100', [95, 90, 85, 80, 72, 60, 45]],
      ['POINT_10_DECIMAL', [9.5, 9, 8.5, 8, 7, 6.3]],
      ['POINT_5', [5, 4, 3, 2, 1]],
    ]
    let drifted = 0
    for (let trial = 0; trial < 60; trial++) {
      const [format, scale] = formats[trial % formats.length]
      const used = scale.filter(() => random() < 0.8)
      while (used.length < 3) used.push(scale.find((s) => !used.includes(s))!)
      used.sort((x, y) => y - x)
      // Each score has one Anchor or three to six. One Anchor on a score, or a single-Anchor score inside the
      // scale, may drift: a drifted single Anchor needs clean neighbours to be outvoted, so a score next to a
      // single-Anchor score never drifts.
      const counts = used.map(() => (random() < 0.3 ? 1 : 3 + Math.floor(random() * 4)))
      const single = (i: number) => counts[i] === 1
      const drifts = used.map((_, i) => {
        const inside = i > 0 && i < used.length - 1
        if (single(i)) return inside && !single(i - 1) && !single(i + 1) && random() < 0.5
        return !single(i - 1) && !single(i + 1) && random() < 0.5
      })
      for (let i = 0; i < used.length; i++) if (single(i) && drifts[i]) drifts[i - 1] = drifts[i + 1] = false
      const anchors: AnchorScore[] = []
      const drift = new Map<number, number>()
      used.forEach((level, i) => {
        for (let n = 0; n < counts[i]; n++) anchors.push({ id: 500 + anchors.length, level })
        if (drifts[i]) {
          const others = used.filter((l) => l !== level)
          drift.set(500 + anchors.length - 1 - Math.floor(random() * counts[i]), others[Math.floor(random() * others.length)])
        }
      })
      drifted += drift.size
      const ids = Array.from({ length: 1 + Math.floor(random() * 20) }, (_, i) => 1 + i)
      const truth = new Map(ids.map((id) => [id, used[Math.floor(random() * used.length)]]))
      const log = startNewTitlesLog({ seed: Math.floor(random() * 2 ** 32), userId: 1, mediaType: 'ANIME', format, anchors, ids })
      const { state, met, duels } = play(log, anchors, truth, random, drift)
      expect(settledScores(state)).toEqual(truth)
      expect(duels).toBeLessThanOrEqual(3 * ids.length * Math.ceil(Math.log2(2 * used.length + 1)))
      for (const id of ids) {
        const mine = met.filter((m) => m.title === id)
        expect(new Set(mine.map((m) => m.anchor)).size).toBe(mine.length)
        const s = truth.get(id)!
        const i = used.indexOf(s)
        if (single(i)) {
          // Confirmed against the neighbouring scores' Anchors.
          for (const n of [i - 1, i + 1].filter((n) => n >= 0 && n < used.length)) {
            expect(mine.some((m) => levelOf(anchors, m.anchor) === used[n])).toBe(true)
          }
        } else {
          expect(metOn(met, anchors, id, s).filter((m) => m.result === 'tie' && !drift.has(m.anchor)).length).toBeGreaterThanOrEqual(2)
        }
      }
    }
    expect(drifted).toBeGreaterThan(30)
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

  it('Undo steps back one Duel at a time, and answering again lands where the first answers did', () => {
    const anchors = anchorsOn(10, 9, 8, 7, 6, 5, 4)
    const truth = new Map([
      [1, 5],
      [2, 9],
    ])
    const { log: done, state } = play(logOf(anchors, [1, 2]), anchors, truth)
    const answers = done.events.filter((e) => e.type === 'duel-answered').length
    expect(answers).toBeGreaterThan(2)
    // Undo the last two answers: the prompt is the one the second-to-last answer replied to.
    const undone = plus(done, { type: 'undo' }, { type: 'undo' })
    const shortened = { ...done, events: done.events.slice(0, -2) }
    expect(replay(undone).prompt).toEqual(replay(shortened).prompt)
    expect(replay(undone).newTitles).toEqual(replay(shortened).newTitles)
    expect(replay(undone).canUndo).toBe(true)
    const again = play(undone, anchors, truth)
    expect(settledScores(again.state)).toEqual(settledScores(state))
  })
})

describe('Forgotten on an Anchor', () => {
  type AnchorDuelPrompt = Extract<RankingState['prompt'], { kind: 'anchor-duel' }>
  const promptOf = (log: DuelLog) => replay(log).prompt as AnchorDuelPrompt

  it('stops using that Anchor: the same Duel is asked against another Anchor of the same score', () => {
    const anchors = anchorsOn(9, 8, 8, 8, 7)
    const log = logOf(anchors, [1, 2])
    const before = promptOf(log)
    expect(levelOf(anchors, before.b)).toBe(8)
    const after = replay(plus(log, { type: 'forgotten', id: before.b }))
    expect(after.prompt).toMatchObject({ kind: 'anchor-duel', a: 1 })
    const p = after.prompt as AnchorDuelPrompt
    expect(p.b).not.toBe(before.b)
    expect(levelOf(anchors, p.b)).toBe(8)
    // The new titles are untouched; the Anchor is listed as Forgotten, so Preview can bring it back.
    expect(after.newTitles!.titles).toEqual(replay(log).newTitles!.titles)
    expect(after.forgotten).toEqual([before.b])
  })

  it('never meets that Anchor again, refuses an answer against it, and still settles every title', () => {
    const anchors = anchorsOn(9, 8, 8, 8, 7)
    const ids = Array.from({ length: 10 }, (_, i) => 1 + i)
    const truth = new Map(ids.map((id) => [id, 8]))
    const log = plus(logOf(anchors, ids), { type: 'forgotten', id: 102 })
    const { state, met } = playChecked(log, anchors, truth, 102)
    expect(met.has(102)).toBe(false)
    expect(settledScores(state)).toEqual(truth)
  })

  it('picks the replacement from the log alone', () => {
    const anchors = anchorsOn(9, 8, 8, 8, 8, 7)
    const forget = (list: AnchorScore[]) => {
      const log = logOf(list, [1, 2, 3])
      return plus(log, { type: 'forgotten', id: promptOf(log).b })
    }
    expect(replay(forget([...anchors].reverse())).prompt).toEqual(replay(forget(anchors)).prompt)
  })

  it('on the only Anchor of a score, Duels go on against the other scores and a title can still land on it', () => {
    // 8's single Anchor (102) is Forgotten: a title between 9 and 7 can't be told apart from 8 any more, so it gets 8.
    const anchors = anchorsOn(9, 8, 7, 6, 5)
    const truth = new Map([
      [1, 8],
      [2, 9],
      [3, 6],
      [4, 5],
    ])
    const log = plus(logOf(anchors, [1, 2, 3, 4]), { type: 'forgotten', id: 102 })
    const { state } = playChecked(log, anchors, truth, 102)
    expect(settledScores(state)).toEqual(truth)
  })

  it('with every Anchor of the middle score Forgotten, asks the next score instead', () => {
    const anchors = anchorsOn(9, 8, 7, 7, 6, 5)
    const log = plus(logOf(anchors, [1]), { type: 'forgotten', id: 103 }, { type: 'forgotten', id: 104 })
    const p = promptOf(log)
    expect([8, 6]).toContain(levelOf(anchors, p.b))
    expect(replay(log).newTitles!.titles[0]).toEqual({ id: 1, settled: false, levels: [9, 8, 7, 6, 5] })
  })

  it('is refused for a title that is neither a new title nor an Anchor, or an Anchor already Forgotten', () => {
    const log = logOf(anchorsOn(9, 8, 7), [1])
    expect(() => replay(plus(log, { type: 'forgotten', id: 999 }))).toThrow(ReplayError)
    expect(() => replay(plus(log, { type: 'forgotten', id: 102 }, { type: 'forgotten', id: 102 }))).toThrow(ReplayError)
  })

  it('Undo and Bring back both put the Anchor back in use', () => {
    const anchors = anchorsOn(9, 8, 8, 8, 7)
    const log = logOf(anchors, [1, 2])
    const p = promptOf(log)
    const forgot = plus(log, { type: 'forgotten', id: p.b })
    const undone = replay(plus(forgot, { type: 'undo' }))
    expect(undone.prompt).toEqual(p)
    expect(undone.forgotten).toEqual([])
    const back = replay(plus(forgot, { type: 'unforgotten', id: p.b }))
    expect(back.prompt).toEqual(p)
    expect(back.forgotten).toEqual([])
    expect(back.newTitles!.titles).toEqual(replay(log).newTitles!.titles)
  })

  it('keeps what a title already learnt from that Anchor', () => {
    const anchors = anchorsOn(9, 8, 8, 7, 6, 5)
    const log = logOf(anchors, [1])
    const p = promptOf(log)
    const won = plus(log, { type: 'duel-answered', a: p.a, b: p.b, result: 'a' })
    const learnt = replay(won).newTitles!.titles
    expect(replay(plus(won, { type: 'forgotten', id: p.b })).newTitles!.titles).toEqual(learnt)
  })
})

describe('Suspect Anchors', () => {
  const suspects = (state: RankingState) => state.newTitles!.suspect.map((s) => s.id)
  // 105 is scored 8 but plays like a 6: titles on 8 and 7 beat it.
  const anchors = anchorsOn(9, 9, 9, 8, 8, 8, 7, 7, 7)
  const drift = new Map([[105, 6]])

  it('an Anchor that two settled titles contradict becomes Suspect, with its old score; the honest ones never do', () => {
    const ids = Array.from({ length: 8 }, (_, i) => 1 + i)
    const truth = new Map(ids.map((id) => [id, id % 2 === 0 ? 8 : 7]))
    const { state, met } = play(logOf(anchors, ids), anchors, truth, rng(3), drift)
    expect(settledScores(state)).toEqual(truth)
    expect(met.filter((m) => m.anchor === 105).length).toBeGreaterThanOrEqual(2)
    expect(state.newTitles!.suspect).toEqual([{ id: 105, level: 8, contradicted: met.filter((m) => m.anchor === 105).length }])
  })

  it('is not Suspect after a single contradiction', () => {
    // A single new title on 8, whichever id makes it meet 105.
    const runs = Array.from({ length: 20 }, (_, i) => {
      const id = 1 + i
      return { id, ...play(logOf(anchors, [id]), anchors, new Map([[id, 8]]), rng(1), drift) }
    })
    const witnessed = runs.find((run) => run.met.some((m) => m.anchor === 105 && m.result === 'win'))!
    expect(settledScores(witnessed.state)).toEqual(new Map([[witnessed.id, 8]]))
    expect(suspects(witnessed.state)).toEqual([])
  })

  it('is never chosen for a later Duel, and an answer against it is refused', () => {
    const ids = Array.from({ length: 12 }, (_, i) => 1 + i)
    const truth = new Map(ids.map((id) => [id, [9, 8, 7][id % 3]]))
    let log = logOf(anchors, ids)
    let suspectSeen = false
    for (let state = replay(log); state.prompt.kind === 'anchor-duel'; state = replay(log)) {
      const p = state.prompt
      if (suspects(state).includes(105)) {
        suspectSeen = true
        expect(p.b).not.toBe(105)
        expect(() => replay(plus(log, { type: 'duel-answered', a: p.a, b: 105, result: 'tie' }))).toThrow(ReplayError)
      }
      const mine = truth.get(p.a)!
      const theirs = drift.get(p.b) ?? levelOf(anchors, p.b)!
      log = plus(log, { type: 'duel-answered', a: p.a, b: p.b, result: mine === theirs ? 'tie' : mine > theirs ? 'a' : 'b' })
    }
    expect(suspectSeen).toBe(true)
    expect(settledScores(replay(log))).toEqual(truth)
  })

  it('stops being Suspect when a title that contradicted it is Forgotten; Undo makes it Suspect again', () => {
    const ids = Array.from({ length: 8 }, (_, i) => 1 + i)
    const truth = new Map(ids.map((id) => [id, id % 2 === 0 ? 8 : 7]))
    const { log, met, state } = play(logOf(anchors, ids), anchors, truth, rng(3), drift)
    const witnesses = met.filter((m) => m.anchor === 105).map((m) => m.title)
    expect(suspects(state)).toEqual([105])
    // Forget every witness but one: a single contradiction is left.
    const forgot = plus(log, ...witnesses.slice(1).map((id): LogEvent => ({ type: 'forgotten', id })))
    expect(suspects(replay(forgot))).toEqual([])
    expect(suspects(replay(plus(forgot, { type: 'undo' })))).toEqual([105])
  })

  it('is listed under Forgotten instead once Forgotten', () => {
    const ids = Array.from({ length: 8 }, (_, i) => 1 + i)
    const truth = new Map(ids.map((id) => [id, id % 2 === 0 ? 8 : 7]))
    const { log } = play(logOf(anchors, ids), anchors, truth, rng(3), drift)
    const forgot = replay(plus(log, { type: 'forgotten', id: 105 }))
    expect(suspects(forgot)).toEqual([])
    expect(forgot.forgotten).toEqual([105])
  })

  it('in drifted oracle runs, catches far-drifted Anchors met twice and never an honest one', () => {
    const random = rng(47)
    const scale = [10, 9, 8, 7, 6, 5, 4]
    let caught = 0
    for (let trial = 0; trial < 30; trial++) {
      const used = scale.filter(() => random() < 0.8)
      while (used.length < 4) used.push(scale.find((s) => !used.includes(s))!)
      used.sort((x, y) => y - x)
      const all: AnchorScore[] = []
      for (const level of used) for (let n = 0, k = 3 + Math.floor(random() * 3); n < k; n++) all.push({ id: 500 + all.length, level })
      // One Anchor drifts two scores or more away.
      const victim = all[Math.floor(random() * all.length)]
      const far = used.filter((l) => Math.abs(used.indexOf(l) - used.indexOf(victim.level)) >= 2)
      const drifted = new Map([[victim.id, far[Math.floor(random() * far.length)]]])
      const ids = Array.from({ length: 20 }, (_, i) => 1 + i)
      const truth = new Map(ids.map((id) => [id, used[Math.floor(random() * used.length)]]))
      const log = startNewTitlesLog({ seed: Math.floor(random() * 2 ** 32), userId: 1, mediaType: 'ANIME', format: 'POINT_10', anchors: all, ids })
      const { state, met } = play(log, all, truth, random, drifted)
      expect(settledScores(state)).toEqual(truth)
      // Every answer the victim gave against its own score, by the titles' true scores.
      const honest = (title: number) => {
        const s = truth.get(title)!
        return s === victim.level ? 'tie' : s > victim.level ? 'win' : 'loss'
      }
      const against = met.filter((m) => m.anchor === victim.id && m.result !== honest(m.title)).length
      expect(suspects(state)).toEqual(against >= 2 ? [victim.id] : [])
      if (against >= 2) caught++
    }
    expect(caught).toBeGreaterThan(8)
  }, 30_000)
})

/**
 * Like `play`, and on every prompt checks that an answer against `avoid` instead is refused. Returns the Anchors met.
 */
function playChecked(log: DuelLog, anchors: AnchorScore[], truth: ReadonlyMap<number, number>, avoid: number) {
  const met = new Set<number>()
  for (let state = replay(log); ; state = replay(log)) {
    const p = state.prompt
    if (p.kind === 'all-complete') return { state, met }
    if (p.kind !== 'anchor-duel' || met.size > 1000) throw new Error(`unexpected ${p.kind}`)
    met.add(p.b)
    expect(levelOf(anchors, p.b)).toBeDefined()
    expect(() => replay(plus(log, { type: 'duel-answered', a: p.a, b: avoid, result: 'tie' }))).toThrow(ReplayError)
    const mine = truth.get(p.a)!
    const theirs = levelOf(anchors, p.b)!
    log = plus(log, { type: 'duel-answered', a: p.a, b: p.b, result: mine === theirs ? 'tie' : mine > theirs ? 'a' : 'b' })
  }
}
