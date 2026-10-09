import { describe, expect, it } from 'vitest'
import type { CatchUpMedia } from '../anilist/candidates.ts'
import type { ListStatus } from '../anilist/types.ts'
import { suggestCatchUp, type CatchUpInput } from './suggest.ts'

const NOW = Date.UTC(2026, 9, 8)
const DAY = 24 * 60 * 60 * 1000

function anime(id: number, overrides: Partial<CatchUpMedia> = {}): CatchUpMedia {
  return {
    id,
    title: { romaji: `Anime ${id}`, english: null, native: null },
    coverUrl: null,
    coverColor: null,
    year: 2015,
    format: 'TV',
    status: 'FINISHED',
    watched: 10_000,
    tags: [],
    relations: [],
    recommendations: [],
    ...overrides,
  }
}

function entry(mediaId: number, status: ListStatus = 'COMPLETED', year = 2015, format = 'TV') {
  return { mediaId, status, year, format }
}

/** Ids 1000.. that are popular but unrelated to anything: filler so batches can fill up. */
function filler(count: number, overrides: (i: number) => Partial<CatchUpMedia> = () => ({})) {
  return Array.from({ length: count }, (_, i) => anime(1000 + i, { watched: 5_000 + i, ...overrides(i) }))
}

/** Sixty watched titles, so the list is past the cold-start threshold. */
const watchedList = Array.from({ length: 60 }, (_, i) => entry(100 + i))

function input(overrides: Partial<CatchUpInput>): CatchUpInput {
  return { list: watchedList, media: [], passed: new Map(), now: NOW, seed: 1, ...overrides }
}

const ids = (batch: { media: CatchUpMedia }[]) => batch.map((s) => s.media.id)

