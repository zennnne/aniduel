import { describe, expect, it } from 'vitest'
import { fetchCatchUpMedia, fetchPopularAnime } from './candidates.ts'
import { AniListError } from './gateway.ts'

type Call = { init: RequestInit; body: { query: string; variables: Record<string, unknown> } }

// A fake `fetch` that records every request and answers from a queue of responses.
function fakeFetch(...responses: Array<{ status?: number; json: unknown; headers?: Record<string, string> }>) {
  const calls: Call[] = []
  const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push({ init: init ?? {}, body: JSON.parse(String(init?.body)) })
    const next = responses.shift()
    if (!next) throw new Error('unexpected request')
    return new Response(JSON.stringify(next.json), {
      status: next.status ?? 200,
      headers: { 'Content-Type': 'application/json', ...next.headers },
    })
  }
  return { fetch: fetch as typeof globalThis.fetch, calls }
}

function rawMedia(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: { romaji: `Romaji ${id}`, english: null, native: null },
    coverImage: { large: `https://img/${id}.jpg`, color: '#123456' },
    siteUrl: `https://anilist.co/anime/${id}`,
    startDate: { year: 2015 },
    format: 'TV',
    status: 'FINISHED',
    popularity: 1000,
    stats: { statusDistribution: [] },
    tags: [],
    relations: { edges: [] },
    recommendations: { nodes: [] },
    ...overrides,
  }
}

const page = (...media: unknown[]) => ({ data: { Page: { media } } })

