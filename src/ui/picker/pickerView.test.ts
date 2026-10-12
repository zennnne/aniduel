// The Picker's view (#64, ADR 0011): the rows it lists, what the picks cost in Anchors, and what Confirm starts.
import { describe, expect, it } from 'vitest'
import type { ListEntry, ListStatus } from '../../anilist/types.ts'
import {
  addPicks,
  DEFAULT_PICKER_FILTERS,
  pickerView,
  startingPicks,
  toggleFacet,
  togglePick,
  toggleStatus,
  wayOut,
  type PickerFilters,
  type PickerInput,
} from './pickerView.ts'

let nextId = 1
type EntryOptions = {
  status?: ListStatus
  completed?: number | null
  year?: number | null
  name?: string
  english?: string | null
  genres?: string[]
  tags?: Array<{ name: string; rank: number; spoiler?: boolean }>
}
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
    genres: options.genres ?? [],
    tags: (options.tags ?? []).map((t) => ({ spoiler: false, ...t })),
  }
}

const ids = (entries: readonly { mediaId: number }[]) => entries.map((e) => e.mediaId)

const view = (input: Partial<PickerInput> & Pick<PickerInput, 'list'>) =>
  pickerView({ scoreFormat: 'POINT_10', titleLanguage: 'ROMAJI', picked: new Set(), ...input })

/** The filters, starting from the Picker's defaults. */
const filters = (over: Partial<PickerFilters> = {}): PickerFilters => ({ ...DEFAULT_PICKER_FILTERS, ...over })
const ALL_STATUSES: ListStatus[] = ['COMPLETED', 'REPEATING', 'CURRENT', 'PAUSED', 'DROPPED']
const shown = (v: { rows: readonly { entry: ListEntry }[] }) => ids(v.rows.map((r) => r.entry))

