// The exit offer in Catch-up's header (#52): when it shows and where it leads.
import { describe, expect, it } from 'vitest'
import { exitOffer } from './exitOffer.ts'

describe('the exit offer', () => {
  it('is not shown before anything was saved this visit', () => {
    expect(exitOffer({ added: 0, eligibleForNewTitles: true })).toBeNull()
    expect(exitOffer({ added: 0, eligibleForNewTitles: false })).toBeNull()
  })

  it('is not shown while the anime list, and so where the offer leads, is not known yet', () => {
    expect(exitOffer({ added: 14, eligibleForNewTitles: null })).toBeNull()
  })

  it('offers Score New Titles, with how many titles were added, to a user who qualifies', () => {
    expect(exitOffer({ added: 14, eligibleForNewTitles: true })).toEqual({ target: 'score-new-titles', label: 'Score 14 new titles →' })
    expect(exitOffer({ added: 1, eligibleForNewTitles: true })).toEqual({ target: 'score-new-titles', label: 'Score 1 new title →' })
  })

  it('leads to the Pool-size default Sort Goal otherwise, so the user builds their scale first', () => {
    expect(exitOffer({ added: 1, eligibleForNewTitles: false })).toEqual({ target: 'default-sort-goal', label: 'Start Rough Sort →' })
    expect(exitOffer({ added: 14, eligibleForNewTitles: false })).toEqual({ target: 'default-sort-goal', label: 'Start Rough Sort →' })
  })
})
