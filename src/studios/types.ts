// What Top Studios reads about one title on a user's anime list. Kept free of GraphQL details.
import type { ListStatus, Title } from '../anilist/types.ts'

export type Studio = { id: number; name: string }

/** A SEQUEL/PREQUEL link from a title to another one, which joins titles into a franchise (the love count, #90). */
export type FranchiseRelation = { type: 'SEQUEL' | 'PREQUEL'; mediaId: number }

export type StudioTitle = {
  mediaId: number
  status: ListStatus
  /** The user's score on the 10-point decimal scale, whatever their Score Format; 0 means no score. */
  score: number
  /** Episodes watched. */
  progress: number
  /** Times rewatched. */
  repeat: number
  episodes: number | null
  /** Minutes per episode. */
  duration: number | null
  /** Main studios only: AniList also returns the others (its `isMain` argument doesn't filter). */
  studios: Studio[]
  relations: FranchiseRelation[]
  title: Title
  coverUrl: string | null
  coverColor: string | null
  bannerUrl: string | null
  siteUrl: string
}
