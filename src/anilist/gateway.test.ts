import { describe, expect, it } from 'vitest'
import { AniListError, createAniListGateway } from './gateway.ts'

type Call = { url: string; init: RequestInit; body: { query: string; variables: Record<string, unknown> } }

// A fake `fetch` that records every request and answers from a queue of responses.
function fakeFetch(...responses: Array<{ status?: number; json: unknown; headers?: Record<string, string> }>) {
  const calls: Call[] = []
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {}, body: JSON.parse(String(init?.body)) })
    const next = responses.shift()
    if (!next) throw new Error('unexpected request')
    return new Response(JSON.stringify(next.json), {
      status: next.status ?? 200,
      headers: { 'Content-Type': 'application/json', ...next.headers },
    })
  }
  return { fetch: fetch as typeof globalThis.fetch, calls }
}

const viewerResponse = {
  data: {
    Viewer: {
      id: 42,
      name: 'zen',
      avatar: { medium: 'https://img/avatar.png' },
      options: { titleLanguage: 'ENGLISH' },
      mediaListOptions: { scoreFormat: 'POINT_5' },
    },
  },
}

function entry(mediaId: number, overrides: Record<string, unknown> = {}) {
  return {
    mediaId,
    status: 'COMPLETED',
    score: 0,
    completedAt: { year: null, month: null, day: null },
    media: {
      title: { romaji: `Romaji ${mediaId}`, english: null, native: null },
      coverImage: { large: `https://img/${mediaId}.jpg`, color: '#e4a15d' },
      bannerImage: null,
      startDate: { year: 2020 },
      format: 'TV',
      episodes: 12,
      chapters: null,
      siteUrl: `https://anilist.co/anime/${mediaId}`,
    },
    ...overrides,
  }
}

function chunk(hasNextChunk: boolean, ...lists: unknown[][]) {
  return { data: { MediaListCollection: { hasNextChunk, lists: lists.map((entries) => ({ entries })) } } }
}

describe('AniList Gateway: Viewer', () => {
  it('sends the token as a Bearer auth header to the AniList GraphQL endpoint', async () => {
    const { fetch, calls } = fakeFetch({ json: viewerResponse })
    const gateway = createAniListGateway({ fetch, token: 'tok-123' })

    await gateway.viewer()

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://graphql.anilist.co')
    expect(calls[0].init.method).toBe('POST')
    const headers = new Headers(calls[0].init.headers)
    expect(headers.get('Authorization')).toBe('Bearer tok-123')
    expect(headers.get('Content-Type')).toBe('application/json')
  })

  it('loads the user id, name, title language and Score Format', async () => {
    const { fetch } = fakeFetch({ json: viewerResponse })
    const gateway = createAniListGateway({ fetch, token: 't' })

    expect(await gateway.viewer()).toEqual({
      id: 42,
      name: 'zen',
      avatarUrl: 'https://img/avatar.png',
      titleLanguage: 'ENGLISH',
      scoreFormat: 'POINT_5',
    })
  })

  it('reports an expired or revoked token as an auth error', async () => {
    const { fetch } = fakeFetch({ status: 401, json: { errors: [{ message: 'Invalid token', status: 401 }] } })
    const gateway = createAniListGateway({ fetch, token: 'old' })

    const error = await gateway.viewer().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AniListError)
    expect((error as AniListError).kind).toBe('auth')
  })

  it('reports a malformed token (AniList answers 400 "Invalid token") as an auth error', async () => {
    const { fetch } = fakeFetch({ status: 400, json: { data: null, errors: [{ message: 'Invalid token', status: 400 }] } })
    const gateway = createAniListGateway({ fetch, token: 'garbage' })

    const error = await gateway.viewer().catch((e: unknown) => e)
    expect((error as AniListError).kind).toBe('auth')
  })

  it('reports a network failure as unreachable', async () => {
    const fetch = (async () => {
      throw new TypeError('Failed to fetch')
    }) as typeof globalThis.fetch
    const gateway = createAniListGateway({ fetch, token: 't' })

    const error = await gateway.viewer().catch((e: unknown) => e)
    expect((error as AniListError).kind).toBe('unreachable')
  })
})

