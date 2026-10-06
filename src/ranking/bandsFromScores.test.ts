// Replaying `bands-from-scores` (ADR 0008): one user event that carries the Band of every scored title.
import { describe, expect, it } from 'vitest'
import { ReplayError, appendEvent, replay, startLog, type DuelLog, type LogEvent, type RankingState } from './engine.ts'

const header = { seed: 42, userId: 7, mediaType: 'ANIME' as const }
const plus = (log: DuelLog, ...events: LogEvent[]): DuelLog => events.reduce(appendEvent, log)
const logOf = (ids: number[], ...events: LogEvent[]): DuelLog => plus(startLog({ ...header, ids }), ...events)
const fromScores = (...bands: [number[], number[], number[], number[], number[]]): LogEvent => ({
  type: 'bands-from-scores',
  bands,
})

/** A Band's titles: ranked ones first (the first one into an empty Band is placed at once), then the unplaced. */
const members = (band: RankingState['bands'][number]) => [...band.tiers.flat(), ...band.unplaced]

describe('bands-from-scores', () => {
  it('puts every listed title in its Band and leaves the rest as Rough Sort prompts, in order', () => {
    const state = replay(logOf([1, 2, 3, 4, 5, 6], fromScores([2], [], [5, 1], [], [4])))
    expect(state.prompt).toEqual({ kind: 'rough-sort', id: 3 })
    expect(state.bands.map(members)).toEqual([[2], [], [5, 1], [], [4]])
    expect(state.progress.roughSort).toEqual({ done: 4, total: 6 })
    const after = replay(logOf([1, 2, 3, 4, 5, 6], fromScores([2], [], [5, 1], [], [4]), { type: 'band-assigned', id: 3, band: 1 }))
    expect(after.prompt).toEqual({ kind: 'rough-sort', id: 6 })
  })
  it('is cancelled by one Undo, back to Rough Sort from the first title', () => {
    const start = logOf([1, 2, 3, 4], fromScores([2], [], [1], [], [4]))
    const state = replay(plus(start, { type: 'undo' }))
    expect(state.prompt).toEqual({ kind: 'rough-sort', id: 1 })
    expect(state.bands.map(members)).toEqual([[], [], [], [], []])
    expect(state.progress.roughSort).toEqual({ done: 0, total: 4 })
    expect(state.canUndo).toBe(false)
  })

  it('is one Undo step among the others: Undo after a hand Band choice cancels only that choice first', () => {
    const start = logOf([1, 2, 3, 4], fromScores([2], [], [1], [], [4]), { type: 'band-assigned', id: 3, band: 1 })
    const once = replay(plus(start, { type: 'undo' }))
    expect(once.prompt).toEqual({ kind: 'rough-sort', id: 3 })
    expect(once.bands.map(members)).toEqual([[2], [], [1], [], [4]])
    const twice = replay(plus(start, { type: 'undo' }, { type: 'undo' }))
    expect(twice.prompt).toEqual({ kind: 'rough-sort', id: 1 })
  })

  it('goes straight to the Band choice when every title is listed', () => {
    const state = replay(logOf([1, 2, 3], fromScores([2, 3], [], [1], [], [])))
    expect(state.progress.roughSort).toEqual({ done: 3, total: 3 })
    expect(state.bandChoice).toEqual({ finished: null, next: 0 })
    expect(state.prompt).toMatchObject({ kind: 'duel', band: 0 })
  })

  it('is refused in a log whose header says an engine older than 6', () => {
    const log = logOf([1, 2], fromScores([1], [], [], [], []))
    expect(() => replay({ ...log, header: { ...log.header, engine: 5 } })).toThrow(ReplayError)
    expect(replay(log).bands[0].tiers).toEqual([[1]])
  })

  it('is refused for a title not waiting in Rough Sort, or listed twice', () => {
    expect(() => replay(logOf([1, 2], fromScores([9], [], [], [], [])))).toThrow(ReplayError)
    expect(() => replay(logOf([1, 2], fromScores([1], [], [1], [], [])))).toThrow(ReplayError)
    const assigned = logOf([1, 2], { type: 'band-assigned', id: 1, band: 0 }, fromScores([], [1], [], [], []))
    expect(() => replay(assigned)).toThrow(ReplayError)
  })
})
