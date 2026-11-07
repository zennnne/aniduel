// What Top Studios reads about one title on a user's anime list: the shared list title and its main studios.
import type { ListTitle, ToolSession, Who } from '../anilyze/types.ts'

export { isDropped, rewatchesOf } from '../anilyze/types.ts'
export type { FranchiseRelation } from '../anilyze/types.ts'

/** How the page reaches AniList: a `fetch`, and the AniDuel! login's token if there is one. */
export type TopStudiosSession = ToolSession

export type Studio = Who

export type StudioTitle = ListTitle & {
  /** Main studios only: AniList also returns the others (its `isMain` argument doesn't filter). */
  studios: Studio[]
}
