// Screen state that only makes sense for the Ranking that is open, and the transitions of it that decide something.
// Session UI state only, never a log event. Pure: App applies what a transition answers with.
import { promptedTitle, type BandIndex, type RankingState } from '../ranking/engine.ts'
import { previewOpen } from '../ranking/preview.ts'
import type { Screen } from './shownScreen.ts'

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

/**
 * What a transition that decides something answers with: the fields of `RankingUi` that change, and the screen to go
 * to, if any. Never the whole state: "Go to Duels →" sets `refining` and answers the Band choice in the same tick, so
 * a whole state worked out from that render's `RankingUi` would write `refining` back to false. App applies `change`
 * on top of the latest state and goes to the screen itself.
 */
export type Transition = { change: Partial<RankingUi>; goTo: Screen | null }

/** Nothing changes and the screen stays. */
const NOTHING: Transition = { change: {}, goTo: null }

/**
 * Whether a fix started from Preview (Re-rank, Move, Bring back) needs no more Duels: the Ranking is finished, or
 * only Refine Duels of other titles are left (on Scores the fixed title is worked on first, until it is settled).
 */
export function fixDone(state: RankingState, id: number): boolean {
  return previewOpen(state.prompt) && promptedTitle(state.prompt) !== id
}

/** `fixEnded`: the fix started from Preview is done. `refineEnded`: the Refine Duels started from Preview are all answered, which the caller says. */
export type Answered = Transition & { fixEnded: boolean; refineEnded: boolean }

/**
 * After an answer, `state` being the Ranking it gave and `screen` the one showing: once a fix started from Preview is
 * placed (or undone), Preview opens again; so it does once the Refine Duels started from Preview are all answered.
 * Whatever ended is cleared, and Preview is the one screen to go to however many ended.
 */
export function answered(ui: RankingUi, state: RankingState, screen: Screen): Answered {
  const fixEnded = ui.previewFix !== null && fixDone(state, ui.previewFix.id)
  const refineEnded = ui.refining && state.prompt.kind === 'all-complete'
  return {
    change: { ...(fixEnded && { previewFix: null }), ...(refineEnded && { refining: false }) },
    goTo: (fixEnded || refineEnded) && screen !== 'preview' ? 'preview' : null,
    fixEnded,
    refineEnded,
  }
}

/** `noDuelNeeded`: the title has its place already, which the caller says. */
export type FixStarted = Transition & { noDuelNeeded: boolean }

/**
 * Re-rank / Move / Bring back from Preview, `state` being the Ranking after the fix's own event: the title's Duels run
 * on the Ranking screen, the fix remembered until they end. A title that needs no Duel (e.g. moved into an empty
 * Band) is placed at once and Preview stays.
 */
export function fixStarted(state: RankingState, id: number, verb: string): FixStarted {
  if (fixDone(state, id)) return { ...NOTHING, noDuelNeeded: true }
  return { change: { previewFix: { id, verb } }, goTo: 'ranking', noDuelNeeded: false }
}

/** `bandFirst`: a Band choice comes before the Duels, and this is the Band; the caller chooses it, which leads on to the Duels. */
export type RefineStarted = Transition & { bandFirst: BandIndex | null }

/**
 * "Go to Duels →" on Preview (#29): the Refine Duels, from the top Band that has some. Nothing without a Duel to go
 * to; otherwise `refining` is set, so that Preview opens again once they are all answered.
 */
export function refineStarted(state: RankingState | null): RefineStarted {
  const kind = state?.prompt.kind
  if (!state || (kind !== 'duel' && kind !== 'anchor-duel' && kind !== 'closer-to')) return { ...NOTHING, bandFirst: null }
  const change = { refining: true }
  return state.bandChoice ? { change, goTo: null, bandFirst: state.bandChoice.next } : { change, goTo: 'ranking', bandFirst: null }
}

/**
 * The Board's entry points (Rough Sort pill, Band choice pill, menu) while it is open, before the first Duel answer:
 * during Rough Sort the Board is a screen to go to; after it, the last check shows again.
 */
export function boardOpened(state: RankingState | null): Transition {
  if (!state?.board.open) return NOTHING
  return state.prompt.kind === 'rough-sort' ? { change: {}, goTo: 'board' } : { change: { lastCheckContinued: false }, goTo: null }
}

/** "Continue →" on the last check: the Band choice comes next, unless it is showing already. */
export function lastCheckLeft(state: RankingState | null, screen: Screen): Transition {
  return { change: { lastCheckContinued: true }, goTo: state?.prompt.kind === 'duel' && screen !== 'bands' ? 'bands' : null }
}
