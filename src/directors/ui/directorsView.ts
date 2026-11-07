// The Top Directors page's view: the shared AniLyze tool view in Top Directors' words, over its load, each Director
// pictured by their own face (#99's P1).
import type { CardPicture } from '../../anilyze/ui/resultView.ts'
import { toolView, type LoadState as ToolLoadState, type ReadLoad, type ToolView, type ToolViewInput } from '../../anilyze/ui/toolView.ts'
import type { TopDirectorsLoad } from '../loadTopDirectors.ts'
import { rankingOf } from '../scoring.ts'
import { TOP_DIRECTORS } from '../tool.ts'

export { searchFor, userOf, type FailureMessage, type HowSure } from '../../anilyze/ui/toolView.ts'

export type LoadState = ToolLoadState<TopDirectorsLoad>
export type DirectorsViewInput = ToolViewInput<TopDirectorsLoad>
export type DirectorsView = ToolView

/** Top Directors' load as the shared Ranking, or its failure. */
export const readDirectors: ReadLoad<TopDirectorsLoad> = (loaded) =>
  loaded.ok ? { ok: true, ranking: rankingOf(loaded.topDirectors) } : loaded

/** A Director's picture is their own face from AniList; none when AniList has none (the page shows their initials). */
export const directorPicture: CardPicture = (who) => ({ cover: who.image ?? null, coverColor: null })

export function directorsView(input: DirectorsViewInput): DirectorsView {
  return toolView(input, TOP_DIRECTORS, readDirectors, directorPicture)
}
