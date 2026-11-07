// The Top Studios page's single entry point: reads a user's list from AniList and ranks their studios.
import { loadTool, type ToolFailure, type ToolLoad } from '../anilyze/load.ts'
import { scoreStudios, type TopStudios } from './scoring.ts'
import { readFavouriteAnime, readStudioList } from './studioGateway.ts'
import type { TopStudiosSession } from './types.ts'

export { GATE, GATE_TARGET, LABEL_GRID, labelRates, MIN_SCORED, scoreWorth, utility } from './scoring.ts'
export type { StudioLabel, StudioScore, StudioVote, TopStudios } from './scoring.ts'
export type { TopStudiosSession } from './types.ts'

export type TopStudiosFailure = ToolFailure

export type TopStudiosLoad = ToolLoad<{ ok: true; topStudios: TopStudios }>

/**
 * Reads the user's list fresh (nothing is cached) and ranks their studios. A token AniList refuses is dropped and the
 * list read again without it, so a stale AniDuel! login never stands between the page and a public list.
 */
export function loadTopStudios(session: TopStudiosSession, userName: string): Promise<TopStudiosLoad> {
  return loadTool<{ ok: true; topStudios: TopStudios }>(session, async (session) => {
    const list = await readStudioList(session, userName)
    const favourites = await readFavouriteAnime(session, userName)
    const scoring = scoreStudios(list, favourites)
    if (!scoring.ok) return { ok: false, failure: { kind: 'too-few-scored', scored: scoring.scored } }
    return { ok: true, topStudios: scoring.topStudios }
  })
}
