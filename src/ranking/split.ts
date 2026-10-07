// Splitting an oversized Band into Sub-bands (ADR 0006): when to offer it, and what it saves.
// Pure functions over RankingState (and the log, for when to offer); the split itself is the engine's `band-split` event.
import { BANDS, progressOf, type BandIndex, type BandState, type DuelLog, type RankingState } from './engine.ts'

/** A split is offered for a Band with at least this many titles that still need Duels (see `titlesToSort`). */
export const SPLIT_OFFER_THRESHOLD = 90
/** Below this estimate, pressing Done on the Split screen asks "Keep sorting" / "Finish anyway". */
export const LOW_SAVINGS = 100

/**
 * Whether the split offer may show on its own (it still needs a qualifying Band and a Duel prompt): no Duel has
 * been answered since titles last joined the Pool, i.e. right after the first Rough Sort or after a sync added
 * titles (#13). Later, splitting is only offered from the menu.
 */
export function autoOfferDue(log: DuelLog): boolean {
  for (let i = log.events.length - 1; i >= 0; i--) {
    const type = log.events[i].type
    if (type === 'duel-answered') return false
    if (type === 'titles-added') return true
  }
  return true
}

/** One Segment for the estimate: places it already has (Tiers) and titles still to insert. */
export type SegmentSize = { places: number; unplaced: number }

/**
 * Worst-case Duels to insert every unplaced title: inserting into k places takes at most ⌈log₂(k+1)⌉ Duels,
 * and each title adds a place (no Tiers assumed). Summed over Segments, because Duels never cross them.
 */
export function worstCaseDuels(segments: readonly SegmentSize[]): number {
  let total = 0
  for (const { places, unplaced } of segments) {
    for (let k = places; k < places + unplaced; k++) total += Math.ceil(Math.log2(k + 1))
  }
  return total
}

/** "Up to −X Duels": the worst case for the Band as one Segment minus the worst case for its three Sub-bands. */
export function splitSavings(whole: SegmentSize, parts: readonly [SegmentSize, SegmentSize, SegmentSize]): number {
  return worstCaseDuels([whole]) - worstCaseDuels(parts)
}

/** ¼ / ½ / ¼ of n titles (the quarters rounded, Middle takes the rest). */
export function quarterSplit(n: number): [number, number, number] {
  const q = Math.round(n / 4)
  return [q, n - 2 * q, q]
}

/** The Tier edge (0 = before the first Tier … tierSizes.length = after the last) nearest to `titles` titles from the top. */
export function snapToTierEdge(tierSizes: readonly number[], titles: number): number {
  let best = 0
  let bestDistance = Math.abs(titles)
  let above = 0
  tierSizes.forEach((size, i) => {
    above += size
    const distance = Math.abs(above - titles)
    if (distance < bestDistance) {
      best = i + 1
      bestDistance = distance
    }
  })
  return best
}

/** Default cut points for a Band's ranked titles: about ¼ and ¾ of its titles, on the nearest Tier edges. */
export function defaultCuts(tierSizes: readonly number[]): [number, number] {
  const titles = tierSizes.reduce((sum, size) => sum + size, 0)
  return [snapToTierEdge(tierSizes, titles / 4), snapToTierEdge(tierSizes, (titles * 3) / 4)]
}

/**
 * The titles of a Band that still need Duels: without a place on Full Ranking, not settled on Scores (where `unplaced`
 * also holds settled titles that never needed an exact place).
 */
export function titlesToSort(state: RankingState, band: BandIndex): number {
  const { done, total } = progressOf(state, state.bands[band])
  return total - done
}

/** Bands offered a split now: not split yet, with at least SPLIT_OFFER_THRESHOLD titles that still need Duels. */
export function splitOffers(state: RankingState): BandIndex[] {
  return BANDS.filter((band) => !state.bands[band].subBands && titlesToSort(state, band) >= SPLIT_OFFER_THRESHOLD)
}

/** The offer's estimate for a Band: its unplaced titles split ¼ / ½ / ¼ and its ranked titles cut at the default cuts. */
export function offerSavings(band: BandState): number {
  const [c1, c2] = defaultCuts(band.tiers.map((tier) => tier.length))
  const [best, middle, lowest] = quarterSplit(band.unplaced.length)
  return splitSavings({ places: band.tiers.length, unplaced: band.unplaced.length }, [
    { places: c1, unplaced: best },
    { places: c2 - c1, unplaced: middle },
    { places: band.tiers.length - c2, unplaced: lowest },
  ])
}
