// An Import as the Import screen sees it: its plan of score writes, each with how far it got, and the hash and Score
// Format the plan was made from. The writes themselves go through the write queue with Catch-up's.
import type { MediaType, ScoreFormat } from '../anilist/types.ts'
import type { PendingWrite } from '../ranking/preview.ts'
import {
  WRITE_SPACING_MS,
  isSavedProgress,
  isSavedScoreWrite,
  isScoreFormat,
  isStatusWrite,
  writeSummary,
  type QueuedWrite,
  type RunnerStatus,
  type WriteQueueState,
  type WriteSummary,
} from '../writes/writeQueue.ts'

export type ImportWrite = QueuedWrite<PendingWrite>

/** One Import. */
export type ImportState = {
  /** Hash of the Duel log and scoring settings the plan was made from. */
  hash: string
  format: ScoreFormat
  writes: ImportWrite[]
}

export function newImport(plan: readonly PendingWrite[], from: { hash: string; format: ScoreFormat }): ImportState {
  return { hash: from.hash, format: from.format, writes: plan.map((w) => ({ ...w, status: 'pending' as const })) }
}

/** The Media Type's Import in the write queue, or null if none is queued. */
export function importOf(queue: WriteQueueState, mediaType: MediaType): ImportState | null {
  const plan = queue.imports.find((i) => i.mediaType === mediaType)
  if (!plan) return null
  const writes = queue.writes.flatMap(({ mediaType: type, ...w }) => (type === mediaType && !isStatusWrite(w) ? [w as ImportWrite] : []))
  return { hash: plan.hash, format: plan.format, writes }
}

/**
 * An Import saved on its own, as before Import and Catch-up shared one write queue, or null if it isn't one. Read once
 * to carry an unfinished Import over into the queue.
 */
export function parseImportState(value: unknown): ImportState | null {
  const v = value as Partial<ImportState> | null
  if (typeof v !== 'object' || v === null || typeof v.hash !== 'string' || !isScoreFormat(v.format)) return null
  if (!Array.isArray(v.writes)) return null
  return v.writes.every((w) => isSavedProgress(w) && isSavedScoreWrite(w)) ? (v as ImportState) : null
}

/** Puts every failed title back in line, for the Retry button. */
export function retryFailed(state: ImportState): ImportState {
  const writes = state.writes.map(({ error: _e, ...w }) => (w.status === 'failed' ? { ...w, status: 'pending' as const } : w))
  return { ...state, writes }
}

/** Estimated time until every pending title is written: one spacing each, plus what is left of a rate-limit wait. */
export function timeLeftMs(state: ImportState, status: RunnerStatus, now: number): number {
  const left = state.writes.filter((w) => w.status === 'pending').length
  if (status.phase === 'waiting') return Math.max(0, status.until - now) + left * WRITE_SPACING_MS
  return left * (status.phase === 'writing' ? status.spacingMs : WRITE_SPACING_MS)
}

/** "1 min 24 s", or "34 s" under a minute. */
export function formatDuration(ms: number): string {
  const seconds = Math.ceil(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  return minutes === 0 ? `${seconds} s` : `${minutes} min ${seconds % 60} s`
}

/** Each skipped title with why it was skipped ("changed on AniList", "not on your list"), in plan order. */
export function skippedWrites(state: ImportState): { mediaId: number; reason: string }[] {
  return state.writes.filter((w) => w.status === 'skipped').map((w) => ({ mediaId: w.mediaId, reason: w.error ?? 'skipped' }))
}

export type ImportSummary = WriteSummary

export function importSummary(state: ImportState): ImportSummary {
  return writeSummary(state.writes)
}
