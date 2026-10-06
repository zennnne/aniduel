// Refine Duels on Scores (#30, ADR 0007): after a sync, Forgotten, Unforgotten, Band move, Re-rank or a Score Format
// change, only the titles left unsettled get Duels again, until every level is the one Full Ranking gives.
// Driven through `replay` by a seeded oracle, like scores.test.ts.
import { describe, expect, it } from 'vitest'
import type { ScoreFormat } from '../anilist/types.ts'
import { BANDS, appendEvent, replay, startLog, type BandIndex, type DuelLog, type LogEvent, type RankingState } from './engine.ts'
import { convertSettings, defaultSettings, score, scoringFor, withStep, type ScoringSettings } from './scoring.ts'

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

/** The oracle: each title's Band and value (higher = better, equal = "about the same"). Edited as the user would. */
type Oracle = { band: Map<number, BandIndex>; value: Map<number, number> }

const pick = <T,>(random: () => number, list: readonly T[]): T => list[Math.floor(random() * list.length)]

function randomOracle(random: () => number, ids: readonly number[], distinct: number, oracle?: Oracle): Oracle {
  const o = oracle ?? { band: new Map(), value: new Map() }
  for (const id of ids) {
    o.band.set(id, pick(random, BANDS))
    o.value.set(id, Math.floor(random() * distinct))
  }
  return o
}

/** A new log on the given Sort Goal and scoring settings, before any title is sorted. */
function newLog(ids: readonly number[], seed: number, goal: 'scores' | 'full-ranking', format: ScoreFormat, settings: ScoringSettings): DuelLog {
  const start = startLog({ seed, userId: 1, mediaType: 'ANIME', ids: [...ids] })
  return {
    ...start,
    events: [{ type: 'scoring-set', format, settings }, { type: 'sort-goal-set', goal }, ...start.events.filter((e) => e.type === 'titles-added')],
  }
}

/** Answers every prompt with the oracle until all is complete; counts the Duels. */
function play(o: Oracle, start: DuelLog): { log: DuelLog; state: RankingState; duels: number } {
  let log = start
  let duels = 0
  for (let state = replay(log); ; state = replay(log)) {
    const p = state.prompt
    if (p.kind === 'all-complete') return { log, state, duels }
    if (p.kind === 'rough-sort') {
      log = appendEvent(log, { type: 'band-assigned', id: p.id, band: o.band.get(p.id)! })
      continue
    }
    const va = o.value.get(p.a)!
    const vb = o.value.get(p.b)!
    log = appendEvent(log, { type: 'duel-answered', a: p.a, b: p.b, result: va === vb ? 'tie' : va > vb ? 'a' : 'b' })
    if (++duels > 50_000) throw new Error('runaway')
  }
}

const levelsOf = (state: RankingState, format: ScoreFormat, settings: ScoringSettings) =>
  new Map([...score(state, format, settings).titles].map(([id, t]) => [id, t.level]))

/**
 * The levels Full Ranking gives a fresh Ranking of the same Pool (Forgotten titles marked so in Rough Sort) under
 * the same oracle and settings: what Scores must end with after any change.
 */
function fullRankingLevels(o: Oracle, state: RankingState, format: ScoreFormat, settings: ScoringSettings) {
  const pool = [...state.standing!.titles.keys(), ...state.forgotten]
  let log = newLog(pool, 1, 'full-ranking', format, settings)
  for (const id of state.forgotten) log = appendEvent(log, { type: 'forgotten', id })
  return levelsOf(play(o, log).state, format, settings)
}

/** Checks a finished Scores Ranking: every title in a Band settled, on Full Ranking's level. */
function expectSettledLikeFullRanking(o: Oracle, state: RankingState, format: ScoreFormat, settings: ScoringSettings) {
  expect(state.prompt).toEqual({ kind: 'all-complete' })
  const standing = state.standing!
  expect(standing.settled).toEqual(new Set(standing.titles.keys()))
  expect(levelsOf(state, format, settings)).toEqual(fullRankingLevels(o, state, format, settings))
}

type Change = 'sync' | 'forgotten' | 'unforgotten' | 'band-moved' | 'rerank' | 'format'

