// Score New Titles (ADR 0009), the list side: which titles are Anchors, whether the user has enough of a scale to
// compare against, and which titles a Score New Titles Pool is built from. Pure; callable from Start and Catch-up.
import type { ListEntry, ScoreFormat } from '../anilist/types.ts'
import type { AnchorScore } from '../ranking/engine.ts'
import { levelOfRaw } from '../ranking/scoring.ts'

/** Score New Titles is offered only with at least this many Anchors… */
export const MIN_ANCHORS = 20
/** …on at least this many distinct scores. */
export const MIN_ANCHOR_SCORES = 3

/**
 * Every title in the list with a score, whatever its status, with that score as a level of the Score Format: the
 * snapshot a Score New Titles Ranking starts from. A raw score too small to show as a level isn't one.
 */
export function anchorsOf(list: readonly ListEntry[], format: ScoreFormat): AnchorScore[] {
  return list
    .filter((e) => e.oldScore100 > 0)
    .map((e) => ({ id: e.mediaId, level: levelOfRaw(format, e.oldScore100) }))
    .filter((a) => a.level > 0)
}

export type NewTitlesEligibility = {
  eligible: boolean
  /** How many Anchors, and on how many distinct scores. */
  anchors: number
  scores: number
  /** Why it isn't offered, as Start shows it; null when eligible. */
  reason: string | null
}

/** Whether there is enough of a scale for Score New Titles: at least 20 Anchors on at least 3 distinct scores. */
export function newTitlesEligibility(anchors: readonly AnchorScore[]): NewTitlesEligibility {
  const scores = new Set(anchors.map((a) => a.level)).size
  const eligible = anchors.length >= MIN_ANCHORS && scores >= MIN_ANCHOR_SCORES
  const reason = eligible
    ? null
    : `Needs at least ${MIN_ANCHORS} scored titles on ${MIN_ANCHOR_SCORES} different scores. You have ${anchors.length} on ${scores}.`
  return { eligible, anchors: anchors.length, scores, reason }
}

/**
 * The list a Score New Titles Pool is built from (the status filter comes after): titles without a score, and for a
 * saved Ranking also its new titles that got a score since (e.g. by an Import), so they stay in it. Never an
 * Anchor of the saved Ranking, even once its score was removed on AniList: the snapshot doesn't change (ADR 0009).
 */
export function newTitlesList(
  list: readonly ListEntry[],
  saved: { anchors: ReadonlySet<number>; pool: ReadonlySet<number> } | null,
): ListEntry[] {
  return list.filter((e) => !saved?.anchors.has(e.mediaId) && (e.oldScore100 === 0 || Boolean(saved?.pool.has(e.mediaId))))
}

/**
 * About how many Duels `n` new titles take against `levels` Anchor scores: a binary search over the levels and the
 * gaps around them for each title.
 */
export function estimateNewTitlesDuels(n: number, levels: number): number {
  return levels === 0 ? 0 : n * Math.ceil(Math.log2(2 * levels + 1))
}
