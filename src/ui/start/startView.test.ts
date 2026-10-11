// Start's view of the Pool: which titles a Ranking holds, the Sort Goal it starts on, and what Start shows of both.
import { describe, expect, it } from 'vitest'
import type { ListEntry, ListStatus } from '../../anilist/types.ts'
import { anchorsOf } from '../../pool/anchors.ts'
import { replay, startLog, startNewTitlesLog, type DuelLog } from '../../ranking/engine.ts'
import { animeStanding, startView, type StartInput } from './startView.ts'

let nextId = 1
const entry = (oldScore100: number, status: ListStatus = 'COMPLETED'): ListEntry => ({
  mediaId: nextId++,
  status,
  oldScore100,
  completedAt: { year: null, month: null, day: null },
  title: { romaji: `T${String(nextId).padStart(4, '0')}`, english: null, native: null },
  coverUrl: null,
  coverColor: null,
  bannerUrl: null,
  year: null,
  format: null,
  length: null,
  siteUrl: '',
})

const many = (count: number, scores: number[], status: ListStatus = 'COMPLETED') =>
  Array.from({ length: count }, (_, i) => entry(scores[i % scores.length], status))

const header = { seed: 42, userId: 7, mediaType: 'ANIME' as const }
const ids = (entries: readonly ListEntry[]) => entries.map((e) => e.mediaId)
const replayed = (log: DuelLog) => ({ log, ranking: replay(log) })

/** Enough Anchors for Score New Titles, plus `unscored` titles without a score. */
function scoredList(unscored: number) {
  const anchors = many(24, [90, 80, 70, 60])
  const fresh = many(unscored, [0])
  return { anchors, fresh, list: [...anchors, ...fresh] }
}

const view = (input: Partial<StartInput>) =>
  startView({ list: null, statuses: ['COMPLETED'], scoreFormat: 'POINT_10', titleLanguage: 'ROMAJI', saved: null, savedBroken: false, picked: null, ...input })

describe("Start's view while the list is loading", () => {
  it('has no Pool, nothing to start on and no New Titles count', () => {
    const start = view({})
    expect(start).toMatchObject({ pool: null, oldScores: null, anchors: null, eligibility: null, startOrder: null, scoresPlan: null })
    expect(start.form).toMatchObject({ poolDuels: null, extraDuels: null, newTitles: { count: null, enabled: false, reason: null, anchors: 0 } })
    expect(animeStanding(start)).toBeNull()
  })
})

describe('the Pool of a new Ranking', () => {
  it('is every title of the chosen statuses, with its old score', () => {
    const list = [entry(90), entry(0), entry(70, 'DROPPED')]
    const start = view({ list })
    expect(ids(start.pool!.titles)).toEqual([list[0].mediaId, list[1].mediaId])
    expect(start.oldScores).toEqual(new Map([[list[0].mediaId, 90], [list[1].mediaId, 0]]))
    expect(start.startOrder).toHaveLength(2)
  })

  it('starts on Full Ranking under 100 titles and on Scores from 100, unless a Sort Goal was picked', () => {
    expect(view({ list: many(99, [80]) }).newGoal).toBe('full-ranking')
    expect(view({ list: many(100, [80]) }).newGoal).toBe('scores')
    expect(view({ list: many(100, [80]), picked: 'full-ranking' }).newGoal).toBe('full-ranking')
  })

  it('shows the estimate of its Sort Goal, and how many more Duels Full Ranking takes', () => {
    const list = many(120, [90, 80, 70])
    const scores = view({ list, picked: 'scores' })
    const full = view({ list, picked: 'full-ranking' })
    expect(scores.form.poolDuels).toBe(scores.pool!.expectedDuels)
    expect(full.form.poolDuels).toBeGreaterThan(scores.form.poolDuels!)
    expect(scores.form.extraDuels).toBe(full.form.poolDuels! - scores.form.poolDuels!)
  })

  it('offers Rough Sort from Scores over its Rough Sort order', () => {
    const start = view({ list: many(40, [95, 85, 75, 65, 55]) })
    expect(start.scoresPlan).not.toBeNull()
    expect(start.form.scoresPlan).toBe(start.scoresPlan)
    expect(start.scoresPlan!.counts.reduce((a, b) => a + b, 0)).toBe(40)
  })
})

