// Preview's unsettled card (#29): it shows after a settings change, but also after Forgotten, a sync or a Band move,
// so its copy names no cause.
import { describe, expect, it } from 'vitest'
import { newTitlesUnsettledSummary, unsettledSummary } from './unsettledCard.ts'

describe("the unsettled card's summary", () => {
  it('counts the titles not settled yet and the Refine Duels, whatever unsettled them', () => {
    expect(unsettledSummary(3, 5)).toBe('3 titles not settled yet · about 5 Refine Duels')
  })

  it('says one title and one Refine Duel in the singular', () => {
    expect(unsettledSummary(1, 1)).toBe('1 title not settled yet · about 1 Refine Duel')
  })
})

describe("the unsettled card's summary on Score New Titles", () => {
  it('says a few more Duels decide while Duels are left', () => {
    expect(newTitlesUnsettledSummary(2, true)).toBe('2 titles not settled yet · a few more Duels decide')
  })

  it('says no Anchor is left to compare with once no Duel is left, and how to go on', () => {
    expect(newTitlesUnsettledSummary(1, false)).toBe(
      '1 title not settled · no Anchor left to compare it with · Bring back a Forgotten Anchor to go on',
    )
    expect(newTitlesUnsettledSummary(3, false)).toBe(
      '3 titles not settled · no Anchor left to compare them with · Bring back a Forgotten Anchor to go on',
    )
  })
})
