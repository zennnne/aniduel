import { describe, expect, it } from 'vitest'
import { loadTopDirectors, type TopDirectors, type TopDirectorsLoad } from './loadTopDirectors.ts'

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

type Person = [id: number, name: string]
const SWING: Person = [1, 'Swing Director']
const SAFE: Person = [2, 'Safe Director']
const MIDDLE: Person = [3, 'Middle Director']
const TINY: Person = [4, 'Tiny Director']
const PARTNER: Person = [9, 'Partner Director']
const SOMEONE: Person = [50, 'Someone Else']

/** A staff credit as AniList returns it: who, and the role text. */
type Credit = [person: Person, role: string]

type EntryOptions = {
  status?: string
  score?: number
  progress?: number | null
  repeat?: number
  episodes?: number | null
  /** Every staff credit, in AniList's order; by default the one Director. */
  staff?: Credit[]
  relations?: Array<[type: string, mediaId: number]>
}

let nextId = 1000
// One entry the way AniList's MediaListCollection returns it, with the title's staff credits.
function entry(score: number, director: Person, options: EntryOptions = {}, mediaId = nextId++) {
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
      duration: 24,
      staff: {
        edges: (options.staff ?? [[director, 'Director']]).map(([[id, name], role]) => ({
          role,
          node: { id, name: { full: name }, image: { large: `https://img/staff/${id}.jpg` }, siteUrl: `https://anilist.co/staff/${id}` },
        })),
      },
      relations: { edges: (options.relations ?? []).map(([relationType, id]) => ({ relationType, node: { id } })) },
    },
  }
}

// The hand-made list of loadTopStudios.test.ts with Directors for studios: the same scores give the same S values,
// which come from the Python prototype (scripts/top-studio-score/prototype.py --json), at the Directors' k of 6.
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

async function load(entries: unknown[], favourites: number[] = []): Promise<TopDirectors> {
  const { fetch } = fakeFetch(listChunk(false, entries), favouritesPage(false, favourites))
  return ranked(await loadTopDirectors({ fetch, token: null }, 'zen'))
}

function ranked(loaded: TopDirectorsLoad): TopDirectors {
  if (!loaded.ok) throw new Error(`expected a ranking, got ${loaded.failure.kind}`)
  return loaded.result
}

const everyone = (result: TopDirectors) => [...result.ranked, ...result.watchlist]
const votesOf = (result: TopDirectors, person: Person) => everyone(result).find((d) => d.id === person[0])?.votes.length ?? 0
const names = (result: TopDirectors) => result.ranked.map((d) => d.name)

// Ten plain titles for the filler Director, so the list has a scale and the ones under test can be read off.
const filler = () => [5, 6, 7, 8, 9, 5, 6, 7, 8, 9].map((s) => entry(s, PARTNER))

