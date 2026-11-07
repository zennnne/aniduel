// What Top Directors reads about one title on a user's anime list: the shared list title and its Directors.
import type { ListTitle, ToolSession, Who } from '../anilyze/types.ts'

/** How the page reaches AniList: a `fetch`, and the AniDuel! login's token if there is one. */
export type TopDirectorsSession = ToolSession

/** A Director with their picture (null when AniList has none) and AniList page. */
export type Director = Who & { image: string | null; siteUrl: string }

export type DirectorTitle = ListTitle & {
  /** The title's Directors (GLOSSARY.md), each once, in AniList's credit order; none when it has no Director credit. */
  directors: Director[]
}
