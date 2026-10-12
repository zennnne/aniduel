// Which screen shows (ADR 0004): the screen name in app state is only part of the answer. Pure; App renders the answer.
import type { Viewer } from '../anilist/types.ts'
import type { ImportProgress, ImportView, PreviewCheck } from '../import/previewImport.ts'
import type { BandIndex, DuelLog, Prompt, RankingState } from '../ranking/engine.ts'
import { previewOpen } from '../ranking/preview.ts'
import type { ScoringSettings } from '../ranking/scoring.ts'
import { autoOfferDue, splitOffers } from '../ranking/split.ts'
import { lastCheckDue } from './board/lastCheck.ts'
import type { RankingUi } from './rankingUi.ts'

/**
 * 'bands' = the Band choice, opened by going Back from a Duel or from the menu. 'board' = the Board, opened from
 * Rough Sort while it is open; otherwise the Ranking screen shows. The last-check Board after Rough Sort
 * is not a screen of its own: the Ranking screen shows it until the user continues.
 */
export type Screen = 'start' | 'ranking' | 'bands' | 'board' | 'preview' | 'import' | 'catchup' | 'picker'
export const SCREENS: readonly Screen[] = ['start', 'ranking', 'bands', 'board', 'preview', 'import', 'catchup', 'picker']

export type ScreenInput = {
  screen: Screen
  /** The logged-in user; null before login and until AniList answered. */
  viewer: Viewer | null
  /** The open Ranking and its Duel log; null when none is saved or it can't be used. */
  ranking: RankingState | null
  log: DuelLog | null
  /** The list's display data is here. */
  listLoaded: boolean
  /** A banner is showing: AniList may be unreachable, so a Ranking doesn't wait for the list (answers still work, with plain cards). */
  notice: boolean
  /** Old AniList score of every Pool title; null while the list is loading. */
  oldScores: ReadonlyMap<number, number> | null
  rankingUi: RankingUi
  /** The fresh `Viewer` check of this Ranking session (ADR 0003), as Preview and Import report it. */
  preview: PreviewCheck | null
  /** The Import, as Preview and Import report it. */
  importing: ImportProgress | null
  /** The loaded list has enough Anchors for Keep My Scale (ADR 0009). */
  keepMyScaleEligible: boolean
  /** Saved progress exists but can't be used: nothing new can start over it. */
  savedBroken: boolean
}

type PromptOf<K extends Prompt['kind']> = Extract<Prompt, { kind: K }>

/** The open Ranking a screen belongs to, and whose it is. */
type InRanking = { viewer: Viewer; ranking: RankingState }

/** The one screen to show, with what it has made sure of. */
export type Shown =
  | { kind: 'start' }
  | { kind: 'catch-up'; viewer: Viewer }
  /** Where a Keep My Scale Ranking's Pool is picked (#64); it has no Ranking yet. */
  | { kind: 'picker'; viewer: Viewer }
  /** `ranking` is null once a Keep My Scale Ranking ended with this Import (ADR 0010): only its summary is left. */
  | { kind: 'import'; viewer: Viewer; ranking: RankingState | null; importing: ImportView }
  | (InRanking & { kind: 'preview'; scoring: ScoringSettings; oldScores: ReadonlyMap<number, number> })
  | RankingShown

/** The Ranking screen: the screen for the engine's next prompt, or the Split screen or the last check over it. */
export type RankingShown =
  /** A split offer, or a split being looked at (ADR 0006). `lastCheckNext`: the last check still comes after it. */
  | (InRanking & { kind: 'split'; band: BandIndex; lastCheckNext: boolean })
  | (InRanking & { kind: 'last-check' })
  | (InRanking & { kind: 'board' })
  | (InRanking & { kind: 'rough-sort'; prompt: PromptOf<'rough-sort'> })
  | (InRanking & { kind: 'band-choice'; prompt: PromptOf<'duel'> })
  | (InRanking & { kind: 'duel'; prompt: PromptOf<'duel' | 'anchor-duel'> })
  | (InRanking & { kind: 'closer-to'; prompt: PromptOf<'closer-to'> })
  | (InRanking & { kind: 'complete' })

/**
 * The open Ranking the shown screen belongs to: the sidebar shows beside it. Null on Start, in Catch-up, in the Picker
 * and once the Ranking ended.
 */