describe('loadTopDirectors: who is a Director', () => {
  it('counts Director, Chief Director and Series Director, a credit for some episodes too', async () => {
    nextId = 1000
    const result = await load([
      ...filler(),
      entry(8, SWING, { staff: [[SWING, 'Director']] }),
      entry(8, SAFE, { staff: [[SAFE, 'Chief Director']] }),
      entry(8, MIDDLE, { staff: [[MIDDLE, 'Series Director']] }),
      entry(8, TINY, { staff: [[TINY, 'Director (eps 1-6)']] }),
    ])

    expect([SWING, SAFE, MIDDLE, TINY].map((p) => votesOf(result, p))).toEqual([1, 1, 1, 1])
  })

  it('leaves out episode, assistant, sound, art and animation directors, and opening and ending directors', async () => {
    nextId = 1000
    const roles = [
      'Episode Director (eps 3, 7)',
      'Assistant Director',
      'Sound Director',
      'Art Director',
      'Animation Director (ep 2)',
      'Director (OP)',
      'Director (ED1, ED2)',
      'Director (OP, ED)',
      'Director (Opening)',
    ]
    const result = await load([...filler(), ...roles.map((role) => entry(8, SOMEONE, { staff: [[SOMEONE, role]] }))])

    expect(votesOf(result, SOMEONE)).toBe(0)
  })

  it('gives every Director of a co-directed title its Vote in full', async () => {
    nextId = 1000
    const coDirected = [9, 9, 8, 8].map((s) =>
      entry(s, SWING, { staff: [[SWING, 'Director'], [SAFE, 'Chief Director']] }),
    )
    const alone = [9, 9, 8, 8].map((s) => entry(s, MIDDLE))
    const result = await load([...filler(), ...coDirected, ...alone])
    const scoreOf = (p: Person) => everyone(result).find((d) => d.id === p[0])!.score

    expect(votesOf(result, SWING)).toBe(4)
    expect(votesOf(result, SAFE)).toBe(4)
    expect(scoreOf(SWING)).toBeCloseTo(scoreOf(MIDDLE), 12)
    expect(scoreOf(SAFE)).toBeCloseTo(scoreOf(MIDDLE), 12)
  })

  it('counts a person credited twice on one title once', async () => {
    nextId = 1000
    const result = await load([
      ...filler(),
      entry(8, SWING, { staff: [[SWING, 'Director'], [SWING, 'Director (eps 1-6)'], [SWING, 'Storyboard']] }),
    ])

    expect(votesOf(result, SWING)).toBe(1)
  })

  it('counts a title with no Director for no one', async () => {
    nextId = 1000
    const result = await load([...filler(), entry(10, SWING, { staff: [[SWING, 'Episode Director']] }), entry(10, SAFE, { staff: [] })])

    expect(everyone(result).map((d) => d.name)).toEqual(['Partner Director'])
    // It still counts toward the user's scale.
    expect(result.scoredCount).toBe(12)
  })

  it('brings each Director’s name, picture and AniList link', async () => {
    nextId = 1000
    const result = await load(filler())

    expect(result.ranked[0]).toMatchObject({
      id: 9,
      name: 'Partner Director',
      image: 'https://img/staff/9.jpg',
      siteUrl: 'https://anilist.co/staff/9',
    })
  })
})

describe('loadTopDirectors: ranking', () => {
  it('ranks Directors by Director Score, love count included, as the prototype does', async () => {
    const result = await load(handMadeList())

    // Three Directors can't make ten at any gate, so the gate is down to 3 and Tiny Director waits on the watchlist.
    expect(names(result)).toEqual(['Swing Director', 'Safe Director', 'Middle Director'])
    expect(result.gate).toBe(3)
    expect(result.averageUtility).toBeCloseTo(1.620706286, 6)
    expect(result.ranked.map((d) => d.score)).toEqual([
      expect.closeTo(0.078933569, 6),
      expect.closeTo(-0.083431097, 6),
      expect.closeTo(-0.279168054, 6),
    ])
    expect(result.ranked.map((d) => d.label)).toEqual(['bold', 'reliable', 'reliable'])
    expect(result.watchlist.map((d) => [d.name, d.score, d.label])).toEqual([['Tiny Director', expect.closeTo(0.519711683, 6), 'elite']])
  })
})

