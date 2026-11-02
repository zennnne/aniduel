// The Top Studios page's single entry point: reads a user's list from AniList and ranks their studios.
import { AniListError } from '../anilist/gateway.ts'
import { scoreStudios, type TopStudios } from './scoring.ts'
import { readFavouriteAnime, readStudioList } from './studioGateway.ts'

export type { StudioScore, StudioVote, TopStudios } from './scoring.ts'

/** How the page reaches AniList: a `fetch`, and the AniDuel! login's token if there is one. */
export type TopStudiosSession = { fetch: typeof fetch; token: string | null }

export type TopStudiosFailure =
  | { kind: 'no-such-user' }
  | { kind: 'private-list' }
  | { kind: 'too-few-scored'; scored: number }
  | { kind: 'rate-limited' }
  | { kind: 'unreachable' }
  /** The token sent was refused; the same name may load without it. */
  | { kind: 'invalid-token' }
  /** Any other AniList error. */
  | { kind: 'api'; message: string }

export type TopStudiosLoad = { ok: true; topStudios: TopStudios } | { ok: false; failure: TopStudiosFailure }

function failureOf(error: AniListError, sentToken: boolean): TopStudiosFailure {
  switch (error.kind) {
    case 'unreachable':
      return { kind: 'unreachable' }
    case 'rate-limited':
      return { kind: 'rate-limited' }
    case 'auth':
      // AniList answers a list it won't show with 401 "Private User"; `request` reads any 401 as an auth error.
      if (/private/i.test(error.message) || !sentToken) return { kind: 'private-list' }
      return { kind: 'invalid-token' }
    case 'api':
      if (error.status === 404 || /not found/i.test(error.message)) return { kind: 'no-such-user' }
      return { kind: 'api', message: error.message }
  }
}

export async function loadTopStudios(session: TopStudiosSession, userName: string): Promise<TopStudiosLoad> {
  try {
    const list = await readStudioList(session, userName)
    const favourites = await readFavouriteAnime(session, userName)
    const scoring = scoreStudios(list, favourites)
    if (!scoring.ok) return { ok: false, failure: { kind: 'too-few-scored', scored: scoring.scored } }
    return { ok: true, topStudios: scoring.topStudios }
  } catch (error) {
    if (error instanceof AniListError) return { ok: false, failure: failureOf(error, Boolean(session.token)) }
    throw error
  }
}
