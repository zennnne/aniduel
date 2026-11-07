// How every AniLyze tool loads a user's list: fresh from AniList (nothing is cached), scored by the shared scoring with
// the tool's numbers, AniList's errors read as the failures the page explains, and a refused token dropped so a stale
// AniDuel! login never blocks a public list.
import { AniListError } from '../anilist/gateway.ts'
import { readFavouriteAnime } from './listGateway.ts'
import { scoreList, type ToolResult } from './scoring.ts'
import type { Tool } from './tool.ts'
import type { ListTitle, ToolSession, Who } from './types.ts'

export type ToolFailure =
  | { kind: 'no-such-user' }
  | { kind: 'private-list' }
  | { kind: 'too-few-scored'; scored: number }
  | { kind: 'rate-limited' }
  | { kind: 'unreachable' }
  /** Any other AniList error. */
  | { kind: 'api'; message: string }

/** A tool's load: what it made of the list, or why the list couldn't be ranked. */
export type ToolLoad<T extends ListTitle = ListTitle, W extends Who = Who> =
  | { ok: true; result: ToolResult<T, W> }
  | { ok: false; failure: ToolFailure }

/**
 * How far a load has got, for the page to show while it waits: the list read `titles` deep (after each chunk), then
 * the whole list read and the favourites being read. Scoring follows at once.
 */
export type LoadProgress = { step: 'list'; titles: number } | { step: 'favourites'; titles: number }

/** Hears a load's progress. */
export type OnProgress = (progress: LoadProgress) => void

/**
 * How a tool reads the user's list: every title, with who each one counts for on it, telling `onChunk` how many titles
 * are read so far after each chunk.
 */
export type ToolListReader<T extends ListTitle> = (
  session: ToolSession,
  userName: string,
  onChunk?: (titles: number) => void,
) => Promise<T[]>

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
 * Reads `userName`'s list with `readList` and their favourite anime, and scores whoever `countsFor` says each title
 * counts for, with the tool's numbers. AniList's errors become failures; a token AniList refuses is dropped and the
 * list read again without it (its progress starting over). `onProgress` hears how far the read has got.
 */
export async function loadTool<T extends ListTitle, W extends Who>(
  session: ToolSession,
  userName: string,
  tool: Tool,
  readList: ToolListReader<T>,
  countsFor: (title: T) => readonly W[],
  onProgress?: OnProgress,
): Promise<ToolLoad<T, W>> {
  const read = async (session: ToolSession): Promise<ToolLoad<T, W>> => {
    const list = await readList(session, userName, onProgress && ((titles) => onProgress({ step: 'list', titles })))
    onProgress?.({ step: 'favourites', titles: list.length })
    const favourites = await readFavouriteAnime(session, userName)
    const scoring = scoreList(list, favourites, countsFor, tool.scoring)
    if (!scoring.ok) return { ok: false, failure: { kind: 'too-few-scored', scored: scoring.scored } }
    return { ok: true, result: scoring.result }
  }
  const loaded = await loadWith(session, read)
  if (loaded !== TOKEN_REFUSED) return loaded
  const again = await loadWith({ ...session, token: null }, read)
  // Without a token there is nothing left to refuse.
  return again === TOKEN_REFUSED ? { ok: false, failure: { kind: 'private-list' } } : again
}

async function loadWith<T extends ListTitle, W extends Who>(
  session: ToolSession,
  read: (session: ToolSession) => Promise<ToolLoad<T, W>>,
): Promise<ToolLoad<T, W> | typeof TOKEN_REFUSED> {
  try {
    return await read(session)
  } catch (error) {
    if (!(error instanceof AniListError)) throw error
    const failure = failureOf(error, Boolean(session.token))
    return failure === TOKEN_REFUSED ? failure : { ok: false, failure }
  }
}
