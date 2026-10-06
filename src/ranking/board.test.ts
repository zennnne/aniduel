// The Board (#31, #33): open before the first Duel answer, Bands listed most recent first.
import { describe, expect, it } from 'vitest'
import { replay, startLog, type BandIndex, type DuelLog, type LogEvent, type SubBandIndex } from './engine.ts'

const header = { seed: 42, userId: 7, mediaType: 'ANIME' as const }

function logOf(ids: number[], ...events: LogEvent[]): DuelLog {
  const log = startLog({ ...header, ids })
  return { ...log, events: [...log.events, ...events] }
}

const plus = (log: DuelLog, ...events: LogEvent[]): DuelLog => ({ ...log, events: [...log.events, ...events] })
const assign = (id: number, band: BandIndex, sub?: SubBandIndex): LogEvent =>
  sub === undefined ? { type: 'band-assigned', id, band } : { type: 'band-assigned', id, band, sub }
const move = (id: number, band: BandIndex, sub?: SubBandIndex): LogEvent =>
  sub === undefined ? { type: 'band-moved', id, band } : { type: 'band-moved', id, band, sub }
const duel = (a: number, b: number, result: 'a' | 'b' | 'tie'): LogEvent => ({ type: 'duel-answered', a, b, result })
const undo: LogEvent = { type: 'undo' }

/** The Board's titles per Band, as ids in Board order. */
const boardIds = (log: DuelLog) => replay(log).board.bands.map((band) => band.titles.map((t) => t.id))

/** Titles 1 and 2 both Loved, Rough Sort done: the first Duel is 2 vs 1. */
const sorted = () => logOf([1, 2], assign(1, 0), assign(2, 0))

describe('whether the Board is open', () => {
  it('is open during Rough Sort and after it, before any Duel answer', () => {
    expect(replay(logOf([1, 2])).board.open).toBe(true)
    expect(replay(logOf([1, 2], assign(1, 0))).board.open).toBe(true)
    expect(replay(sorted()).board.open).toBe(true)
  })

  it('closes once a Duel is answered', () => {
    expect(replay(plus(sorted(), duel(2, 1, 'a'))).board.open).toBe(false)
  })

  it('opens again once that answer is undone', () => {
    expect(replay(plus(sorted(), duel(2, 1, 'a'), undo)).board.open).toBe(true)
  })

  it('stays closed when a sync adds titles after Duels started, even while they wait in Rough Sort', () => {
    const synced = plus(sorted(), duel(2, 1, 'a'), { type: 'titles-added', ids: [3] })
    expect(replay(synced).prompt).toEqual({ kind: 'rough-sort', id: 3 })
    expect(replay(synced).board.open).toBe(false)
    expect(replay(plus(synced, undo)).board.open).toBe(false)
  })
})

