// The Sort Goal and the scoring settings in the Duel log (ADR 0007, #24): two events that replay records,
// that Undo skips, and that an older log refuses.
import { describe, expect, it } from 'vitest'
import { ReplayError, appendEvent, replay, startLog, type DuelLog, type LogEvent } from './engine.ts'
import engine6 from './fixtures/engine6-log.json'
import { defaultSettings, scoringFor, type ScoringSettings } from './scoring.ts'

const header = { seed: 42, userId: 7, mediaType: 'ANIME' as const }
const plus = (log: DuelLog, ...events: LogEvent[]): DuelLog => events.reduce(appendEvent, log)
const logOf = (ids: number[], ...events: LogEvent[]): DuelLog => plus(startLog({ ...header, ids }), ...events)

const bell: ScoringSettings = { distribution: 'bell', step: 'fine', best: 9, worst: 4 }
const scoringSet = (settings: ScoringSettings = bell): LogEvent => ({ type: 'scoring-set', format: 'POINT_10', settings })
const fullRanking: LogEvent = { type: 'sort-goal-set', goal: 'full-ranking' }
const assign = (id: number): LogEvent => ({ type: 'band-assigned', id, band: 0 })

describe('Sort Goal and scoring settings events', () => {
  it('a log without them has no Sort Goal (so Full Ranking) and no scoring settings of its own', () => {
    const state = replay(logOf([1, 2], assign(1), assign(2)))
    expect(state.sortGoal).toBeUndefined()
    expect(state.scoring).toBeUndefined()
  })

  it('replay reports the latest Sort Goal and scoring settings, and they change no prompt', () => {
    const without = replay(logOf([1, 2, 3], assign(1), assign(2)))
    const state = replay(logOf([1, 2, 3], scoringSet({ ...bell, best: 10 }), fullRanking, assign(1), scoringSet(), assign(2)))
    expect(state.sortGoal).toBe('full-ranking')
    expect(state.scoring).toEqual({ format: 'POINT_10', settings: bell })
    expect(state.prompt).toEqual(without.prompt)
    expect(state.bands).toEqual(without.bands)
  })

  it('is refused in a log whose header says engine version 6', () => {
    for (const event of [fullRanking, scoringSet()]) {
      const log = logOf([1, 2], assign(1), event)
      expect(() => replay(log)).not.toThrow()
      expect(() => replay({ ...log, header: { ...log.header, engine: 6 } })).toThrow(ReplayError)
    }
  })

  it('refuses a Sort Goal or scoring settings that make no sense', () => {
    const bad: LogEvent[] = [
      { type: 'sort-goal-set', goal: 'fastest' as never },
      scoringSet({ ...bell, best: 11 }),
      scoringSet({ ...bell, best: 4, worst: 9 }),
      scoringSet({ ...bell, step: undefined as never }),
      { type: 'scoring-set', format: 'POINT_7' as never, settings: bell },
    ]
    for (const event of bad) expect(() => replay(logOf([1], event))).toThrow(ReplayError)
  })
})

describe('a new log', () => {
  it("starts with its Sort Goal and the Score Format's default scoring settings", () => {
    const log = startLog({ ...header, ids: [1, 2], scoreFormat: 'POINT_10_DECIMAL' })
    const state = replay(log)
    expect(state.sortGoal).toBe('scores')
    expect(state.scoring).toEqual({
      format: 'POINT_10_DECIMAL',
      settings: { distribution: 'linear', step: 'whole', best: 10, worst: 3 },
    })
    expect(state.prompt).toEqual({ kind: 'rough-sort', id: 1 })
    expect(state.canUndo).toBe(false)
  })
})

