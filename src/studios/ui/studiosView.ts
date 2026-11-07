// The Top Studios page's view (spec #87): the shared AniLyze tool view in Top Studios' words, over its load.
import { toolView, type ToolView, type ToolViewInput } from '../../anilyze/ui/toolView.ts'
import { TOP_STUDIOS } from '../tool.ts'

export function studiosView(input: ToolViewInput): ToolView {
  return toolView(input, TOP_STUDIOS)
}
