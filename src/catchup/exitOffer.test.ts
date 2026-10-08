// The exit offer in Catch-up's header (#52): when it shows and where it leads.
import { describe, expect, it } from 'vitest'
import { exitOffer } from './exitOffer.ts'

describe('the exit offer', () => {
  it('is not shown before anything was saved this visit', () => {
    expect(exitOffer({ added: 0 })).toBeNull()
  })

  it('leads back to Start to pick a Sort Goal once a title was saved, whatever its mark', () => {
    expect(exitOffer({ added: 1 })).toEqual({ target: 'sort-goal', label: 'Start ranking →' })
    expect(exitOffer({ added: 14 })).toEqual({ target: 'sort-goal', label: 'Start ranking →' })
  })
})
