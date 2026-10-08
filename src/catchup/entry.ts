// Catch-up's entry on Start (#52, UI decisions on #37): the mochi over the Start card's corner, holding a sign.
import type { ListStatus, MediaType } from '../anilist/types.ts'
import { queueProgress, type QueueSnapshot } from './queue.ts'
import { isWatched } from './watched.ts'

/** Below this many watched titles the list is near empty, and the mochi asks for more without being hovered. */
export const NEAR_EMPTY_BELOW = 10

/** Titles on the list with any status but Planning. */
export function watchedCount(list: readonly { status: ListStatus }[]): number {
  return list.filter(isWatched).length
}

/** Fewer than NEAR_EMPTY_BELOW watched titles. */
export function isNearEmpty(list: readonly { status: ListStatus }[]): boolean {
  return watchedCount(list) < NEAR_EMPTY_BELOW
}

/**
 * What the sign in the mochi's paws says: "+ Catch-up", "saving 12/20" with a fill while the write queue runs,
 * "2 failed · retry" once it stopped with failures, or "anime only" (asleep, not tappable) while Manga is selected.
 */
export type StartSign =
  | { kind: 'catch-up' }
  | { kind: 'saving'; saved: number; total: number }
  | { kind: 'failed'; count: number }
  | { kind: 'asleep' }

export function startSign(mediaType: MediaType, queue: QueueSnapshot): StartSign {
  if (mediaType !== 'ANIME') return { kind: 'asleep' }
  if (!queue.state) return { kind: 'catch-up' }
  const progress = queueProgress(queue.state)
  if (queue.running && progress.left > 0) return { kind: 'saving', saved: progress.saved, total: progress.total }
  if (progress.failed.length > 0) return { kind: 'failed', count: progress.failed.length }
  return { kind: 'catch-up' }
}
