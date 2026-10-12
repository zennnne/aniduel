// The Picker's view (#64, ADR 0011): the rows it lists, what the picks cost in Anchors, and what Confirm starts.
import { describe, expect, it } from 'vitest'
import type { ListEntry, ListStatus } from '../../anilist/types.ts'
import { pickerView, startingPicks, togglePick, type PickerInput } from './pickerView.ts'

let nextId = 1
type EntryOptions = { status?: ListStatus; completed?: number | null; year?: number | null; name?: string; english?: string | null }
const entry = (oldScore100: number, options: EntryOptions = {}): ListEntry => {
  const mediaId = nextId++
  return {
    mediaId,
    status: options.status ?? 'COMPLETED',
    oldScore100,
    completedAt: { year: options.completed ?? null, month: null, day: null },
    title: { romaji: options.name ?? `T${String(mediaId).padStart(4, '0')}`, english: options.english ?? null, native: null },
    coverUrl: null,
    coverColor: null,
    bannerUrl: null,
    year: options.year ?? null,
    format: null,
    length: null,
    siteUrl: '',
  }
}

const ids = (entries: readonly { mediaId: number }[]) => entries.map((e) => e.mediaId)

const view = (input: Partial<PickerInput> & Pick<PickerInput, 'list'>) =>
  pickerView({ scoreFormat: 'POINT_10', titleLanguage: 'ROMAJI', picked: new Set(), ...input })

describe("the Picker's rows", () => {
  it('list every title except Planning ones, with score (or none), release year and list status', () => {
    const scored = entry(85, { year: 2019, status: 'DROPPED' })
    const unscored = entry(0, { year: null, status: 'CURRENT' })
    const planning = entry(0, { status: 'PLANNING' })
    const rows = view({ list: [scored, unscored, planning] }).rows
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.entry === scored)).toMatchObject({ score: '8', year: 2019, status: 'DROPPED', picked: false })
    expect(rows.find((r) => r.entry === unscored)).toMatchObject({ score: null, year: null, status: 'CURRENT', picked: false })
  })

  it("show each title's name in the user's title language", () => {
    const a = entry(0, { name: 'Shingeki no Kyojin', english: 'Attack on Titan' })
    expect(view({ list: [a], titleLanguage: 'ENGLISH' }).rows[0].title).toBe('Attack on Titan')
    expect(view({ list: [a], titleLanguage: 'ROMAJI' }).rows[0].title).toBe('Shingeki no Kyojin')
  })

  it('come unscored first, then the most recently completed first, then by title', () => {
    const old = entry(80, { completed: 2018 })
    const recent = entry(70, { completed: 2024 })
    const undatedB = entry(0, { name: 'B' })
    const undatedA = entry(0, { name: 'A' })
    const unscoredRecent = entry(0, { completed: 2023 })
    const list = [old, recent, undatedB, undatedA, unscoredRecent]
    expect(ids(view({ list }).rows.map((r) => r.entry))).toEqual(ids([unscoredRecent, undatedA, undatedB, recent, old]))
  })

  it('mark the picked titles', () => {
    const list = [entry(0), entry(80)]
    const rows = view({ list, picked: new Set([list[1].mediaId]) }).rows
    expect(rows.map((r) => [r.entry.mediaId, r.picked])).toEqual([
      [list[0].mediaId, false],
      [list[1].mediaId, true],
    ])
  })
})

/** 24 Anchors on 9, 8, 7 and 6 (six each), plus `unscored` titles without a score. */
function scaleList(unscored: number) {
  const anchors = Array.from({ length: 24 }, (_, i) => entry([90, 80, 70, 60][i % 4]))
  const fresh = Array.from({ length: unscored }, () => entry(0))
  return { anchors, fresh, list: [...anchors, ...fresh] }
}

describe("the Picker's summary", () => {
  it('counts the picks, the Anchors they leave and on how many scores, and about how many Duels', () => {
    const { anchors, fresh, list } = scaleList(3)
    expect(view({ list }).summary).toEqual({ picked: 0, anchors: 24, scores: 4, duels: 0 })
    // Two titles over 4 scores: 2 · 2 log2(5) ≈ 9.3.
    expect(view({ list, picked: new Set(ids(fresh.slice(0, 2))) }).summary).toEqual({ picked: 2, anchors: 24, scores: 4, duels: 9 })
    // A picked scored title is no longer an Anchor.
    expect(view({ list, picked: new Set([fresh[0].mediaId, anchors[0].mediaId]) }).summary).toMatchObject({ picked: 2, anchors: 23, scores: 4 })
  })
})

describe("the Picker's Confirm", () => {
  it('is not allowed with nothing picked', () => {
    expect(view({ list: scaleList(3).list }).confirm).toEqual({ allowed: false, reason: 'Pick at least one title.' })
  })

  it('is not allowed when the picks leave fewer than 20 Anchors', () => {
    const { anchors, list } = scaleList(0)
    expect(view({ list, picked: new Set(ids(anchors.slice(0, 4))) }).confirm).toMatchObject({ allowed: true })
    expect(view({ list, picked: new Set(ids(anchors.slice(0, 5))) }).confirm).toEqual({
      allowed: false,
      reason: 'Your picks leave 19 scored titles on 4 different scores; at least 20 on 3 are needed. Untick some scored titles.',
    })
  })

  it('is not allowed when the picks leave fewer than 3 distinct scores (every title of one score picked)', () => {
    const list = Array.from({ length: 30 }, (_, i) => entry([90, 80, 70][i % 3]))
    const sevens = new Set(ids(list.filter((e) => e.oldScore100 === 70)))
    expect(view({ list, picked: sevens }).confirm).toEqual({
      allowed: false,
      reason: 'Your picks leave 20 scored titles on 2 different scores; at least 20 on 3 are needed. Untick some scored titles.',
    })
  })

  it('starts on the picked titles in Rough Sort order, with every other scored title as an Anchor', () => {
    const { anchors, list } = scaleList(0)
    const recent = entry(0, { completed: 2024 })
    const older = entry(0, { completed: 2020 })
    const confirm = view({ list: [...list, older, recent], picked: new Set([older.mediaId, anchors[0].mediaId, recent.mediaId]) }).confirm
    if (!confirm.allowed) throw new Error(confirm.reason)
    expect(confirm.order).toEqual([recent.mediaId, older.mediaId, anchors[0].mediaId])
    expect(confirm.anchors).toHaveLength(23)
    expect(confirm.anchors.map((a) => a.id)).not.toContain(anchors[0].mediaId)
    expect(confirm.anchors).toContainEqual({ id: anchors[1].mediaId, level: 8 })
  })

  it('never starts on a picked title that is no longer on the list', () => {
    const { fresh, list } = scaleList(1)
    const confirm = view({ list, picked: new Set([fresh[0].mediaId, 99999]) })
    expect(confirm.summary.picked).toBe(1)
    expect(confirm.confirm).toMatchObject({ allowed: true, order: [fresh[0].mediaId] })
  })
})

describe('the starting picks', () => {
  it('are nothing when the Picker is opened from Start', () => {
    expect(startingPicks(scaleList(3).list, { from: 'start' })).toEqual(new Set())
  })
})

describe('ticking a title', () => {
  it('picks it, and ticking it again unpicks it, leaving the other picks', () => {
    const once = togglePick(new Set([1]), 2)
    expect(once).toEqual(new Set([1, 2]))
    expect(togglePick(once, 2)).toEqual(new Set([1]))
  })
})
