// Catch-up's entry on Start (#52, UI decisions on #37): the mochi over the Start card's corner, holding a sign.
import type { ListStatus, MediaType } from '../anilist/types.ts'
import { queueProgress, type QueueSnapshot } from './queue.ts'
import { isWatched } from './watched.ts'

/**
 * Below this many watched titles a list of the Media Type is near empty: the mochi asks for more without being
 * hovered, and Catch-up starts from the Starting era. Manga's is anime's until its holdout eval (#96) is picked.
 */
export const NEAR_EMPTY_BELOW: Readonly<Record<MediaType, number>> = { ANIME: 30, MANGA: 30 }

/** Titles on the list with any status but Planning. */
export function watchedCount(list: readonly { status: ListStatus }[]): number {
  return list.filter(isWatched).length
}

/** Fewer than the Media Type's NEAR_EMPTY_BELOW watched titles. */
export function isNearEmpty(list: readonly { status: ListStatus }[], mediaType: MediaType): boolean {
  return watchedCount(list) < NEAR_EMPTY_BELOW[mediaType]
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
