// Catch-up's entry on Start (#52): when the mochi asks for more titles, and what its sign says.
import { describe, expect, it } from 'vitest'
import type { ListStatus } from '../anilist/types.ts'
import type { WriteStatus } from '../writes/writeQueue.ts'
import { isNearEmpty, startSign } from './entry.ts'
import type { QueueSnapshot } from './queue.ts'

const listOf = (...statuses: ListStatus[]) => statuses.map((status, i) => ({ mediaId: i + 1, status }))
const completed = (n: number) => listOf(...Array.from({ length: n }, () => 'COMPLETED' as const))

describe('a near-empty list', () => {
  it('is one with fewer than 50 watched titles', () => {
    expect(isNearEmpty(completed(0))).toBe(true)
    expect(isNearEmpty(completed(49))).toBe(true)
    expect(isNearEmpty(completed(50))).toBe(false)
  })

  it('does not count Planning titles as watched', () => {
    expect(isNearEmpty([...completed(49), ...listOf('PLANNING', 'PLANNING')])).toBe(true)
    expect(isNearEmpty([...completed(49), ...listOf('DROPPED')])).toBe(false)
  })
})

/** A queue snapshot whose writes have these statuses. */
function queueOf(running: boolean, ...statuses: WriteStatus[]): QueueSnapshot {
  const writes = statuses.map((status, i) => ({ mediaId: i + 1, listStatus: 'COMPLETED' as const, name: `Title ${i + 1}`, status }))
  return { state: { writes }, running, status: null }
}
const NOTHING_SAVED: QueueSnapshot = { state: null, running: false, status: null }

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

  it('sleeps while Manga is selected, whatever the queue is doing', () => {
    expect(startSign('MANGA', NOTHING_SAVED)).toEqual({ kind: 'asleep' })
    expect(startSign('MANGA', queueOf(false, 'failed'))).toEqual({ kind: 'asleep' })
  })
})