describe("the Picker's rows", () => {
  it('list every title except Planning ones, with score (or none), release year and list status', () => {
    const scored = entry(85, { year: 2019, status: 'DROPPED' })
    const unscored = entry(0, { year: null, status: 'CURRENT' })
    const planning = entry(0, { status: 'PLANNING' })
    const rows = view({ list: [scored, unscored, planning], filters: filters({ statuses: ALL_STATUSES }) }).rows
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.entry === scored)).toMatchObject({ score: '8', year: 2019, status: 'DROPPED', picked: false })
    expect(rows.find((r) => r.entry === unscored)).toMatchObject({ score: null, year: null, status: 'CURRENT', picked: false })
  })

  it('show no score for a score too small to show in the Score Format, and list it with the titles without one', () => {
    // 5 of 100 is 0 on 10 points.
    const tiny = entry(5, { completed: 2020 })
    const scored = entry(80, { completed: 2024 })
    const v = view({ list: [scored, tiny] })
    expect(v.rows.map((r) => [r.entry.mediaId, r.score])).toEqual([
      [tiny.mediaId, null],
      [scored.mediaId, '8'],
    ])
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

describe("the Picker's status filter", () => {
  it('starts on Completed and Repeating', () => {
    const list = ALL_STATUSES.map((status) => entry(0, { status }))
    expect(DEFAULT_PICKER_FILTERS.statuses).toEqual(['COMPLETED', 'REPEATING'])
    expect(shown(view({ list }))).toEqual(ids(list.slice(0, 2)))
  })

  it('shows the other offered statuses once switched on', () => {
    const list = ALL_STATUSES.map((status) => entry(0, { status }))
    expect(shown(view({ list, filters: filters({ statuses: ['DROPPED', 'PAUSED'] }) }))).toEqual(ids([list[3], list[4]]))
  })

  it('counts the titles of each offered status on the whole list, whatever the other filters', () => {
    const list = [entry(0), entry(80, { year: 2020 }), entry(0, { status: 'DROPPED' }), entry(0, { status: 'PLANNING' })]
    expect(view({ list, filters: filters({ year: 2020, search: 'zzz' }) }).statusCounts).toEqual({
      COMPLETED: 2,
      REPEATING: 0,
      CURRENT: 0,
      PAUSED: 0,
      DROPPED: 1,
    })
  })
})

describe("the Picker's search", () => {
  it("narrows the list by title in the user's title language, ignoring case and accents", () => {
    const titan = entry(0, { name: 'Shingeki no Kyojin', english: 'Attack on Titan' })
    const pokemon = entry(0, { name: 'Pokémon' })
    const list = [titan, pokemon]
    expect(shown(view({ list, titleLanguage: 'ENGLISH', filters: filters({ search: 'titan' }) }))).toEqual([titan.mediaId])
    expect(shown(view({ list, titleLanguage: 'ROMAJI', filters: filters({ search: 'titan' }) }))).toEqual([])
    expect(shown(view({ list, titleLanguage: 'ROMAJI', filters: filters({ search: ' KYOJIN ' }) }))).toEqual([titan.mediaId])
    expect(shown(view({ list, filters: filters({ search: 'pokemon' }) }))).toEqual([pokemon.mediaId])
  })
})

describe("the Picker's release-year filter", () => {
  it('shows only that year, and a title with no year only under all years', () => {
    const a = entry(0, { year: 2019 })
    const b = entry(0, { year: 2024 })
    const none = entry(0, { year: null })
    const list = [a, b, none]
    expect(shown(view({ list, filters: filters({ year: 2024 }) }))).toEqual([b.mediaId])
    expect(new Set(shown(view({ list, filters: filters({ year: null }) })))).toEqual(new Set(ids(list)))
  })

  it('offers the release years of the titles the Picker can show, newest first', () => {
    const list = [entry(0, { year: 2019 }), entry(0, { year: 2024 }), entry(0, { year: 2019, status: 'DROPPED' }), entry(0, { year: 2001, status: 'PLANNING' })]
    expect(view({ list }).years).toEqual([2024, 2019])
  })

  it('counts the titles of each year and of all years, whatever the filters', () => {
    const list = [entry(0, { year: 2019 }), entry(0, { year: 2024 }), entry(0, { year: 2019, status: 'DROPPED' }), entry(0, { year: null })]
    const v = view({ list, filters: filters({ year: 2024, search: 'nothing has this' }) })
    expect(v.yearCounts).toEqual({ 2019: 2, 2024: 1 })
    expect(v.listed).toBe(4)
  })
})

describe("the Picker's genre and tag filters", () => {
  const military = { name: 'Military', rank: 80 }
  it('show only titles with every chosen genre and every chosen tag', () => {
    const actionDrama = entry(0, { genres: ['Action', 'Drama'], tags: [military] })
    const action = entry(0, { genres: ['Action'], tags: [military] })
    const drama = entry(0, { genres: ['Drama'] })
    const list = [actionDrama, action, drama]
    expect(new Set(shown(view({ list, filters: filters({ genres: ['Action'] }) })))).toEqual(new Set(ids([actionDrama, action])))
    expect(shown(view({ list, filters: filters({ genres: ['Action', 'Drama'] }) }))).toEqual([actionDrama.mediaId])
    expect(new Set(shown(view({ list, filters: filters({ tags: ['Military'] }) })))).toEqual(new Set(ids([actionDrama, action])))
    expect(shown(view({ list, filters: filters({ genres: ['Drama'], tags: ['Military'] }) }))).toEqual([actionDrama.mediaId])
  })

  it('count a tag for a title only at rank 50 or more', () => {
    const strong = entry(0, { tags: [{ name: 'Time Loop', rank: 50 }] })
    const weak = entry(0, { tags: [{ name: 'Time Loop', rank: 49 }] })
    const v = view({ list: [strong, weak], filters: filters({ tags: ['Time Loop'] }) })
    expect(shown(v)).toEqual([strong.mediaId])
    expect(v.tags).toEqual([{ name: 'Time Loop', count: 1, chosen: true }])
  })

  it('never offer a spoiler tag, nor a tag that counts for no title', () => {
    const list = [entry(0, { tags: [{ name: 'Twist', rank: 95, spoiler: true }, { name: 'Faint', rank: 10 }, military] })]
    expect(view({ list }).tags.map((t) => t.name)).toEqual(['Military'])
  })

  it('give each genre and tag the count of titles it would show with the other filters and the search', () => {
    const list = [
      entry(0, { name: 'Alpha', genres: ['Action', 'Drama'], tags: [military] }),
      entry(0, { name: 'Beta', genres: ['Action'], tags: [military] }),
      entry(0, { name: 'Gamma', genres: ['Drama', 'Comedy'] }),
      entry(0, { name: 'Delta', genres: ['Action'], status: 'DROPPED' }),
    ]
    expect(view({ list }).genres).toEqual([
      { name: 'Action', count: 2, chosen: false },
      { name: 'Comedy', count: 1, chosen: false },
      { name: 'Drama', count: 2, chosen: false },
    ])
    const narrowed = view({ list, filters: filters({ genres: ['Action'], search: 'a' }) })
    expect(narrowed.genres).toEqual([
      { name: 'Action', count: 2, chosen: true },
      { name: 'Comedy', count: 0, chosen: false },
      { name: 'Drama', count: 1, chosen: false },
    ])
    expect(narrowed.tags).toEqual([{ name: 'Military', count: 2, chosen: false }])
  })

  it('list tags most common first, and the tag search narrows the tags offered but keeps the chosen ones', () => {
    const list = [
      entry(0, { tags: [{ name: 'Iyashikei', rank: 90 }, { name: 'Cute Girls Doing Cute Things', rank: 90 }] }),
      entry(0, { tags: [{ name: 'Cute Girls Doing Cute Things', rank: 90 }, { name: 'Male Protagonist', rank: 60 }] }),
    ]
    expect(view({ list }).tags.map((t) => t.name)).toEqual(['Cute Girls Doing Cute Things', 'Iyashikei', 'Male Protagonist'])
    const searched = view({ list, filters: filters({ tags: ['Iyashikei'], tagSearch: 'CUTE' }) })
    expect(searched.tags.map((t) => t.name)).toEqual(['Iyashikei', 'Cute Girls Doing Cute Things'])
  })

  it('count every tag offered for the tag search box, whatever is typed in it', () => {
    const list = [
      entry(0, { tags: [{ name: 'Iyashikei', rank: 90 }, { name: 'Twist', rank: 90, spoiler: true }] }),
      entry(0, { tags: [{ name: 'Band', rank: 90 }, { name: 'Faint', rank: 20 }] }),
    ]
    expect(view({ list, filters: filters({ tagSearch: 'band' }) }).tagCount).toBe(2)
  })
})

describe("the Picker's sorts", () => {
  const b = entry(70, { name: 'B', year: 2020, completed: 2021 })
  const a = entry(0, { name: 'a', year: 2015, completed: 2016 })
  const c = entry(90, { name: 'C', year: null, completed: 2024 })
  const d = entry(0, { name: 'D', year: 2023, completed: 2023 })
  const e = entry(70, { name: 'E', year: 2020 })
  const list = [b, a, c, d, e]

  it('is unscored first, then most recently completed, then by title, by default', () => {
    expect(DEFAULT_PICKER_FILTERS.sort).toBe('default')
    expect(shown(view({ list }))).toEqual(ids([d, a, c, b, e]))
  })

  it('can be by title', () => {
    expect(shown(view({ list, filters: filters({ sort: 'title' }) }))).toEqual(ids([a, b, c, d, e]))
  })

  it('can be by score, highest first and unscored last, then by title', () => {
    expect(shown(view({ list, filters: filters({ sort: 'score' }) }))).toEqual(ids([c, b, e, a, d]))
  })

  it('can be by release year, newest first and titles without a year last, then by title', () => {
    expect(shown(view({ list, filters: filters({ sort: 'year' }) }))).toEqual(ids([d, b, e, a, c]))
  })
})

describe('"Add N without a score"', () => {
  it('adds the unscored titles not yet picked that the status, year, genre and tag filters show', () => {
    const fit = entry(0, { year: 2024, genres: ['Drama'], tags: [{ name: 'Iyashikei', rank: 80 }] })
    const alsoFit = entry(0, { year: 2024, genres: ['Drama', 'Slice of Life'], tags: [{ name: 'Iyashikei', rank: 60 }] })
    const pickedFit = entry(0, { year: 2024, genres: ['Drama'], tags: [{ name: 'Iyashikei', rank: 80 }] })
    const scored = entry(80, { year: 2024, genres: ['Drama'], tags: [{ name: 'Iyashikei', rank: 80 }] })
    const otherYear = entry(0, { year: 2023, genres: ['Drama'], tags: [{ name: 'Iyashikei', rank: 80 }] })
    const otherGenre = entry(0, { year: 2024, genres: ['Action'], tags: [{ name: 'Iyashikei', rank: 80 }] })
    const weakTag = entry(0, { year: 2024, genres: ['Drama'], tags: [{ name: 'Iyashikei', rank: 30 }] })
    const dropped = entry(0, { year: 2024, genres: ['Drama'], tags: [{ name: 'Iyashikei', rank: 80 }], status: 'DROPPED' })
    const list = [fit, alsoFit, pickedFit, scored, otherYear, otherGenre, weakTag, dropped]
    const v = view({ list, picked: new Set([pickedFit.mediaId]), filters: filters({ year: 2024, genres: ['Drama'], tags: ['Iyashikei'] }) })
    expect(new Set(v.addUnscored)).toEqual(new Set(ids([fit, alsoFit])))
  })

  it('ignores the search box, so its count is the same whatever is typed', () => {
    const list = [entry(0, { name: 'Alpha' }), entry(0, { name: 'Beta' }), entry(80, { name: 'Gamma' })]
    expect(view({ list, filters: filters({ search: 'alpha' }) }).addUnscored).toEqual(ids(list.slice(0, 2)))
  })

  it('adds a title whose card says "no score" because its score is too small to show in the Score Format', () => {
    const tiny = entry(5)
    const list = [tiny, entry(80)]
    expect(view({ list }).rows.find((r) => r.entry === tiny)?.score).toBeNull()
    expect(view({ list }).addUnscored).toEqual([tiny.mediaId])
    expect(view({ list, scoreFormat: 'POINT_100' }).addUnscored).toEqual([])
  })

  it('adds nothing once every such title is picked', () => {
    const list = [entry(0), entry(80)]
    expect(view({ list, picked: new Set([list[0].mediaId]) }).addUnscored).toEqual([])
  })
})

describe('"Pick all N shown"', () => {
  it('counts the titles shown, search included, and picks those not yet picked', () => {
    const alpha = entry(80, { name: 'Alpha' })
    const alpine = entry(0, { name: 'Alpine' })
    const beta = entry(0, { name: 'Beta' })
    const v = view({ list: [alpha, alpine, beta], picked: new Set([alpine.mediaId]), filters: filters({ search: 'alp' }) })
    expect(v.pickAll).toEqual({ shown: 2, ids: [alpha.mediaId] })
    expect(addPicks(new Set([alpine.mediaId]), v.pickAll.ids)).toEqual(new Set([alpine.mediaId, alpha.mediaId]))
  })

  it('has nothing to pick when every title shown is picked', () => {
    const list = [entry(0), entry(80)]
    expect(view({ list, picked: new Set(ids(list)) }).pickAll).toEqual({ shown: 2, ids: [] })
  })
})

describe('"Picked only"', () => {
  it('shows only the picked titles that pass the other filters', () => {
    const list = [entry(0), entry(80), entry(70), entry(0, { status: 'DROPPED' })]
    const picked = new Set([list[1].mediaId, list[3].mediaId])
    expect(shown(view({ list, picked, filters: filters({ pickedOnly: true }) }))).toEqual([list[1].mediaId])
    expect(shown(view({ list, picked, filters: filters({ pickedOnly: true, statuses: ALL_STATUSES }) }))).toEqual(ids([list[3], list[1]]))
  })
})

describe('picks hidden by the filters or the search', () => {
  it('stay picked and keep counting', () => {
    const { fresh, list } = scaleList(2)
    const v = view({ list, picked: new Set([fresh[0].mediaId]), filters: filters({ search: 'nothing like this' }) })
    expect(v.rows).toEqual([])
    expect(v.summary.picked).toBe(1)
    expect(v.confirm).toMatchObject({ allowed: true, order: [fresh[0].mediaId] })
  })
})

describe('when nothing matches', () => {
  const list = [
    entry(0, { name: 'Alpha', year: 2020, genres: ['Drama'], status: 'DROPPED' }),
    entry(0, { name: 'Beta', year: 2024, genres: ['Action'] }),
    entry(0, { name: 'Bravo', year: 2020, genres: ['Action'] }),
    entry(0, { name: 'Gamma', year: 2020, genres: ['Drama'] }),
  ]

  it('is not reported while titles show', () => {
    expect(view({ list }).nothingMatches).toBeNull()
  })

  it('offers each change that brings titles back, with the count it gives, and leaves out the ones that give none', () => {
    const f = filters({ search: 'alpha', year: 2024, genres: ['Action'] })
    const v = view({ list, filters: f })
    expect(v.rows).toEqual([])
    // Clearing the search shows Beta; every status shows nothing (Alpha is from 2020); all years and clearing genres
    // and tags show nothing either (Alpha is Dropped).
    expect(v.nothingMatches).toEqual([{ change: 'search', count: 1 }])
    // Nothing to offer when no single change brings a title back.
    expect(view({ list, filters: filters({ statuses: ['PAUSED'], search: 'zzz' }) }).nothingMatches).toEqual([])
  })

  it('counts every way out separately', () => {
    const v = view({ list, filters: filters({ statuses: ['DROPPED'], year: 2024, search: 'a' }) })
    // Every status: Beta (2024, has an a). All years: Alpha. Clear the search: nothing (Alpha is 2020).
    expect(v.nothingMatches).toEqual([
      { change: 'statuses', count: 1 },
      { change: 'years', count: 1 },
    ])
    const tagged = view({ list, filters: filters({ genres: ['Action'], tags: ['Iyashikei'] }) })
    expect(tagged.nothingMatches).toEqual([{ change: 'genres-tags', count: 3 }])
  })

  it('offers turning "Picked only" off when no pick shows, with how many titles that shows', () => {
    const v = view({ list, picked: new Set([list[0].mediaId]), filters: filters({ pickedOnly: true }) })
    expect(v.rows).toEqual([])
    expect(v.nothingMatches).toEqual([
      { change: 'statuses', count: 1 },
      { change: 'picked-only', count: 3 },
    ])
    expect(view({ list, filters: filters({ pickedOnly: true }) }).nothingMatches).toEqual([{ change: 'picked-only', count: 3 }])
  })

  it('applies a way out to the filters, and resetting clears the search and every filter but keeps the sort', () => {
    const f = filters({ search: 'x', statuses: ['DROPPED'], year: 2020, genres: ['Drama'], tags: ['Iyashikei'], pickedOnly: true, sort: 'title' })
    expect(wayOut(f, 'search')).toEqual({ ...f, search: '' })
    expect(wayOut(f, 'statuses')).toEqual({ ...f, statuses: ALL_STATUSES })
    expect(wayOut(f, 'years')).toEqual({ ...f, year: null })
    expect(wayOut(f, 'genres-tags')).toEqual({ ...f, genres: [], tags: [] })
    expect(wayOut(f, 'picked-only')).toEqual({ ...f, pickedOnly: false })
    expect(wayOut(f, 'reset')).toEqual({ ...DEFAULT_PICKER_FILTERS, sort: 'title' })
  })
})

describe("the Picker's summary", () => {
  it('counts the picks, the Anchors they leave and on how many scores, and about how many Duels', () => {
    const { anchors, fresh, list } = scaleList(3)
    expect(view({ list }).summary).toEqual({ picked: 0, anchors: 24, scores: 4, duels: 0 })
    // Two titles over 4 scores: 2 · 2 log2(5) ≈ 9.3.
    expect(view({ list, picked: new Set(ids(fresh.slice(0, 2))) }).summary).toEqual({ picked: 2, anchors: 24, scores: 4, duels: 9 })
    // A picked scored title is no longer an Anchor.
    expect(view({ list, picked: new Set([fresh[0].mediaId, anchors[0].mediaId]) }).summary).toMatchObject({ picked: 2, anchors: 23, scores: 4 })
  })

  it('counts a scored Planning title as an Anchor, though the Picker never lists it (ADR 0009)', () => {
    const { list } = scaleList(1)
    const planned = entry(50, { status: 'PLANNING' })
    const v = view({ list: [...list, planned], filters: filters({ statuses: ALL_STATUSES }) })
    expect(v.summary).toMatchObject({ anchors: 25, scores: 5 })
    expect(shown(v)).not.toContain(planned.mediaId)
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
      reason: 'Your picks leave 19 Anchors on 4 scores; at least 20 on 3 are needed. Untick some titles that have a score.',
    })
  })

  it('is not allowed when the picks leave fewer than 3 distinct scores (every title of one score picked)', () => {
    const list = Array.from({ length: 30 }, (_, i) => entry([90, 80, 70][i % 3]))
    const sevens = new Set(ids(list.filter((e) => e.oldScore100 === 70)))
    expect(view({ list, picked: sevens }).confirm).toEqual({
      allowed: false,
      reason: 'Your picks leave 20 Anchors on 2 scores; at least 20 on 3 are needed. Untick some titles that have a score.',
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
    expect(startingPicks(scaleList(3).list, 'POINT_10', { from: 'start' })).toEqual(new Set())
  })

  it("are every unscored Completed and Repeating title when the Picker is opened from Catch-up's exit offer", () => {
    const { list } = scaleList(0)
    const completed = entry(0)
    const repeating = entry(0, { status: 'REPEATING' })
    const others = (['CURRENT', 'PAUSED', 'DROPPED', 'PLANNING'] as const).map((status) => entry(0, { status }))
    expect(startingPicks([...list, completed, repeating, ...others], 'POINT_10', { from: 'catch-up' })).toEqual(new Set([completed.mediaId, repeating.mediaId]))
  })

  it('add the remembered unsettled titles to those of Catch-up (#66)', () => {
    const { list } = scaleList(0)
    const completed = entry(0)
    const dropped = entry(0, { status: 'DROPPED' })
    expect(startingPicks([...list, completed, dropped], 'POINT_10', { from: 'catch-up' }, [dropped.mediaId])).toEqual(new Set([completed.mediaId, dropped.mediaId]))
  })

  it('add the remembered unsettled titles when the user says to pick them again (#66)', () => {
    const { fresh, list } = scaleList(3)
    const remembered = [fresh[0].mediaId, fresh[2].mediaId]
    expect(startingPicks(list, 'POINT_10', { from: 'start' }, remembered)).toEqual(new Set(remembered))
  })

  it('never tick a remembered title the Picker cannot show (#66)', () => {
    const { fresh, list } = scaleList(1)
    const planning = entry(0, { status: 'PLANNING' })
    expect(startingPicks([...list, planning], 'POINT_10', { from: 'start' }, [fresh[0].mediaId, planning.mediaId, 99999])).toEqual(
      new Set([fresh[0].mediaId]),
    )
  })
})

describe('the count of active filters', () => {
  it('counts each list status shown, the year, and each chosen genre and tag, but not the search or the sort', () => {
    const list = [entry(0)]
    expect(view({ list }).activeFilters).toBe(2)
    const f = filters({ statuses: ['DROPPED'], year: 2020, genres: ['Drama'], tags: ['Military', 'Space'], search: 'x', sort: 'title' })
    expect(view({ list, filters: f }).activeFilters).toBe(5)
  })
})

describe("the Picker's dock", () => {
  it('counts the picks that replace a score', () => {
    const { anchors, fresh, list } = scaleList(3)
    expect(view({ list, picked: new Set(ids(fresh)) }).dock.replacing).toBe(0)
    expect(view({ list, picked: new Set([fresh[0].mediaId, anchors[0].mediaId, anchors[5].mediaId]) }).dock.replacing).toBe(2)
  })

  it('stacks the covers of the last six titles picked, the latest first, leaving out picks gone from the list', () => {
    const { list } = scaleList(0)
    const picks = [...ids(list.slice(0, 7)), 99999]
    expect(ids(view({ list, picked: new Set(picks) }).dock.covers)).toEqual(ids(list.slice(1, 7)).reverse())
    expect(view({ list }).dock.covers).toEqual([])
  })

  it("says why Confirm is not allowed, as Confirm's reason does, in orange when the picks leave too few Anchors or scores", () => {
    const { anchors, fresh, list } = scaleList(1)
    expect(view({ list }).dock.blocked).toEqual({ text: 'Pick at least one title.', warn: false })
    expect(view({ list, picked: new Set(ids(fresh)) }).dock.blocked).toBeNull()
    const tooFew = view({ list, picked: new Set(ids(anchors.slice(0, 6))) })
    expect(tooFew.dock.blocked).toEqual({
      text: 'Your picks leave 18 Anchors on 4 scores; at least 20 on 3 are needed. Untick some titles that have a score.',
      warn: true,
    })
    expect(tooFew.confirm).toEqual({ allowed: false, reason: tooFew.dock.blocked?.text })
  })
})

describe('ticking a title', () => {
  it('picks it, and ticking it again unpicks it, leaving the other picks', () => {
    const once = togglePick(new Set([1]), 2)
    expect(once).toEqual(new Set([1, 2]))
    expect(togglePick(once, 2)).toEqual(new Set([1]))
  })
})

describe('choosing a genre, a tag or a list status', () => {
  it('adds it to the filters, and choosing it again takes it out, leaving the others', () => {
    const f = filters({ genres: ['Drama'], tags: ['Space'] })
    expect(toggleFacet(f, 'genres', 'Action')).toEqual({ ...f, genres: ['Drama', 'Action'] })
    expect(toggleFacet(f, 'genres', 'Drama')).toEqual({ ...f, genres: [] })
    expect(toggleFacet(f, 'tags', 'Iyashikei')).toEqual({ ...f, tags: ['Space', 'Iyashikei'] })
  })

  it('keeps the list statuses in the order Start offers them', () => {
    expect(toggleStatus(filters({ statuses: ['REPEATING'] }), 'COMPLETED').statuses).toEqual(['COMPLETED', 'REPEATING'])
    expect(toggleStatus(filters(), 'COMPLETED').statuses).toEqual(['REPEATING'])
  })
})