describe('the order of titles in a Band on the Board', () => {
  it('puts the latest Band choice first', () => {
    expect(boardIds(logOf([1, 2, 3, 4], assign(1, 0), assign(2, 1), assign(3, 0), assign(4, 0)))).toEqual([
      [4, 3, 1],
      [2],
      [],
      [],
      [],
    ])
  })

  it('puts a title moved into a Band first, and takes it out of its old Band', () => {
    const log = logOf([1, 2, 3, 4], assign(1, 0), assign(2, 1), assign(3, 1), move(1, 1), assign(4, 1))
    expect(boardIds(log)).toEqual([[], [4, 1, 3, 2], [], [], []])
  })

  it('gives each title the position of the event that last put it in its Band', () => {
    const log = logOf([1, 2, 3], assign(1, 2), assign(2, 2), move(1, 3), assign(3, 2))
    const at = new Map(replay(log).board.bands.flatMap((band) => band.titles.map((t) => [t.id, t.at])))
    // Events: titles-added, 1 → Okay, 2 → Okay, 1 → Meh, 3 → Okay.
    expect(Object.fromEntries(at)).toEqual({ 1: 3, 2: 2, 3: 4 })
  })

  it('counts positions over the events that still count, so an undone move leaves no gap', () => {
    const log = logOf([1, 2, 3], assign(1, 2), move(1, 3), undo, assign(2, 2))
    expect(replay(log).board.bands[2].titles).toEqual([
      { id: 2, at: 2 },
      { id: 1, at: 1 },
    ])
  })

  it('gives every title placed by Rough Sort from Scores one shared position, listed by id for the UI to order by name', () => {
    const fromScores: LogEvent = { type: 'bands-from-scores', bands: [[5, 2], [], [4, 1], [], []] }
    const log = logOf([1, 2, 3, 4, 5], fromScores, assign(3, 0))
    expect(replay(log).board.bands[0].titles).toEqual([
      { id: 3, at: 2 },
      { id: 2, at: 1 },
      { id: 5, at: 1 },
    ])
    expect(replay(log).board.bands[2].titles).toEqual([
      { id: 1, at: 1 },
      { id: 4, at: 1 },
    ])
  })

  it('keeps every title its own position when its Band is split (a split puts no title in a Band)', () => {
    const split: LogEvent = { type: 'band-split', band: 0, cuts: [0, 1], unplaced: [[3], [], [2]] }
    const log = plus(logOf([1, 2, 3], assign(1, 0), assign(2, 0), assign(3, 0)), split)
    expect(replay(log).board.bands[0].titles.map((t) => t.at)).toEqual([3, 2, 1])
  })

  it('shows only the five Bands: no unsorted and no Forgotten titles', () => {
    const log = logOf([1, 2, 3], assign(1, 0), { type: 'forgotten', id: 2 })
    expect(boardIds(log)).toEqual([[1], [], [], [], []])
  })

  it('brings a title back to the top of its Band when it is no longer Forgotten', () => {
    const log = plus(sorted(), { type: 'forgotten', id: 1 }, { type: 'unforgotten', id: 1 })
    expect(boardIds(log)[0]).toEqual([1, 2])
  })

  it('marks each title in a split Band with its Sub-band', () => {
    const split: LogEvent = { type: 'band-split', band: 0, cuts: [0, 1], unplaced: [[2], [], [3]] }
    const log = plus(logOf([1, 2, 3, 4], assign(1, 0), assign(2, 0), assign(3, 0), assign(4, 1)), split)
    const titles = replay(log).board.bands[0].titles
    expect(titles.map(({ id, sub }) => ({ id, sub }))).toEqual([
      { id: 3, sub: 2 },
      { id: 2, sub: 0 },
      { id: 1, sub: 1 },
    ])
    expect(replay(log).board.bands[1].titles[0]).not.toHaveProperty('sub')
  })

  it('moves a title between Sub-bands of the same Band to the top', () => {
    const split: LogEvent = { type: 'band-split', band: 0, cuts: [0, 1], unplaced: [[2], [], [3]] }
    const log = plus(logOf([1, 2, 3], assign(1, 0), assign(2, 0), assign(3, 0)), split, move(2, 0, 2))
    expect(replay(log).board.bands[0].titles.map(({ id, sub }) => ({ id, sub }))).toEqual([
      { id: 2, sub: 2 },
      { id: 3, sub: 2 },
      { id: 1, sub: 1 },
    ])
  })
})

describe('a Band move during Rough Sort', () => {
  it('changes only the Band: the next prompt is still Rough Sort', () => {
    const log = plus(logOf([1, 2, 3], assign(1, 0), assign(2, 0)), move(1, 3))
    const state = replay(log)
    expect(state.prompt).toEqual({ kind: 'rough-sort', id: 3 })
    expect(state.bands[0]).toEqual({ tiers: [[2]], unplaced: [] })
    expect(state.bands[3]).toEqual({ tiers: [[1]], unplaced: [] })
    expect(state.progress.roughSort).toEqual({ done: 2, total: 3 })
  })

  it('is cancelled by Undo like any move', () => {
    const before = logOf([1, 2, 3], assign(1, 0), assign(2, 0))
    expect(replay(plus(before, move(1, 3), undo))).toEqual(replay(before))
  })

  it('leaves the Duels after Rough Sort as they would be had the title been put there in the first place', () => {
    const moved = plus(logOf([1, 2, 3], assign(1, 0), assign(2, 0)), move(1, 3), assign(3, 0))
    const state = replay(moved)
    expect(state.bandChoice).toEqual({ finished: null, next: 0 })
    expect(state.prompt).toMatchObject({ kind: 'duel', band: 0, a: 3, b: 2 })
  })
})
