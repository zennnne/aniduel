import { describe, expect, it } from 'vitest'
import type { CatchUpMedia, Era } from '../anilist/candidates.ts'
import { AniListError } from '../anilist/gateway.ts'
import type { ListStatus } from '../anilist/types.ts'
import type { Clock } from '../import/runner.ts'
import { createCandidatePool, eraYears, retryRateLimited, type CandidateSource } from './candidatePool.ts'

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

const entry = (mediaId: number, status: ListStatus = 'COMPLETED', year: number | null = 2015) => ({ mediaId, status, year, format: 'TV' })

/** A fake AniList: knows `catalog`, and records which ids and eras were asked for. */
function fakeSource(catalog: CatchUpMedia[], popular: CatchUpMedia[] = []) {
  const byId = new Map(catalog.map((m) => [m.id, m]))
  const asked: number[][] = []
  const eras: Array<Era | null> = []
  const source: CandidateSource = {
    media: async (ids) => {
      asked.push([...ids])
      return ids.flatMap((id) => byId.get(id) ?? [])
    },
    popular: async (era) => {
      eras.push(era)
      return popular
    },
  }
  return { source, asked, eras }
}

const ids = (media: readonly CatchUpMedia[]) => media.map((m) => m.id).sort((a, b) => a - b)

describe('Catch-up candidate pool', () => {
  it('loads the watched titles, one hop of their relations and recommendations, and popular titles from the era', async () => {
    const catalog = [
      anime(1, { relations: [{ type: 'SEQUEL', mediaId: 10 }], recommendations: [{ mediaId: 11, rating: 50 }] }),
      anime(2, { relations: [{ type: 'PREQUEL', mediaId: 1 }] }),
      anime(3), // Planning: not a seed
      anime(10),
      anime(11),
    ]
    const { source, asked, eras } = fakeSource(catalog, [anime(50)])
    const pool = createCandidatePool(source)

    await pool.update([entry(1), entry(2, 'DROPPED'), entry(3, 'PLANNING')])

    expect(asked[0]).toEqual([1, 2])
    expect(asked[1].sort()).toEqual([10, 11]) // 1 is on the list already, 3 is linked from nothing
    expect(eras).toEqual([{ from: 2015, to: 2015 }])
    expect(ids(pool.media())).toEqual([1, 2, 10, 11, 50])
  })

  it('asks for nothing it has asked for before; titles marked since only bring their own new neighbours', async () => {
    const catalog = [
      anime(1, { relations: [{ type: 'SEQUEL', mediaId: 10 }] }),
      anime(10, { relations: [{ type: 'SEQUEL', mediaId: 20 }], recommendations: [{ mediaId: 21, rating: 5 }] }),
      anime(20),
      anime(21),
    ]
    const { source, asked, eras } = fakeSource(catalog)
    const pool = createCandidatePool(source)
    await pool.update([entry(1)])
    asked.length = 0

    await pool.update([entry(1), entry(10)]) // 10 was just marked Completed

    expect(asked.map((a) => [...a].sort())).toEqual([[20, 21]])
    expect(eras).toHaveLength(1) // the era did not change
    expect(ids(pool.media())).toEqual([1, 10, 20, 21])
  })

  it('remembers ids AniList returned nothing for, so it does not ask again', async () => {
    const { source, asked } = fakeSource([anime(1, { relations: [{ type: 'SEQUEL', mediaId: 404 }] })])
    const pool = createCandidatePool(source)
    await pool.update([entry(1)])
    asked.length = 0

    await pool.update([entry(1)])

    expect(asked).toEqual([])
  })

  it('caps the neighbours per update, relations first, then the best-rated recommendations', async () => {
    const recs = Array.from({ length: 10 }, (_, i) => ({ mediaId: 100 + i, rating: i }))
    const seed = anime(1, { relations: [{ type: 'SIDE_STORY', mediaId: 99 }], recommendations: recs })
    const { source, asked } = fakeSource([seed])
    const pool = createCandidatePool(source, { seeds: 50, neighbours: 3 })

    await pool.update([entry(1)])

    expect(asked[1].sort()).toEqual([108, 109, 99])
  })

  it('caps the seeds per update and loads the rest on later updates', async () => {
    const list = Array.from({ length: 5 }, (_, i) => entry(i + 1))
    const { source, asked } = fakeSource(list.map((e) => anime(e.mediaId)))
    const pool = createCandidatePool(source, { seeds: 3, neighbours: 10 })

    await pool.update(list)
    await pool.update(list)

    expect(asked).toEqual([[1, 2, 3], [4, 5]])
  })

  it('asks for all-time favourites when no watched title has a year', async () => {
    const { source, eras } = fakeSource([])
    const pool = createCandidatePool(source)

    await pool.update([])

    expect(eras).toEqual([null])
  })
})

describe('the user era', () => {
  it('spans the middle 80% of the watched titles’ start years, leaving Planning out', () => {
    const list = [
      entry(1, 'COMPLETED', 1990),
      ...Array.from({ length: 8 }, (_, i) => entry(10 + i, 'COMPLETED', 2010 + i)),
      entry(2, 'COMPLETED', 2025),
      entry(3, 'PLANNING', 1970),
    ]

    expect(eraYears(list)).toEqual({ from: 2010, to: 2017 })
    expect(eraYears([entry(1, 'PLANNING', 2000), entry(2, 'COMPLETED', null)])).toBeNull()
  })
})

describe('reading through the rate limit', () => {
  function fakeClock(): Clock & { sleeps: number[] } {
    let now = 1_760_000_000_000
    const sleeps: number[] = []
    return { sleeps, now: () => now, sleep: async (ms) => void (sleeps.push(ms), (now += ms)) }
  }

  it('waits for the rate-limit reset after a 429, then asks again', async () => {
    const clock = fakeClock()
    let calls = 0
    const request = async () => {
      calls++
      if (calls === 1) throw new AniListError('rate-limited', 'Too Many Requests.', 429)
      return 'ok'
    }

    const result = await retryRateLimited(request, { clock, resetAt: () => clock.now() / 1000 + 42 })

    expect(result).toBe('ok')
    expect(clock.sleeps).toEqual([42_000])
  })

  it('waits a minute when the reset time is unknown, and passes other errors on', async () => {
    const clock = fakeClock()
    let calls = 0
    const request = async () => {
      calls++
      if (calls === 1) throw new AniListError('rate-limited', 'Too Many Requests.', 429)
      throw new AniListError('unreachable', 'down')
    }

    await expect(retryRateLimited(request, { clock, resetAt: () => null })).rejects.toMatchObject({ kind: 'unreachable' })
    expect(clock.sleeps).toEqual([60_000])
  })
})
