// The Top Studios page's view: who is looked up, what it says when it can't rank, and how sure a result is.
import { describe, expect, it } from 'vitest'
import type { TopStudiosFailure, TopStudiosLoad } from '../loadTopStudios.ts'
import { searchFor, studiosView, type StudiosViewInput } from './studiosView.ts'

const view = (input: Partial<StudiosViewInput>) => studiosView({ search: '', own: { kind: 'none' }, load: { kind: 'idle' }, ...input })
const zen = { kind: 'known', name: 'zen' } as const

describe('who the page looks up', () => {
  it('loads a shared ?user= link straight away, even for someone logged in as another user', () => {
    const shared = view({ search: '?user=Friend', own: zen })
    expect(shared.loadNow).toBe('Friend')
    expect(shared.formName).toBe('Friend')
  })

  it('fills in the logged-in user’s own name without loading it', () => {
    const own = view({ own: zen })
    expect(own.loadNow).toBeNull()
    expect(own.formName).toBe('zen')
    expect(own.screen).toEqual({ kind: 'search', error: null })
  })

  it('offers an empty form when logged out, or while the login is still being checked', () => {
    for (const own of [{ kind: 'none' }, { kind: 'checking' }] as const) {
      expect(view({ own })).toMatchObject({ loadNow: null, formName: '', screen: { kind: 'search', error: null } })
    }
  })

  it('ignores an empty ?user=', () => {
    expect(view({ search: '?user=%20', own: zen })).toMatchObject({ loadNow: null, formName: 'zen' })
  })

  it('loads nothing more once a name is loading or loaded', () => {
    expect(view({ search: '?user=Friend', load: { kind: 'loading', userName: 'Friend' } }).loadNow).toBeNull()
    expect(view({ search: '?user=Friend', load: { kind: 'loaded', userName: 'Friend', loaded: tooFew } }).loadNow).toBeNull()
  })

  it('lets a logged-in user look up a friend: the result is the friend’s', () => {
    const friend = view({ search: '?user=Friend', own: zen, load: { kind: 'loaded', userName: 'Friend', loaded: ranked() } })
    expect(friend.screen).toMatchObject({ kind: 'result', userName: 'Friend' })
    expect(friend.formName).toBe('Friend')
  })

  it('shows a result as the studios’ cards, ranked first, then the watchlist', () => {
    const { screen } = view({ load: { kind: 'loaded', userName: 'zen', loaded: ranked({ studios: 2 }) } })
    if (screen.kind !== 'result') throw new Error(`expected a result, got ${screen.kind}`)
    expect(screen.cards.map((c) => [c.name, c.rank])).toEqual([
      ['Studio 0', 1],
      ['Studio 1', 2],
    ])
  })

  it('shows the name being read while it loads', () => {
    expect(view({ load: { kind: 'loading', userName: 'Friend' } }).screen).toEqual({ kind: 'loading', userName: 'Friend' })
  })
})

describe('the share link', () => {
  it('puts the name looked up in ?user=, keeping the rest of the query', () => {
    expect(searchFor('', 'zen')).toBe('?user=zen')
    expect(searchFor('?fake-anilist&user=old', 'New Name')).toBe('?fake-anilist=&user=New+Name')
  })
})

const tooFew: TopStudiosLoad = { ok: false, failure: { kind: 'too-few-scored', scored: 7 } }

