// What an AniLyze tool reads about one title on a user's anime list, whoever the title counts for. Kept free of GraphQL
// details.
import type { ListStatus, Title } from '../anilist/types.ts'

/** How a tool page reaches AniList: a `fetch`, and the AniDuel! login's token if there is one. */
export type ToolSession = { fetch: typeof fetch; token: string | null }

/**
 * Who a title counts for on a tool: a studio on Top Studios, a Director on Top Directors. `image` is their own picture
 * where AniList has one (a Director's face; a studio has none).
 */
export type Who = { id: number; name: string; image?: string | null }

/** A SEQUEL/PREQUEL link from a title to another one, which joins titles into a Franchise (the Love count, #90). */
export type FranchiseRelation = { type: 'SEQUEL' | 'PREQUEL'; mediaId: number }

export type ListTitle = {
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
  relations: FranchiseRelation[]
  title: Title
  coverUrl: string | null
  coverColor: string | null
  bannerUrl: string | null
  siteUrl: string
}

/** Whether the user dropped it. */
export const isDropped = (title: ListTitle): boolean => title.status === 'DROPPED'

/** Times the user rewatched it: a title being rewatched now counts at least once. */
export const rewatchesOf = (title: ListTitle): number => Math.max(title.repeat, title.status === 'REPEATING' ? 1 : 0)
