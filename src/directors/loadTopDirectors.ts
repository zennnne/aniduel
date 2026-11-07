// The Top Directors page's single entry point: reads a user's list from AniList and ranks their Directors.
import { loadTool, type ToolFailure, type ToolLoad } from '../anilyze/load.ts'
import { readDirectorList, readFavouriteAnime } from './directorGateway.ts'
import { scoreDirectors, type TopDirectors } from './scoring.ts'
import type { TopDirectorsSession } from './types.ts'

export type { DirectorScore, DirectorVote, TopDirectors } from './scoring.ts'
export type { TopDirectorsSession } from './types.ts'

export type TopDirectorsFailure = ToolFailure

export type TopDirectorsLoad = ToolLoad<{ ok: true; topDirectors: TopDirectors }>

/**
 * Reads the user's list fresh (nothing is cached) and ranks their Directors. A token AniList refuses is dropped and
 * the list read again without it, so a stale AniDuel! login never stands between the page and a public list.
 */
export function loadTopDirectors(session: TopDirectorsSession, userName: string): Promise<TopDirectorsLoad> {
  return loadTool<{ ok: true; topDirectors: TopDirectors }>(session, async (session) => {
    const list = await readDirectorList(session, userName)
    const favourites = await readFavouriteAnime(session, userName)
    const scoring = scoreDirectors(list, favourites)
    if (!scoring.ok) return { ok: false, failure: { kind: 'too-few-scored', scored: scoring.scored } }
    return { ok: true, topDirectors: scoring.topDirectors }
  })
}
