import { describe, expect, it } from 'vitest'
import type { ListEntry, ListStatus } from '../anilist/types.ts'
import { appendEvent, replay, startLog, type DuelLog, type LogEvent } from '../ranking/engine.ts'
import { syncEvents } from './sync.ts'

function entry(mediaId: number, status: ListStatus = 'COMPLETED', completedYear: number | null = null): ListEntry {
  return {
    mediaId,
    status,
    oldScore100: 0,
    completedAt: { year: completedYear, month: null, day: null },
    title: { romaji: `Title ${mediaId}`, english: null, native: null },
    coverUrl: null,
    coverColor: null,
    bannerUrl: null,
    year: null,
    format: null,
    length: null,
    siteUrl: '',
  }
}

const header = { seed: 1, userId: 7, mediaType: 'ANIME' as const }
const logOf = (ids: number[], ...events: LogEvent[]): DuelLog => events.reduce(appendEvent, startLog({ ...header, ids }))
const DEFAULT: ListStatus[] = ['COMPLETED', 'REPEATING']

describe('syncEvents: comparing the fetched list with the Pool in the Duel log', () => {
  it('records nothing when the Pool is unchanged', () => {
    expect(syncEvents(logOf([1, 2]), [entry(1), entry(2)], DEFAULT, 'ROMAJI')).toEqual([])
  })

  it('adds new titles in Rough Sort order (latest completed first)', () => {
    const list = [entry(1), entry(3, 'COMPLETED', 2020), entry(4, 'COMPLETED', 2024), entry(2)]
    expect(syncEvents(logOf([1, 2]), list, DEFAULT, 'ROMAJI')).toEqual([{ type: 'titles-added', ids: [4, 3] }])
  })

  it('removes titles no longer on the list, or no longer in a chosen status, in log order', () => {
    const list = [entry(1, 'DROPPED'), entry(2), entry(3, 'PLANNING')]
    expect(syncEvents(logOf([3, 1, 2]), list, DEFAULT, 'ROMAJI')).toEqual([{ type: 'titles-removed', ids: [3, 1] }])
  })

  it('records removals before additions when both happen', () => {
    expect(syncEvents(logOf([1, 2]), [entry(2), entry(5)], DEFAULT, 'ROMAJI')).toEqual([
      { type: 'titles-removed', ids: [1] },
      { type: 'titles-added', ids: [5] },
    ])
  })

  it('records nothing when a title moves between two chosen statuses (Completed → Repeating)', () => {
    expect(syncEvents(logOf([1, 2]), [entry(1, 'REPEATING'), entry(2)], DEFAULT, 'ROMAJI')).toEqual([])
  })

  it('handles a changed status filter the same way: matching titles join, others leave', () => {
    const list = [entry(1), entry(2, 'PAUSED'), entry(3, 'DROPPED')]
    expect(syncEvents(logOf([1, 2]), list, ['COMPLETED', 'DROPPED'], 'ROMAJI')).toEqual([
      { type: 'titles-removed', ids: [2] },
      { type: 'titles-added', ids: [3] },
    ])
  })

  it('keeps Forgotten titles in the Pool: they are not added again', () => {
    expect(syncEvents(logOf([1, 2], { type: 'forgotten', id: 1 }), [entry(1), entry(2)], DEFAULT, 'ROMAJI')).toEqual([])
  })

  it('adds a title again after it was removed earlier, and the result replays', () => {
    const log = logOf([1, 2], { type: 'titles-removed', ids: [2] })
    const events = syncEvents(log, [entry(1), entry(2)], DEFAULT, 'ROMAJI')
    expect(events).toEqual([{ type: 'titles-added', ids: [2] }])
    expect(replay(events.reduce(appendEvent, log)).prompt).toEqual({ kind: 'rough-sort', id: 1 })
  })
})