describe('loadTopDirectors: Franchise and love count', () => {
  // Six titles at 9, 9, 9, 5, 5, 5 for each Director: mean 7, SD 2, so a 9 is z +1 (loved) and a 5 is z −1.
  const sixTitles = (person: Person, firstId: number, relations: Array<Array<[string, number]>> = []) =>
    [9, 9, 9, 5, 5, 5].map((s, i) => entry(s, person, { relations: relations[i] }, firstId + i))
  const chain = (firstId: number, length: number) =>
    Array.from({ length }, (_, i) => [
      ...(i > 0 ? [['PREQUEL', firstId + i - 1] as [string, number]] : []),
      ...(i < length - 1 ? [['SEQUEL', firstId + i + 1] as [string, number]] : []),
    ])
  const scoreOf = (result: TopDirectors, person: Person) => everyone(result).find((d) => d.id === person[0])!.score

  it('lifts a Director with more loved works over one with the same votes whose loved titles are one Franchise', async () => {
    const result = await load([...sixTitles(SAFE, 2000, chain(2000, 3)), ...sixTitles(SWING, 3000)])

    expect(names(result)).toEqual(['Swing Director', 'Safe Director'])
    expect(scoreOf(result, SWING) - scoreOf(result, SAFE)).toBeGreaterThan(0.01)
  })

  it('joins titles into a Franchise only within one Director’s titles', async () => {
    // The same SEQUEL link, but the sequel is another Director's title: each keeps its own score.
    const linked = await load([...sixTitles(SAFE, 2000, chain(2000, 1)), ...sixTitles(SWING, 3000)])
    const crossDirector = await load([
      entry(9, SAFE, { relations: [['SEQUEL', 3000]] }, 2000),
      ...sixTitles(SAFE, 2000).slice(1),
      entry(9, SWING, { relations: [['PREQUEL', 2000]] }, 3000),
      ...sixTitles(SWING, 3000).slice(1),
    ])

    expect(scoreOf(crossDirector, SAFE)).toBeCloseTo(scoreOf(linked, SAFE), 12)
    expect(scoreOf(crossDirector, SWING)).toBeCloseTo(scoreOf(linked, SWING), 12)
  })

  it('joins a sequel by the same Director into their Franchise, which weighs its titles less', async () => {
    // The same six titles each; for Safe, the two 9s it opens with are one Franchise.
    const joined = await load([...sixTitles(SAFE, 2000, chain(2000, 2)), ...sixTitles(SWING, 3000)])
    const safe = joined.ranked.find((d) => d.id === SAFE[0])!
    const swing = joined.ranked.find((d) => d.id === SWING[0])!

    expect(safe.votes[0].weight).toBeLessThan(swing.votes[0].weight)
    expect(safe.votes[2].weight).toBeCloseTo(swing.votes[2].weight, 12)
  })

  it('gives favourite anime a bonus', async () => {
    const plain = await load([...sixTitles(SAFE, 2000), ...sixTitles(SWING, 3000)])
    const favourite = await load([...sixTitles(SAFE, 2000), ...sixTitles(SWING, 3000)], [2003])

    expect(scoreOf(favourite, SAFE)).toBeGreaterThan(scoreOf(plain, SAFE))
    expect(favourite.ranked.find((d) => d.id === SAFE[0])!.votes[3].favourite).toBe(true)
  })
})

describe('loadTopDirectors: gate and watchlist', () => {
  // Directors of the given sizes, numbered from 10. Director i scores 6, 7, 8, ... shifted by i/10, so they differ in S.
  function directorsOfSize(...sizes: number[]) {
    nextId = 1000
    return sizes.flatMap((size, i) => {
      const person: Person = [10 + i, `Director ${10 + i}`]
      return Array.from({ length: size }, (_, j) => entry(6 + (j % 3) + i / 10, person))
    })
  }
  const sizes = (result: TopDirectors) => result.ranked.map((d) => d.votes.length)

  it('keeps the gate at 4 when ten Directors pass it', async () => {
    const result = await load(directorsOfSize(...Array(10).fill(4), 3))

    expect(result.gate).toBe(4)
    expect(sizes(result)).toHaveLength(10)
  })

  it('lowers the gate to 3 when fewer than ten Directors pass at 4', async () => {
    const result = await load(directorsOfSize(...Array(9).fill(4), 3, 2))

    expect(result.gate).toBe(3)
    expect(sizes(result).sort()).toEqual([3, ...Array(9).fill(4)])
  })

  it('never lowers the gate below 3, however few Directors pass', async () => {
    const result = await load(directorsOfSize(5, 5, 4, 2, 2))

    expect(result.gate).toBe(3)
    expect(sizes(result).sort()).toEqual([4, 5, 5])
    expect(result.watchlist.map((d) => d.votes.length)).toEqual([2, 2])
  })

  it('puts the best five Directors below the gate on the watchlist, best first', async () => {
    const result = await load(directorsOfSize(...Array(10).fill(4), 3, 3, 3, 3, 3, 3, 3))

    expect(result.gate).toBe(4)
    expect(result.watchlist.map((d) => d.name)).toEqual(['Director 26', 'Director 25', 'Director 24', 'Director 23', 'Director 22'])
  })
})

