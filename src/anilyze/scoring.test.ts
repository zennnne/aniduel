import { describe, expect, it } from 'vitest'
import { entropicMean, points } from './scoring.ts'

// The owner's list (zennnne, 773 scored entries): mean and SD on the 10-point scale.
const ownerScale = { mean: 6.2287, sd: 1.9035 }

describe('Studio Score: points on the owner scale (research spec §7)', () => {
  it.each([
    [10, 7.4],
    [8, 2.5],
    [6, 0.9],
    [3, 0.18],
  ])('a %d is worth about %d points', (score, expected) => {
    // The spec rounds; within 3% of its figure.
    expect(points(score, ownerScale) / expected).toBeGreaterThan(0.97)
    expect(points(score, ownerScale) / expected).toBeLessThan(1.03)
  })

  it('a masterpiece is worth about three solid titles', () => {
    expect(points(10, ownerScale) / points(8, ownerScale)).toBeCloseTo(3, 0)
  })
})

describe('Studio Score: the first term at α = 1, k = 0, without γ', () => {
  const votes = (...groups: Array<[count: number, z: number]>) =>
    groups.flatMap(([count, z]) => Array.from({ length: count }, () => ({ z, weight: 1 })))

  it('Safe (20 votes at z + 0.3) scores +0.300', () => {
    expect(entropicMean(votes([20, 0.3]))).toBeCloseTo(0.3, 3)
  })

  it('Bold (5 at z + 2.0, 15 at z − 1.0) scores +0.753', () => {
    expect(entropicMean(votes([5, 2.0], [15, -1.0]))).toBeCloseTo(0.753, 3)
  })

  it('Lucky (1 at z + 2.0, 19 at z − 1.0) scores −0.330', () => {
    expect(entropicMean(votes([1, 2.0], [19, -1.0]))).toBeCloseTo(-0.33, 3)
  })

  it('k pseudo-votes at the prior pull a lone masterpiece most of the way back', () => {
    // 1 vote at z = +2 against 13.1 pseudo-votes at utility 1 (z = 0): ln((e² + 13.1) / 14.1) ≈ 0.374.
    expect(entropicMean([{ z: 2, weight: 1 }], 13.1, 1)).toBeCloseTo(0.374, 3)
  })
})
