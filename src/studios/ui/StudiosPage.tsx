// Top Studios: the shared AniLyze tool page in Top Studios' words, each studio pictured by its best title's cover.
import { CoverPicture } from '../../anilyze/ui/Picture.tsx'
import { ToolPage } from '../../anilyze/ui/ToolPage.tsx'
import { loadTopStudios, type TopStudiosSession } from '../loadTopStudios.ts'
import { TOP_STUDIOS } from '../tool.ts'
import { studiosView } from './studiosView.ts'

export function StudiosPage({ session }: { session: TopStudiosSession }) {
  return <ToolPage session={session} tool={TOP_STUDIOS} load={loadTopStudios} view={studiosView} Picture={CoverPicture} />
}
