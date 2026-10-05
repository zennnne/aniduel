// What a saved Import is checked against before it resumes: the Duel log and scoring settings it was planned from.
import type { ScoreFormat } from '../anilist/types.ts'
import type { DuelLog } from '../ranking/engine.ts'
import type { PendingWrite } from '../ranking/preview.ts'
import type { SavedScoring } from '../ranking/scoring.ts'
import { newImport, type ImportState } from './runner.ts'

/** A short hash (FNV-1a, 32 bit) of the Duel log and scoring settings. Any answer or setting change changes it. */
export function planHash(log: DuelLog, scoring: SavedScoring): string {
  const text = JSON.stringify({ log, scoring })
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export type ResumeDecision =
  /** Nothing changed: carry on with the saved plan, no new confirmation. */
  | { kind: 'continue'; state: ImportState }
  /** The Ranking or settings changed: a recalculated plan to confirm again. */
  | { kind: 'confirm-again'; state: ImportState; writtenBefore: number }
  /** The Score Format changed (ADR 0003): the plan is thrown away; scores are made again on Preview. */
  | { kind: 'dropped' }

/**
 * Decides how a saved Import resumes. `plan` recalculates the Import plan from the current Ranking; it is only
 * called when the hash changed.
 */
export function resumeImport(
  saved: ImportState,
  now: { hash: string; format: ScoreFormat; plan: () => PendingWrite[] },
): ResumeDecision {
  if (saved.format !== now.format) return { kind: 'dropped' }
  if (saved.hash === now.hash) return { kind: 'continue', state: saved }
  const written = new Map(saved.writes.filter((w) => w.status === 'done').map((w) => [w.mediaId, w.scoreRaw]))
  // A title the old plan wrote has that score on AniList now, even if the list in memory is older.
  const plan = now.plan().map((w) => ({ ...w, oldScore100: written.get(w.mediaId) ?? w.oldScore100 }))
  return { kind: 'confirm-again', state: newImport(plan, { hash: now.hash, format: now.format }), writtenBefore: written.size }
}
