// Switching the Sort Goal (#28, ADR 0007), in either direction and at any point: driven through `replay` by a
// seeded oracle, like scores.test.ts.
import { describe, expect, it } from 'vitest'
import type { ScoreFormat } from '../anilist/types.ts'
import {
  BANDS,
  ReplayError,
  appendEvent,
  replay,
  startLog,
  startNewTitlesLog,
  type BandIndex,
  type DuelLog,
  type LogEvent,
  type RankingState,
  type SwitchableGoal,
} from './engine.ts'
import { defaultSettings, score, type SavedScoring, type ScoringSettings } from './scoring.ts'
import { switchGoalEvents } from './sortGoal.ts'

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

/** `n` titles in random Bands, values from `distinct` values (few = many ties). */
function randomCase(random: () => number, n: number, distinct: number): Case {
  const ids = Array.from({ length: n }, (_, i) => 1000 + i * 7)
  const band = new Map(ids.map((id) => [id, BANDS[Math.floor(random() * BANDS.length)]]))
  const value = new Map(ids.map((id) => [id, Math.floor(random() * distinct)]))
  return { ids, band, value }
}

/** Answers prompts with the oracle until all is complete, or until `stopAfter` Duels. */
function play(c: Case, log: DuelLog, stopAfter = Infinity): { state: RankingState; log: DuelLog; pairs: string[] } {
  const pairs: string[] = []
  for (let state = replay(log); ; state = replay(log)) {
    const p = state.prompt
    if (p.kind === 'all-complete' || pairs.length >= stopAfter) return { state, log, pairs }
    if (p.kind === 'rough-sort') {
      log = appendEvent(log, { type: 'band-assigned', id: p.id, band: c.band.get(p.id)! })
      continue
    }
    pairs.push([p.a, p.b].sort((x, y) => x - y).join(':'))
    const va = c.value.get(p.a)!
    const vb = c.value.get(p.b)!
    log = appendEvent(log, { type: 'duel-answered', a: p.a, b: p.b, result: va === vb ? 'tie' : va > vb ? 'a' : 'b' })
    if (pairs.length > 50_000) throw new Error('runaway')
  }
}

const switched = (log: DuelLog, goal: 'scores' | 'full-ranking', format: ScoreFormat, saved: SavedScoring | null = null) =>
  switchGoalEvents(replay(log), saved, format, goal).reduce(appendEvent, log)

/** The oracle's exact order: every Band's Tiers hold the titles of one value, best first. */
function oracleTiers(c: Case, band: BandIndex): number[][] {
  const values = [...new Set(c.ids.filter((id) => c.band.get(id) === band).map((id) => c.value.get(id)!))].sort((x, y) => y - x)
  return values.map((v) => c.ids.filter((id) => c.band.get(id) === band && c.value.get(id) === v).sort((x, y) => x - y))
}
const tiersOf = (state: RankingState, band: BandIndex) => state.bands[band].tiers.map((t) => [...t].sort((x, y) => x - y))

const levelsOf = (state: RankingState, format: ScoreFormat, settings: ScoringSettings) =>
  new Map([...score(state, format, settings).titles].map(([id, t]) => [id, t.level]))

describe('switching the Sort Goal', () => {
  const ids = [1, 2, 3]
  const scoresLog = () => startLog({ seed: 1, userId: 7, mediaType: 'ANIME', ids, scoreFormat: 'POINT_10_DECIMAL' })

  it('to Full Ranking appends the Sort Goal, then settings on the human Score Step with best and worst snapped', () => {
    const events = switchGoalEvents(replay(scoresLog()), null, 'POINT_10_DECIMAL', 'full-ranking')
    expect(events).toEqual<LogEvent[]>([
      { type: 'sort-goal-set', goal: 'full-ranking' },
      { type: 'scoring-set', format: 'POINT_10_DECIMAL', settings: defaultSettings('POINT_10_DECIMAL', 'human') },
    ])
  })

  it('to Scores on an older log appends whole-step settings from the saved ones first, then the Sort Goal', () => {
    const old: DuelLog = { header: { ...scoresLog().header, engine: 6 }, events: [{ type: 'titles-added', ids }] }
    const saved: SavedScoring = { format: 'POINT_10_DECIMAL', settings: { distribution: 'bell', step: 'fine', best: 9.7, worst: 4.2 } }
    expect(replay(old).sortGoal).toBeUndefined()
    const events = switchGoalEvents(replay(old), saved, 'POINT_10_DECIMAL', 'scores')
    expect(events).toEqual<LogEvent[]>([
      { type: 'scoring-set', format: 'POINT_10_DECIMAL', settings: { distribution: 'bell', step: 'whole', best: 10, worst: 4 } },
      { type: 'sort-goal-set', goal: 'scores' },
    ])
    const state = replay(events.reduce(appendEvent, old))
    expect(state.sortGoal).toBe('scores')
  })

  it('to the goal the Ranking is already on appends nothing', () => {
    expect(switchGoalEvents(replay(scoresLog()), null, 'POINT_10_DECIMAL', 'scores')).toEqual([])
    const old: DuelLog = { header: { ...scoresLog().header, engine: 6 }, events: [{ type: 'titles-added', ids }] }
    expect(switchGoalEvents(replay(old), null, 'POINT_10_DECIMAL', 'full-ranking')).toEqual([])
  })

  it('is skipped by Undo: it cancels the Duel answer before the switch, and the goal stays', () => {
    const c: Case = { ids, band: new Map(ids.map((id) => [id, 0 as BandIndex])), value: new Map([[1, 3], [2, 2], [3, 1]]) }
    const { log } = play(c, scoresLog(), 1)
    // As if the switch had come before that answer.
    const before = replay(switched({ ...log, events: log.events.slice(0, -1) }, 'full-ranking', 'POINT_10_DECIMAL'))
    const undone = replay(appendEvent(switched(log, 'full-ranking', 'POINT_10_DECIMAL'), { type: 'undo' }))
    expect(undone.sortGoal).toBe('full-ranking')
    expect(undone.scoring).toEqual(before.scoring)
    expect(undone.prompt).toEqual(before.prompt)
    expect(undone.bands).toEqual(before.bands)
  })
})

