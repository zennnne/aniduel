// Top Directors: the shared AniLyze tool page in Top Directors' words, each Director pictured by their own face.
import { FacePicture } from '../../anilyze/ui/Picture.tsx'
import { ToolPage } from '../../anilyze/ui/ToolPage.tsx'
import { loadTopDirectors, type TopDirectorsSession } from '../loadTopDirectors.ts'
import { TOP_DIRECTORS } from '../tool.ts'
import { directorPicture, directorsView } from './directorsView.ts'

export function DirectorsPage({ session }: { session: TopDirectorsSession }) {
  return (
    <ToolPage
      session={session}
      tool={TOP_DIRECTORS}
      load={loadTopDirectors}
      view={directorsView}
      Picture={FacePicture}
      cardPicture={directorPicture}
    />
  )
}
