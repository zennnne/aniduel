// The Scores Sort Goal (ADR 0007, #26): Duels stop once every title's level is settled. Driven through `replay`
// by a seeded oracle, and checked against what Full Ranking gives under the same oracle and settings.
import { describe, expect, it } from 'vitest'
import type { ScoreFormat } from '../anilist/types.ts'
import { BANDS, ReplayError, appendEvent, replay, startLog, type BandIndex, type DuelLog, type LogEvent, type RankingState } from './engine.ts'
import { defaultSettings, levelGroups, score, withStep, type ScoringSettings } from './scoring.ts'

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

const FORMATS: readonly ScoreFormat[] = ['POINT_100', 'POINT_10_DECIMAL', 'POINT_10', 'POINT_5', 'POINT_3']

type Case = { ids: number[]; band: Map<number, BandIndex>; value: Map<number, number> }

/** `n` titles in random Bands (or `sizes` titles per Band, in order); values from `distinct` values (few = many ties). */
function randomCase(random: () => number, n: number, distinct: number, sizes?: readonly number[]): Case {
  const ids = Array.from({ length: n }, (_, i) => 1000 + i * 7)
  const bands = sizes ? sizes.flatMap((size, b) => Array.from({ length: size }, () => b as BandIndex)) : null
  const band = new Map(ids.map((id, i) => [id, bands ? bands[i] : BANDS[Math.floor(random() * BANDS.length)]]))
  const value = new Map(ids.map((id) => [id, Math.floor(random() * distinct)]))
  // With sizes, the Bands must agree with the values: Band 0 holds the best titles.
  if (sizes) {
    const byValue = [...ids].sort((x, y) => value.get(y)! - value.get(x)! || x - y)
    byValue.forEach((id, i) => band.set(id, bands![i]))
  }
  return { ids, band, value }
}

/** A new log on the given Sort Goal and scoring settings, before any title is sorted. */
function newLog(c: Case, seed: number, goal: 'scores' | 'full-ranking', format: ScoreFormat, settings: ScoringSettings): DuelLog {
  const start = startLog({ seed, userId: 1, mediaType: 'ANIME', ids: c.ids })
  const events: LogEvent[] = [
    { type: 'scoring-set', format, settings },
    { type: 'sort-goal-set', goal },
    ...start.events.filter((e) => e.type === 'titles-added'),
  ]
  return { ...start, events }
}

/** Answers every prompt with the oracle (Rough Sort by the case's Bands) until all is complete. */
function play(c: Case, log: DuelLog): { state: RankingState; duels: number; log: DuelLog; prompts: string[] } {
  let duels = 0
  const prompts: string[] = []
  for (let state = replay(log); ; state = replay(log)) {
    const p = state.prompt
    if (p.kind === 'all-complete') return { state, duels, log, prompts }
    if (p.kind === 'rough-sort') {
      log = appendEvent(log, { type: 'band-assigned', id: p.id, band: c.band.get(p.id)! })
      continue
    }
    prompts.push(`${p.a}:${p.b}:${p.left}`)
    const va = c.value.get(p.a)!
    const vb = c.value.get(p.b)!
    log = appendEvent(log, { type: 'duel-answered', a: p.a, b: p.b, result: va === vb ? 'tie' : va > vb ? 'a' : 'b' })
    if (++duels > 50_000) throw new Error('runaway')
  }
}

const levelsOf = (state: RankingState, format: ScoreFormat, settings: ScoringSettings) =>
  new Map([...score(state, format, settings).titles].map(([id, t]) => [id, t.level]))

function randomSettings(random: () => number, format: ScoreFormat): ScoringSettings {
  const base = defaultSettings(format, 'whole')
  const distribution = random() < 0.5 ? 'linear' : 'bell'
  // Sometimes a narrower best..worst, so boundaries land elsewhere.
  if (random() < 0.5) return { ...base, distribution }
  const span = base.best - base.worst
  return withStep({ distribution, step: 'whole', best: base.best - span * random() * 0.3, worst: base.worst + span * random() * 0.3 }, format, 'whole')
}

