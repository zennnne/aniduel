// The Top Directors page's single entry point: reads a user's list from AniList and ranks their Directors by the
// Director Score, the shared AniLyze scoring over each title's Directors with Top Directors' numbers (./tool.ts).
import { loadTool, type OnProgress, type ToolLoad } from '../anilyze/load.ts'
import type { ToolResult } from '../anilyze/scoring.ts'
import { readDirectorList } from './directorGateway.ts'
import { TOP_DIRECTORS } from './tool.ts'
import type { Director, DirectorTitle, TopDirectorsSession } from './types.ts'

/** The user's Directors ranked, each with their picture (or null) and AniList page from the gateway. */
export type TopDirectors = ToolResult<DirectorTitle, Director>

export type TopDirectorsLoad = ToolLoad<DirectorTitle, Director>

/**
 * Reads the user's list fresh (nothing is cached) and ranks their Directors: each title counts for each of its
 * Directors, in full. A token AniList refuses is dropped and the list read again without it, so a stale AniDuel! login
 * never stands between the page and a public list. `onProgress` hears how far the read has got.
 */
export function loadTopDirectors(session: TopDirectorsSession, userName: string, onProgress?: OnProgress): Promise<TopDirectorsLoad> {
  return loadTool(session, userName, TOP_DIRECTORS, readDirectorList, (title) => title.directors, onProgress)
}
