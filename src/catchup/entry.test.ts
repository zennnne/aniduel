// Catch-up's entry on Start (#52): when the mochi asks for more titles, and what its sign says.
import { describe, expect, it } from 'vitest'
import type { ListStatus, MediaType } from '../anilist/types.ts'
import type { WriteQueueSnapshot, WriteStatus } from '../writes/writeQueue.ts'
import { isNearEmpty, NEAR_EMPTY_BELOW, startSign } from './entry.ts'

const listOf = (...statuses: ListStatus[]) => statuses.map((status, i) => ({ mediaId: i + 1, status }))
const completed = (n: number) => listOf(...Array.from({ length: n }, () => 'COMPLETED' as const))

describe('a near-empty list', () => {
  it('is one with fewer than 30 watched titles', () => {
    expect(isNearEmpty(completed(0), 'ANIME')).toBe(true)
    expect(isNearEmpty(completed(29), 'ANIME')).toBe(true)
    expect(isNearEmpty(completed(30), 'ANIME')).toBe(false)
  })

  it('does not count Planning titles as watched', () => {
    expect(isNearEmpty([...completed(29), ...listOf('PLANNING', 'PLANNING')], 'ANIME')).toBe(true)
    expect(isNearEmpty([...completed(29), ...listOf('DROPPED')], 'ANIME')).toBe(false)
  })

  it('uses the threshold of the list’s own Media Type', () => {
    expect(isNearEmpty(completed(NEAR_EMPTY_BELOW.MANGA - 1), 'MANGA')).toBe(true)
    expect(isNearEmpty(completed(NEAR_EMPTY_BELOW.MANGA), 'MANGA')).toBe(false)
  })
})

/** The write queue with Catch-up writes of these statuses, all of `mediaType` (anime unless given). */
function queueOf(running: boolean, ...statuses: WriteStatus[]): WriteQueueSnapshot {
  return queueWith(running, statuses.map((status) => ['ANIME', status] as const))
}
function queueWith(running: boolean, writes: ReadonlyArray<readonly [MediaType, WriteStatus]>): WriteQueueSnapshot {
  return {
    state: {
      imports: [],
      writes: writes.map(([mediaType, status], i) => ({ mediaType, mediaId: i + 1, listStatus: 'COMPLETED', name: `Title ${i + 1}`, status })),
    },
    running,
    status: null,
    released: [],
  }
}
const NOTHING_SAVED: WriteQueueSnapshot | null = null

describe('the sign on Start', () => {
  it('invites to Catch-up while nothing is being saved', () => {
    expect(startSign('ANIME', NOTHING_SAVED)).toEqual({ kind: 'catch-up' })
    expect(startSign('ANIME', queueOf(false, 'done', 'skipped'))).toEqual({ kind: 'catch-up' })
  })

  it('shows how far the queue has got while it writes', () => {
    expect(startSign('ANIME', queueOf(true, 'done', 'skipped', 'pending', 'pending'))).toEqual({ kind: 'saving', saved: 2, total: 4 })
  })

  it('counts the failed writes once the queue stops', () => {
    expect(startSign('ANIME', queueOf(false, 'done', 'failed', 'failed'))).toEqual({ kind: 'failed', count: 2 })
  })

  it('keeps showing progress while a run with earlier failures is still writing', () => {
    expect(startSign('ANIME', queueOf(true, 'failed', 'done', 'pending'))).toEqual({ kind: 'saving', saved: 1, total: 2 })
  })

  it('is awake on Manga too', () => {
    expect(startSign('MANGA', NOTHING_SAVED)).toEqual({ kind: 'catch-up' })
  })

  it('counts only the writes of the selected Media Type', () => {
    const queue = queueWith(true, [
      ['ANIME', 'failed'],
      ['ANIME', 'failed'],
      ['MANGA', 'done'],
      ['MANGA', 'pending'],
    ])
    expect(startSign('MANGA', queue)).toEqual({ kind: 'saving', saved: 1, total: 2 })

    const stopped = queueWith(false, [
      ['ANIME', 'failed'],
      ['ANIME', 'failed'],
      ['MANGA', 'done'],
    ])
    expect(startSign('MANGA', stopped)).toEqual({ kind: 'catch-up' })
    expect(startSign('ANIME', stopped)).toEqual({ kind: 'failed', count: 2 })
  })
})
