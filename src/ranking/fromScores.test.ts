// Rough Sort from Scores (ADR 0008): the plan built from the Pool's old AniList scores.
import { describe, expect, it } from 'vitest'
import { planFromScores } from './fromScores.ts'

/** Titles with ids 1.. in the given order, one per old score (100-point scale, 0 = no score). */
const pool = (...scores: number[]) => scores.map((score100, i) => ({ id: i + 1, score100 }))

describe('planFromScores', () => {
  it('cuts by z-score, each cut point landing in the Band the rule names', () => {
    // Mean 50, SD 20: z = -1.5, -0.5, 0, +0.5, +1.5 exactly.
    const plan = planFromScores(pool(20, 40, 50, 60, 80))
    expect(plan.bands).toEqual([[5], [4], [3], [2], [1]])
    expect(plan.counts).toEqual([1, 1, 1, 1, 1])
  })

  it('keeps a title just inside a cut point out of the outer Band', () => {
    // 100 × (20, 40, 50, 60, 80) gives mean 50, SD 20. Ids 501-504 (59, 41, 79, 21) keep the mean at 50 and the SD
    // at about 20.05, so their z is about +0.45, -0.45, +1.45, -1.45.
    const base = Array.from({ length: 100 }, () => [20, 40, 50, 60, 80]).flat()
    const plan = planFromScores(pool(...base, 59, 41, 79, 21))
    const bandOf = (id: number) => plan.bands.findIndex((ids) => ids.includes(id))
    expect([501, 502, 503, 504].map(bandOf)).toEqual([2, 2, 1, 3])
  })

  it('puts equal scores in the same Band', () => {
    const plan = planFromScores(pool(90, 70, 70, 70, 70, 50, 30, 90, 10))
    const bandOf = (id: number) => plan.bands.findIndex((ids) => ids.includes(id))
    expect(bandOf(1)).toBe(bandOf(8))
    expect(new Set([2, 3, 4, 5].map(bandOf)).size).toBe(1)
  })

  it('leaves unscored titles out of every Band but counts them in "X of Y"', () => {
    const plan = planFromScores(pool(20, 0, 40, 50, 0, 60, 80))
    expect(plan.bands).toEqual([[7], [6], [4], [3], [1]])
    expect(plan.scored).toBe(5)
    expect(plan.total).toBe(7)
  })

  it('warns below 80% scored, not at 80%', () => {
    expect(planFromScores(pool(20, 40, 60, 80, 0)).warn).toBe(false)
    expect(planFromScores(pool(20, 40, 60, 0, 0)).warn).toBe(true)
  })

  it('is not offered when nothing is scored or every score is the same (SD = 0)', () => {
    expect(planFromScores(pool(0, 0, 0))).toMatchObject({ offer: false, scored: 0, total: 3 })
    expect(planFromScores(pool(70, 70, 0, 70))).toMatchObject({ offer: false, scored: 3, total: 4 })
    expect(planFromScores([])).toMatchObject({ offer: false, scored: 0, total: 0 })
    expect(planFromScores(pool(70, 80)).offer).toBe(true)
  })

  it('gives a valid plan with some empty Bands for 3 smileys', () => {
    // AniList keeps smileys on the 100-point scale as 35 / 60 / 85. Mean 62.5, SD 17.5: z = +1.29, -0.14, -1.57.
    const plan = planFromScores(pool(85, 85, 60, 60, 60, 60, 60, 35, 35, 85))
    expect(plan.offer).toBe(true)
    expect(plan.counts).toEqual([0, 3, 5, 0, 2])
    expect(plan.bands[1]).toEqual([1, 2, 10])
  })

  it('gives a valid plan with some empty Bands for 5 stars', () => {
    // Stars on the 100-point scale: 10 / 30 / 50 / 70 / 90. Mostly 4 stars, one 1-star outlier.
    const plan = planFromScores(pool(70, 70, 70, 70, 90, 50, 70, 70, 10, 70))
    expect(plan.offer).toBe(true)
    expect(plan.counts.reduce((a, b) => a + b, 0)).toBe(10)
    expect(plan.counts.filter((c) => c === 0).length).toBeGreaterThan(0)
    expect(plan.bands[4]).toEqual([9])
  })
})
