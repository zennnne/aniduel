import { describe, expect, it } from 'vitest'
import type { CatchUpMedia } from '../anilist/candidates.ts'
import { cycleMark, firstBatch, markCounts, saveBatch, setMark, withQueuedWrites, type CatchUpBatch } from './batch.ts'

const NOW = Date.UTC(2026, 9, 8)

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

/** Sixty watched titles (ids 100..159), so the list is past the cold-start threshold. */
const list = Array.from({ length: 60 }, (_, i) => ({ mediaId: 100 + i, status: 'COMPLETED' as const, year: 2015, format: 'TV' }))

/** Popular titles unrelated to anything (ids 1000..). */
const filler = (count: number) => Array.from({ length: count }, (_, i) => anime(1000 + i, { watched: 5_000 + i }))

const ids = (batch: CatchUpBatch) => batch.suggestions.map((s) => s.media.id)

function start(media: CatchUpMedia[]) {
  return firstBatch({ list, media, passed: new Map(), now: NOW, seed: 1 })
}

describe('Catch-up batch: marks', () => {
  it('starts as batch 1 with 20 unmarked titles', () => {
    const batch = start(filler(40))

    expect(batch.number).toBe(1)
    expect(batch.suggestions).toHaveLength(20)
    expect(markCounts(batch)).toEqual({ completed: 0, dropped: 0, planning: 0, passed: 20 })
  })

  it('cycles a tapped title Completed → Dropped → Planning → none', () => {
    let batch = start(filler(40))
    const id = ids(batch)[0]
    const seen: Array<string | undefined> = []
    for (let i = 0; i < 4; i++) {
      batch = cycleMark(batch, id)
      seen.push(batch.marks.get(id))
    }

    expect(seen).toEqual(['COMPLETED', 'DROPPED', 'PLANNING', undefined])
  })

  it('sets or clears a mark directly from the ⋯ menu', () => {
    let batch = start(filler(40))
    const [a, b] = ids(batch)
    batch = setMark(batch, a, 'PLANNING')
    batch = setMark(batch, b, 'DROPPED')
    batch = setMark(batch, b, null)

    expect([...batch.marks]).toEqual([[a, 'PLANNING']])
    expect(markCounts(batch)).toEqual({ completed: 0, dropped: 0, planning: 1, passed: 19 })
  })

  it('ignores a title that is not in the batch', () => {
    const batch = start(filler(40))

    expect(cycleMark(batch, 99_999).marks.size).toBe(0)
  })
})

describe('Catch-up batch: Save & next', () => {
  it('writes the last mark of each marked title, and nothing for the unmarked ones', () => {
    let batch = start(filler(40))
    const [a, b, c] = ids(batch)
    batch = cycleMark(batch, a) // Completed
    batch = cycleMark(cycleMark(batch, b), b) // Dropped
    batch = setMark(batch, c, 'COMPLETED')
    batch = setMark(batch, c, 'PLANNING') // changed before saving

    const saved = saveBatch(batch, { list, media: filler(40), passed: new Map(), now: NOW, seed: 2 })

    expect(saved.writes).toEqual([
      { mediaId: a, listStatus: 'COMPLETED' },
      { mediaId: b, listStatus: 'DROPPED' },
      { mediaId: c, listStatus: 'PLANNING' },
    ])
    expect(saved.passed).toHaveLength(17)
    expect(saved.passed).not.toContain(a)
  })

  it('shows the next batch at once: numbered on, unmarked, and with none of the titles just shown', () => {
    let batch = start(filler(60))
    batch = cycleMark(batch, ids(batch)[0])

    const { next } = saveBatch(batch, { list, media: filler(60), passed: new Map(), now: NOW, seed: 2 })

    expect(next.number).toBe(2)
    expect(next.marks.size).toBe(0)
    expect(next.suggestions).toHaveLength(20)
    expect(ids(next).filter((id) => ids(batch).includes(id))).toEqual([])
  })

  it('counts marked titles as on the list for the next batch: a sequel of a title just Completed comes first', () => {
    const marked = anime(500, { watched: 1_000_000, relations: [{ type: 'SEQUEL', mediaId: 501 }] })
    const sequel = anime(501, { watched: 1 })
    const media = [marked, sequel, ...filler(40)]
    let batch = start(media)
    expect(ids(batch)).toContain(500)
    expect(ids(batch)).not.toContain(501) // the least popular, and a sequel of nothing watched yet

    batch = cycleMark(batch, 500)
    const { next, list: updated } = saveBatch(batch, { list, media, passed: new Map(), now: NOW, seed: 2 })

    expect(updated).toContainEqual({ mediaId: 500, status: 'COMPLETED', year: 2015, format: 'TV' })
    expect(ids(next)[0]).toBe(501)
  })

  it('keeps titles marked Planning out of later batches without counting them as watched', () => {
    const planned = anime(500, { watched: 1_000_000, relations: [{ type: 'SEQUEL', mediaId: 501 }] })
    const media = [planned, anime(501, { watched: 1 }), ...filler(40)]
    const batch = setMark(start(media), 500, 'PLANNING')

    const { next } = saveBatch(batch, { list, media, passed: new Map(), now: NOW, seed: 2 })

    expect(ids(next)).not.toContain(500)
    expect(ids(next)[0]).not.toBe(501)
  })

  it('adds the titles left unmarked to the Passed history it hands back, so later batches skip them too', () => {
    const media = filler(70)
    const first = start(media)
    const second = saveBatch(first, { list, media, passed: new Map(), now: NOW, seed: 2 })
    const third = saveBatch(second.next, { list: second.list, media, passed: second.history, now: NOW, seed: 3 })

    expect(second.history.get(ids(first)[0])).toBe(NOW)
    expect(ids(third.next).filter((id) => ids(first).includes(id) || ids(second.next).includes(id))).toEqual([])
  })
})

