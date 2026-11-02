import { describe, expect, it } from 'vitest'
import { loadTopStudios, type TopStudios, type TopStudiosLoad } from './loadTopStudios.ts'

type Call = { url: string; init: RequestInit; body: { query: string; variables: Record<string, unknown> } }
type Canned = { status?: number; json: unknown }

// A fake `fetch` that records every request and answers from a queue of responses.
function fakeFetch(...responses: Canned[]) {
  const calls: Call[] = []
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {}, body: JSON.parse(String(init?.body)) })
    const next = responses.shift()
    if (!next) throw new Error('unexpected request')
    return new Response(JSON.stringify(next.json), {
      status: next.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return { fetch: fetch as typeof globalThis.fetch, calls }
}

type Studio = [id: number, name: string]
const SWING: Studio = [1, 'Swing Studio']
const SAFE: Studio = [2, 'Safe Studio']
const MIDDLE: Studio = [3, 'Middle Studio']
const TINY: Studio = [4, 'Tiny Studio']
const PARTNER: Studio = [9, 'Partner Studio']

type EntryOptions = {
  status?: string
  score?: number
  progress?: number | null
  repeat?: number
  episodes?: number | null
  duration?: number | null
  studios?: Studio[]
  otherStudios?: Studio[]
  relations?: Array<[type: string, mediaId: number]>
}

let nextId = 1000
// One entry the way AniList's MediaListCollection returns it.
function entry(score: number, studio: Studio, options: EntryOptions = {}, mediaId = nextId++) {
  return {
    mediaId,
    status: options.status ?? 'COMPLETED',
    score: options.score ?? score,
    progress: options.progress === undefined ? (options.episodes ?? 12) : options.progress,
    repeat: options.repeat ?? 0,
    media: {
      id: mediaId,
      title: { romaji: `Title ${mediaId}`, english: null, native: null },
      coverImage: { large: `https://img/${mediaId}.jpg`, color: '#e4a15d' },
      bannerImage: null,
      siteUrl: `https://anilist.co/anime/${mediaId}`,
      episodes: options.episodes === undefined ? 12 : options.episodes,
      duration: options.duration === undefined ? 24 : options.duration,
      studios: {
        edges: [
          ...(options.studios ?? [studio]).map(([id, name]) => ({ isMain: true, node: { id, name } })),
          ...(options.otherStudios ?? []).map(([id, name]) => ({ isMain: false, node: { id, name } })),
        ],
      },
      relations: { edges: (options.relations ?? []).map(([relationType, id]) => ({ relationType, node: { id } })) },
    },
  }
}

// The hand-made list: a studio that swings, one that plays safe, one in between, and one too small to rank.
// The expected S values below come from the Python prototype at γ = 0 run on the same list
// (scripts/top-studio-score/prototype.py; the love count arrives in #90).
function handMadeList() {
  nextId = 1000
  return [
    ...[10, 9.5, 4, 5, 3, 6].map((s) => entry(s, SWING)),
    ...[7.5, 7.5, 8, 7, 7.5, 8].map((s) => entry(s, SAFE)),
    ...[7, 6, 8, 6.5, 7, 5].map((s) => entry(s, MIDDLE)),
    ...[10, 10].map((s) => entry(s, TINY)),
  ]
}

function listChunk(hasNextChunk: boolean, entries: unknown[]): Canned {
  return { json: { data: { MediaListCollection: { hasNextChunk, lists: [{ entries }] } } } }
}

function favouritesPage(hasNextPage: boolean, ids: number[]): Canned {
  return {
    json: { data: { User: { favourites: { anime: { pageInfo: { hasNextPage }, nodes: ids.map((id) => ({ id })) } } } } },
  }
}

async function load(entries: unknown[], favourites: number[] = []): Promise<TopStudios> {
  const { fetch } = fakeFetch(listChunk(false, entries), favouritesPage(false, favourites))
  return ranked(await loadTopStudios({ fetch, token: null }, 'zen'))
}

function ranked(loaded: TopStudiosLoad): TopStudios {
  if (!loaded.ok) throw new Error(`expected a ranking, got ${loaded.failure.kind}`)
  return loaded.topStudios
}

const scoreOf = (result: TopStudios, studio: Studio) => result.studios.find((s) => s.id === studio[0])?.score
const names = (result: TopStudios) => result.studios.map((s) => s.name)

describe('loadTopStudios: ranking', () => {
  it('ranks studios with at least 6 entries by Studio Score, as the prototype does', async () => {
    const result = await load(handMadeList())

    expect(names(result)).toEqual(['Swing Studio', 'Safe Studio', 'Middle Studio'])
    expect(result.gate).toBe(6)
    expect(scoreOf(result, SWING)).toBeCloseTo(-0.017663909, 6)
    expect(scoreOf(result, SAFE)).toBeCloseTo(-0.057027119, 6)
    expect(scoreOf(result, MIDDLE)).toBeCloseTo(-0.167082039, 6)
  })

  it('a studio that swings beats one that plays safe on the same average', async () => {
    nextId = 1000
    // Both average 7; filler studios bring the list to ten scored titles.
    const result = await load([
      ...[10, 10, 5, 5, 6, 6].map((s) => entry(s, SWING)),
      ...[7, 7, 7, 7, 7, 7].map((s) => entry(s, SAFE)),
      ...[7, 7].map((s) => entry(s, TINY)),
    ])

    expect(names(result)).toEqual(['Swing Studio', 'Safe Studio'])
  })

  it('gives each counted title of a studio its z and weight, and the user its average vote utility', async () => {
    const result = await load(handMadeList())
    const swing = result.studios[0]

    expect(swing.votes).toHaveLength(6)
    expect(swing.votes.map((v) => v.title.score)).toEqual([10, 9.5, 4, 5, 3, 6])
    // From the prototype: mean 7.125, SD 1.8965, so a 10 sits at z +1.516; Ū = 1.6207.
    expect(result.scale.mean).toBeCloseTo(7.125, 9)
    expect(result.scale.sd).toBeCloseTo(1.896542908, 6)
    expect(swing.votes[0].z).toBeCloseTo(1.516, 3)
    expect(result.averageUtility).toBeCloseTo(1.620706286, 6)
  })

  it('rescales vote weights so the mean W over every vote of every studio is 1, mid-scores at half weight', async () => {
    const result = await load(handMadeList())
    const swing = result.studios[0]
    const safe = result.studios[1]

    // All titles are 12 × 24 min; an 8 (z +0.46) is a mid-score, so its w is halved and its W is √½ of the others.
    expect(swing.votes[0].weight).toBeCloseTo(1.17, 2)
    expect(safe.votes[2].weight / swing.votes[0].weight).toBeCloseTo(Math.SQRT1_2, 9)
  })
})

describe('loadTopStudios: which entries count', () => {
  it('ignores Planning titles', async () => {
    const base = await load(handMadeList())
    const withPlanning = await load([...handMadeList(), entry(10, SAFE, { status: 'PLANNING', progress: 0 })])

    expect(withPlanning).toEqual(base)
  })

  it('leaves out unscored completed, current and paused titles', async () => {
    const base = await load(handMadeList())
    const withUnscored = await load([
      ...handMadeList(),
      entry(0, SWING),
      entry(0, SWING, { status: 'CURRENT', progress: 6 }),
      entry(0, SWING, { status: 'PAUSED', progress: 6 }),
    ])

    expect(withUnscored.studios).toEqual(base.studios)
    expect(withUnscored.averageUtility).toBe(base.averageUtility)
  })

  it('counts an unscored drop against the studio at z −1', async () => {
    const base = await load(handMadeList())
    const withDrop = await load([...handMadeList(), entry(0, SAFE, { status: 'DROPPED', progress: 3 })])
    const safe = withDrop.studios.find((s) => s.id === SAFE[0])!

    expect(safe.votes).toHaveLength(7)
    expect(safe.votes.at(-1)?.z).toBe(-1)
    expect(scoreOf(withDrop, SAFE)!).toBeLessThan(scoreOf(base, SAFE)!)
  })

  it('counts an unscored rewatch in the studio’s favour at z +0.5', async () => {
    const withRewatch = await load([...handMadeList(), entry(0, MIDDLE, { repeat: 1 })])
    const middle = withRewatch.studios.find((s) => s.id === MIDDLE[0])!

    expect(middle.votes).toHaveLength(7)
    expect(middle.votes.at(-1)?.z).toBe(0.5)
  })

  it('weighs a dropped title by the episodes watched', async () => {
    const droppedEarly = await load([
      ...handMadeList(),
      entry(2, SAFE, { status: 'DROPPED', episodes: 24, progress: 1 }),
    ])
    const droppedLate = await load([
      ...handMadeList(),
      entry(2, SAFE, { status: 'DROPPED', episodes: 24, progress: 23 }),
    ])

    expect(scoreOf(droppedEarly, SAFE)!).toBeGreaterThan(scoreOf(droppedLate, SAFE)!)
  })

  it('gives favourite anime a bonus', async () => {
    const list = handMadeList()
    const base = await load(list)
    const withFavourite = await load(list, [list[6].mediaId])
    const vote = (r: TopStudios) => r.studios.find((s) => s.id === SAFE[0])!.votes[0]

    expect(vote(withFavourite).favourite).toBe(true)
    expect(vote(withFavourite).z - vote(base).z).toBeCloseTo(0.5, 9)
  })

  it('credits only main studios, in full, even though AniList returns the others', async () => {
    const base = await load(handMadeList())
    nextId = 1000
    const withPartners = await load([
      ...[10, 9.5, 4, 5, 3, 6].map((s) => entry(s, SWING, { otherStudios: [PARTNER] })),
      ...[7.5, 7.5, 8, 7, 7.5, 8].map((s) => entry(s, SAFE, { otherStudios: [PARTNER] })),
      ...[7, 6, 8, 6.5, 7, 5].map((s) => entry(s, MIDDLE)),
      ...[10, 10].map((s) => entry(s, TINY)),
    ])

    expect(names(withPartners)).toEqual(names(base))
    expect(scoreOf(withPartners, SWING)).toBeCloseTo(scoreOf(base, SWING)!, 12)
  })

  it('gives a co-produced title full credit at each main studio', async () => {
    nextId = 1000
    const result = await load([
      ...handMadeList(),
      entry(9, SWING, { studios: [SWING, SAFE] }),
    ])

    expect(result.studios.find((s) => s.id === SWING[0])!.votes).toHaveLength(7)
    expect(result.studios.find((s) => s.id === SAFE[0])!.votes).toHaveLength(7)
  })
})

describe('loadTopStudios: how much of the list is scored', () => {
  it('counts the titles that count toward a studio, and the scored ones among them', async () => {
    const result = await load([
      ...handMadeList(),
      entry(0, SWING, { status: 'DROPPED', progress: 3 }),
      entry(0, MIDDLE, { repeat: 1 }),
      entry(8, SAFE, { studios: [] }),
      entry(0, SAFE),
      entry(0, SAFE, { status: 'PLANNING' }),
    ])

    // 20 scored + a studio-less scored title + an unscored drop and rewatch; the unscored completed and Planning ones don't count.
    expect(result.countedCount).toBe(23)
    expect(result.countedScoredCount).toBe(21)
  })
})

describe('loadTopStudios: reading AniList', () => {
  it('follows list chunks and favourites pages to the end', async () => {
    const list = handMadeList()
    const { fetch, calls } = fakeFetch(
      listChunk(true, list.slice(0, 10)),
      listChunk(false, list.slice(10)),
      favouritesPage(true, [1]),
      favouritesPage(false, [list[0].mediaId]),
    )

    const result = ranked(await loadTopStudios({ fetch, token: null }, 'zen'))

    expect(calls.map((c) => c.body.variables)).toEqual([
      { userName: 'zen', chunk: 1, perChunk: 500 },
      { userName: 'zen', chunk: 2, perChunk: 500 },
      { userName: 'zen', page: 1 },
      { userName: 'zen', page: 2 },
    ])
    expect(result.studios.flatMap((s) => s.votes)).toHaveLength(18)
    expect(result.studios[0].votes[0].favourite).toBe(true)
  })

  it('asks for scores on the 10-point decimal scale and for main-studio flags', async () => {
    const { fetch, calls } = fakeFetch(listChunk(false, handMadeList()), favouritesPage(false, []))
    await loadTopStudios({ fetch, token: null }, 'zen')

    expect(calls[0].body.query).toContain('score(format: POINT_10_DECIMAL)')
    expect(calls[0].body.query).toContain('isMain')
  })

  it('sends the token only when given one', async () => {
    const anonymous = fakeFetch(listChunk(false, handMadeList()), favouritesPage(false, []))
    await loadTopStudios({ fetch: anonymous.fetch, token: null }, 'zen')
    const signedIn = fakeFetch(listChunk(false, handMadeList()), favouritesPage(false, []))
    await loadTopStudios({ fetch: signedIn.fetch, token: 'tok' }, 'zen')

    expect(anonymous.calls.every((c) => !new Headers(c.init.headers).has('Authorization'))).toBe(true)
    expect(signedIn.calls.every((c) => new Headers(c.init.headers).get('Authorization') === 'Bearer tok')).toBe(true)
  })
})

describe('loadTopStudios: when it cannot rank', () => {
  async function failure(...responses: Canned[]) {
    const { fetch } = fakeFetch(...responses)
    const loaded = await loadTopStudios({ fetch, token: null }, 'zen')
    if (loaded.ok) throw new Error('expected a failure')
    return loaded.failure
  }

  it('says when there is no such AniList user', async () => {
    const notFound = { status: 404, json: { data: { MediaListCollection: null }, errors: [{ message: 'User not found', status: 404 }] } }
    expect(await failure(notFound)).toEqual({ kind: 'no-such-user' })
  })

  it('says when the list is private', async () => {
    const privateUser = { status: 401, json: { data: { MediaListCollection: null }, errors: [{ message: 'Private User', status: 401 }] } }
    expect(await failure(privateUser)).toEqual({ kind: 'private-list' })
  })

  it('says when fewer than 10 titles are scored', async () => {
    nextId = 1000
    const nine = [9, 8, 7, 6, 5, 4, 3, 2, 1].map((s) => entry(s, SWING))
    expect(await failure(listChunk(false, [...nine, entry(0, SWING)]), favouritesPage(false, []))).toEqual({
      kind: 'too-few-scored',
      scored: 9,
    })
  })

  it('says when AniList is rate-limiting', async () => {
    expect(await failure({ status: 429, json: { errors: [{ message: 'Too Many Requests.', status: 429 }] } })).toEqual({
      kind: 'rate-limited',
    })
  })

  it('says when AniList is unreachable', async () => {
    const fetch = (async () => {
      throw new TypeError('Failed to fetch')
    }) as typeof globalThis.fetch
    expect(await loadTopStudios({ fetch, token: null }, 'zen')).toEqual({ ok: false, failure: { kind: 'unreachable' } })
  })

  it('tells a missing user and a private list apart from other AniList errors', async () => {
    const broken = { status: 500, json: { data: null, errors: [{ message: 'Internal Server Error', status: 500 }] } }
    expect(await failure(broken)).toEqual({ kind: 'api', message: 'Internal Server Error' })
  })

  it('says a list is private when AniList refuses it even with a token', async () => {
    const privateUser = { status: 401, json: { data: { MediaListCollection: null }, errors: [{ message: 'Private User', status: 401 }] } }
    const { fetch, calls } = fakeFetch(privateUser)
    expect(await loadTopStudios({ fetch, token: 'tok' }, 'friend')).toEqual({ ok: false, failure: { kind: 'private-list' } })
    expect(calls).toHaveLength(1)
  })
})

describe('loadTopStudios: a token AniList refuses', () => {
  it('loads the list again without the token', async () => {
    const refused = { status: 400, json: { data: null, errors: [{ message: 'Invalid token', status: 400 }] } }
    const { fetch, calls } = fakeFetch(refused, listChunk(false, handMadeList()), favouritesPage(false, []))
    const loaded = await loadTopStudios({ fetch, token: 'old' }, 'zen')

    expect(names(ranked(loaded))).toEqual(['Swing Studio', 'Safe Studio', 'Middle Studio'])
    expect(new Headers(calls[0].init.headers).get('Authorization')).toBe('Bearer old')
    expect(calls.slice(1).every((c) => !new Headers(c.init.headers).has('Authorization'))).toBe(true)
  })

  it('says the list is private when it can’t be read without the token either', async () => {
    const refused = { status: 400, json: { data: null, errors: [{ message: 'Invalid token', status: 400 }] } }
    const privateUser = { status: 401, json: { data: { MediaListCollection: null }, errors: [{ message: 'Private User', status: 401 }] } }
    const { fetch } = fakeFetch(refused, privateUser)
    expect(await loadTopStudios({ fetch, token: 'old' }, 'zen')).toEqual({ ok: false, failure: { kind: 'private-list' } })
  })
})