/**
 * Applies one random change of the given kind to a log (and the oracle, when the user's opinion changes with it).
 * Returns the new log and the scoring that applies afterwards.
 */
function change(
  kind: Change,
  random: () => number,
  o: Oracle,
  log: DuelLog,
  scoring: { format: ScoreFormat; settings: ScoringSettings },
  nextId: () => number,
): { log: DuelLog; scoring: { format: ScoreFormat; settings: ScoringSettings } } {
  const state = replay(log)
  const inBands = [...state.standing!.titles.keys()]
  const add = (...events: LogEvent[]) => events.reduce(appendEvent, log)
  switch (kind) {
    case 'sync': {
      const fresh = Array.from({ length: 1 + Math.floor(random() * 4) }, nextId)
      randomOracle(random, fresh, 30, o)
      const gone = inBands.filter(() => random() < 0.1)
      const events: LogEvent[] = [{ type: 'titles-added', ids: fresh }]
      if (gone.length > 0) events.push({ type: 'titles-removed', ids: gone })
      return { log: add(...events), scoring }
    }
    case 'forgotten':
      return { log: add({ type: 'forgotten', id: pick(random, inBands) }), scoring }
    case 'unforgotten': {
      const id = pick(random, inBands)
      return { log: add({ type: 'forgotten', id }, { type: 'unforgotten', id }), scoring }
    }
    case 'band-moved': {
      const id = pick(random, inBands)
      const band = pick(random, BANDS.filter((b) => b !== o.band.get(id)))
      o.band.set(id, band)
      return { log: add({ type: 'band-moved', id, band }), scoring }
    }
    case 'rerank': {
      // The user re-ranks a title because their opinion of it changed.
      const id = pick(random, inBands)
      o.value.set(id, Math.floor(random() * 30))
      return { log: add({ type: 'rerank-requested', id }), scoring }
    }
    case 'format': {
      // AniList's Score Format changed: the app appends the conversion `scoringFor` gives (ADR 0003).
      const to = pick(random, FORMATS.filter((f) => f !== scoring.format))
      const { settings, event } = scoringFor(state, null, to)
      expect(event).not.toBeNull()
      expect(settings).toEqual(convertSettings(scoring.settings, scoring.format, to))
      return { log: add(event!), scoring: { format: to, settings } }
    }
  }
}

const CHANGES: readonly Change[] = ['sync', 'forgotten', 'unforgotten', 'band-moved', 'rerank', 'format']

