import { describe, expect, it } from 'vitest'
import { duelsLeft } from './estimate.ts'
import { ReplayError, replay, startLog, type BandIndex, type DuelLog, type LogEvent } from './engine.ts'

const header = { seed: 42, userId: 7, mediaType: 'ANIME' as const }

function logOf(ids: number[], ...events: LogEvent[]): DuelLog {
  const log = startLog({ ...header, ids })
  return { ...log, events: [...log.events, ...events] }
}

const plus = (log: DuelLog, ...events: LogEvent[]): DuelLog => ({ ...log, events: [...log.events, ...events] })
const assign = (id: number, band: BandIndex): LogEvent => ({ type: 'band-assigned', id, band })
const select = (band: BandIndex): LogEvent => ({ type: 'band-selected', band })
const forget = (id: number): LogEvent => ({ type: 'forgotten', id })
const undo: LogEvent = { type: 'undo' }
const duel = (a: number, b: number, result: 'a' | 'b' | 'tie'): LogEvent => ({ type: 'duel-answered', a, b, result })

/** Titles 1-3 Loved, 4-6 Okay. After Rough Sort, 1 and 4 have a place; 2, 3 and 5, 6 wait for Duels. */
const sorted = () => logOf([1, 2, 3, 4, 5, 6], assign(1, 0), assign(2, 0), assign(3, 0), assign(4, 2), assign(5, 2), assign(6, 2))

describe('choosing a Band', () => {
  it('is due right after Rough Sort, suggesting the top Band that still has titles to place', () => {
    const state = replay(sorted())
    expect(state.bandChoice).toEqual({ finished: null, next: 0 })
    // The default: Duels continue from the top Band.
    expect(state.prompt).toMatchObject({ kind: 'duel', band: 0 })
  })

  it('is settled by answering a Duel in the suggested Band: Duels stay in that Band', () => {
    const state = replay(plus(sorted(), duel(2, 1, 'a')))
    expect(state.bandChoice).toBeNull()
    expect(state.prompt).toMatchObject({ kind: 'duel', band: 0, a: 3 })
  })

  it('moves the Duels to the chosen Band', () => {
    const state = replay(plus(sorted(), select(2)))
    expect(state.bandChoice).toBeNull()
    expect(state.prompt).toMatchObject({ kind: 'duel', band: 2, a: 5, b: 4 })
  })
  it('is due again once the chosen Band is finished, naming it and suggesting the top Band left', () => {
    const state = replay(plus(sorted(), select(2), duel(5, 4, 'a'), duel(6, 4, 'a'), duel(6, 5, 'b')))
    expect(state.bands[2].tiers).toEqual([[5], [6], [4]])
    expect(state.bandChoice).toEqual({ finished: 2, next: 0 })
  })

  it('starts a split Band at its first Sub-band with titles to place', () => {
    // Okay split with an empty Best: Middle holds 4 (ranked) and 5, Lowest holds 6.
    const split: LogEvent = { type: 'band-split', band: 2, cuts: [0, 1], unplaced: [[], [5], [6]] }
    const state = replay(plus(sorted(), split, select(2)))
    expect(state.prompt).toMatchObject({ kind: 'duel', band: 2, sub: 1, a: 5, b: 4 })
  })

  it('never starts Duels while a title waits in Rough Sort, and is due again once it is sorted', () => {
    const synced = plus(sorted(), select(2), { type: 'titles-added', ids: [7] })
    expect(replay(synced).prompt).toEqual({ kind: 'rough-sort', id: 7 })
    expect(replay(synced).bandChoice).toBeNull()
    expect(replay(plus(synced, assign(7, 4))).bandChoice).toEqual({ finished: null, next: 0 })
  })

  it('ignores a Band selected before Rough Sort is done, or a Band with nothing to place', () => {
    const early = logOf([1, 2, 3], assign(1, 0), select(0), assign(2, 0), assign(3, 0))
    expect(replay(early).bandChoice).toEqual({ finished: null, next: 0 })
    expect(replay(plus(sorted(), select(4))).bandChoice).toEqual({ finished: null, next: 0 })
  })

  it('is refused in a log older than engine version 3, or for a Band that does not exist', () => {
    const old = sorted()
    expect(() => replay({ ...plus(old, select(2)), header: { ...old.header, engine: 2 } })).toThrow(ReplayError)
    expect(() => replay(plus(sorted(), select(7 as BandIndex)))).toThrow(ReplayError)
  })
})

