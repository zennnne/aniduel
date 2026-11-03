// Catch-up batches: the 20 titles on screen, the user's marks on them, and "Save & next 20". Pure: the screen keeps the
// current batch and hands every change back through these functions.
import type { CatchUpMedia, Era } from '../anilist/candidates.ts'
import type { ListEntry, ListStatus, MediaType } from '../anilist/types.ts'
import type { QueuedWrite, StatusWrite } from '../writes/writeQueue.ts'
import { suggestCatchUp, type AnimeSignal, type Suggestion } from './suggest.ts'

/** What a title can be marked in Catch-up. Unmarked means Passed. `CURRENT` is manga's Reading. */
export type CatchUpMark = Extract<ListStatus, 'COMPLETED' | 'CURRENT' | 'DROPPED' | 'PLANNING' | 'PAUSED'>

/**
 * The marks of each Media Type, in the order a tap on a cover steps through them, then back to unmarked. Manga has
 * Reading, for a running series the user has caught up with, and reads from "finished" to "stopped".
 */
export const MARKS: Readonly<Record<MediaType, readonly CatchUpMark[]>> = {
  ANIME: ['COMPLETED', 'DROPPED', 'PLANNING', 'PAUSED'],
  MANGA: ['COMPLETED', 'CURRENT', 'PAUSED', 'DROPPED', 'PLANNING'],
}

/** One title on the user's list, as Catch-up needs it. */
export type CatchUpEntry = Pick<ListEntry, 'mediaId' | 'status' | 'year' | 'format'>

export type CatchUpBatch = {
  /** 1 for the first batch of a visit, then 2, 3… */
  number: number
  suggestions: Suggestion[]
  /** Media id → mark, for the marked titles of this batch only. */
  marks: ReadonlyMap<number, CatchUpMark>
}

/** What the next batch is chosen from. */
export type BatchInput = {
  /** The Media Type of `list` and `media`; anime when left out. */
  mediaType?: MediaType
  list: readonly CatchUpEntry[]
  media: readonly CatchUpMedia[]
  /** Passed history: media id → when it was Passed (ms). */
  passed: ReadonlyMap<number, number>
  now: number
  seed: number
  /** The Starting era's years, for a near-empty list (null: all-time favourites). */
  startingEra?: Era | null
  /** Manga only: the user's anime, for the anime signal. */
  anime?: AnimeSignal
}

function suggest(input: BatchInput): Suggestion[] {
  const { mediaType, list, media, passed, now, seed, startingEra, anime } = input
  return suggestCatchUp({ mediaType, list, media, passed, now, seed, startingEra, anime })
}

export function firstBatch(input: BatchInput): CatchUpBatch {
  return { number: 1, suggestions: suggest(input), marks: new Map() }
}

const inBatch = (batch: CatchUpBatch, id: number) => batch.suggestions.some((s) => s.media.id === id)

/** Sets a title's mark (null clears it), e.g. from its ⋯ menu. A title not in the batch is ignored. */
export function setMark(batch: CatchUpBatch, id: number, mark: CatchUpMark | null): CatchUpBatch {
  if (!inBatch(batch, id)) return batch
  const marks = new Map(batch.marks)
  if (mark === null) marks.delete(id)
  else marks.set(id, mark)
  return { ...batch, marks }
}

/**
 * A tap on a cover: the next of the Media Type's MARKS, then unmarked. On anime Completed → Dropped → Planning → Paused;
 * on manga Completed → Reading → Paused → Dropped → Planning.
 */
export function cycleMark(batch: CatchUpBatch, id: number, mediaType: MediaType = 'ANIME'): CatchUpBatch {
  const cycle = MARKS[mediaType]
  const now = batch.marks.get(id)
  const next = now === undefined ? cycle[0] : (cycle[cycle.indexOf(now) + 1] ?? null)
  return setMark(batch, id, next)
}

/** How many titles of the batch have each mark, and how many are left unmarked (Passed). */
export type MarkCounts = Record<CatchUpMark, number> & { passed: number }

export function markCounts(batch: CatchUpBatch): MarkCounts {
  const marks = [...batch.marks.values()]
  const count = (mark: CatchUpMark) => marks.filter((m) => m === mark).length
  return {
    COMPLETED: count('COMPLETED'),
    CURRENT: count('CURRENT'),
    DROPPED: count('DROPPED'),
    PLANNING: count('PLANNING'),
    PAUSED: count('PAUSED'),
    passed: batch.suggestions.length - marks.length,
  }
}

export type SavedBatch = {
  /** One status write per marked title, in batch order, for the write queue. */
  writes: StatusWrite[]
  /** The titles left unmarked. */
  passed: number[]
  /** The list with the marked titles on it: they count for the next batch before AniList has them. */
  list: CatchUpEntry[]
  /** The Passed history given in, plus this batch's Passed titles at `now`. */
  history: Map<number, number>
  next: CatchUpBatch
}

/** "Save & next 20": the writes for the marks, and the next batch chosen from the list as it is after them. */
export function saveBatch(batch: CatchUpBatch, input: BatchInput): SavedBatch {
  const writes: StatusWrite[] = []
  const passed: number[] = []
  const added: CatchUpEntry[] = []
  for (const { media } of batch.suggestions) {
    const mark = batch.marks.get(media.id)
    if (mark === undefined) {
      passed.push(media.id)
      continue
    }
    writes.push({ mediaId: media.id, listStatus: mark })
    added.push({ mediaId: media.id, status: mark, year: media.year, format: media.format })
  }
  const addedIds = new Set(added.map((e) => e.mediaId))
  const list = [...input.list.filter((e) => !addedIds.has(e.mediaId)), ...added]
  const history = new Map(input.passed)
  for (const id of passed) history.set(id, input.now)
  const next: CatchUpBatch = {
    number: batch.number + 1,
    suggestions: suggest({ ...input, list, passed: history }),
    marks: new Map(),
  }
  return { writes, passed, list, history, next }
}

/**
 * The list as read from AniList, plus the titles still in the write queue (pending, or failed and waiting for Retry):
 * they were marked, so they count as on the list. Year and format come from `media` when it has them.
 */
export function withQueuedWrites(
  list: readonly CatchUpEntry[],
  queued: ReadonlyArray<QueuedWrite<StatusWrite>>,
  media: readonly CatchUpMedia[],
): CatchUpEntry[] {
  const listed = new Set(list.map((e) => e.mediaId))
  const known = new Map(media.map((m) => [m.id, m]))
  const added = queued
    .filter((w) => (w.status === 'pending' || w.status === 'failed') && !listed.has(w.mediaId))
    .map((w) => ({ mediaId: w.mediaId, status: w.listStatus, year: known.get(w.mediaId)?.year ?? null, format: known.get(w.mediaId)?.format ?? null }))
  return [...list, ...added]
}