describe('a log from engine version 6 (fixture)', () => {
  const log = engine6 as DuelLog
  const at = (n: number) => replay({ ...log, events: log.events.slice(0, n) }).prompt

  it('replays to the same prompts as engine version 6 did', () => {
    expect(at(13)).toEqual({ kind: 'duel', band: 0, a: 1, b: 3, left: 3, right: 1, bounds: { lo: 0, hi: 1, pivot: 0 } })
    expect(at(17)).toEqual({ kind: 'duel', band: 0, a: 2, b: 3, left: 2, right: 3, bounds: { lo: 0, hi: 3, pivot: 1 } })
    expect(at(26)).toEqual({ kind: 'duel', band: 2, a: 12, b: 9, left: 9, right: 12, bounds: { lo: 0, hi: 2, pivot: 1 } })
  })

  it('replays to the same Ranking, as Full Ranking with no scoring settings of its own', () => {
    const state = replay(log)
    expect(state.prompt).toEqual({ kind: 'all-complete' })
    expect(state.bands.map((band) => band.tiers)).toEqual([[[1], [2], [3], [4]], [[5], [6], [7]], [[8], [9], [11], [12]], [], []])
    expect(state.forgotten).toEqual([10])
    expect(state.canUndo).toBe(true)
    expect(state.sortGoal).toBeUndefined()
    expect(state.scoring).toBeUndefined()
  })

  it('takes the new events once appended to, and is stamped with the current engine version', () => {
    const next = plus(log, scoringSet())
    expect(next.header.engine).toBe(7)
    expect(replay(next).scoring).toEqual({ format: 'POINT_10', settings: bell })
  })
})

describe('scoringFor: the scoring settings a Ranking uses', () => {
  const saved = { format: 'POINT_10' as const, settings: { distribution: 'linear' as const, step: 'fine' as const, best: 8, worst: 2 } }

  it("takes the log's settings over the saved ones", () => {
    const state = replay(logOf([1], scoringSet()))
    expect(scoringFor(state, saved, 'POINT_10')).toEqual({ settings: bell, converted: false, event: null })
  })

  it("converts the log's settings to a new Score Format and gives the event that records it (ADR 0003)", () => {
    const state = replay(logOf([1], scoringSet()))
    const converted = { distribution: 'bell', step: 'fine', best: 5, worst: 2 } as const
    expect(scoringFor(state, saved, 'POINT_5')).toEqual({
      settings: converted,
      converted: true,
      event: { type: 'scoring-set', format: 'POINT_5', settings: converted },
    })
  })

  it('falls back to the saved settings for a log without any, and records a conversion of those too', () => {
    const state = replay(logOf([1]))
    expect(scoringFor(state, saved, 'POINT_10')).toEqual({ settings: saved.settings, converted: false, event: null })
    const converted = { distribution: 'linear', step: 'fine', best: 4, worst: 1 } as const
    expect(scoringFor(state, saved, 'POINT_5')).toEqual({
      settings: converted,
      converted: true,
      event: { type: 'scoring-set', format: 'POINT_5', settings: converted },
    })
    expect(scoringFor(state, null, 'POINT_5')).toEqual({ settings: defaultSettings('POINT_5'), converted: false, event: null })
  })
})

describe('Undo and the settings events', () => {
  const answered = logOf([1, 2], assign(1), assign(2))
  const duel = (log: DuelLog): LogEvent => {
    const prompt = replay(log).prompt
    if (prompt.kind !== 'duel') throw new Error('expected a Duel')
    return { type: 'duel-answered', a: prompt.a, b: prompt.b, result: 'a' }
  }

  it('cancels the answer before a settings event and leaves the settings in place', () => {
    const log = plus(answered, duel(answered), scoringSet(), fullRanking, { type: 'undo' })
    const state = replay(log)
    expect(state.prompt).toEqual(replay(answered).prompt)
    expect(state.scoring).toEqual({ format: 'POINT_10', settings: bell })
    expect(state.sortGoal).toBe('full-ranking')
  })

  it('never cancels a settings event made after the answer it cancels', () => {
    const log = plus(answered, duel(answered), scoringSet(), { type: 'undo' }, { type: 'undo' })
    expect(replay(log).scoring).toEqual({ format: 'POINT_10', settings: bell })
  })

  it('has nothing to cancel when only settings events came since the last user event was undone', () => {
    const start = logOf([1], scoringSet(), fullRanking)
    expect(replay(start).canUndo).toBe(false)
    expect(replay(plus(start, { type: 'undo' })).scoring).toEqual({ format: 'POINT_10', settings: bell })
  })
})
