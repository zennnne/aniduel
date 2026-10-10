// The exit offer in Catch-up's header (#52): when it shows and where it leads.
import { describe, expect, it } from 'vitest'
import { exitOffer, type AnimeStanding } from './exitOffer.ts'

const anime = (over: Partial<AnimeStanding> = {}): AnimeStanding => ({ eligibleForNewTitles: false, unscored: 0, saved: 'none', ...over })

describe('the exit offer', () => {
  it('is not shown before anything was saved this visit', () => {
    expect(exitOffer({ added: 0, anime: anime({ eligibleForNewTitles: true, unscored: 9 }) })).toBeNull()
    expect(exitOffer({ added: 0, anime: anime() })).toBeNull()
  })

  it('is not shown while the anime list, and so where the offer leads, is not known yet', () => {
    expect(exitOffer({ added: 14, anime: null })).toBeNull()
  })

  it('offers Score New Titles to a user who qualifies, with the count on Start’s New Titles button', () => {
    expect(exitOffer({ added: 14, anime: anime({ eligibleForNewTitles: true, unscored: 9 }) })).toEqual({
      target: 'score-new-titles',
      label: 'Score 9 new titles →',
    })
    expect(exitOffer({ added: 14, anime: anime({ eligibleForNewTitles: true, unscored: 1 }) })?.label).toBe('Score 1 new title →')
  })

  it('asks to replace a saved Scores or Full Ranking Ranking with Score New Titles', () => {
    expect(exitOffer({ added: 3, anime: anime({ eligibleForNewTitles: true, unscored: 9, saved: 'other' }) })).toEqual({
      target: 'replace-with-new-titles',
      label: 'Score 9 new titles →',
    })
  })

  it('carries on a saved Score New Titles Ranking, which the new titles join', () => {
    expect(exitOffer({ added: 3, anime: anime({ eligibleForNewTitles: true, unscored: 9, saved: 'new-titles' }) })).toEqual({
      target: 'saved-ranking',
      label: 'Score 9 new titles →',
    })
  })

  it('leads to the Pool-size default Sort Goal otherwise, so the user builds their scale first', () => {
    expect(exitOffer({ added: 1, anime: anime({ unscored: 9 }) })).toEqual({ target: 'default-sort-goal', label: 'Start Rough Sort →' })
  })

  it('carries on a saved Ranking instead of starting Rough Sort', () => {
    const continued = { target: 'saved-ranking', label: 'Continue ranking →' }
    expect(exitOffer({ added: 1, anime: anime({ unscored: 9, saved: 'other' }) })).toEqual(continued)
    expect(exitOffer({ added: 1, anime: anime({ unscored: 9, saved: 'new-titles' }) })).toEqual(continued)
  })

  it('does not offer Score New Titles with no title to score (e.g. only Planning was added)', () => {
    expect(exitOffer({ added: 2, anime: anime({ eligibleForNewTitles: true }) })?.target).toBe('default-sort-goal')
    expect(exitOffer({ added: 2, anime: anime({ eligibleForNewTitles: true, saved: 'other' }) })?.label).toBe('Continue ranking →')
  })
})
