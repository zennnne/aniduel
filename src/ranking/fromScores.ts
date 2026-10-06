// Rough Sort from Scores (ADR 0008): pure, no I/O. Builds the Band of every scored title in the Pool from how far
// its old AniList score sits from the user's own average. Only the result goes into the Duel log
// (`bands-from-scores`); replay never reads AniList scores.
import { BANDS, type BandIndex, type PerBand } from './engine.ts'

export type ScoresPlan = {
  /** Per Band (Loved first): the scored titles it gets, in the order they were given. */
  bands: PerBand<number[]>
  /** Per Band: how many titles it gets. */
  counts: PerBand<number>
  /** Titles with a score ("X of Y"). */
  scored: number
  /** Every title in the Pool, scored or not. */
  total: number
  /** Fewer than 80% of the titles have a score: the offer says "not recommended". */
  belowThreshold: boolean
  /** Whether to offer at all: false when nothing is scored or every score is the same (SD = 0). */
  offerable: boolean
}

/**
 * The cut rule on z = (score − mean) / SD over the scored titles (population SD):
 * z ≥ +1.5 Loved, +0.5 ≤ z < +1.5 Liked, −0.5 < z < +0.5 Okay, −1.5 < z ≤ −0.5 Meh, z ≤ −1.5 Hated.
 *
 * Computed exactly in integers, so a score right on a cut point always lands where the rule says: with
 * d = n·score − Σscores and T = Σd², z = d / √(T / n), so |z| ≥ k ⇔ n·d² ≥ k²·T.
 * Equal scores have equal d, so they always share a Band.
 *
 * `titles` are in Rough Sort order; scores are on the 100-point scale, 0 = no score.
 */
export function planFromScores(titles: readonly { id: number; score100: number }[]): ScoresPlan {
  const scored = titles.filter((t) => t.score100 > 0)
  const n = BigInt(scored.length)
  const sum = scored.reduce((s, t) => s + BigInt(t.score100), 0n)
  const deviation = (score: number) => n * BigInt(score) - sum
  const spread = scored.reduce((s, t) => s + deviation(t.score100) ** 2n, 0n)
  const bands: ScoresPlan['bands'] = [[], [], [], [], []]
  if (spread > 0n) {
    // The cut points as 4·k² (so k = 1.5 and k = 0.5 stay integers): |z| ≥ k ⇔ 4·n·d² ≥ 4k²·T.
    const FAR = 9n // k = 1.5
    const NEAR = 1n // k = 0.5
    const atLeast = (d: bigint, fourKSquared: bigint) => 4n * n * d * d >= fourKSquared * spread
    for (const t of scored) {
      const d = deviation(t.score100)
      const band: BandIndex =
        d > 0n ? (atLeast(d, FAR) ? 0 : atLeast(d, NEAR) ? 1 : 2) : d < 0n ? (atLeast(d, FAR) ? 4 : atLeast(d, NEAR) ? 3 : 2) : 2
      bands[band].push(t.id)
    }
  }
  const counts = BANDS.map((b) => bands[b].length) as ScoresPlan['counts']
  return {
    bands,
    counts,
    scored: scored.length,
    total: titles.length,
    // In integers, so exactly 80% doesn't warn.
    belowThreshold: 5 * scored.length < 4 * titles.length,
    offerable: spread > 0n,
  }
}