describe('Score New Titles never switches (ADR 0009)', () => {
  const anchors = [9, 8, 7].map((level, i) => ({ id: 101 + i, level }))
  const newTitlesLog = () => startNewTitlesLog({ seed: 1, userId: 7, mediaType: 'ANIME', format: 'POINT_10', anchors, ids: [1, 2] })

  it('to Scores or Full Ranking: no events, and the engine refuses one written by hand at any point', () => {
    let log = newTitlesLog()
    for (let answered = 0; answered < 3; answered++) {
      const state = replay(log)
      for (const goal of ['scores', 'full-ranking'] as const) {
        expect(switchGoalEvents(state, null, 'POINT_10', goal)).toEqual([])
        expect(() => replay(appendEvent(log, { type: 'sort-goal-set', goal }))).toThrow(ReplayError)
      }
      if (state.prompt.kind !== 'anchor-duel') break
      log = appendEvent(log, { type: 'duel-answered', a: state.prompt.a, b: state.prompt.b, result: 'a' })
    }
  })

  it('from Scores or Full Ranking: no Sort Goal event reaches it, and Anchors set can only start a Ranking', () => {
    const scores = startLog({ seed: 1, userId: 7, mediaType: 'ANIME', ids: [1, 2], scoreFormat: 'POINT_10' })
    const full = switched(scores, 'full-ranking', 'POINT_10')
    for (const log of [scores, full]) {
      const goal = 'score-new-titles' as unknown as SwitchableGoal
      expect(() => replay(appendEvent(log, { type: 'sort-goal-set', goal }))).toThrow(ReplayError)
      expect(() => replay(appendEvent(log, { type: 'anchors-set', format: 'POINT_10', anchors }))).toThrow(ReplayError)
    }
  })
})

describe('switching, answered by a consistent oracle', () => {
  it('Scores to Full Ranking ends with the exact order and never asks an earlier Duel again', () => {
    const random = rng(21)
    for (let trial = 0; trial < 40; trial++) {
      const format = FORMATS[trial % FORMATS.length]
      const c = randomCase(random, 2 + Math.floor(random() * 50), random() < 0.3 ? 1_000_000 : 1 + Math.floor(random() * 20))
      const seed = Math.floor(random() * 2 ** 32)
      const start = startLog({ seed, userId: 1, mediaType: 'ANIME', ids: c.ids, scoreFormat: format })
      const all = play(c, start).pairs.length
      // Anywhere from the first Duel to after Scores is done.
      const first = play(c, start, Math.floor(random() * (all + 1)))
      const second = play(c, switched(first.log, 'full-ranking', format))
      expect(second.state.sortGoal).toBe('full-ranking')
      for (const band of BANDS) expect(tiersOf(second.state, band)).toEqual(oracleTiers(c, band))
      const asked = new Set(first.pairs)
      for (const pair of second.pairs) expect(asked.has(pair)).toBe(false)
    }
  }, 60_000)

  it('Full Ranking to Scores ends on the oracle levels with no more Duels than Scores alone', () => {
    const random = rng(22)
    for (let trial = 0; trial < 40; trial++) {
      const format = FORMATS[trial % FORMATS.length]
      const c = randomCase(random, 2 + Math.floor(random() * 50), random() < 0.3 ? 1_000_000 : 1 + Math.floor(random() * 20))
      const seed = Math.floor(random() * 2 ** 32)
      const scoresAlone = play(c, startLog({ seed, userId: 1, mediaType: 'ANIME', ids: c.ids, scoreFormat: format }))
      const fullStart = switched(startLog({ seed, userId: 1, mediaType: 'ANIME', ids: c.ids, scoreFormat: format }), 'full-ranking', format)
      const fullAlone = play(c, fullStart)
      const first = play(c, fullStart, Math.floor(random() * (fullAlone.pairs.length + 1)))
      const second = play(c, switched(first.log, 'scores', format))
      const settings = defaultSettings(format, 'whole')
      expect(second.state.sortGoal).toBe('scores')
      expect(levelsOf(second.state, format, settings)).toEqual(levelsOf(scoresAlone.state, format, settings))
      expect(second.pairs.length).toBeLessThanOrEqual(scoresAlone.pairs.length)
      expect(first.pairs.length + second.pairs.length).toBeLessThanOrEqual(fullAlone.pairs.length)
      const asked = new Set(first.pairs)
      for (const pair of second.pairs) expect(asked.has(pair)).toBe(false)
    }
  }, 60_000)
})