describe('loadTopDirectors: labels', () => {
  const ELITE: Person = [21, 'Elite Director']
  const BOLD: Person = [22, 'Bold Director']
  const RELIABLE: Person = [23, 'Reliable Director']
  const MEH: Person = [24, 'Meh Director']
  const NEAR: Person = [25, 'Near Director']

  // `n` titles: `hits` at 10, `flops` at 1, the rest at 5.5 (a hit, a flop and neither on these lists).
  const titles = (person: Person, n: number, hits: number, flops: number) =>
    Array.from({ length: n }, (_, i) => entry(i < hits ? 10 : i < hits + flops ? 1 : 5.5, person))
  const fourCorners = () => [
    ...titles(ELITE, 10, 3, 0),
    ...titles(BOLD, 10, 3, 3),
    ...titles(RELIABLE, 10, 0, 0),
    ...titles(MEH, 10, 0, 3),
  ]
  const director = (result: TopDirectors, [id]: Person) => everyone(result).find((d) => d.id === id)!

  it('labels each Director from its hit and flop rates against the pooled rates of the ranked Directors', async () => {
    const result = await load(fourCorners())

    expect([ELITE, BOLD, RELIABLE, MEH].map((p) => director(result, p).label)).toEqual(['elite', 'bold', 'reliable', 'meh'])
  })

  it('counts a rate as high only 10 points above the pool', async () => {
    // Pooled hit rate 8 in 48 ≈ 16.7%: Near's 25% is more than 6 points above it but not 10, so it stays low.
    const result = await load([...fourCorners(), ...titles(NEAR, 8, 2, 0)])

    expect(result.labelLines.hit).toBeCloseTo(8 / 48 + 0.1, 12)
    expect(director(result, NEAR)).toMatchObject({ label: 'reliable', hitRate: expect.closeTo(0.25, 12) })
  })

  it('gives the lines a rate must pass to read high, which the label map draws its corners on', async () => {
    // Pooled: 6 hits and 6 flops in 40 titles, 15% each, plus the Directors' 10-point margin.
    const result = await load(fourCorners())

    expect(result.labelLines.hit).toBeCloseTo(0.25, 12)
    expect(result.labelLines.flop).toBeCloseTo(0.25, 12)
  })

  it('pools only the top 20 ranked Directors', async () => {
    // 19 plain Directors and Bold make the top 20, with 1 flop in 200 titles; five all-flop Directors rank below them.
    // Pooled over the top 20, Bold's 20% flops read high (line 10.5%); pooled over all 25 (51 in 250, line 30.4%) not.
    nextId = 1000
    const plain = Array.from({ length: 19 }, (_, i) => titles([100 + i, `Plain ${i}`], 10, 1, 0)).flat()
    const flopping = Array.from({ length: 5 }, (_, i) => titles([200 + i, `Flopping ${i}`], 10, 0, 10)).flat()
    const result = await load([...plain, ...titles(BOLD, 10, 3, 2), ...flopping])

    expect(result.ranked).toHaveLength(25)
    expect(result.ranked.slice(20).every((d) => d.name.startsWith('Flopping'))).toBe(true)
    expect(director(result, BOLD)).toMatchObject({ label: 'bold', hitRate: expect.closeTo(0.3, 12), flopRate: expect.closeTo(0.2, 12) })
  })

  it('labels the watchlist too', async () => {
    const result = await load([...fourCorners(), ...titles(TINY, 2, 2, 0)])

    expect(result.watchlist).toEqual([expect.objectContaining({ name: 'Tiny Director', label: 'elite', hitRate: 1 })])
  })
})

describe('loadTopDirectors: the watchlist', () => {
  // Ten ranked Directors at the full gate of 4, plus the ones under test, each a plain run of the given scores.
  const tenRanked = () =>
    Array.from({ length: 10 }, (_, i) => [6, 7, 8, 7].map((s) => entry(s, [100 + i, `Ranked ${i}`]))).flat()
  const run = (person: Person, scores: number[]) => scores.map((s) => entry(s, person))

  it('holds Directors below the Gate of 4, never one that reaches it however high it scores', async () => {
    nextId = 1000
    const result = await load([...tenRanked(), ...run(TINY, [10, 10, 10]), ...run(SWING, [10, 9.5, 10, 9.5])])

    expect(result.gate).toBe(4)
    expect(result.watchlist.map((d) => [d.name, d.votes.length])).toEqual([['Tiny Director', 3]])
    expect(result.ranked[0].name).toBe('Swing Director')
  })
})

