import { describe, expect, it } from 'vitest'
import type { ListEntry, ListStatus } from '../anilist/types.ts'
import { anchorsOf, newTitlesEligibility, newTitlesList } from './anchors.ts'

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
})

describe('Score New Titles eligibility', () => {
  it('needs at least 20 Anchors', () => {
    expect(newTitlesEligibility(anchorsOf(scored(19, [90, 80, 70]), 'POINT_10'))).toMatchObject({ eligible: false, anchors: 19, scores: 3 })
    expect(newTitlesEligibility(anchorsOf(scored(20, [90, 80, 70]), 'POINT_10'))).toMatchObject({ eligible: true, anchors: 20, scores: 3 })
  })

  it('needs at least 3 distinct Anchor scores', () => {
    expect(newTitlesEligibility(anchorsOf(scored(30, [90, 80]), 'POINT_10'))).toMatchObject({ eligible: false, anchors: 30, scores: 2 })
    expect(newTitlesEligibility(anchorsOf(scored(30, [90, 80, 70]), 'POINT_10'))).toMatchObject({ eligible: true, scores: 3 })
  })

  it('counts distinct scores at the Score Format the user sees', () => {
    // 85, 88 and 81 are all 8 on 10 points.
    expect(newTitlesEligibility(anchorsOf(scored(30, [85, 88, 81]), 'POINT_10'))).toMatchObject({ eligible: false, scores: 1 })
  })

  it('says why when not eligible', () => {
    expect(newTitlesEligibility(anchorsOf(scored(12, [90, 80]), 'POINT_10')).reason).toBe(
      'Needs at least 20 scored titles on 3 different scores. You have 12 on 2.',
    )
    expect(newTitlesEligibility(anchorsOf(scored(20, [90, 80, 70]), 'POINT_10')).reason).toBeNull()
  })
})

describe('the list a Score New Titles Pool is built from', () => {
  it('holds the titles without a score, plus the new titles already in the Ranking even once scored', () => {
    const anchor = entry(80)
    const unscored = entry(0)
    const imported = entry(70)
    const list = [anchor, unscored, imported]
    expect(newTitlesList(list, null).map((e) => e.mediaId)).toEqual([unscored.mediaId])
    const inRanking = new Set([imported.mediaId])
    expect(newTitlesList(list, { anchors: new Set([anchor.mediaId]), pool: inRanking }).map((e) => e.mediaId)).toEqual([
      unscored.mediaId,
      imported.mediaId,
    ])
  })

  it('never holds an Anchor, even once its score is removed on AniList', () => {
    const anchor = entry(0)
    expect(newTitlesList([anchor], { anchors: new Set([anchor.mediaId]), pool: new Set() })).toEqual([])
  })
})
