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
// The expected S values below come from the Python prototype run on the same list
// (scripts/top-studio-score/prototype.py --json).
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
  it('ranks studios by Studio Score, love count included, as the prototype does', async () => {
    const result = await load(handMadeList())

    // Three studios can't make ten at any gate, so the gate is down to 4 and Tiny Studio waits on the watchlist.
    expect(names(result)).toEqual(['Swing Studio', 'Safe Studio', 'Middle Studio'])
    expect(result.gate).toBe(4)
    expect(scoreOf(result, SWING)).toBeCloseTo(0.088691958, 6)
    expect(scoreOf(result, SAFE)).toBeCloseTo(-0.044711236, 6)
    expect(scoreOf(result, MIDDLE)).toBeCloseTo(-0.161777001, 6)
    expect(result.watchlist.map((s) => [s.name, s.score])).toEqual([['Tiny Studio', expect.closeTo(0.351384448, 6)]])
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

describe('loadTopStudios: love count', () => {
  // Six titles at 9, 9, 9, 5, 5, 5 for each studio: mean 7, SD 2, so a 9 is z +1 (loved) and a 5 is z −1.
  const sixTitles = (studio: Studio, firstId: number, relations: Array<Array<[string, number]>> = []) =>
    [9, 9, 9, 5, 5, 5].map((s, i) => entry(s, studio, { relations: relations[i] }, firstId + i))
  const chain = (firstId: number, length: number) =>
    Array.from({ length }, (_, i) => [
      ...(i > 0 ? [['PREQUEL', firstId + i - 1] as [string, number]] : []),
      ...(i < length - 1 ? [['SEQUEL', firstId + i + 1] as [string, number]] : []),
    ])

  it('lifts a studio with more loved works over one with the same votes whose loved titles are one franchise', async () => {
    const result = await load([...sixTitles(SAFE, 2000, chain(2000, 3)), ...sixTitles(SWING, 3000)])

    expect(names(result)).toEqual(['Swing Studio', 'Safe Studio'])
    expect(scoreOf(result, SWING)! - scoreOf(result, SAFE)!).toBeGreaterThan(0.01)
  })

  it('counts each favourite on its own when a franchise holds two or more (fav split)', async () => {
    const result = await load(
      [
        ...sixTitles(SAFE, 2000, chain(2000, 2)), // two favourites joined by SEQUEL
        ...sixTitles(SWING, 3000), // the same two favourites, not joined
        ...sixTitles(MIDDLE, 4000, chain(4000, 2)), // joined, no favourites
        ...sixTitles(TINY, 5000), // not joined, no favourites
      ],
      [2000, 2001, 3000, 3001],
    )

    expect(scoreOf(result, SAFE)).toBeCloseTo(scoreOf(result, SWING)!, 12)
    expect(scoreOf(result, MIDDLE)!).toBeLessThan(scoreOf(result, TINY)!)
  })

  it('joins titles into a franchise only within one studio', async () => {
    // The same SEQUEL chain, but the sequel is another studio's title: each studio keeps its own love.
    const linked = await load([...sixTitles(SAFE, 2000, chain(2000, 1)), ...sixTitles(SWING, 3000)])
    const crossStudio = await load([
      entry(9, SAFE, { relations: [['SEQUEL', 3000]] }, 2000),
      ...sixTitles(SAFE, 2000).slice(1),
      entry(9, SWING, { relations: [['PREQUEL', 2000]] }, 3000),
      ...sixTitles(SWING, 3000).slice(1),
    ])

    expect(scoreOf(crossStudio, SAFE)).toBeCloseTo(scoreOf(linked, SAFE)!, 12)
    expect(scoreOf(crossStudio, SWING)).toBeCloseTo(scoreOf(linked, SWING)!, 12)
  })
})

describe('loadTopStudios: gate and watchlist', () => {
  // Studios of the given sizes, numbered from 10. Studio i scores 6, 7, 8, ... shifted by i/10, so they differ in S.
  function studiosOfSize(...sizes: number[]) {
    nextId = 1000
    return sizes.flatMap((size, i) => {
      const studio: Studio = [10 + i, `Studio ${10 + i}`]
      return Array.from({ length: size }, (_, j) => entry(6 + (j % 3) + i / 10, studio))
    })
  }
  const sizes = (result: TopStudios) => result.studios.map((s) => s.votes.length)

  it('keeps the gate at 6 when ten studios pass it', async () => {
    const result = await load(studiosOfSize(...Array(10).fill(6), 5))

    expect(result.gate).toBe(6)
    expect(sizes(result)).toHaveLength(10)
  })

  it('lowers the gate to 5 when fewer than ten studios pass at 6', async () => {
    const result = await load(studiosOfSize(...Array(9).fill(6), 5, 4))

    expect(result.gate).toBe(5)
    expect(sizes(result).sort()).toEqual([5, ...Array(9).fill(6)])
  })

  it('lowers the gate to 4 when fewer than ten pass at 5', async () => {
    const result = await load(studiosOfSize(...Array(9).fill(6), 4, 3))

    expect(result.gate).toBe(4)
    expect(sizes(result)).toHaveLength(10)
  })

  it('never lowers the gate below 4, however few studios pass', async () => {
    const result = await load(studiosOfSize(6, 6, 6, 3, 3))

    expect(result.gate).toBe(4)
    expect(sizes(result)).toEqual([6, 6, 6])
    expect(result.watchlist.map((s) => s.votes.length)).toEqual([3, 3])
  })

  it('puts the best five studios below the gate on the watchlist, best first', async () => {
    const result = await load(studiosOfSize(...Array(10).fill(6), 5, 5, 5, 5, 5, 5, 5))

    expect(result.watchlist).toHaveLength(5)
    expect(result.watchlist.every((s) => s.votes.length < result.gate)).toBe(true)
    // Studios 20–26 differ only by their shift, so the best five are 26 down to 22.
    expect(result.watchlist.map((s) => s.name)).toEqual(['Studio 26', 'Studio 25', 'Studio 24', 'Studio 23', 'Studio 22'])
    expect(result.studios.every((s) => s.votes.length >= result.gate)).toBe(true)
  })
})

describe('loadTopStudios: labels', () => {
  const ELITE: Studio = [21, 'Elite Studio']
  const BOLD: Studio = [22, 'Bold Studio']
  const RELIABLE: Studio = [23, 'Reliable Studio']
  const MEH: Studio = [24, 'Meh Studio']
  const NEAR: Studio = [25, 'Near Studio']

  // Ten titles: `hits` at 10, `flops` at 1, the rest at 5.5. Across these lists a 10 sits at z ≥ +1.6 (a hit,
  // z ≥ 1.2), a 1 at z ≤ −1.6 (a flop, z ≤ −1) and a 5.5 near z 0 (neither).
  const tenTitles = (studio: Studio, hits: number, flops: number) =>
    Array.from({ length: 10 }, (_, i) => entry(i < hits ? 10 : i < hits + flops ? 1 : 5.5, studio))
  const fourCorners = () => [
    ...tenTitles(ELITE, 3, 0),
    ...tenTitles(BOLD, 3, 3),
    ...tenTitles(RELIABLE, 0, 0),
    ...tenTitles(MEH, 0, 3),
  ]
  const studio = (result: TopStudios, [id]: Studio) => result.studios.find((s) => s.id === id)!

  it('labels each studio from its hit and flop rates against the pooled rates of the ranked studios', async () => {
    // Pooled: 6 hits and 6 flops in 40 titles, 15% each; a rate is high above 21%.
    const result = await load(fourCorners())

    expect(studio(result, ELITE)).toMatchObject({ label: 'elite', hitRate: 0.3, flopRate: 0 })
    expect(studio(result, BOLD)).toMatchObject({ label: 'bold', hitRate: 0.3, flopRate: 0.3 })
    expect(studio(result, RELIABLE)).toMatchObject({ label: 'reliable', hitRate: 0, flopRate: 0 })
    expect(studio(result, MEH)).toMatchObject({ label: 'meh', hitRate: 0, flopRate: 0.3 })
  })

  it('counts a rate as high only 6 points above the pool', async () => {
    // Pooled hit rate 8 in 50 = 16%: Near's 20% is above it but under 22%, so it stays low.
    const result = await load([...fourCorners(), ...tenTitles(NEAR, 2, 0)])

    expect(studio(result, NEAR)).toMatchObject({ label: 'reliable', hitRate: 0.2 })
    expect(studio(result, ELITE).label).toBe('elite')
  })

  it('pools only the top 20 ranked studios', async () => {
    // 19 plain studios and Bold make the top 20, with 1 flop in 200 titles; five all-flop studios rank below them.
    // Pooled over the top 20, Bold's 10% flops read high; pooled over all 25 (51 in 250) they wouldn't.
    nextId = 1000
    const plain = Array.from({ length: 19 }, (_, i) => tenTitles([100 + i, `Plain ${i}`], 1, 0)).flat()
    const flopping = Array.from({ length: 5 }, (_, i) => tenTitles([200 + i, `Flopping ${i}`], 0, 10)).flat()
    const result = await load([...plain, ...tenTitles(BOLD, 2, 1), ...flopping])

    expect(result.studios).toHaveLength(25)
    expect(result.studios.slice(20).every((s) => s.name.startsWith('Flopping'))).toBe(true)
    expect(studio(result, BOLD)).toMatchObject({ label: 'bold', hitRate: 0.2, flopRate: 0.1 })
  })

  it('labels the watchlist too', async () => {
    const result = await load([...fourCorners(), entry(10, TINY), entry(10, TINY)])

    expect(result.watchlist).toEqual([expect.objectContaining({ name: 'Tiny Studio', label: 'elite', hitRate: 1 })])
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
    expect(safe.votes.at(-1)?.z).toBeCloseTo(-1, 12)
    expect(scoreOf(withDrop, SAFE)!).toBeLessThan(scoreOf(base, SAFE)!)
  })

  it('counts an unscored rewatch in the studio’s favour at z +0.5', async () => {
    const withRewatch = await load([...handMadeList(), entry(0, MIDDLE, { repeat: 1 })])
    const middle = withRewatch.studios.find((s) => s.id === MIDDLE[0])!

    expect(middle.votes).toHaveLength(7)
    expect(middle.votes.at(-1)?.z).toBeCloseTo(0.5, 12)
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

  it('says when the token it was given is no longer valid', async () => {
    const { fetch } = fakeFetch({ status: 400, json: { data: null, errors: [{ message: 'Invalid token', status: 400 }] } })
    expect(await loadTopStudios({ fetch, token: 'old' }, 'zen')).toEqual({ ok: false, failure: { kind: 'invalid-token' } })
  })
})
