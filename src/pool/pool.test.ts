import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STATUSES,
  OFFERED_STATUSES,
  buildPool,
  displayTitle,
  estimateDuels,
  estimateMinutes,
  roughSortOrder,
} from './pool.ts'
import type { ListEntry, ListStatus } from '../anilist/types.ts'

const aot = { romaji: 'Shingeki no Kyojin', english: 'Attack on Titan', native: '進撃の巨人' }
const romajiOnly = { romaji: 'Mushishi', english: null, native: null }

describe('displayTitle', () => {
  it("uses the user's title language", () => {
    expect(displayTitle(aot, 'ENGLISH')).toBe('Attack on Titan')
    expect(displayTitle(aot, 'NATIVE')).toBe('進撃の巨人')
    expect(displayTitle(aot, 'ROMAJI')).toBe('Shingeki no Kyojin')
  })

  it('treats the stylised settings like their plain language', () => {
    expect(displayTitle(aot, 'ENGLISH_STYLISED')).toBe('Attack on Titan')
    expect(displayTitle(aot, 'NATIVE_STYLISED')).toBe('進撃の巨人')
    expect(displayTitle(aot, 'ROMAJI_STYLISED')).toBe('Shingeki no Kyojin')
  })

  it('falls back to romaji when the title has no name in that language', () => {
    expect(displayTitle(romajiOnly, 'ENGLISH')).toBe('Mushishi')
    expect(displayTitle(romajiOnly, 'NATIVE')).toBe('Mushishi')
  })
})

describe('statuses', () => {
  it('selects Completed and Repeating by default', () => {
    expect([...DEFAULT_STATUSES].sort()).toEqual(['COMPLETED', 'REPEATING'])
  })

  it('never offers Planning', () => {
    expect(OFFERED_STATUSES).not.toContain('PLANNING')
    expect([...OFFERED_STATUSES].sort()).toEqual(['COMPLETED', 'CURRENT', 'DROPPED', 'PAUSED', 'REPEATING'])
  })
})

describe('estimateDuels', () => {
  // Before Rough Sort the estimate assumes five equal Bands and binary insertion:
  // the sum of log2(k!) over each Band's size, rounded.
  it('needs no Duels when every Band holds at most one title', () => {
    expect(estimateDuels(0)).toBe(0)
    expect(estimateDuels(5)).toBe(0)
  })

  it('sums log2(k!) over five equal Bands', () => {
    expect(estimateDuels(10)).toBe(5) // 5 × log2(2!) = 5
    expect(estimateDuels(15)).toBe(13) // 5 × log2(3!) = 12.92
    expect(estimateDuels(100)).toBe(305) // 5 × log2(20!) = 305.4
  })

  it('spreads a remainder over the first Bands', () => {
    expect(estimateDuels(7)).toBe(2) // Bands of 2, 2, 1, 1, 1
  })
})

describe('estimateMinutes', () => {
  it('assumes about 3 seconds per Duel', () => {
    expect(estimateMinutes(0)).toBe(0)
    expect(estimateMinutes(305)).toBe(15)
  })
})

function entry(mediaId: number, status: ListStatus): ListEntry {
  return {
    mediaId,
    status,
    oldScore100: 0,
    completedAt: { year: null, month: null, day: null },
    title: { romaji: `T${mediaId}`, english: null, native: null },
    coverUrl: null,
    coverColor: null,
    bannerUrl: null,
    year: null,
    format: null,
    length: null,
    siteUrl: '',
  }
}

describe('buildPool', () => {
  const list = [entry(1, 'COMPLETED'), entry(2, 'COMPLETED'), entry(3, 'REPEATING'), entry(4, 'DROPPED'), entry(5, 'CURRENT')]

  it('counts the titles under each offered status', () => {
    expect(buildPool(list, DEFAULT_STATUSES).countByStatus).toEqual({
      COMPLETED: 2,
      REPEATING: 1,
      CURRENT: 1,
      PAUSED: 0,
      DROPPED: 1,
    })
  })

  it('keeps only titles in the chosen statuses, with the expected number of Duels', () => {
    const pool = buildPool(list, ['COMPLETED', 'REPEATING'])
    expect(pool.titles.map((t) => t.mediaId)).toEqual([1, 2, 3])
    expect(pool.expectedDuels).toBe(0)

    const bigger = buildPool(list, ['COMPLETED', 'REPEATING', 'DROPPED', 'CURRENT'])
    expect(bigger.titles).toHaveLength(5)
  })
})

describe('roughSortOrder', () => {
  function done(mediaId: number, romaji: string, year: number | null, month: number | null = null, day: number | null = null) {
    return { ...entry(mediaId, 'COMPLETED'), title: { romaji, english: null, native: null }, completedAt: { year, month, day } }
  }

  it('puts the most recently completed first and undated titles last, sorted by title', () => {
    const titles = [
      done(1, 'Zeta', null),
      done(2, 'Old', 2015, 3, 1),
      done(3, 'Alpha', null),
      done(4, 'Newest', 2024, 11, 20),
      done(5, 'Newer', 2024, 2, 9),
    ]
    expect(roughSortOrder(titles, 'ROMAJI')).toEqual([4, 5, 2, 3, 1])
  })

  it('sorts undated titles by the name the user sees', () => {
    const b = { ...done(1, 'B romaji', null), title: { romaji: 'B romaji', english: 'Z english', native: null } }
    const a = { ...done(2, 'C romaji', null), title: { romaji: 'C romaji', english: 'A english', native: null } }
    expect(roughSortOrder([b, a], 'ENGLISH')).toEqual([2, 1])
    expect(roughSortOrder([b, a], 'ROMAJI')).toEqual([1, 2])
  })

  it('puts a date with only a year after full dates in that year', () => {
    expect(roughSortOrder([done(1, 'A', 2020), done(2, 'B', 2020, 1, 2)], 'ROMAJI')).toEqual([2, 1])
  })
})