/** A loaded result with what the "How sure is this?" reading looks at. */
function ranked({ gate = 6, studios = 10, counted = 100, countedScored = 80 } = {}): TopStudiosLoad {
  return {
    ok: true,
    topStudios: {
      studios: Array.from({ length: studios }, (_, i) => ({
        id: i,
        name: `Studio ${i}`,
        score: 0,
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

const failed = (failure: TopStudiosFailure, own: StudiosViewInput['own'] = { kind: 'none' }) =>
  view({ own, load: { kind: 'loaded', userName: 'Friend', loaded: { ok: false, failure } } }).screen

describe('what the page says when it can’t rank', () => {
  it('shows each failure on the search page, under the field, with the name kept in the field', () => {
    const v = view({ search: '?user=Friend', load: { kind: 'loaded', userName: 'Friend', loaded: tooFew } })
    expect(v.screen.kind).toBe('search')
    expect(v.formName).toBe('Friend')
  })

  it('says there is no such AniList user, without offering to try again', () => {
    expect(failed({ kind: 'no-such-user' })).toEqual({
      kind: 'search',
      error: { title: 'There’s no AniList user called “Friend”.', body: 'Check the spelling: it’s the name in their AniList profile link.', retry: false },
    })
  })

  it('says a list is private, and points a logged-out visitor to the AniDuel! login', () => {
    expect(failed({ kind: 'private-list' })).toEqual({
      kind: 'search',
      error: {
        title: 'Friend’s list is private.',
        body: 'If it’s yours, log in on AniDuel! first: this page then reads it with your login.',
        retry: false,
      },
    })
    expect(failed({ kind: 'private-list' }, zen)).toEqual({
      kind: 'search',
      error: { title: 'Friend’s list is private.', body: 'AniList shows it only to them.', retry: false },
    })
  })

  it('says when too few titles are scored to rank', () => {
    expect(failed({ kind: 'too-few-scored', scored: 7 })).toEqual({
      kind: 'search',
      error: {
        title: 'Friend has scored only 7 titles.',
        body: 'Top Studios needs at least 10 scored titles to tell studios apart. Score more on AniList and try again.',
        retry: false,
      },
    })
    expect(failed({ kind: 'too-few-scored', scored: 1 })).toMatchObject({ error: { title: 'Friend has scored only 1 title.' } })
  })

  it('offers to try again when AniList is busy, unreachable or answers with an error', () => {
    expect(failed({ kind: 'rate-limited' })).toEqual({
      kind: 'search',
      error: { title: 'AniList is busy right now.', body: 'It takes only so many requests a minute. Wait a moment, then try again.', retry: true },
    })
    expect(failed({ kind: 'unreachable' })).toEqual({
      kind: 'search',
      error: { title: 'AniList can’t be reached.', body: 'Check your connection; AniList may also be down for a while.', retry: true },
    })
    expect(failed({ kind: 'api', message: 'Internal Server Error' })).toEqual({
      kind: 'search',
      error: { title: 'AniList answered with an error.', body: 'Internal Server Error', retry: true },
    })
  })
})

const sure = (options: Parameters<typeof ranked>[0]) => {
  const { screen } = view({ load: { kind: 'loaded', userName: 'zen', loaded: ranked(options) } })
  if (screen.kind !== 'result') throw new Error(`expected a result, got ${screen.kind}`)
  return screen.howSure
}

describe('How sure is this?', () => {
  it('is Solid, five dots, with nothing to note on a well-scored list with 10 studios ranked at the full gate', () => {
    expect(sure({})).toEqual({ dots: 5, word: 'Solid', notes: [] })
  })

  it('takes a dot when the gate was lowered', () => {
    expect(sure({ gate: 4 })).toEqual({
      dots: 4,
      word: 'Good',
      notes: ['Your list is short, so a studio needed only 4 titles (not 6) to be ranked.'],
    })
  })

  it('takes another when fewer than 10 studios rank', () => {
    expect(sure({ gate: 4, studios: 6 })).toEqual({
      dots: 3,
      word: 'Fair',
      notes: ['Your list is short, so a studio needed only 4 titles (not 6) to be ranked.', 'Only 6 studios made it.'],
    })
  })

  it('takes two and says the labels may be off when under half the titles that count are scored', () => {
    expect(sure({ counted: 100, countedScored: 49 })).toEqual({
      dots: 3,
      word: 'Fair',
      notes: ['You scored only 49% of the titles that count, so the labels may be off.'],
    })
  })

  it('has no scored-fraction note at exactly half', () => {
    expect(sure({ counted: 100, countedScored: 50 })).toMatchObject({ dots: 5, notes: [] })
  })

  it('rounds the share down, so a list just under half never reads “only 50%”', () => {
    expect(sure({ counted: 1000, countedScored: 499 }).notes).toEqual([
      'You scored only 49% of the titles that count, so the labels may be off.',
    ])
  })

  it('is Very rough, one dot, when all three apply', () => {
    expect(sure({ gate: 4, studios: 3, counted: 40, countedScored: 12 })).toMatchObject({ dots: 1, word: 'Very rough' })
  })
})
