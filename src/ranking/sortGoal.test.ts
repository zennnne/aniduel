// The default Sort Goal on Start (ADR 0007, V3 amendment): from the Pool size, until the user picks one.
import { describe, expect, it } from 'vitest'
import { defaultSortGoal } from './sortGoal.ts'

describe('defaultSortGoal', () => {
  it('is Full Ranking below 100 titles', () => {
    expect(defaultSortGoal(0)).toBe('full-ranking')
    expect(defaultSortGoal(60)).toBe('full-ranking')
    expect(defaultSortGoal(99)).toBe('full-ranking')
  })

  it('is Scores from 100 titles up', () => {
    expect(defaultSortGoal(100)).toBe('scores')
    expect(defaultSortGoal(150)).toBe('scores')
  })
})
