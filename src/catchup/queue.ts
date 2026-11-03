// Catch-up's part of the write queue: the list status writes of every saved page, as the Catch-up screen and the
// sign on Start show them. They are written by the one write queue, in line with Import's scores.
import type { MediaType } from '../anilist/types.ts'
import { isStatusWrite, writeSummary, type QueuedWrite, type RunnerStatus, type StatusWrite, type WriteQueueSnapshot } from '../writes/writeQueue.ts'

/** One status write from a saved page, named for the failure bar. */
export type CatchUpWrite = StatusWrite & { name: string }

export type QueueSnapshot = {
  /** Null until something was saved (or a saved queue was found). */
  state: { writes: QueuedWrite<CatchUpWrite>[] } | null
  running: boolean
  /** What the queue is doing, e.g. waiting out a rate limit. */
  status: RunnerStatus | null
}

/** The status writes of one Media Type in the write queue: what Catch-up on that Media Type shows of it. */
export function catchUpSnapshot(queue: WriteQueueSnapshot, mediaType: MediaType): QueueSnapshot {
  const writes = queue.state.writes.flatMap(({ mediaType: type, ...w }) =>
    type === mediaType && isStatusWrite(w) ? [{ ...w, name: w.name ?? `Title #${w.mediaId}` }] : [],
  )
  return { state: writes.length > 0 ? { writes } : null, running: queue.running, status: queue.status }
}

export type QueueProgress = {
  /** Written (or found already on the list) in this run. */
  saved: number
  /** Every write in this run, failed ones not counted. */
  total: number
  left: number
  /** Writes that didn't reach AniList, waiting for Retry. */
  failed: CatchUpWrite[]
}

export function queueProgress(state: NonNullable<QueueSnapshot['state']>): QueueProgress {
  const { written, skipped, failed, left, total } = writeSummary(state.writes)
  return {
    saved: written + skipped,
    total: total - failed,
    left,
    failed: state.writes
      .filter((w) => w.status === 'failed')
      .map(({ mediaId, listStatus, name }) => ({ mediaId, listStatus, name })),
  }
}

/**
 * When a run of the queue just ended: the titles now on the user's lists through Catch-up, by Media Type (only those
 * with any). Otherwise null.
 */
export function settledByRun(before: WriteQueueSnapshot, after: WriteQueueSnapshot): Map<MediaType, number[]> | null {
  if (!before.running || after.running) return null
  const settled = new Map<MediaType, number[]>()
  for (const mediaType of ['ANIME', 'MANGA'] as const) {
    const done = (catchUpSnapshot(after, mediaType).state?.writes ?? []).filter((w) => w.status === 'done').map((w) => w.mediaId)
    if (done.length > 0) settled.set(mediaType, done)
  }
  return settled
}
