// The exit offer in Catch-up's header (#52): when it shows and where it leads.
import { describe, expect, it } from 'vitest'
import { exitOffer, type Standing } from './exitOffer.ts'

const standing = (over: Partial<Standing> = {}): Standing => ({ eligibleForKeepMyScale: false, unscored: 0, saved: 'none', ...over })

describe('the exit offer', () => {
  it('is not shown before anything was saved this visit', () => {
    expect(exitOffer({ added: 0, standing: standing({ eligibleForKeepMyScale: true, unscored: 9 }) })).toBeNull()
    expect(exitOffer({ added: 0, standing: standing() })).toBeNull()
  })

  it('is not shown while the list, and so where the offer leads, is not known yet', () => {
    expect(exitOffer({ added: 14, standing: null })).toBeNull()
  })

  it('leads a user who qualifies to the Picker, naming the count on Start’s Keep My Scale button but not calling them new', () => {
    expect(exitOffer({ added: 14, standing: standing({ eligibleForKeepMyScale: true, unscored: 9 }) })).toEqual({
      target: 'picker',
      label: 'Score 9 titles →',
    })
    expect(exitOffer({ added: 14, standing: standing({ eligibleForKeepMyScale: true, unscored: 1 }) })?.label).toBe('Score 1 title →')
  })

  it('leads to the Picker over a saved Scores or Full Ranking Ranking too; its Confirm asks before replacing it', () => {
    expect(exitOffer({ added: 3, standing: standing({ eligibleForKeepMyScale: true, unscored: 9, saved: 'other' }) })).toEqual({
      target: 'picker',
      label: 'Score 9 titles →',
    })
  })

  it('carries on a saved Keep My Scale Ranking, whose Pool is fixed, so it names no titles to score', () => {
    expect(exitOffer({ added: 3, standing: standing({ eligibleForKeepMyScale: true, unscored: 9, saved: 'keep-my-scale' }) })).toEqual({
      target: 'saved-ranking',
      label: 'Continue ranking →',
    })
  })

  it('leads to the Pool-size default Sort Goal otherwise, so the user builds their scale first', () => {
    expect(exitOffer({ added: 1, standing: standing({ unscored: 9 }) })).toEqual({ target: 'default-sort-goal', label: 'Start Rough Sort →' })
  })

  it('carries on a saved Ranking instead of starting Rough Sort', () => {
    const continued = { target: 'saved-ranking', label: 'Continue ranking →' }
    expect(exitOffer({ added: 1, standing: standing({ unscored: 9, saved: 'other' }) })).toEqual(continued)
    expect(exitOffer({ added: 1, standing: standing({ unscored: 9, saved: 'keep-my-scale' }) })).toEqual(continued)
  })

  it('does not offer Keep My Scale with no title to score (e.g. only Planning was added)', () => {
    expect(exitOffer({ added: 2, standing: standing({ eligibleForKeepMyScale: true }) })?.target).toBe('default-sort-goal')
    expect(exitOffer({ added: 2, standing: standing({ eligibleForKeepMyScale: true, saved: 'other' }) })?.label).toBe('Continue ranking →')
  })
})