describe('Refine Duels on Scores after a change to the Pool, the Ranking or the Score Format', () => {
  for (const kind of CHANGES) {
    it(`after ${kind}: prompts until every title is settled, on the level Full Ranking gives`, () => {
      const random = rng(300 + CHANGES.indexOf(kind))
      let next = 5000
      let refine = 0
      for (let trial = 0; trial < 8; trial++) {
        const format = FORMATS[trial % FORMATS.length]
        const settings = defaultSettings(format, 'whole')
        const ids = Array.from({ length: 10 + Math.floor(random() * 40) }, (_, i) => 1000 + i * 7)
        const o = randomOracle(random, ids, random() < 0.3 ? 1_000_000 : 2 + Math.floor(random() * 25))
        const done = play(o, newLog(ids, Math.floor(random() * 2 ** 32), 'scores', format, settings))
        expectSettledLikeFullRanking(o, done.state, format, settings)

        // The change hits a finished Ranking, or one stopped part-way through its Duels.
        let log = done.log
        if (random() < 0.5) {
          const cut = log.events.length - Math.floor(random() * done.duels)
          log = { ...log, events: log.events.slice(0, cut) }
          if (replay(log).standing!.titles.size === 0) log = done.log
        }
        const changed = change(kind, random, o, log, { format, settings }, () => next++)
        const after = play(o, changed.log)
        expect(after.state.scoring).toEqual(changed.scoring)
        expectSettledLikeFullRanking(o, after.state, changed.scoring.format, changed.scoring.settings)
        if (log === done.log) refine += after.duels
      }
      // On a finished Ranking the change really did unsettle titles in some trials (not every change moves a boundary).
      expect(refine).toBeGreaterThan(0)
    })
  }

  it('after several changes in a row, mixed with settings changes and switching Sort Goal', () => {
    const random = rng(320)
    let next = 9000
    for (let trial = 0; trial < 6; trial++) {
      const format = FORMATS[trial % FORMATS.length]
      let scoring = { format, settings: defaultSettings(format, 'whole') }
      const ids = Array.from({ length: 15 + Math.floor(random() * 30) }, (_, i) => 1000 + i * 7)
      const o = randomOracle(random, ids, 2 + Math.floor(random() * 20))
      let { log } = play(o, newLog(ids, trial, 'scores', format, scoring.settings))
      for (let step = 0; step < 4; step++) {
        const roll = random()
        if (roll < 0.15) {
          // best / worst or the Distribution changed on Preview.
          const base = defaultSettings(scoring.format, 'whole')
          const span = base.best - base.worst
          const settings = withStep(
            { distribution: random() < 0.5 ? 'linear' : 'bell', step: 'whole', best: base.best - span * random() * 0.3, worst: base.worst + span * random() * 0.3 },
            scoring.format,
            'whole',
          )
          scoring = { format: scoring.format, settings }
          log = appendEvent(log, { type: 'scoring-set', ...scoring })
        } else if (roll < 0.25) {
          // To Full Ranking and back: back on Scores needs the whole step first.
          log = appendEvent(log, { type: 'sort-goal-set', goal: 'full-ranking' })
          log = play(o, log).log
          log = appendEvent(log, { type: 'sort-goal-set', goal: 'scores' })
        } else {
          const changed = change(pick(random, CHANGES), random, o, log, scoring, () => next++)
          log = changed.log
          scoring = changed.scoring
        }
        // Answer only some of the Refine Duels before the next change.
        const answered = play(o, log)
        const keep = random() < 0.5 ? answered.log.events.length : answered.log.events.length - Math.floor(random() * answered.duels)
        log = { ...answered.log, events: answered.log.events.slice(0, keep) }
      }
      const { state } = play(o, log)
      expect(state.sortGoal).toBe('scores')
      expectSettledLikeFullRanking(o, state, scoring.format, scoring.settings)
    }
  })
})

describe('the cost of Refine Duels', () => {
  it('after a single Forgotten or a single added title is small next to a whole Scores run', () => {
    const format: ScoreFormat = 'POINT_10_DECIMAL'
    const settings = defaultSettings(format, 'whole')
    // Measured on 10 points with decimals, Bands agreeing with the values (10 changes of each kind per seed):
    // - 200 titles, 5 x 40, 12 seeds: a full run 420-590 Duels; Forgotten 0-51 (5% on average), added 1-38 (2%).
    // - 120 titles, 5 x 24, 10 seeds: a full run 196-284 Duels; Forgotten 0-31 (3-5% on average), added 1-23 (1-5%).
    // 120 titles keeps this test fast; seed 7 is the dearest of those for Forgotten. The bounds sit well above.
    const random = rng(407)
    const ids = Array.from({ length: 120 }, (_, i) => 1000 + i * 7)
    const o = randomOracle(random, ids, 1_000_000_000)
    ;[...ids].sort((x, y) => o.value.get(y)! - o.value.get(x)!).forEach((id, i) => o.band.set(id, Math.floor(i / 24) as BandIndex))
    const full = play(o, newLog(ids, 7, 'scores', format, settings))
    let forgottenTotal = 0
    let addedTotal = 0
    const trials = 10
    for (let trial = 0; trial < trials; trial++) {
      const forgotten = play(o, appendEvent(full.log, { type: 'forgotten', id: pick(random, ids) }))
      const id = 99_000 + trial
      o.band.set(id, pick(random, BANDS))
      o.value.set(id, Math.floor(random() * 1_000_000_000))
      const added = play(o, appendEvent(full.log, { type: 'titles-added', ids: [id] }))
      expect(forgotten.duels).toBeLessThanOrEqual(full.duels * 0.25)
      expect(added.duels).toBeLessThanOrEqual(full.duels * 0.25)
      forgottenTotal += forgotten.duels
      addedTotal += added.duels
    }
    expect(forgottenTotal / trials).toBeLessThanOrEqual(full.duels * 0.1)
    expect(addedTotal / trials).toBeLessThanOrEqual(full.duels * 0.1)
  })
})