describe('loadTopDirectors: reading AniList', () => {
  it('reads staff on the list query, the first 25 by relevance, scores on the 10-point decimal scale', async () => {
    const { fetch, calls } = fakeFetch(listChunk(false, handMadeList()), favouritesPage(false, []))
    await loadTopDirectors({ fetch, token: null }, 'zen')

    expect(calls[0].body.query).toContain('MediaListCollection')
    expect(calls[0].body.query).toContain('type: ANIME')
    expect(calls[0].body.query).toContain('staff(sort: [RELEVANCE], perPage: 25)')
    expect(calls[0].body.query).toContain('score(format: POINT_10_DECIMAL)')
  })

  it('follows list chunks and favourites pages to the end', async () => {
    const list = handMadeList()
    const { fetch, calls } = fakeFetch(
      listChunk(true, list.slice(0, 10)),
      listChunk(false, list.slice(10)),
      favouritesPage(true, [1]),
      favouritesPage(false, [list[0].mediaId]),
    )

    const result = ranked(await loadTopDirectors({ fetch, token: null }, 'zen'))

    expect(calls.map((c) => c.body.variables)).toEqual([
      { userName: 'zen', chunk: 1, perChunk: 500 },
      { userName: 'zen', chunk: 2, perChunk: 500 },
      { userName: 'zen', page: 1 },
      { userName: 'zen', page: 2 },
    ])
    expect(result.ranked[0].votes[0].favourite).toBe(true)
  })

  it('sends the token only when given one', async () => {
    const anonymous = fakeFetch(listChunk(false, handMadeList()), favouritesPage(false, []))
    await loadTopDirectors({ fetch: anonymous.fetch, token: null }, 'zen')
    const signedIn = fakeFetch(listChunk(false, handMadeList()), favouritesPage(false, []))
    await loadTopDirectors({ fetch: signedIn.fetch, token: 'tok' }, 'zen')

    expect(anonymous.calls.every((c) => !new Headers(c.init.headers).has('Authorization'))).toBe(true)
    expect(signedIn.calls.every((c) => new Headers(c.init.headers).get('Authorization') === 'Bearer tok')).toBe(true)
  })
})

describe('loadTopDirectors: when it cannot rank', () => {
  async function failure(...responses: Canned[]) {
    const { fetch } = fakeFetch(...responses)
    const loaded = await loadTopDirectors({ fetch, token: null }, 'zen')
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
    expect(await loadTopDirectors({ fetch, token: null }, 'zen')).toEqual({ ok: false, failure: { kind: 'unreachable' } })
  })

  it('passes on any other AniList error', async () => {
    const broken = { status: 500, json: { data: null, errors: [{ message: 'Internal Server Error', status: 500 }] } }
    expect(await failure(broken)).toEqual({ kind: 'api', message: 'Internal Server Error' })
  })
})

describe('loadTopDirectors: a token AniList refuses', () => {
  const refused = { status: 400, json: { data: null, errors: [{ message: 'Invalid token', status: 400 }] } }

  it('loads the list again without the token', async () => {
    const { fetch, calls } = fakeFetch(refused, listChunk(false, handMadeList()), favouritesPage(false, []))
    const loaded = await loadTopDirectors({ fetch, token: 'old' }, 'zen')

    expect(names(ranked(loaded))).toEqual(['Swing Director', 'Safe Director', 'Middle Director'])
    expect(new Headers(calls[0].init.headers).get('Authorization')).toBe('Bearer old')
    expect(calls.slice(1).every((c) => !new Headers(c.init.headers).has('Authorization'))).toBe(true)
  })

  it('says the list is private when it can’t be read without the token either', async () => {
    const privateUser = { status: 401, json: { data: { MediaListCollection: null }, errors: [{ message: 'Private User', status: 401 }] } }
    const { fetch } = fakeFetch(refused, privateUser)
    expect(await loadTopDirectors({ fetch, token: 'old' }, 'zen')).toEqual({ ok: false, failure: { kind: 'private-list' } })
  })
})
