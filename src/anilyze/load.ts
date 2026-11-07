// How every AniLyze tool loads a user's list: fresh from AniList (nothing is cached), AniList's errors read as the
// failures the page explains, and a refused token dropped so a stale AniDuel! login never blocks a public list.
import { AniListError } from '../anilist/gateway.ts'
import type { ToolSession } from './types.ts'

export type ToolFailure =
  | { kind: 'no-such-user' }
  | { kind: 'private-list' }
  | { kind: 'too-few-scored'; scored: number }
  | { kind: 'rate-limited' }
  | { kind: 'unreachable' }
  /** Any other AniList error. */
  | { kind: 'api'; message: string }

/** A tool's load: its own result (`{ ok: true, … }`), or why the list couldn't be ranked. */
export type ToolLoad<Result extends { ok: true }> = Result | { ok: false; failure: ToolFailure }

/** The token sent was refused (expired or revoked): the same name may still load without it. */
const TOKEN_REFUSED = 'token-refused'

function failureOf(error: AniListError, sentToken: boolean): ToolFailure | typeof TOKEN_REFUSED {
  // AniList answers a list it won't show with "Private User" (a 401 so far); the message wins whatever the status.
  if (/private/i.test(error.message)) return { kind: 'private-list' }
  switch (error.kind) {
    case 'unreachable':
      return { kind: 'unreachable' }
    case 'rate-limited':
      return { kind: 'rate-limited' }
    case 'auth':
      // `request` reads any 401 as an auth error; with no token sent, the only thing refused is the list.
      if (!sentToken) return { kind: 'private-list' }
      return TOKEN_REFUSED
    case 'api':
      if (error.status === 404 || /not found/i.test(error.message)) return { kind: 'no-such-user' }
      return { kind: 'api', message: error.message }
  }
}

/**
 * Runs `read` (the tool's AniList reads and scoring) and turns AniList's errors into failures. A token AniList refuses
 * is dropped and `read` run again without it.
 */
export async function loadTool<Result extends { ok: true }>(
  session: ToolSession,
  read: (session: ToolSession) => Promise<ToolLoad<Result>>,
): Promise<ToolLoad<Result>> {
  const loaded = await loadWith(session, read)
  if (loaded !== TOKEN_REFUSED) return loaded
  const again = await loadWith({ ...session, token: null }, read)
  // Without a token there is nothing left to refuse.
  return again === TOKEN_REFUSED ? { ok: false, failure: { kind: 'private-list' } } : again
}

async function loadWith<Result extends { ok: true }>(
  session: ToolSession,
  read: (session: ToolSession) => Promise<ToolLoad<Result>>,
): Promise<ToolLoad<Result> | typeof TOKEN_REFUSED> {
  try {
    return await read(session)
  } catch (error) {
    if (!(error instanceof AniListError)) throw error
    const failure = failureOf(error, Boolean(session.token))
    return failure === TOKEN_REFUSED ? failure : { ok: false, failure }
  }
}
