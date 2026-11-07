// Studio Score v2.8 for Top Studios: the shared AniLyze scoring over each title's main studios, with Top Studios'
// numbers (./tool.ts). Pure: takes the titles on the user's list and their favourite anime, returns the ranked studios.
import { scoreList, type Label, type Ranking, type Vote, type WhoScore } from '../anilyze/scoring.ts'
import { TOP_STUDIOS } from './tool.ts'
import type { StudioTitle } from './types.ts'

export { entropicMean, LABEL_GRID, labelRates, MIN_SCORED, points, scoreWorth, utility } from '../anilyze/scoring.ts'
export type { ScoreScale } from '../anilyze/scoring.ts'
export { GATE, GATE_TARGET, K } from './tool.ts'

export type StudioLabel = Label
/** One counted title in one studio's score. */
export type StudioVote = Vote<StudioTitle>
export type StudioScore = WhoScore<StudioTitle>

/** A Ranking of studios, with the ranked ones under `studios`. */
export type TopStudios = Omit<Ranking<StudioTitle>, 'ranked'> & {
  /** Studios with at least `gate` Votes, best first. */
  studios: StudioScore[]
}

export type StudioScoring = { ok: true; topStudios: TopStudios } | { ok: false; reason: 'too-few-scored'; scored: number }

/** Ranks the user's studios by Studio Score v2.8: each title counts for each of its main studios, in full. */
export function scoreStudios(list: readonly StudioTitle[], favouriteIds: Iterable<number>): StudioScoring {
  const scoring = scoreList(list, favouriteIds, (title) => title.studios, TOP_STUDIOS.scoring)
  if (!scoring.ok) return scoring
  const { ranked, ...rest } = scoring.ranking
  return { ok: true, topStudios: { studios: ranked, ...rest } }
}

/** Top Studios as the shared Ranking the AniLyze views and components read. */
export function rankingOf({ studios, ...rest }: TopStudios): Ranking<StudioTitle> {
  return { ranked: studios, ...rest }
}
