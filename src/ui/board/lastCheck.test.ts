// The last-check Board after Rough Sort: when it shows instead of the Band choice.
import { describe, expect, it } from 'vitest'
import { replay, startLog, type BandIndex, type DuelLog, type LogEvent } from '../../ranking/engine.ts'
import { lastCheckDue } from './lastCheck.ts'

const header = { seed: 42, userId: 7, mediaType: 'ANIME' as const }

function logOf(ids: number[], ...events: LogEvent[]): DuelLog {
  const log = startLog({ ...header, ids })
  return { ...log, events: [...log.events, ...events] }
}

const plus = (log: DuelLog, ...events: LogEvent[]): DuelLog => ({ ...log, events: [...log.events, ...events] })
const assign = (id: number, band: BandIndex): LogEvent => ({ type: 'band-assigned', id, band })
const duel = (a: number, b: number): LogEvent => ({ type: 'duel-answered', a, b, result: 'a' })
const undo: LogEvent = { type: 'undo' }

/** Titles 1 and 2 both Loved, Rough Sort done: the first Duel is 2 vs 1. */
const sorted = () => logOf([1, 2], assign(1, 0), assign(2, 0))

describe('the last check', () => {
  it('is due once Rough Sort by hand is finished, until the user continues', () => {
    expect(lastCheckDue(replay(sorted()), false)).toBe(true)
    expect(lastCheckDue(replay(sorted()), true)).toBe(false)
  })

  it('is not due while Rough Sort is going on', () => {
    expect(lastCheckDue(replay(logOf([1, 2], assign(1, 0))), false)).toBe(false)
  })

  it('is due right away when Rough Sort from Scores placed every title, so Rough Sort by hand is skipped', () => {
    const fromScores: LogEvent = { type: 'bands-from-scores', bands: [[1, 2], [], [3], [], []] }
    expect(lastCheckDue(replay(logOf([1, 2, 3], fromScores)), false)).toBe(true)
  })

  it('is due after Rough Sort from Scores once the titles without a score are sorted by hand', () => {
    const fromScores: LogEvent = { type: 'bands-from-scores', bands: [[1, 2], [], [], [], []] }
    expect(lastCheckDue(replay(logOf([1, 2, 3], fromScores)), false)).toBe(false)
    expect(lastCheckDue(replay(logOf([1, 2, 3], fromScores, assign(3, 4))), false)).toBe(true)
  })

  it('is not due once a Duel is answered, and is due again when Undo removes every Duel answer', () => {
    const answered = plus(sorted(), { type: 'band-selected', band: 0 }, duel(2, 1))
    expect(lastCheckDue(replay(answered), false)).toBe(false)
    expect(lastCheckDue(replay(plus(answered, undo)), false)).toBe(true)
  })

  it('is never due for titles a sync added after Duels started: they go through Rough Sort only', () => {
    const synced = plus(sorted(), duel(2, 1), { type: 'titles-added', ids: [3] })
    expect(lastCheckDue(replay(synced), false)).toBe(false)
    const sortedAgain = plus(synced, assign(3, 1))
    expect(replay(sortedAgain).prompt.kind).not.toBe('rough-sort')
    expect(lastCheckDue(replay(sortedAgain), false)).toBe(false)
  })
})
