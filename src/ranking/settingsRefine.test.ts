// Refine Duels after a settings change on Preview (#29, ADR 0007): driven through `replay` by a seeded oracle and
// checked against what Full Ranking gives under the same oracle and the new settings. Also the Refine Duel estimate.
import { describe, expect, it } from 'vitest'
import type { ScoreFormat } from '../anilist/types.ts'
import { BANDS, appendEvent, replay, startLog, type BandIndex, type DuelLog, type LogEvent, type RankingState } from './engine.ts'
import { refineDuels } from './estimate.ts'
import { previewOpen } from './preview.ts'
import { defaultSettings, levels, score, withStep, type ScoringSettings } from './scoring.ts'

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

/** `n` titles in random Bands (or `sizes` titles per Band); Band 0 holds the best ones. Values from `distinct` values (few = many ties). */
function randomCase(random: () => number, n: number, distinct: number, sizes?: readonly number[]): Case {
  const ids = Array.from({ length: n }, (_, i) => 1000 + i * 7)
  const value = new Map(ids.map((id) => [id, Math.floor(random() * distinct)]))
  const byValue = [...ids].sort((x, y) => value.get(y)! - value.get(x)! || x - y)
  const cuts = sizes
    ? sizes.slice(0, -1).map((_, b) => sizes.slice(0, b + 1).reduce((sum, k) => sum + k, 0))
    : [...BANDS.slice(1).map(() => Math.floor(random() * (n + 1)))].sort((x, y) => x - y)
  const band = new Map(byValue.map((id, i) => [id, cuts.filter((cut) => cut <= i).length as BandIndex]))
  return { ids, band, value }
}

function newLog(c: Case, seed: number, goal: 'scores' | 'full-ranking', format: ScoreFormat, settings: ScoringSettings): DuelLog {
  const start = startLog({ seed, userId: 1, mediaType: 'ANIME', ids: c.ids })
  const events: LogEvent[] = [
    { type: 'scoring-set', format, settings },
    { type: 'sort-goal-set', goal },
    ...start.events.filter((e) => e.type === 'titles-added'),
  ]
  return { ...start, events }
}

/** Answers every prompt with the oracle until all is complete. `each` sees the state before every Duel answer. */
function play(c: Case, log: DuelLog, each?: (state: RankingState) => void): { state: RankingState; duels: number; log: DuelLog } {
  let duels = 0
  for (let state = replay(log); ; state = replay(log)) {
    const p = state.prompt
    if (p.kind === 'closer-to') throw new Error('a closer-to prompt is Score New Titles only')
    if (p.kind === 'all-complete') return { state, duels, log }
    if (p.kind === 'rough-sort') {
      log = appendEvent(log, { type: 'band-assigned', id: p.id, band: c.band.get(p.id)! })
      continue
    }
    each?.(state)
    const va = c.value.get(p.a)!
    const vb = c.value.get(p.b)!
    log = appendEvent(log, { type: 'duel-answered', a: p.a, b: p.b, result: va === vb ? 'tie' : va > vb ? 'a' : 'b' })
    if (++duels > 50_000) throw new Error('runaway')
  }
}

const levelsOf = (state: RankingState, format: ScoreFormat, settings: ScoringSettings) =>
  new Map([...score(state, format, settings).titles].map(([id, t]) => [id, t.level]))

/** Different whole-step settings, as a Preview change would give: another best / worst or Distribution. */
function changed(random: () => number, format: ScoreFormat, from: ScoringSettings): ScoringSettings {
  const options = levels(format, 'whole')
  for (;;) {
    const best = options[Math.floor(random() * options.length)]
    const worst = options[Math.floor(random() * options.length)]
    const distribution = random() < 0.5 ? 'linear' : 'bell'
    const next = withStep({ ...from, best, worst, distribution }, format, 'whole')
    if (next.worst < next.best && JSON.stringify(next) !== JSON.stringify(from)) return next
  }
}

