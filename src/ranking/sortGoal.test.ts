// The default Sort Goal on Start (ADR 0007 amendments): from the Pool size and the Score Format, until the user picks one.
import { describe, expect, it } from 'vitest'
import { defaultSortGoal } from './sortGoal.ts'

describe('defaultSortGoal', () => {
  it('is Full Ranking below 100 titles', () => {
    expect(defaultSortGoal(0, 'POINT_10_DECIMAL')).toBe('full-ranking')
    expect(defaultSortGoal(60, 'POINT_100')).toBe('full-ranking')
    expect(defaultSortGoal(99, 'POINT_10_DECIMAL')).toBe('full-ranking')
  })

  it('is Scores from 100 titles up', () => {
    expect(defaultSortGoal(100, 'POINT_10_DECIMAL')).toBe('scores')
    expect(defaultSortGoal(150, 'POINT_100')).toBe('scores')
  })

  it('is Scores at any size for a Score Format with one Score Step', () => {
    for (const format of ['POINT_10', 'POINT_5', 'POINT_3'] as const) {
      expect(defaultSortGoal(0, format)).toBe('scores')
      expect(defaultSortGoal(60, format)).toBe('scores')
      expect(defaultSortGoal(150, format)).toBe('scores')
    }
  })
})