describe('AniList Gateway: list', () => {
  it('follows hasNextChunk until the whole list is loaded', async () => {
    const { fetch, calls } = fakeFetch(
      { json: chunk(true, [entry(1), entry(2)]) },
      { json: chunk(true, [entry(3)]) },
      { json: chunk(false, [entry(4)]) },
    )
    const gateway = createAniListGateway({ fetch, token: 'tok' })

    const list = await gateway.mediaList({ userId: 42, type: 'ANIME', statuses: ['COMPLETED', 'REPEATING'] })

    expect(list.map((e) => e.mediaId)).toEqual([1, 2, 3, 4])
    expect(calls.map((c) => c.body.variables.chunk)).toEqual([1, 2, 3])
    for (const call of calls) {
      expect(new Headers(call.init.headers).get('Authorization')).toBe('Bearer tok')
      expect(call.body.variables).toMatchObject({
        userId: 42,
        type: 'ANIME',
        statusIn: ['COMPLETED', 'REPEATING'],
        perChunk: 500,
      })
    }
  })

  it('asks for the old score on the 100-point scale', async () => {
    const { fetch, calls } = fakeFetch({ json: chunk(false, [entry(1, { score: 85 })]) })
    const gateway = createAniListGateway({ fetch, token: 't' })

    const [only] = await gateway.mediaList({ userId: 1, type: 'ANIME', statuses: ['COMPLETED'] })

    expect(calls[0].body.query).toMatch(/score\(format:\s*POINT_100\)/)
    expect(only.oldScore100).toBe(85)
  })

  it('maps each entry to the display data later screens need', async () => {
    const { fetch } = fakeFetch({
      json: chunk(false, [
        entry(7, {
          status: 'REPEATING',
          completedAt: { year: 2024, month: 3, day: 9 },
          media: {
            title: { romaji: 'Shingeki no Kyojin', english: 'Attack on Titan', native: '進撃の巨人' },
            coverImage: { extraLarge: 'https://img/7-xl.jpg', large: 'https://img/7.jpg', color: null },
            bannerImage: 'https://img/7-banner.jpg',
            startDate: { year: 2013 },
            format: 'TV',
            episodes: 25,
            chapters: null,
            siteUrl: 'https://anilist.co/anime/7',
          },
        }),
      ]),
    })
    const gateway = createAniListGateway({ fetch, token: 't' })

    const [only] = await gateway.mediaList({ userId: 1, type: 'ANIME', statuses: ['REPEATING'] })

    expect(only).toEqual({
      mediaId: 7,
      status: 'REPEATING',
      oldScore100: 0,
      completedAt: { year: 2024, month: 3, day: 9 },
      title: { romaji: 'Shingeki no Kyojin', english: 'Attack on Titan', native: '進撃の巨人' },
      coverUrl: 'https://img/7-xl.jpg',
      coverColor: null,
      bannerUrl: 'https://img/7-banner.jpg',
      year: 2013,
      format: 'TV',
      length: 25,
      siteUrl: 'https://anilist.co/anime/7',
    })
  })

  it('uses chapters as the length of a manga', async () => {
    const manga = entry(9, {
      media: { ...entry(9).media, format: 'MANGA', episodes: null, chapters: 120 },
    })
    const { fetch } = fakeFetch({ json: chunk(false, [manga]) })
    const gateway = createAniListGateway({ fetch, token: 't' })

    const [only] = await gateway.mediaList({ userId: 1, type: 'MANGA', statuses: ['COMPLETED'] })

    expect(only.length).toBe(120)
  })

  it('lists a title once even when it also sits in a custom list', async () => {
    const { fetch } = fakeFetch({ json: chunk(false, [entry(1), entry(2)], [entry(2)]) })
    const gateway = createAniListGateway({ fetch, token: 't' })

    const list = await gateway.mediaList({ userId: 1, type: 'ANIME', statuses: ['COMPLETED'] })

    expect(list.map((e) => e.mediaId)).toEqual([1, 2])
  })

  it('surfaces the rate-limit headers from the last response', async () => {
    const { fetch } = fakeFetch({
      json: chunk(false, [entry(1)]),
      headers: { 'X-RateLimit-Remaining': '17', 'X-RateLimit-Reset': '1760000000' },
    })
    const gateway = createAniListGateway({ fetch, token: 't' })

    await gateway.mediaList({ userId: 1, type: 'ANIME', statuses: ['COMPLETED'] })

    expect(gateway.rateLimit()).toEqual({ remaining: 17, resetAt: 1760000000 })
  })
})