describe('a settings change on Scores', () => {
  it('prompts Refine Duels only while a title is unsettled, then every level is the one Full Ranking gives', () => {
    const random = rng(29)
    let refined = 0
    for (let trial = 0; trial < 40; trial++) {
      const format = FORMATS[trial % FORMATS.length]
      const before = defaultSettings(format, 'whole')
      const after = changed(random, format, before)
      const n = 2 + Math.floor(random() * 60)
      const c = randomCase(random, n, random() < 0.3 ? 1_000_000 : 1 + Math.floor(random() * 20))
      const seed = Math.floor(random() * 2 ** 32)
      const done = play(c, newLog(c, seed, 'scores', format, before))
      expect(done.state.prompt.kind).toBe('all-complete')
      const set = appendEvent(done.log, { type: 'scoring-set', format, settings: after })
      const unsettledNow = replay(set).standing!
      const refine = play(c, set, (state) => {
        // Every Refine Duel is asked while some title is unsettled, and says it is a Refine Duel.
        expect(state.standing!.settled.size).toBeLessThan(state.standing!.titles.size)
        expect(state.prompt.kind === 'duel' && state.prompt.refine).toBe(true)
      })
      if (unsettledNow.settled.size === n) expect(refine.duels).toBe(0)
      else refined++
      const full = play(c, newLog(c, seed, 'full-ranking', format, after))
      expect(levelsOf(refine.state, format, after)).toEqual(levelsOf(full.state, format, after))
      expect(refine.state.standing!.settled.size).toBe(n)
    }
    expect(refined).toBeGreaterThan(10)
  })

  it('are not Refine Duels before the Ranking was first complete', () => {
    const random = rng(30)
    const c = randomCase(random, 30, 1_000_000)
    const settings = defaultSettings('POINT_10_DECIMAL', 'whole')
    play(c, newLog(c, 4, 'scores', 'POINT_10_DECIMAL', settings), (state) => {
      expect(state.prompt.kind === 'duel' && state.prompt.refine).toBeFalsy()
    })
  })
})

describe('the Refine Duel estimate', () => {
  /** A small Preview change: best one level down, worst one level up, or the other Distribution. */
  function tweak(format: ScoreFormat, from: ScoringSettings, kind: number): ScoringSettings {
    const options = levels(format, 'whole')
    if (kind === 0) return { ...from, best: options[options.indexOf(from.best) + 1] }
    if (kind === 1) return { ...from, worst: options[options.indexOf(from.worst) - 1] }
    return { ...from, distribution: from.distribution === 'linear' ? 'bell' : 'linear' }
  }

  it('is about the number of Refine Duels the oracle then answers, and 0 when everything is settled', () => {
    const random = rng(31)
    let estimated = 0
    let answered = 0
    for (let trial = 0; trial < 12; trial++) {
      const format = (['POINT_10_DECIMAL', 'POINT_100'] as const)[trial % 2]
      const before = defaultSettings(format, 'whole')
      const c = randomCase(random, 100, trial < 6 ? 30 : 1_000_000, [20, 20, 20, 20, 20])
      const done = play(c, newLog(c, trial, 'scores', format, before))
      expect(refineDuels(done.state)).toBe(0)
      const set = appendEvent(done.log, { type: 'scoring-set', format, settings: tweak(format, before, trial % 3) })
      const estimate = refineDuels(replay(set))
      const actual = play(c, set).duels
      // Each Ranking on its own: within a factor of two either way (a few Duels of slack for tiny counts).
      expect(estimate).toBeLessThanOrEqual(actual * 2 + 3)
      expect(estimate).toBeGreaterThanOrEqual(actual / 2 - 3)
      estimated += estimate
      answered += actual
    }
    expect(answered).toBeGreaterThan(100)
    // Overall: within a third.
    expect(Math.abs(estimated - answered)).toBeLessThanOrEqual(answered / 3)
  }, 60_000)

  it('is 0 on Full Ranking', () => {
    const c = randomCase(rng(32), 20, 1_000_000)
    const settings = defaultSettings('POINT_10', 'whole')
    expect(refineDuels(replay(newLog(c, 1, 'full-ranking', 'POINT_10', settings)))).toBe(0)
  })
})

describe('Preview', () => {
  it('stays open for Refine Duels after a settings change, not for ordinary Duels or a switch to Full Ranking', () => {
    const random = rng(33)
    const format = 'POINT_10_DECIMAL'
    const before = defaultSettings(format, 'whole')
    const c = randomCase(random, 60, 1_000_000, [12, 12, 12, 12, 12])
    let ordinary = 0
    const done = play(c, newLog(c, 2, 'scores', format, before), (state) => {
      expect(previewOpen(state.prompt)).toBe(false)
      ordinary++
    })
    expect(ordinary).toBeGreaterThan(0)
    expect(previewOpen(done.state.prompt)).toBe(true)
    const set = appendEvent(done.log, { type: 'scoring-set', format, settings: { ...before, worst: before.worst + 1 } })
    expect(replay(set).prompt.kind).toBe('duel')
    expect(previewOpen(replay(set).prompt)).toBe(true)
    // Full Ranking orders titles inside a level: those are Duels to answer before Preview.
    const full = appendEvent(appendEvent(done.log, { type: 'sort-goal-set', goal: 'full-ranking' }), {
      type: 'scoring-set',
      format,
      settings: withStep(before, format, 'human'),
    })
    expect(replay(full).prompt.kind).toBe('duel')
    expect(previewOpen(replay(full).prompt)).toBe(false)
  })
})
