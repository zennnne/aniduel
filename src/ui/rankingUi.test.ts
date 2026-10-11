// The screen state of the open Ranking: what leaving the Ranking resets.
import { describe, expect, it } from 'vitest'
import { NO_RANKING_UI, leftRanking, splitSkipped, titlesAdded, type RankingUi } from './rankingUi.ts'

/** Every part set: a split looked at, an offer turned down, the last check continued, a fix and Refine Duels from Preview, a Move sheet open. */
const busy: RankingUi = {
  splitView: { band: 1 },
  skippedSplits: [0, 2],
  lastCheckContinued: true,
  previewFix: { id: 7, verb: 'Re-ranking' },
  refining: true,
  previewMoving: 9,
}

describe('leaving a Ranking', () => {
  it('ends with the one empty state: nothing in progress', () => {
    expect(leftRanking()).toBe(NO_RANKING_UI)
    expect(leftRanking()).toEqual({
      splitView: null,
      skippedSplits: [],
      lastCheckContinued: false,
      previewFix: null,
      refining: false,
      previewMoving: null,
    })
  })

  it('keeps no part of what was in use, as the update App applies to its state', () => {
    // App resets with `setRankingUi(leftRanking)`: React hands the update the state being left.
    const update: (left: RankingUi) => RankingUi = leftRanking
    const parts = Object.keys(busy) as (keyof RankingUi)[]
    for (const part of parts) expect(update({ ...NO_RANKING_UI, [part]: busy[part] })).toBe(NO_RANKING_UI)
    expect(update(busy)).toBe(NO_RANKING_UI)
  })
})

describe('a split offer turned down', () => {
  it('closes the Split screen and is not offered again', () => {
    const state = splitSkipped({ ...NO_RANKING_UI, splitView: { band: 1 }, skippedSplits: [0] }, 1)
    expect(state.splitView).toBeNull()
    expect(state.skippedSplits).toEqual([0, 1])
  })

  it('keeps the rest as it was', () => {
    expect(splitSkipped(busy, 3)).toEqual({ ...busy, splitView: null, skippedSplits: [0, 2, 3] })
  })
})

describe('titles a sync added', () => {
  it('let the skipped split offers show again, and nothing else changes', () => {
    expect(titlesAdded(busy)).toEqual({ ...busy, skippedSplits: [] })
  })
})