export function rankingShown(shown: Shown): InRanking | null {
  if (shown.kind === 'start' || shown.kind === 'catch-up' || shown.kind === 'picker' || !shown.ranking) return null
  return { viewer: shown.viewer, ranking: shown.ranking }
}

/**
 * The Band whose Split screen shows over the Ranking screen (ADR 0006): the one being looked at, else the first Band
 * offered on its own. That is after Rough Sort (also after a sync added titles), before the next Duel answer, for
 * each Band that qualifies and wasn't skipped in this session; later a split is only opened from the menu.
 */
export function splitBandOf(ranking: RankingState, log: DuelLog | null, rankingUi: RankingUi): BandIndex | null {
  if (rankingUi.splitView) return rankingUi.splitView.band
  if (ranking.prompt.kind !== 'duel' || !log || !autoOfferDue(log)) return null
  return splitOffers(ranking).find((band) => !rankingUi.skippedSplits.includes(band)) ?? null
}

/** The screen for the engine's next prompt. Rough Sort → split offer → last check → Band choice → Duels. */
function promptScreen(input: ScreenInput, open: InRanking): RankingShown {
  const { screen, log, rankingUi } = input
  const { ranking } = open
  const prompt = ranking.prompt
  const lastCheck = lastCheckDue(ranking, rankingUi.lastCheckContinued)
  const band = splitBandOf(ranking, log, rankingUi)
  if (band !== null) return { ...open, kind: 'split', band, lastCheckNext: lastCheck }
  if (lastCheck) return { ...open, kind: 'last-check' }
  switch (prompt.kind) {
    case 'rough-sort':
      return screen === 'board' && ranking.board.open ? { ...open, kind: 'board' } : { ...open, kind: 'rough-sort', prompt }
    case 'duel':
      return ranking.bandChoice || screen === 'bands' ? { ...open, kind: 'band-choice', prompt } : { ...open, kind: 'duel', prompt }
    case 'anchor-duel':
      // Keep My Scale (ADR 0009): no Band to choose.
      return { ...open, kind: 'duel', prompt }
    case 'closer-to':
      return { ...open, kind: 'closer-to', prompt }
    case 'all-complete':
      return { ...open, kind: 'complete' }
  }
}

/**
 * The one screen to show. A screen name whose conditions don't hold falls back: to the Ranking screen while a
 * Ranking is open, else to Start.
 */
export function shownScreen(input: ScreenInput): Shown {
  const { screen, viewer, ranking, oldScores } = input
  if (!viewer) return { kind: 'start' }
  if (screen === 'catchup') return { kind: 'catch-up', viewer }
  // The Picker needs the list itself (a notice isn't enough), enough Anchors, and no saved Ranking it can't replace:
  // a Keep My Scale one continues instead, and one that can't be used blocks anything new.
  if (screen === 'picker') {
    const allowed = input.listLoaded && input.keepMyScaleEligible && !input.savedBroken && !ranking?.keepMyScale
    return allowed ? { kind: 'picker', viewer } : { kind: 'start' }
  }
  const importing = screen === 'import' && input.importing?.stage !== 'dropped' ? input.importing : null
  // A Keep My Scale Ranking is gone once its Import finished (ADR 0010); the summary still shows.
  if (importing?.stage === 'done' && !ranking) return { kind: 'import', viewer, ranking: null, importing }
  // Wait for the list's display data, unless AniList is unreachable: answers still work then, with plain cards.
  if (screen === 'start' || !ranking || !(input.listLoaded || input.notice)) return { kind: 'start' }
  const open = { viewer, ranking }
  if (importing) return { ...open, kind: 'import', importing }
  // Preview only for a Ranking that may have it and whose old scores are loaded. Its scoring settings are the log's
  // own (ADR 0007), put there on the Score Format AniList reports by the fresh `Viewer` check (ADR 0003), which
  // Preview waits for.
  if (screen === 'preview' && input.preview && previewOpen(ranking.prompt) && oldScores && ranking.scoring?.format === viewer.scoreFormat) {
    return { ...open, kind: 'preview', scoring: ranking.scoring.settings, oldScores }
  }
  return promptScreen(input, open)
}
