// Screen state that only makes sense for the Ranking that is open. Session UI state only, never a log event.
import type { BandIndex } from '../ranking/engine.ts'

export type RankingUi = {
  /** The Band whose split is being looked at: pins the Split screen open (ADR 0006). */
  splitView: { band: BandIndex } | null
  /** Bands whose split offer was turned down ("Keep it as it is") in this session. */
  skippedSplits: readonly BandIndex[]
  /** The user pressed Continue on the last-check Board. */
  lastCheckContinued: boolean
  /** A fix started from Preview (#11): its Duels run on the Ranking screen, then Preview opens again. */
  previewFix: { id: number; verb: string } | null
  /** "Go to Duels →" on Preview's unsettled card (#29): once every score is settled again, Preview opens again. */
  refining: boolean
  /** The title whose Move sheet is open over Preview. */
  previewMoving: number | null
}

/** Nothing in progress: what a Ranking that was just opened starts with. */
export const NO_RANKING_UI: RankingUi = {
  splitView: null,
  skippedSplits: [],
  lastCheckContinued: false,
  previewFix: null,
  refining: false,
  previewMoving: null,
}

/**
 * Leaving the open Ranking, whichever way: another one opens, the Media Type switches, Restore, Start over, Keep My
 * Scale replaces it, its Import ends it, or logout. Nothing of its screen state is kept.
 */
export function leftRanking(): RankingUi {
  return NO_RANKING_UI
}

/** "Keep it as it is" on a split offer: the Split screen closes and the Band isn't offered again in this session. */
export function splitSkipped(state: RankingUi, band: BandIndex): RankingUi {
  return { ...state, splitView: null, skippedSplits: [...state.skippedSplits, band] }
}

/** A sync added titles: they can push a Band over the split threshold again (ADR 0006), so a skipped offer may show again. */
export function titlesAdded(state: RankingUi): RankingUi {
  return { ...state, skippedSplits: [] }
}
