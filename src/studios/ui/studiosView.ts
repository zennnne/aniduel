// The Top Studios page's view (spec #87): the shared AniLyze tool view in Top Studios' words, over its load.
import { toolView, type LoadState as ToolLoadState, type ReadLoad, type ToolView, type ToolViewInput } from '../../anilyze/ui/toolView.ts'
import type { TopStudiosLoad } from '../loadTopStudios.ts'
import { rankingOf } from '../scoring.ts'
import { TOP_STUDIOS } from '../tool.ts'

export { searchFor, userOf, type FailureMessage, type HowSure } from '../../anilyze/ui/toolView.ts'

export type LoadState = ToolLoadState<TopStudiosLoad>
export type StudiosViewInput = ToolViewInput<TopStudiosLoad>
export type StudiosView = ToolView

/** Top Studios' load as the shared Ranking, or its failure. */
export const readStudios: ReadLoad<TopStudiosLoad> = (loaded) =>
  loaded.ok ? { ok: true, ranking: rankingOf(loaded.topStudios) } : loaded

export function studiosView(input: StudiosViewInput): StudiosView {
  return toolView(input, TOP_STUDIOS, readStudios)
}
