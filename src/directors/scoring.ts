// The Director Score for Top Directors: the shared AniLyze scoring over each title's Directors, with Top Directors'
// numbers (./tool.ts). Pure: takes the titles on the user's list and their favourite anime, returns the ranked Directors.
import { scoreList, type Ranking, type Vote, type WhoScore } from '../anilyze/scoring.ts'
import { TOP_DIRECTORS } from './tool.ts'
import type { DirectorTitle } from './types.ts'

/** One counted title in one Director's score. */
export type DirectorVote = Vote<DirectorTitle>
export type DirectorScore = WhoScore<DirectorTitle> & { image: string | null; siteUrl: string }

/** A Ranking of Directors, with the ranked ones under `directors`. */
export type TopDirectors = Omit<Ranking<DirectorTitle>, 'ranked' | 'watchlist'> & {
  /** Directors with at least `gate` Votes, best first. */
  directors: DirectorScore[]
  watchlist: DirectorScore[]
}

export type DirectorScoring = { ok: true; topDirectors: TopDirectors } | { ok: false; reason: 'too-few-scored'; scored: number }

/** Ranks the user's Directors by the Director Score: each title counts for each of its Directors, in full. */
export function scoreDirectors(list: readonly DirectorTitle[], favouriteIds: Iterable<number>): DirectorScoring {
  const scoring = scoreList(list, favouriteIds, (title) => title.directors, TOP_DIRECTORS.scoring)
  if (!scoring.ok) return scoring
  const { ranked, watchlist, ...rest } = scoring.ranking
  // Every Director comes with a picture (or null) and a page from the gateway.
  return { ok: true, topDirectors: { directors: ranked as DirectorScore[], watchlist: watchlist as DirectorScore[], ...rest } }
}

/** Top Directors as the shared Ranking the AniLyze views and components read. */
export function rankingOf({ directors, ...rest }: TopDirectors): Ranking<DirectorTitle> {
  return { ranked: directors, ...rest }
}
