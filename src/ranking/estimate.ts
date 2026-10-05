// Duel estimates from binary insertion: placing k titles needs about log2(k!) Duels.
// Duels only happen inside a Band (or Sub-band), so the estimate is summed per Band.

export const BAND_COUNT = 5

function log2Factorial(k: number): number {
  let sum = 0
  for (let i = 2; i <= k; i++) sum += Math.log2(i)
  return sum
}

/** Expected Duels for the given Band (or Sub-band) sizes, rounded. */
export function duelsForBandSizes(sizes: readonly number[]): number {
  return Math.round(sizes.reduce((total, k) => total + log2Factorial(k), 0))
}

/** Splits `n` titles into five equal Bands; a remainder goes to the first Bands. */
export function equalBandSizes(n: number): number[] {
  const base = Math.floor(n / BAND_COUNT)
  const extra = n % BAND_COUNT
  return Array.from({ length: BAND_COUNT }, (_, i) => base + (i < extra ? 1 : 0))
}

type Part = { readonly tiers: readonly (readonly unknown[])[]; readonly unplaced: readonly unknown[] }
type BandPart = Part & { readonly subBands?: readonly Part[] }

/**
 * Expected Duels for the whole Ranking from the real Band sizes (#1 US8), or null while Rough Sort isn't done
 * (then the estimate assumes equal Bands). A split Band counts Sub-band by Sub-band.
 */
export function duelsFromBands(state: {
  readonly progress: { readonly roughSort: { readonly done: number; readonly total: number } }
  readonly bands: readonly BandPart[]
}): number | null {
  const { done, total } = state.progress.roughSort
  if (done < total) return null
  const size = (part: Part) => part.tiers.reduce((n, tier) => n + tier.length, 0) + part.unplaced.length
  return duelsForBandSizes(state.bands.flatMap((band) => (band.subBands ?? [band]).map(size)))
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