describe('a new Ranking', () => {
  it("starts on Scores with the Score Format's defaults on the whole Score Step", () => {
    const state = replay(startLog({ seed: 1, userId: 7, mediaType: 'ANIME', ids: [1, 2], scoreFormat: 'POINT_100' }))
    expect(state.sortGoal).toBe('scores')
    expect(state.scoring).toEqual({ format: 'POINT_100', settings: { distribution: 'linear', step: 'whole', best: 100, worst: 30 } })
  })
})

describe('Scores, answered by a consistent oracle', () => {
  it('ends with every title on the level Full Ranking gives under the same oracle and settings', () => {
    const random = rng(11)
    for (let trial = 0; trial < 60; trial++) {
      const format = FORMATS[trial % FORMATS.length]
      const settings = randomSettings(random, format)
      const n = 1 + Math.floor(random() * 70)
      // From no ties at all to many.
      const c = randomCase(random, n, random() < 0.3 ? 1_000_000 : 1 + Math.floor(random() * 25))
      const seed = Math.floor(random() * 2 ** 32)
      const scores = play(c, newLog(c, seed, 'scores', format, settings))
      const full = play(c, newLog(c, seed, 'full-ranking', format, settings))
      const expected = levelsOf(full.state, format, settings)
      expect(expected.size).toBe(n)
      expect(levelsOf(scores.state, format, settings)).toEqual(expected)
      expect(scores.state.standing?.settled.size).toBe(n)
      expect(scores.duels).toBeLessThanOrEqual(full.duels)
    }
    // A few seconds alone; past the 5 s default when the whole suite runs on a busy machine.
  }, 60_000)

  it('uses at least 20% fewer Duels than Full Ranking on 200 titles at the whole step with equal Bands', () => {
    const random = rng(12)
    let scores = 0
    let full = 0
    for (let trial = 0; trial < 3; trial++) {
      const c = randomCase(random, 200, 1_000_000_000, [40, 40, 40, 40, 40])
      const settings = defaultSettings('POINT_10_DECIMAL', 'whole')
      const seed = Math.floor(random() * 2 ** 32)
      scores += play(c, newLog(c, seed, 'scores', 'POINT_10_DECIMAL', settings)).duels
      full += play(c, newLog(c, seed, 'full-ranking', 'POINT_10_DECIMAL', settings)).duels
    }
    // Measured: about 36% fewer. 20% is the bar from the spec, far enough below to never flake.
    expect(scores).toBeLessThanOrEqual(full * 0.8)
  }, 120_000)

  it('prompts the same Duels every time the same log is replayed', () => {
    const random = rng(13)
    const c = randomCase(random, 60, 12)
    const settings = defaultSettings('POINT_10_DECIMAL', 'whole')
    const first = play(c, newLog(c, 99, 'scores', 'POINT_10_DECIMAL', settings))
    const again = play(c, newLog(c, 99, 'scores', 'POINT_10_DECIMAL', settings))
    expect(again.prompts).toEqual(first.prompts)
    expect(replay(structuredClone(first.log))).toEqual(first.state)
    // Every prefix of the log replays to the prompt that was answered next.
    const log = first.log
    for (let i = 0; i < log.events.length; i++) {
      const event = log.events[i]
      if (event.type !== 'duel-answered') continue
      const p = replay({ ...log, events: log.events.slice(0, i) }).prompt
      expect(p.kind === 'duel' && [p.a, p.b]).toEqual([event.a, event.b])
    }
  })
})