describe('Catch-up batch: after a reload', () => {
  it('counts titles still in the write queue as on the list, so they are not suggested again', () => {
    const queued = [
      { mediaId: 1000, listStatus: 'COMPLETED' as const, status: 'pending' as const },
      { mediaId: 1001, listStatus: 'DROPPED' as const, status: 'failed' as const },
      { mediaId: 1002, listStatus: 'PLANNING' as const, status: 'skipped' as const }, // AniList has its own status
      { mediaId: 100, listStatus: 'DROPPED' as const, status: 'done' as const }, // already on the list as read
    ]

    const merged = withQueuedWrites(list, queued, filler(5))

    expect(merged.filter((e) => e.mediaId >= 1000)).toEqual([
      { mediaId: 1000, status: 'COMPLETED', year: 2015, format: 'TV' },
      { mediaId: 1001, status: 'DROPPED', year: 2015, format: 'TV' },
    ])
    expect(merged.find((e) => e.mediaId === 100)?.status).toBe('COMPLETED')
    expect(ids(firstBatch({ list: merged, media: filler(40), passed: new Map(), now: NOW, seed: 1 }))).not.toContain(1000)
  })
})

describe('Catch-up batch: cold start', () => {
  /** 40 titles from 2005, and 40 less popular ones from 2018 that are sequels of the 2005 ones. */
  const media = [
    ...Array.from({ length: 40 }, (_, i) => anime(2000 + i, { year: 2005, watched: 20_000 + i })),
    ...Array.from({ length: 40 }, (_, i) =>
      anime(3000 + i, { year: 2018, watched: 1_000 + i, relations: [{ mediaId: 2000 + i, type: 'PREQUEL' }] }),
    ),
  ]
  const threeWatched = list.slice(0, 3)
  const twentyThreeWatched = list.slice(0, 23)
  const startingEra = { from: 2003, to: 2007 }

  it('keeps suggesting from the Starting era while the list stays below 30 watched titles', () => {
    let batch = firstBatch({ list: threeWatched, media, passed: new Map(), now: NOW, seed: 1, startingEra })
    batch = setMark(batch, ids(batch)[0], 'COMPLETED')

    const saved = saveBatch(batch, { list: threeWatched, media, passed: new Map(), now: NOW, seed: 2, startingEra })

    expect(saved.next.suggestions).toHaveLength(20)
    expect(saved.next.suggestions.every((s) => s.media.year === 2005)).toBe(true)
  })

  it('switches to the usual mix once the marks take the list to 30 watched titles', () => {
    let batch = firstBatch({ list: twentyThreeWatched, media, passed: new Map(), now: NOW, seed: 1, startingEra })
    for (const id of ids(batch).slice(0, 7)) batch = setMark(batch, id, 'COMPLETED')

    const saved = saveBatch(batch, { list: twentyThreeWatched, media, passed: new Map(), now: NOW, seed: 2, startingEra })

    // Sequels of the seven just marked lead the batch, though far less popular than the 2005 titles left.
    expect(saved.next.suggestions.slice(0, 7).every((s) => s.media.year === 2018)).toBe(true)
  })
})