describe('Undo around the changes on Scores (ADR 0005)', () => {
  const undo: LogEvent = { type: 'undo' }
  const plus = (log: DuelLog, ...events: LogEvent[]): DuelLog => events.reduce(appendEvent, log)
  const undos = (n: number) => Array<LogEvent>(n).fill(undo)

  /** Finished Scores Rankings of 30 titles with many ties, one per trial, on the whole Score Step. */
  function* finishedRankings(seed: number, format: ScoreFormat = 'POINT_10') {
    const random = rng(seed)
    for (let trial = 0; trial < 6; trial++) {
      const ids = Array.from({ length: 30 }, (_, i) => 1000 + i * 7)
      const o = randomOracle(random, ids, 12)
      yield { random, o, ids, done: play(o, newLog(ids, trial, 'scores', format, defaultSettings(format, 'whole'))).log }
    }
  }

  const userEvents: Record<string, (random: () => number, o: Oracle, ids: number[]) => LogEvent[]> = {
    forgotten: (random, _o, ids) => [{ type: 'forgotten', id: pick(random, ids) }],
    unforgotten: (random, _o, ids) => {
      const id = pick(random, ids)
      return [{ type: 'forgotten', id }, { type: 'unforgotten', id }]
    },
    'band-moved': (random, o, ids) => {
      const id = pick(random, ids)
      const band = pick(random, BANDS.filter((b) => b !== o.band.get(id)))
      o.band.set(id, band)
      return [{ type: 'band-moved', id, band }]
    },
    rerank: (random, o, ids) => {
      const id = pick(random, ids)
      o.value.set(id, Math.floor(random() * 12))
      return [{ type: 'rerank-requested', id }]
    },
  }

  for (const [name, make] of Object.entries(userEvents)) {
    it(`cancels ${name} as one step, and its Refine Duels one by one, back to the settled Ranking before it`, () => {
      let refined = 0
      for (const { random, o, ids, done } of finishedRankings(500 + name.length)) {
        const events = make(random, o, ids)
        const before = plus(done, ...events.slice(0, -1))
        const changed = plus(before, ...events.slice(-1))
        expect(replay(plus(changed, undo))).toEqual(replay(before))
        const after = play(o, changed).log
        const appended = after.events.length - changed.events.length
        refined += appended
        expect(replay(plus(after, ...undos(appended)))).toEqual(replay(changed))
        expect(replay(plus(after, ...undos(appended + 1)))).toEqual(replay(before))
      }
      expect(refined).toBeGreaterThan(0)
    })
  }

  it('never cancels a sync; Undo cancels its Refine Duels back to just after it', () => {
    let next = 7000
    let refined = 0
    for (const { random, o, ids, done } of finishedRankings(520)) {
      const fresh = [next++, next++]
      randomOracle(random, fresh, 12, o)
      const synced = plus(done, { type: 'titles-added', ids: fresh }, { type: 'titles-removed', ids: [pick(random, ids)] })
      expect(replay(synced).canUndo).toBe(false)
      expect(replay(plus(synced, undo))).toEqual(replay(synced))
      const after = play(o, synced).log
      const appended = after.events.length - synced.events.length
      refined += appended
      expect(replay(plus(after, ...undos(appended + 1)))).toEqual(replay(synced))
    }
    expect(refined).toBeGreaterThan(0)
  })

  it('never cancels a Score Format conversion: Undo cancels the answer before it, and the Refine Duels after it', () => {
    let refined = 0
    // 5 stars to 10 points: finer levels, so some titles are no longer settled.
    for (const { o, done } of finishedRankings(530, 'POINT_5')) {
      const { event } = scoringFor(replay(done), null, 'POINT_10')
      const converted = plus(done, event!)
      // The last answer before the conversion goes; the converted settings stay.
      const cancelled = replay(plus(converted, undo))
      expect(cancelled.scoring).toEqual({ format: 'POINT_10', settings: event!.settings })
      expect(cancelled).toEqual(replay({ ...converted, events: [...done.events.slice(0, -1), event!] }))
      const after = play(o, converted).log
      const appended = after.events.length - converted.events.length
      refined += appended
      expect(replay(plus(after, ...undos(appended)))).toEqual(replay(converted))
    }
    expect(refined).toBeGreaterThan(0)
  })
})

