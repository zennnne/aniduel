// Duel estimates. Full Ranking (binary insertion): placing k titles needs about log2(k!) Duels. Scores (ADR 0007):
// titles that end on one level need no order among themselves, which saves part of log2(g!) per level of g titles.
// Duels only happen inside a Band (or Sub-band), so the estimate is summed per Band.
import type { ScoreFormat } from '../anilist/types.ts'
import { progressOf, type BandIndex, type RankingState, type SortGoal } from './engine.ts'
import { levelAt, type SavedScoring, type ScoringSettings } from './scoring.ts'

export const BAND_COUNT = 5

/**
 * The share of log2(g!) per level of g titles that Scores saves in practice. The information bound would be 1; the
 * level-targeted multi-selection measures about 0.37 (one 150-title Band) to 0.46 (five equal Bands) on 200 titles.
 */
const SCORES_SAVING = 0.42

function log2Factorial(k: number): number {
  let sum = 0
  for (let i = 2; i <= k; i++) sum += Math.log2(i)
  return sum
}

/** What a Scores estimate needs: the scoring settings that turn positions into levels. */
export type ScoresScale = { format: ScoreFormat; settings: ScoringSettings }

/**
 * Expected Duels for the given Band (or Sub-band) sizes, top to bottom, rounded. With a `scale` the Ranking is on
 * Scores: each Band saves part of log2(g!) for every level its positions share (g titles), so a Band whose titles
 * all get different levels costs what it costs on Full Ranking.
 */
export function duelsForBandSizes(sizes: readonly number[], scale?: ScoresScale): number {
  const n = sizes.reduce((sum, k) => sum + k, 0)
  let total = 0
  let offset = 0
  for (const k of sizes) {
    total += log2Factorial(k)
    if (scale) {
      const shared = new Map<number, number>()
      for (let p = offset; p < offset + k; p++) {
        const level = levelAt(scale.format, scale.settings, p, n)
        shared.set(level, (shared.get(level) ?? 0) + 1)
      }
      for (const g of shared.values()) total -= SCORES_SAVING * log2Factorial(g)
    }
    offset += k
  }
  return Math.round(total)
}

/** Splits `n` titles into five equal Bands; a remainder goes to the first Bands. */
export function equalBandSizes(n: number): number[] {
  const base = Math.floor(n / BAND_COUNT)
  const extra = n % BAND_COUNT
  return Array.from({ length: BAND_COUNT }, (_, i) => base + (i < extra ? 1 : 0))
}

type Part = { readonly tiers: readonly (readonly unknown[])[]; readonly unplaced: readonly unknown[] }
type BandPart = Part & { readonly subBands?: readonly Part[] }

/** The Scores scale of a Ranking on Scores (its log's own settings), or undefined on Full Ranking. */
export function scaleOf(state: { readonly sortGoal?: SortGoal; readonly scoring?: SavedScoring }): ScoresScale | undefined {
  return state.sortGoal === 'scores' && state.scoring ? state.scoring : undefined
}

/**
 * Expected Duels for the whole Ranking from the real Band sizes (#1 US8), or null while Rough Sort isn't done
 * (then the estimate assumes equal Bands). A split Band counts Sub-band by Sub-band. Follows the Sort Goal.
 */
export function duelsFromBands(state: {
  readonly progress: { readonly roughSort: { readonly done: number; readonly total: number } }
  readonly bands: readonly BandPart[]
  readonly sortGoal?: SortGoal
  readonly scoring?: SavedScoring
}): number | null {
  const { done, total } = state.progress.roughSort
  if (done < total) return null
  const size = (part: Part) => part.tiers.reduce((n, tier) => n + tier.length, 0) + part.unplaced.length
  return duelsForBandSizes(state.bands.flatMap((band) => (band.subBands ?? [band]).map(size)), scaleOf(state))
}

/**
 * About how many more Duels the Ranking takes on Full Ranking than on Scores (#28, the "+~N Duels" shown before
 * switching): the Full Ranking estimate minus the Scores one, over the real Band sizes once Rough Sort is done,
 * equal Bands before. 0 on Full Ranking.
 */
export function fullRankingExtra(state: RankingState): number {
  const scale = scaleOf(state)
  if (!scale) return 0
  const { done, total } = state.progress.roughSort
  const size = (part: Part) => part.tiers.reduce((n, tier) => n + tier.length, 0) + part.unplaced.length
  const sizes = done < total ? equalBandSizes(total) : state.bands.flatMap((band) => (band.subBands ?? [band]).map(size))
  return Math.max(0, duelsForBandSizes(sizes) - duelsForBandSizes(sizes, scale))
}

/**
 * Expected Duels left in a Band, rounded: each unplaced title lands in one of (Tiers + 1) places, about log2 of
 * that many Duels, and the Band grows by one Tier per title. A split Band counts Sub-band by Sub-band.
 */
export function duelsLeft(band: BandPart): number {
  let sum = 0
  for (const part of band.subBands ?? [band]) {
    for (let k = 1; k <= part.unplaced.length; k++) sum += Math.log2(part.tiers.length + k)
  }
  return Math.round(sum)
}

/**
 * Expected Duels left in a Band of a Ranking, following its Sort Goal. On Scores, its unsettled titles are counted
 * the way `duelsLeft` counts unplaced ones, scaled by what Scores saves on the whole Ranking's Band sizes.
 */
export function duelsLeftIn(state: RankingState, band: BandIndex): number {
  const scale = scaleOf(state)
  if (!scale) return duelsLeft(state.bands[band])
  const size = (part: Part) => part.tiers.reduce((n, tier) => n + tier.length, 0) + part.unplaced.length
  const sizes = state.bands.flatMap((b) => (b.subBands ?? [b]).map(size))
  const full = duelsForBandSizes(sizes)
  const ratio = full > 0 ? duelsForBandSizes(sizes, scale) / full : 1
  let sum = 0
  const b = state.bands[band]
  for (const part of b.subBands ?? [b]) {
    const { done, total } = progressOf(state, part)
    for (let k = 1; k <= total - done; k++) sum += Math.log2(done + k)
  }
  return Math.round(sum * ratio)
}
