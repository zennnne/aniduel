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
