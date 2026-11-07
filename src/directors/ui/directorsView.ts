// The Top Directors page's view: the shared AniLyze tool view in Top Directors' words, over its load, each Director
// pictured by their own face (#99's P1).
import type { CardPicture } from '../../anilyze/ui/resultView.ts'
import { toolView, type ToolView, type ToolViewInput } from '../../anilyze/ui/toolView.ts'
import { TOP_DIRECTORS } from '../tool.ts'

/** A Director's picture is their own face from AniList; none when AniList has none (the page shows their initials). */
export const directorPicture: CardPicture = (who) => ({ cover: who.image ?? null, coverColor: null })

export function directorsView(input: ToolViewInput): ToolView {
  return toolView(input, TOP_DIRECTORS, directorPicture)
}
