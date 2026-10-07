// Preview's unsettled card (#29): it shows after a settings change, but also after Forgotten, a sync or a Band move,
// so its copy names no cause.
import { describe, expect, it } from 'vitest'
import { unsettledSummary } from './unsettledCard.ts'

describe("the unsettled card's summary", () => {
  it('counts the titles not settled yet and the Refine Duels, whatever unsettled them', () => {
    expect(unsettledSummary(3, 5)).toBe('3 titles not settled yet · about 5 Refine Duels')
  })

  it('says one title and one Refine Duel in the singular', () => {
    expect(unsettledSummary(1, 1)).toBe('1 title not settled yet · about 1 Refine Duel')
  })
})