describe('Catch-up candidate query', () => {
  it('asks for up to 50 anime per request by id, with relations, recommendations, tags and status distribution', async () => {
    const ids = Array.from({ length: 120 }, (_, i) => i + 1)
    const { fetch, calls } = fakeFetch(
      { json: page(...ids.slice(0, 50).map((id) => rawMedia(id))) },
      { json: page(...ids.slice(50, 100).map((id) => rawMedia(id))) },
      { json: page(...ids.slice(100).map((id) => rawMedia(id))) },
    )

    const media = await fetchCatchUpMedia({ fetch, token: 'tok' }, ids)

    expect(media.map((m) => m.id)).toEqual(ids)
    expect(calls.map((c) => (c.body.variables.ids as number[]).length)).toEqual([50, 50, 20])
    for (const call of calls) {
      expect(new Headers(call.init.headers).get('Authorization')).toBe('Bearer tok')
      expect(call.body.variables.perPage).toBe(50)
      expect(call.body.query).toContain('id_in: $ids')
      expect(call.body.query).toContain('type: ANIME')
      expect(call.body.query).toMatch(/relations\s*\{/)
      expect(call.body.query).toMatch(/recommendations\([^)]*sort: RATING_DESC/)
      expect(call.body.query).toMatch(/tags\s*\{/)
      expect(call.body.query).toMatch(/statusDistribution\s*\{\s*status\s+amount\s*\}/)
      expect(call.body.query).toMatch(/\bsiteUrl\b/)
    }
  })

  it('makes no request for no ids, and asks for each id once', async () => {
    const empty = fakeFetch()
    expect(await fetchCatchUpMedia({ fetch: empty.fetch, token: 't' }, [])).toEqual([])
    expect(empty.calls).toHaveLength(0)

    const { fetch, calls } = fakeFetch({ json: page(rawMedia(1), rawMedia(2)) })
    await fetchCatchUpMedia({ fetch, token: 't' }, [1, 2, 1, 2])
    expect(calls[0].body.variables.ids).toEqual([1, 2])
  })

  it('maps each media to what Catch-up needs, with watched-popularity excluding Planning', async () => {
    const { fetch } = fakeFetch({
      json: page(
        rawMedia(7, {
          title: { romaji: 'Shingeki no Kyojin', english: 'Attack on Titan', native: '進撃の巨人' },
          coverImage: { large: 'https://img/7.jpg', color: null },
          startDate: { year: 2013 },
          format: 'TV',
          status: 'FINISHED',
          popularity: 1_063_311,
          stats: {
            statusDistribution: [
              { status: 'CURRENT', amount: 66_331 },
              { status: 'PLANNING', amount: 72_755 },
              { status: 'COMPLETED', amount: 890_927 },
              { status: 'DROPPED', amount: 16_717 },
              { status: 'PAUSED', amount: 16_581 },
            ],
          },
          tags: [
            { name: 'Military', rank: 92 },
            { name: 'Survival', rank: 80 },
          ],
          relations: {
            edges: [
              { relationType: 'SEQUEL', node: { id: 8, type: 'ANIME' } },
              { relationType: 'SOURCE', node: { id: 900, type: 'MANGA' } },
            ],
          },
          recommendations: {
            nodes: [
              { rating: 2893, mediaRecommendation: { id: 20 } },
              { rating: 12, mediaRecommendation: null },
            ],
          },
        }),
      ),
    })

    const [only] = await fetchCatchUpMedia({ fetch, token: 't' }, [7])

    expect(only).toEqual({
      id: 7,
      title: { romaji: 'Shingeki no Kyojin', english: 'Attack on Titan', native: '進撃の巨人' },
      coverUrl: 'https://img/7.jpg',
      coverColor: null,
      siteUrl: 'https://anilist.co/anime/7',
      year: 2013,
      format: 'TV',
      status: 'FINISHED',
      watched: 1_063_311 - 72_755,
      tags: [
        { name: 'Military', rank: 92 },
        { name: 'Survival', rank: 80 },
      ],
      // Relations to manga and novels are left out: Catch-up is anime only.
      relations: [{ type: 'SEQUEL', mediaId: 8 }],
      recommendations: [{ mediaId: 20, rating: 2893 }],
    })
  })

  it('reports a 429 as rate-limited, passing on the reset header', async () => {
    const { fetch } = fakeFetch({
      status: 429,
      json: { errors: [{ message: 'Too Many Requests.', status: 429 }] },
      headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': '1760000060' },
    })
    const seen: unknown[] = []

    const error = await fetchCatchUpMedia({ fetch, token: 't', onRateLimit: (r) => seen.push(r) }, [1]).catch(
      (e: unknown) => e,
    )

    expect(error).toBeInstanceOf(AniListError)
    expect((error as AniListError).kind).toBe('rate-limited')
    expect(seen).toEqual([{ remaining: 0, resetAt: 1760000060 }])
  })

  it('stops at the first rate-limited request without asking for later pages', async () => {
    const { fetch, calls } = fakeFetch(
      { json: page(...Array.from({ length: 50 }, (_, i) => rawMedia(i + 1))) },
      { status: 429, json: { errors: [{ message: 'Too Many Requests.', status: 429 }] } },
    )

    const ids = Array.from({ length: 150 }, (_, i) => i + 1)
    await expect(fetchCatchUpMedia({ fetch, token: 't' }, ids)).rejects.toMatchObject({ kind: 'rate-limited' })
    expect(calls).toHaveLength(2)
  })
})

describe('Catch-up popular-in-era query', () => {
  it('asks for the most popular anime that started within the era, with everything the suggestions score from', async () => {
    const { fetch, calls } = fakeFetch(
      { json: page(rawMedia(1), rawMedia(2)) },
      { json: page(rawMedia(3)) },
    )

    const media = await fetchPopularAnime({ fetch, token: 'tok' }, { from: 2010, to: 2016 }, 2)

    expect(media.map((m) => m.id)).toEqual([1, 2, 3])
    expect(calls.map((c) => c.body.variables.page)).toEqual([1, 2])
    for (const call of calls) {
      expect(call.body.query).toContain('sort: POPULARITY_DESC')
      expect(call.body.query).toContain('type: ANIME')
      expect(call.body.query).toContain('isAdult: false')
      expect(call.body.query).toMatch(/relations\s*\{/)
      expect(call.body.query).toMatch(/statusDistribution\s*\{\s*status\s+amount\s*\}/)
      // FuzzyDateInt bounds are exclusive: after the end of 2009, before 2017.
      expect(call.body.variables).toMatchObject({ perPage: 50, from: 20091231, to: 20170000 })
    }
  })

  it('asks for all-time favourites without an era', async () => {
    const { fetch, calls } = fakeFetch({ json: page(rawMedia(1)) })

    await fetchPopularAnime({ fetch, token: 't' }, null, 1)

    expect(calls[0].body.variables.from).toBeUndefined()
    expect(calls[0].body.variables.to).toBeUndefined()
  })
})
