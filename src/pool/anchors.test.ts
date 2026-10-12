import { describe, expect, it } from 'vitest'
import type { ListEntry, ListStatus } from '../anilist/types.ts'
import { anchorsOf, keepMyScaleEligibility, keepMyScalePool, unscoredTitles } from './anchors.ts'

let nextId = 1
const entry = (oldScore100: number, status: ListStatus = 'COMPLETED'): ListEntry => ({
  mediaId: nextId++,
  status,
  oldScore100,
  completedAt: { year: null, month: null, day: null },
  title: { romaji: `T${nextId}`, english: null, native: null },
  coverUrl: null,
  coverColor: null,
  bannerUrl: null,
  year: null,
  format: null,
  length: null,
  siteUrl: '',
})

/** `count` scored titles spread over the given 100-point scores in turn. */
const scored = (count: number, scores: number[]) => Array.from({ length: count }, (_, i) => entry(scores[i % scores.length]))

describe('Anchors', () => {
  it('are every title with a score, whatever its status, at its level of the Score Format', () => {
    const list = [entry(90), entry(0), entry(70, 'DROPPED'), entry(55, 'PAUSED'), entry(0, 'CURRENT')]
    expect(anchorsOf(list, 'POINT_10')).toEqual([
      { id: list[0].mediaId, level: 9 },
      { id: list[2].mediaId, level: 7 },
      { id: list[3].mediaId, level: 5 },
    ])
  })

  it('leave out the titles picked for the Ranking, even those with a score (ADR 0011)', () => {
    const list = [entry(90), entry(80), entry(0), entry(70)]
    const picked = new Set([list[1].mediaId, list[2].mediaId])
    expect(anchorsOf(list, 'POINT_10', picked)).toEqual([
      { id: list[0].mediaId, level: 9 },
      { id: list[3].mediaId, level: 7 },
    ])
  })

  it('left after picking every title of one score can lose that score, and with it eligibility', () => {
    const list = scored(30, [90, 80, 70])
    const sevens = new Set(list.filter((e) => e.oldScore100 === 70).map((e) => e.mediaId))
    expect(keepMyScaleEligibility(anchorsOf(list, 'POINT_10', sevens))).toMatchObject({ eligible: false, anchors: 20, scores: 2 })
  })
})

describe('Keep My Scale eligibility', () => {
  it('needs at least 20 Anchors', () => {
    expect(keepMyScaleEligibility(anchorsOf(scored(19, [90, 80, 70]), 'POINT_10'))).toMatchObject({ eligible: false, anchors: 19, scores: 3 })
    expect(keepMyScaleEligibility(anchorsOf(scored(20, [90, 80, 70]), 'POINT_10'))).toMatchObject({ eligible: true, anchors: 20, scores: 3 })
  })

  it('needs at least 3 distinct Anchor scores', () => {
    expect(keepMyScaleEligibility(anchorsOf(scored(30, [90, 80]), 'POINT_10'))).toMatchObject({ eligible: false, anchors: 30, scores: 2 })
    expect(keepMyScaleEligibility(anchorsOf(scored(30, [90, 80, 70]), 'POINT_10'))).toMatchObject({ eligible: true, scores: 3 })
  })

  it('counts distinct scores at the Score Format the user sees', () => {
    // 85, 88 and 81 are all 8 on 10 points.
    expect(keepMyScaleEligibility(anchorsOf(scored(30, [85, 88, 81]), 'POINT_10'))).toMatchObject({ eligible: false, scores: 1 })
  })

  it('says why when not eligible', () => {
    expect(keepMyScaleEligibility(anchorsOf(scored(12, [90, 80]), 'POINT_10')).reason).toBe(
      'Needs at least 20 scored titles on 3 different scores. You have 12 on 2.',
    )
    expect(keepMyScaleEligibility(anchorsOf(scored(20, [90, 80, 70]), 'POINT_10')).reason).toBeNull()
  })
})

describe("a saved Keep My Scale Ranking's Pool", () => {
  it('holds the picked titles still on the list, whatever their status or score now', () => {
    const anchor = entry(80)
    const unscored = entry(0, 'DROPPED')
    const rescored = entry(70, 'PAUSED')
    const other = entry(0)
    const list = [anchor, unscored, rescored, other]
    const saved = { anchors: new Set([anchor.mediaId]), pool: new Set([unscored.mediaId, rescored.mediaId, 999]) }
    expect(keepMyScalePool(list, saved).titles.map((e) => e.mediaId)).toEqual([unscored.mediaId, rescored.mediaId])
  })
})

describe('the titles without a score Start counts for Keep My Scale', () => {
  it('are the unscored Completed and Repeating titles', () => {
    const list = [entry(0), entry(0, 'REPEATING'), entry(0, 'DROPPED'), entry(0, 'CURRENT'), entry(80)]
    expect(unscoredTitles(list)).toEqual([list[0], list[1]])
  })
})
