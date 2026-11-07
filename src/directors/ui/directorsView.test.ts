// The Top Directors page's view: who is looked up, the share link, what it says when it can't rank, how sure a
// result is, each Director's picture, and the link to Top Studios.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TopDirectorsFailure, TopDirectorsLoad } from '../loadTopDirectors.ts'
import { directorsView, searchFor, type DirectorsViewInput } from './directorsView.ts'

const view = (input: Partial<DirectorsViewInput>) =>
  directorsView({ search: '', own: { kind: 'none' }, load: { kind: 'idle' }, ...input })
const zen = { kind: 'known', name: 'zen' } as const

afterEach(() => vi.unstubAllEnvs())

const tooFew: TopDirectorsLoad = { ok: false, failure: { kind: 'too-few-scored', scored: 7 } }

/** A loaded result: `directors` ranked, the second without a picture on AniList. */
function ranked({ gate = 4, directors = 10, counted = 100, countedScored = 80 } = {}): TopDirectorsLoad {
  return {
    ok: true,
    topDirectors: {
      directors: Array.from({ length: directors }, (_, i) => ({
        id: i,
        name: `Director ${i}`,
        image: i === 1 ? null : `https://img/staff/${i}.jpg`,
        siteUrl: `https://anilist.co/staff/${i}`,
        score: -i / 10,
        votes: [],
        hitRate: 0,
        flopRate: 0,
        label: 'reliable' as const,
      })),
      watchlist: [],
      gate,
      labelLines: { hit: 0.2, flop: 0.2 },
      averageUtility: 1,
      scale: { mean: 7, sd: 1.5 },
      scoredCount: countedScored,
      watchedCount: counted,
      countedCount: counted,
      countedScoredCount: countedScored,
    },
  }
}

describe('the share link', () => {
  it('loads a shared ?user= link straight away, the name in the field', () => {
    const shared = view({ search: '?user=Friend', own: zen })
    expect(shared.loadNow).toBe('Friend')
    expect(shared.formName).toBe('Friend')
  })

  it('fills in the logged-in user’s own name without loading it', () => {
    expect(view({ own: zen })).toMatchObject({ loadNow: null, formName: 'zen', screen: { kind: 'search', error: null } })
  })

  it('puts the name looked up in ?user=, keeping the rest of the query', () => {
    expect(searchFor('?fake-anilist&user=old', 'New Name')).toBe('?fake-anilist=&user=New+Name')
  })

  it('shows the result for the name loaded', () => {
    const { screen } = view({ search: '?user=Friend', load: { kind: 'loaded', userName: 'Friend', loaded: ranked() } })
    expect(screen).toMatchObject({ kind: 'result', userName: 'Friend' })
  })
})

describe('each Director’s card', () => {
  it('shows the Director’s own picture, or none for one AniList has no picture of', () => {
    const { screen } = view({ load: { kind: 'loaded', userName: 'zen', loaded: ranked({ directors: 2 }) } })
    if (screen.kind !== 'result') throw new Error(`expected a result, got ${screen.kind}`)
    expect(screen.cards.map((c) => [c.name, c.rank, c.cover])).toEqual([
      ['Director 0', 1, 'https://img/staff/0.jpg'],
      ['Director 1', 2, null],
    ])
  })
})

const failed = (failure: TopDirectorsFailure, own: DirectorsViewInput['own'] = { kind: 'none' }) =>
  view({ own, load: { kind: 'loaded', userName: 'Friend', loaded: { ok: false, failure } } }).screen

describe('what the page says when it can’t rank', () => {
  it('keeps the name in the field and shows the failure on the search page', () => {
    const v = view({ search: '?user=Friend', load: { kind: 'loaded', userName: 'Friend', loaded: tooFew } })
    expect(v.screen.kind).toBe('search')
    expect(v.formName).toBe('Friend')
  })

  it('says there is no such user, or that the list is private', () => {
    expect(failed({ kind: 'no-such-user' })).toMatchObject({ error: { title: 'There’s no AniList user called “Friend”.', retry: false } })
    expect(failed({ kind: 'private-list' })).toMatchObject({
      error: { title: 'Friend’s list is private.', body: 'If it’s yours, log in on AniDuel! first: this page then reads it with your login.' },
    })
  })

  it('says when too few titles are scored, in Top Directors’ words', () => {
    expect(failed({ kind: 'too-few-scored', scored: 7 })).toEqual({
      kind: 'search',
      error: {
        title: 'Friend has scored only 7 titles.',
        body: 'Top Directors needs at least 10 scored titles to tell directors apart. Score more on AniList and try again.',
        retry: false,
      },
    })
  })

  it('offers to try again when AniList is busy, unreachable or answers with an error', () => {
    expect(failed({ kind: 'rate-limited' })).toMatchObject({ error: { title: 'AniList is busy right now.', retry: true } })
    expect(failed({ kind: 'unreachable' })).toMatchObject({ error: { title: 'AniList can’t be reached.', retry: true } })
    expect(failed({ kind: 'api', message: 'Boom' })).toMatchObject({ error: { title: 'AniList answered with an error.', body: 'Boom', retry: true } })
  })
})

describe('How sure is this?', () => {
  const sure = (options: Parameters<typeof ranked>[0]) => {
    const { screen } = view({ load: { kind: 'loaded', userName: 'zen', loaded: ranked(options) } })
    if (screen.kind !== 'result') throw new Error(`expected a result, got ${screen.kind}`)
    return screen.howSure
  }

  it('is Solid at the Directors’ full gate of 4 with 10 ranked', () => {
    expect(sure({})).toEqual({ dots: 5, word: 'Solid', notes: [] })
  })

  it('says when the gate was lowered to 3', () => {
    expect(sure({ gate: 3, directors: 7 })).toEqual({
      dots: 3,
      word: 'Fair',
      notes: ['Your list is short, so a director needed only 3 titles (not 4) to be ranked.', 'Only 7 directors made it.'],
    })
  })
})

describe('the link to Top Studios', () => {
  it('opens Top Studios for the same ?user=', () => {
    vi.stubEnv('BASE_URL', '/aniduel/')
    expect(view({ search: '?user=Fake Zen' }).crossLink).toEqual({
      text: '🏢 Top Studios →',
      href: '/aniduel/anilyze/studios/?user=Fake%20Zen',
    })
  })

  it('opens it blank when no one is looked up, and keeps the fake AniList under npm run dev', () => {
    vi.stubEnv('BASE_URL', '/aniduel/')
    vi.stubEnv('DEV', true)
    expect(view({ own: zen }).crossLink.href).toBe('/aniduel/anilyze/studios/')
    expect(view({ search: '?fake-anilist&user=Fake%20Zen' }).crossLink.href).toBe('/aniduel/anilyze/studios/?fake-anilist&user=Fake%20Zen')
  })
})
