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
  /** Any other AniList error. */
  | { kind: 'api'; message: string }

export type TopStudiosLoad = { ok: true; topStudios: TopStudios } | { ok: false; failure: TopStudiosFailure }

/** The token sent was refused (expired or revoked): the same name may still load without it. */
const TOKEN_REFUSED = 'token-refused'

function failureOf(error: AniListError, sentToken: boolean): TopStudiosFailure | typeof TOKEN_REFUSED {
  switch (error.kind) {
    case 'unreachable':
      return { kind: 'unreachable' }
    case 'rate-limited':
      return { kind: 'rate-limited' }
    case 'auth':
      // AniList answers a list it won't show with 401 "Private User"; `request` reads any 401 as an auth error.
      if (/private/i.test(error.message) || !sentToken) return { kind: 'private-list' }
      return TOKEN_REFUSED
    case 'api':
      if (error.status === 404 || /not found/i.test(error.message)) return { kind: 'no-such-user' }
      return { kind: 'api', message: error.message }
  }
}

/**
 * Reads the user's list fresh (nothing is cached) and ranks their studios. A token AniList refuses is dropped and the
 * list read again without it, so a stale AniDuel! login never stands between the page and a public list.
 */
export async function loadTopStudios(session: TopStudiosSession, userName: string): Promise<TopStudiosLoad> {
  const loaded = await loadWith(session, userName)
  if (loaded !== TOKEN_REFUSED) return loaded
  const again = await loadWith({ ...session, token: null }, userName)
  // Without a token there is nothing left to refuse.
  return again === TOKEN_REFUSED ? { ok: false, failure: { kind: 'private-list' } } : again
}

async function loadWith(session: TopStudiosSession, userName: string): Promise<TopStudiosLoad | typeof TOKEN_REFUSED> {
  try {
    const list = await readStudioList(session, userName)
    const favourites = await readFavouriteAnime(session, userName)
    const scoring = scoreStudios(list, favourites)
    if (!scoring.ok) return { ok: false, failure: { kind: 'too-few-scored', scored: scoring.scored } }
    return { ok: true, topStudios: scoring.topStudios }
  } catch (error) {
    if (!(error instanceof AniListError)) throw error
    const failure = failureOf(error, Boolean(session.token))
    return failure === TOKEN_REFUSED ? failure : { ok: false, failure }
  }
}
