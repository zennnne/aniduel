// Catch-up batches: the 20 titles on screen, the user's marks on them, and "Save & next 20". Pure: the screen keeps the
// current batch and hands every change back through these functions.
import type { CatchUpMedia } from '../anilist/candidates.ts'
import type { ListEntry, ListStatus } from '../anilist/types.ts'
import type { StatusWrite } from '../import/runner.ts'
import { suggestCatchUp, type Suggestion } from './suggest.ts'

/** What a title can be marked in Catch-up. Unmarked means Passed. */
export type CatchUpMark = Extract<ListStatus, 'COMPLETED' | 'DROPPED' | 'PLANNING'>

/** Tapping a cover steps through these, then back to unmarked. */
export const MARK_CYCLE: readonly CatchUpMark[] = ['COMPLETED', 'DROPPED', 'PLANNING']

/** One title on the user's anime list, as Catch-up needs it. */
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
  list: readonly CatchUpEntry[]
  media: readonly CatchUpMedia[]
  /** Passed history: media id → when it was Passed (ms). */
  passed: ReadonlyMap<number, number>
  now: number
  seed: number
}

function suggest(input: BatchInput): Suggestion[] {
  return suggestCatchUp({ list: input.list, media: input.media, passed: input.passed, now: input.now, seed: input.seed })
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

/** A tap on a cover: Completed → Dropped → Planning → unmarked. */
export function cycleMark(batch: CatchUpBatch, id: number): CatchUpBatch {
  const now = batch.marks.get(id)
  const next = now === undefined ? MARK_CYCLE[0] : (MARK_CYCLE[MARK_CYCLE.indexOf(now) + 1] ?? null)
  return setMark(batch, id, next)
}

export type MarkCounts = { completed: number; dropped: number; planning: number; passed: number }

export function markCounts(batch: CatchUpBatch): MarkCounts {
  const marks = [...batch.marks.values()]
  const count = (mark: CatchUpMark) => marks.filter((m) => m === mark).length
  return {
    completed: count('COMPLETED'),
    dropped: count('DROPPED'),
    planning: count('PLANNING'),
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