describe('settled titles', () => {
  // Six titles in one Band, 3 smileys, 3..1: two titles per level.
  const c: Case = { ids: [1, 2, 3, 4, 5, 6], band: new Map([1, 2, 3, 4, 5, 6].map((id) => [id, 0 as BandIndex])), value: new Map([[1, 6], [2, 5], [3, 4], [4, 3], [5, 2], [6, 1]]) }
  const settings = defaultSettings('POINT_3', 'whole')

  it('are reported by the Ranking, and only they get a score', () => {
    let log = newLog(c, 5, 'scores', 'POINT_3', settings)
    for (const id of c.ids) log = appendEvent(log, { type: 'band-assigned', id, band: 0 })
    const start = replay(log)
    expect(start.standing?.settled.size).toBe(0)
    expect(score(start, 'POINT_3', settings).titles.size).toBe(0)
    expect(start.progress.ranked).toEqual({ done: 0, total: 6 })
    const { state } = play(c, log)
    expect(state.standing?.settled).toEqual(new Set(c.ids))
    expect(state.progress.ranked).toEqual({ done: 6, total: 6 })
    expect([...score(state, 'POINT_3', settings).titles].map(([id, t]) => [id, t.level]).sort((x, y) => x[0] - y[0])).toEqual([
      [1, 3], [2, 3], [3, 2], [4, 2], [5, 1], [6, 1],
    ])
  })

  it('mid-way, only settled titles get a score, and it is already their final one', () => {
    const random = rng(14)
    const big = randomCase(random, 40, 1_000_000, [40, 0, 0, 0, 0])
    const s = defaultSettings('POINT_10_DECIMAL', 'whole')
    const { log } = play(big, newLog(big, 3, 'scores', 'POINT_10_DECIMAL', s))
    const final = levelsOf(replay(log), 'POINT_10_DECIMAL', s)
    let partly = 0
    for (let i = 0; i < log.events.length; i++) {
      if (log.events[i].type !== 'duel-answered') continue
      const mid = replay({ ...log, events: log.events.slice(0, i) })
      const settled = mid.standing!.settled
      const scored = score(mid, 'POINT_10_DECIMAL', s).titles
      expect(new Set(scored.keys())).toEqual(settled)
      for (const [id, t] of scored) expect(t.level).toBe(final.get(id))
      expect(mid.progress.ranked).toEqual({ done: settled.size, total: 40 })
      if (settled.size > 0 && settled.size < 40) partly++
    }
    expect(partly).toBeGreaterThan(0)
  })
})

describe('level groups', () => {
  it("group each Band's settled titles by level, best first, under the log's settings", () => {
    const random = rng(15)
    const c = randomCase(random, 30, 1_000_000, [12, 10, 8, 0, 0])
    const settings = defaultSettings('POINT_10', 'whole')
    const { state } = play(c, newLog(c, 8, 'scores', 'POINT_10', settings))
    const levels = levelsOf(state, 'POINT_10', settings)
    for (const band of BANDS) {
      const groups = levelGroups(state, band)!
      const ids = [...state.bands[band].tiers.flat(), ...state.bands[band].unplaced]
      expect(groups.flatMap((g) => g.ids).sort()).toEqual(ids.sort())
      for (const group of groups) for (const id of group.ids) expect(levels.get(id)).toBe(group.level)
      expect(groups.map((g) => g.level)).toEqual([...new Set(groups.map((g) => g.level))].sort((x, y) => y - x))
    }
    expect(levelGroups(play(c, newLog(c, 8, 'full-ranking', 'POINT_10', settings)).state, 0)).toBeNull()
  })
})

describe('Scores in the log', () => {
  const ids = [1, 2]
  const base = startLog({ seed: 1, userId: 7, mediaType: 'ANIME', ids })

  it('refuses a Score Step other than whole', () => {
    const human: LogEvent = { type: 'scoring-set', format: 'POINT_10', settings: defaultSettings('POINT_10') }
    const scores: LogEvent = { type: 'sort-goal-set', goal: 'scores' }
    const whole: LogEvent = { type: 'scoring-set', format: 'POINT_10', settings: defaultSettings('POINT_10', 'whole') }
    expect(() => replay({ ...base, events: [whole, scores, ...base.events, human] })).toThrow(ReplayError)
    expect(() => replay({ ...base, events: [human, scores, ...base.events] })).toThrow(ReplayError)
    expect(() => replay({ ...base, events: [scores, ...base.events] })).toThrow(ReplayError)
    expect(() => replay({ ...base, events: [whole, scores, ...base.events] })).not.toThrow()
  })
})