describe('Catch-up suggestions', () => {
  it('never suggests a title already on the list, whatever its status', () => {
    const list = [...watchedList, entry(1, 'PLANNING'), entry(2, 'DROPPED'), entry(3, 'CURRENT')]
    const media = [anime(1), anime(2), anime(3), anime(4), anime(100)]

    const batch = suggestCatchUp(input({ list, media }))

    expect(ids(batch)).toEqual([4])
  })

  it('hides a Passed title for 30 days, then suggests it again', () => {
    const media = [anime(1), anime(2), anime(3)]
    const passed = new Map([
      [1, NOW - 30 * DAY + 1], // a moment short of 30 days: still hidden
      [2, NOW - 30 * DAY], // 30 days ago: back
    ])

    const batch = suggestCatchUp(input({ media, passed }))

    expect(ids(batch).sort()).toEqual([2, 3])
  })

  it('puts sequels and prequels of watched titles at the top, above far more popular titles', () => {
    const media = [
      // Watched 100 lists 1 as its sequel.
      anime(100, { relations: [{ type: 'SEQUEL', mediaId: 1 }] }),
      // Candidate 2 lists watched 101 as its sequel, so 2 is 101's prequel.
      anime(2, { watched: 800, relations: [{ type: 'SEQUEL', mediaId: 101 }] }),
      anime(1, { watched: 500 }),
      ...filler(30, () => ({ watched: 2_000_000 })),
    ]

    const batch = suggestCatchUp(input({ media }))

    expect(batch).toHaveLength(20)
    expect(ids(batch).slice(0, 2).sort()).toEqual([1, 2])
  })

  it('counts a Dropped title as watched just like a Completed one, and a Planning title not at all', () => {
    const list = [
      ...watchedList.slice(3),
      entry(100, 'COMPLETED'),
      entry(101, 'DROPPED'),
      entry(102, 'PLANNING'),
    ]
    const media = [
      anime(100, { recommendations: [{ mediaId: 1, rating: 50 }], relations: [{ type: 'SEQUEL', mediaId: 4 }] }),
      anime(101, { recommendations: [{ mediaId: 2, rating: 50 }], relations: [{ type: 'SEQUEL', mediaId: 5 }] }),
      anime(102, { recommendations: [{ mediaId: 3, rating: 500 }], relations: [{ type: 'SEQUEL', mediaId: 6 }] }),
      ...[1, 2, 3, 4, 5, 6].map((id) => anime(id, { watched: 4_000 })),
      ...filler(30),
    ]

    const batch = suggestCatchUp(input({ list, media }))

    // The Completed and Dropped titles' sequels, then their recommendations; nothing from the Planning one.
    expect(ids(batch).slice(0, 4)).toEqual([4, 5, 1, 2])
    expect(ids(batch)).not.toContain(3)
    expect(ids(batch)).not.toContain(6)
  })

  it("prefers popular titles from the user's years and formats over more popular ones outside them", () => {
    const list = Array.from({ length: 60 }, (_, i) => entry(100 + i, 'COMPLETED', 2009 + (i % 3), 'TV'))
    const media = [
      anime(1, { year: 1990, format: 'MOVIE', watched: 20_000 }),
      anime(2, { year: 2010, format: 'MOVIE', watched: 12_000 }),
      anime(3, { year: 1990, format: 'TV', watched: 12_000 }),
      anime(4, { year: 2010, format: 'TV', watched: 10_000 }),
    ]

    const batch = suggestCatchUp(input({ list, media }))

    expect(ids(batch)[0]).toBe(4)
    expect(ids(batch)[3]).toBe(1)
  })

  it('makes a batch of 12 strongest matches, 5 popular-in-era and 3 exploratory titles', () => {
    const list = Array.from({ length: 60 }, (_, i) => entry(100 + i, 'COMPLETED', 2014 + (i % 3), 'TV'))
    // 30 titles recommended from the user's list, 30 popular ones from their era, 30 popular ones from other eras.
    const recommended = Array.from({ length: 30 }, (_, i) => anime(200 + i, { year: 2015, watched: 3_000 }))
    const inEra = Array.from({ length: 30 }, (_, i) => anime(300 + i, { year: 2015, watched: 50_000 + i }))
    const otherEras = Array.from({ length: 30 }, (_, i) =>
      anime(400 + i, { year: 1995 + (i % 5), format: 'MOVIE', watched: 60_000 + i }),
    )
    const seeds = list.map((e, i) =>
      anime(e.mediaId, { recommendations: [200 + i, 212 + i].map((mediaId) => ({ mediaId, rating: 80 })) }),
    )

    const batch = suggestCatchUp(input({ list, media: [...seeds, ...recommended, ...inEra, ...otherEras] }))

    expect(batch).toHaveLength(20)
    const byKind = (kind: string) => batch.filter((s) => s.kind === kind).map((s) => s.media.id)
    expect(byKind('strong')).toHaveLength(12)
    expect(byKind('strong').every((id) => id >= 200 && id < 300)).toBe(true)
    expect(byKind('era')).toHaveLength(5)
    expect(byKind('era').every((id) => id >= 300 && id < 400)).toBe(true)
    expect(byKind('explore')).toHaveLength(3)
    expect(byKind('explore').every((id) => id >= 400)).toBe(true)
  })

  it('fills the whole batch from what is left when a kind runs short', () => {
    const media = Array.from({ length: 25 }, (_, i) => anime(1 + i, { year: 2015, watched: 1_000 + i }))

    const batch = suggestCatchUp(input({ media }))

    expect(batch).toHaveLength(20)
  })

  it('suggests at most 2 titles from one franchise per batch', () => {
    // Watched 100 starts a long franchise: 100 → 1 → 2 → … → 6, plus a recap film and a side story of 1.
    const chain = [100, 1, 2, 3, 4, 5, 6]
    const media = [
      ...chain.map((id, i) =>
        anime(id, {
          watched: 900_000,
          relations: [
            ...(i + 1 < chain.length ? [{ type: 'SEQUEL', mediaId: chain[i + 1] }] : []),
            ...(id === 1 ? [{ type: 'SUMMARY', mediaId: 7 }, { type: 'SIDE_STORY', mediaId: 8 }] : []),
          ],
        }),
      ),
      anime(7, { format: 'MOVIE', year: 1999, watched: 900_000 }),
      anime(8, { watched: 900_000 }),
      ...filler(30),
    ]

    const batch = suggestCatchUp(input({ media }))

    expect(batch).toHaveLength(20)
    expect(ids(batch).filter((id) => id < 100)).toHaveLength(2)
  })

  it('gives the same batch for the same seed, and varies the exploratory titles between seeds', () => {
    const list = Array.from({ length: 60 }, (_, i) => entry(100 + i, 'COMPLETED', 2015, 'TV'))
    const media = [
      ...filler(30),
      ...Array.from({ length: 30 }, (_, i) => anime(400 + i, { year: 1990 + i, format: 'MOVIE', watched: 40_000 + i })),
    ]
    const run = (seed: number) => suggestCatchUp(input({ list, media, seed }))
    const explored = (seed: number) =>
      run(seed)
        .filter((s) => s.kind === 'explore')
        .map((s) => s.media.id)
        .join()

    expect(run(7)).toEqual(run(7))
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8]
    expect(new Set(seeds.map(explored)).size).toBeGreaterThan(1)
  })

  it('breaks a tie in favour of the title sharing tags with watched titles', () => {
    const media = [
      anime(100, { tags: [{ name: 'Military', rank: 90 }] }),
      anime(1, { tags: [{ name: 'Cooking', rank: 90 }] }),
      anime(2, { tags: [{ name: 'Military', rank: 90 }] }),
    ]

    const batch = suggestCatchUp(input({ media }))

    expect(ids(batch)).toEqual([2, 1])
  })

  it('runs with other weights, e.g. popularity only', () => {
    const media = [
      anime(100, { relations: [{ type: 'SEQUEL', mediaId: 1 }] }),
      anime(1, { watched: 500 }),
      anime(2, { watched: 900_000 }),
    ]
    const popularityOnly = { relations: 0, recommendations: 0, popularity: 1, tags: 0 }

    expect(ids(suggestCatchUp(input({ media })))).toEqual([1, 2])
    expect(ids(suggestCatchUp(input({ media, weights: popularityOnly })))).toEqual([2, 1])
  })

  it('never suggests a title that has not started airing', () => {
    const media = [anime(1, { status: 'NOT_YET_RELEASED' }), anime(2, { status: 'RELEASING' })]

    expect(ids(suggestCatchUp(input({ media })))).toEqual([2])
  })

  describe('cold start: fewer than 30 watched titles', () => {
    /** 30 titles from 2005 and 30 far more popular ones from 2018. */
    const media = [
      ...Array.from({ length: 30 }, (_, i) => anime(2000 + i, { year: 2005, watched: 20_000 + i })),
      ...Array.from({ length: 30 }, (_, i) => anime(3000 + i, { year: 2018, watched: 200_000 + i })),
    ]
    const twentyNineWatched = Array.from({ length: 29 }, (_, i) => entry(100 + i, 'COMPLETED', 2018))

    it('fills the batch with popular titles from the Starting era', () => {
      const batch = suggestCatchUp(input({ list: twentyNineWatched, media, startingEra: { from: 2003, to: 2007 } }))

      expect(batch).toHaveLength(20)
      expect(batch.every((s) => s.media.year === 2005)).toBe(true)
      // Most popular first.
      expect(ids(batch).slice(0, 3)).toEqual([2029, 2028, 2027])
    })

    it('gives all-time favourites when the Starting era was skipped', () => {
      const batch = suggestCatchUp(input({ list: twentyNineWatched, media, startingEra: null }))

      expect(batch.every((s) => s.media.year === 2018)).toBe(true)
      expect(ids(batch).slice(0, 3)).toEqual([3029, 3028, 3027])
    })

    it('still counts as cold start with Planning titles, which are not watched', () => {
      const list = [...twentyNineWatched, entry(500, 'PLANNING'), entry(501, 'PLANNING')]

      const batch = suggestCatchUp(input({ list, media, startingEra: { from: 2003, to: 2007 } }))

      expect(batch.every((s) => s.media.year === 2005)).toBe(true)
    })

    it('ignores the Starting era from 30 watched titles: the usual mix from the list takes over', () => {
      const thirtyWatched = [...twentyNineWatched, entry(129, 'DROPPED', 2018)]
      const sequel = anime(4000, { year: 2019, watched: 100, relations: [{ mediaId: 100, type: 'PREQUEL' }] })

      const batch = suggestCatchUp(input({ list: thirtyWatched, media: [...media, sequel], startingEra: { from: 2003, to: 2007 } }))

      expect(ids(batch)[0]).toBe(4000)
      expect(batch.map((s) => s.kind)).toContain('strong')
      // The list's own era (2018) leads, not the Starting era.
      expect(batch.filter((s) => s.media.year === 2005).length).toBeLessThan(batch.length / 2)
    })
  })
})
