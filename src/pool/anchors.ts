// Keep My Scale (ADR 0009, ADR 0011), the list side: which titles are Anchors, whether the user has enough of a scale
// to compare against, and which titles a saved Keep My Scale Ranking holds. Pure; callable from Start and Catch-up.
import type { ListEntry, ListStatus, ScoreFormat } from '../anilist/types.ts'
import type { AnchorScore } from '../ranking/engine.ts'
import { levelOfRaw, type SavedScoring } from '../ranking/scoring.ts'
import { buildPool, DEFAULT_STATUSES, OFFERED_STATUSES, type Pool } from './pool.ts'

/** Keep My Scale is offered only with at least this many Anchors… */
export const MIN_ANCHORS = 20
/** …on at least this many distinct scores. */
export const MIN_ANCHOR_SCORES = 3

/**
 * Every title in the list with a score, whatever its status, with that score as a level of the Score Format: the
 * snapshot a Keep My Scale Ranking starts from. A raw score too small to show as a level isn't one. A title picked
 * for the Ranking is never an Anchor, even with a score (ADR 0011): `picked` leaves those out.
 */
export function anchorsOf(list: readonly ListEntry[], format: ScoreFormat, picked?: ReadonlySet<number>): AnchorScore[] {
  return list
    .filter((e) => e.oldScore100 > 0 && !picked?.has(e.mediaId))
    .map((e) => ({ id: e.mediaId, level: levelOfRaw(format, e.oldScore100) }))
    .filter((a) => a.level > 0)
}

export type KeepMyScaleEligibility = {
  eligible: boolean
  /** How many Anchors, and on how many distinct scores. */
  anchors: number
  scores: number
  /** Why it isn't offered, as Start shows it; null when eligible. */
  reason: string | null
}

/** Whether there is enough of a scale for Keep My Scale: at least 20 Anchors on at least 3 distinct scores. */
export function keepMyScaleEligibility(anchors: readonly AnchorScore[]): KeepMyScaleEligibility {
  const scores = new Set(anchors.map((a) => a.level)).size
  const eligible = anchors.length >= MIN_ANCHORS && scores >= MIN_ANCHOR_SCORES
  const reason = eligible
    ? null
    : `Needs at least ${MIN_ANCHORS} scored titles on ${MIN_ANCHOR_SCORES} different scores. You have ${anchors.length} on ${scores}.`
  return { eligible, anchors: anchors.length, scores, reason }
}

/** A saved Keep My Scale Ranking's Anchors (its snapshot, ADR 0009) and the titles in its Pool. */
export type SavedKeepMyScale = { anchors: ReadonlySet<number>; pool: ReadonlySet<number> }

/**
 * A saved Keep My Scale Ranking's Pool: the titles picked for it that are still on the list, whatever their status or
 * score now (ADR 0011: the Pool is fixed once the Ranking starts). The single place that says which titles such a
 * Ranking holds: Start, Preview's old scores and the Import read it here.
 */
export function keepMyScalePool(list: readonly ListEntry[], saved: SavedKeepMyScale, scale?: SavedScoring): Pool {
  return buildPool(
    list.filter((e) => saved.pool.has(e.mediaId)),
    OFFERED_STATUSES,
    scale,
  )
}

/**
 * The titles without a score in the default statuses (Completed and Repeating): what Score New Titles used to score,
 * the count Start shows on Keep My Scale and Catch-up's exit offer names (#61).
 */
export function unscoredTitles(list: readonly ListEntry[]): ListEntry[] {
  const statuses = new Set<ListStatus>(DEFAULT_STATUSES)
  return list.filter((e) => e.oldScore100 === 0 && statuses.has(e.status))
}

/**
 * About how many Duels `n` picked titles take against `levels` Anchor scores: for each title a binary search over the
 * scores, each step confirmed by a second Anchor (ADR 0009), so about twice the plain search: 2 log2(levels + 1).
 * The oracle runs in src/ranking/keepMyScale.test.ts take a little less than this.
 */
export function estimateKeepMyScaleDuels(n: number, levels: number): number {
  return Math.round(2 * n * Math.log2(levels + 1))
}