describe('Score New Titles picked on Start', () => {
  it('makes the Pool the titles without a score, never an Anchor', () => {
    const { anchors, fresh, list } = scoredList(5)
    const start = view({ list, picked: 'score-new-titles' })
    expect(start.onNewTitles).toBe(true)
    expect(start.newGoal).toBe('score-new-titles')
    expect(ids(start.pool!.titles)).toEqual(ids(fresh))
    expect(start.anchors).toEqual(anchorsOf(anchors, 'POINT_10'))
    expect(start.form.newTitles).toEqual({ count: 5, enabled: true, reason: null, anchors: 24 })
  })

  it('counts only the chosen statuses', () => {
    const { list } = scoredList(5)
    const start = view({ list: [...list, entry(0, 'DROPPED')], picked: 'score-new-titles' })
    expect(start.form.newTitles.count).toBe(5)
    expect(start.pool!.titles).toHaveLength(5)
  })

  it("stops counting when there aren't enough Anchors: the Sort Goal follows the Pool size again", () => {
    const list = [...many(5, [90, 80]), ...many(3, [0])]
    const start = view({ list, picked: 'score-new-titles' })
    expect(start.onNewTitles).toBe(false)
    expect(start.newGoal).toBe('full-ranking')
    expect(start.pool!.titles).toHaveLength(8)
    expect(start.form.newTitles).toMatchObject({ count: 3, enabled: false, reason: 'Needs at least 20 scored titles on 3 different scores. You have 5 on 2.' })
  })

  it('shows the New Titles count whichever Sort Goal is picked', () => {
    const { list } = scoredList(5)
    expect(view({ list, picked: 'scores' }).form.newTitles).toMatchObject({ count: 5, enabled: true })
  })
})

describe('a saved Ranking', () => {
  it('shows its own Sort Goal and Rough Sort progress, and has nothing new to start on', () => {
    const list = many(6, [80])
    const saved = replayed(startLog({ ...header, ids: ids(list), scoreFormat: 'POINT_10' }))
    const start = view({ list, saved, picked: 'full-ranking' })
    expect(start.savedRanking).toBe('other')
    expect(start.form.goal).toBe('scores')
    expect(start.form.saved).toEqual({ done: 0, total: 6 })
    expect(start).toMatchObject({ startOrder: null, scoresPlan: null })
    expect(start.form.scoresPlan).toBeNull()
  })

  it('on Score New Titles keeps its new titles once they got a score, and never takes one of its Anchors', () => {
    const { anchors, fresh, list } = scoredList(4)
    const log = startNewTitlesLog({ ...header, format: 'POINT_10', anchors: anchorsOf(anchors, 'POINT_10'), ids: ids(fresh) })
    // Since it started: one new title was imported with a score, one Anchor lost its score, one title was added unscored.
    const added = entry(0)
    const now = [...list.map((e) => (e === fresh[0] ? { ...e, oldScore100: 70 } : e === anchors[0] ? { ...e, oldScore100: 0 } : e)), added]
    const start = view({ list: now, saved: replayed(log) })
    expect(start.savedRanking).toBe('new-titles')
    expect(start.onNewTitles).toBe(true)
    expect(ids(start.pool!.titles)).toEqual([...ids(fresh), added.mediaId])
    expect(start.form.newTitles.count).toBe(5)
    expect(start.form.newTitles.anchors).toBe(24)
    expect(start.form.goal).toBe('score-new-titles')
    expect(start.form.saved).toEqual({ done: 0, total: 4 })
    expect(start.form).toMatchObject({ bandDuels: null, extraDuels: null })
  })

  it("that can't be used leaves nothing to start on", () => {
    const start = view({ list: many(40, [90, 80, 70]), savedBroken: true })
    expect(start).toMatchObject({ savedRanking: 'broken', startOrder: null, scoresPlan: null })
  })
})

describe('where the anime stands for the exit offer', () => {
  it("is Start's own New Titles count and eligibility", () => {
    const { list } = scoredList(5)
    const start = view({ list })
    expect(animeStanding(start)).toEqual({ eligibleForNewTitles: true, unscored: start.form.newTitles.count, saved: 'none' })
  })

  it('says which Ranking is saved', () => {
    const { anchors, fresh, list } = scoredList(3)
    const other = replayed(startLog({ ...header, ids: ids(list) }))
    const newTitles = replayed(startNewTitlesLog({ ...header, format: 'POINT_10', anchors: anchorsOf(anchors, 'POINT_10'), ids: ids(fresh) }))
    expect(animeStanding(view({ list, saved: other }))).toMatchObject({ saved: 'other', unscored: 3 })
    expect(animeStanding(view({ list, saved: newTitles }))).toMatchObject({ saved: 'new-titles', unscored: 3 })
  })

  it("is unknown while the saved progress can't be used", () => {
    expect(animeStanding(view({ list: scoredList(3).list, savedBroken: true }))).toBeNull()
  })
})