describe('multi-step Undo with Band choice', () => {
  it('skips over a Band selected: it cancels the Duel answer before it and stays in the chosen Band', () => {
    const state = replay(plus(sorted(), select(2), duel(5, 4, 'a'), undo))
    expect(state.prompt).toMatchObject({ kind: 'duel', band: 2, a: 5, b: 4 })
    expect(state.bands[2].tiers).toEqual([[4]])
  })

  it('from a Band choice after a Band finished, goes back to the last Duel of that Band', () => {
    const finished = plus(sorted(), duel(2, 1, 'a'), duel(3, 1, 'b'))
    expect(replay(finished).bandChoice).toEqual({ finished: 0, next: 2 })
    const state = replay(plus(finished, select(2), undo))
    expect(state.prompt).toMatchObject({ kind: 'duel', band: 0, a: 3, b: 1 })
    expect(state.bandChoice).toBeNull()
  })

  it('undoes several Duels in a row, including a Forgotten, across a Band choice', () => {
    const log = plus(sorted(), duel(2, 1, 'a'), forget(3), select(2), duel(5, 4, 'tie'))
    expect(replay(log).bands[2].tiers).toEqual([[4, 5]])
    const one = replay(plus(log, undo))
    expect(one.prompt).toMatchObject({ kind: 'duel', band: 2, a: 5 })
    const two = replay(plus(log, undo, undo))
    expect(two.forgotten).toEqual([])
    expect(two.prompt).toMatchObject({ kind: 'duel', band: 0, a: 3 })
    const three = replay(plus(log, undo, undo, undo))
    expect(three.bands[0]).toEqual({ tiers: [[1]], unplaced: [2, 3] })
    expect(three.prompt).toMatchObject({ kind: 'duel', band: 0, a: 2, b: 1 })
  })

  it('has nothing to undo when only a Band selected follows a sync', () => {
    const state = replay(plus(sorted(), { type: 'titles-added', ids: [] }, select(2), undo))
    expect(state.canUndo).toBe(false)
    expect(state.prompt).toMatchObject({ kind: 'duel', band: 2 })
  })

  it('cancels a Band split as one step, leaving the Band chosen after it', () => {
    const split: LogEvent = { type: 'band-split', band: 2, cuts: [0, 1], unplaced: [[], [5], [6]] }
    const state = replay(plus(sorted(), select(2), split, undo))
    expect(state.bands[2].subBands).toBeUndefined()
    expect(state.prompt).toMatchObject({ kind: 'duel', band: 2, a: 5, b: 4 })
  })
})

describe('Duels left in a Band', () => {
  it('estimates about log2 of the places each unplaced title can land in, summed', () => {
    // Loved after Rough Sort: 1 placed, 2 and 3 wait. Inserting into 1 then 2 places: log2(2) + log2(3) ≈ 2.58.
    expect(duelsLeft(replay(sorted()).bands[0])).toBe(3)
    expect(duelsLeft(replay(sorted()).bands[4])).toBe(0)
  })

  it('counts a split Band Sub-band by Sub-band', () => {
    const split: LogEvent = { type: 'band-split', band: 2, cuts: [0, 1], unplaced: [[], [5], [6]] }
    // Middle: 5 into one Tier (1 Duel); Lowest: 6 was placed without a Duel.
    expect(duelsLeft(replay(plus(sorted(), split)).bands[2])).toBe(1)
  })
})
