// The Top Studios page's single entry point: reads a user's list from AniList and ranks their studios by Studio Score
// v2.8, the shared AniLyze scoring over each title's main studios with Top Studios' numbers (./tool.ts).
import { loadTool, type OnProgress, type ToolLoad } from '../anilyze/load.ts'
import type { ToolResult } from '../anilyze/scoring.ts'
import { readStudioList } from './studioGateway.ts'
import { TOP_STUDIOS } from './tool.ts'
import type { Studio, StudioTitle, TopStudiosSession } from './types.ts'

/** The user's studios ranked: those with at least `gate` Votes under `ranked`, best first. */
export type TopStudios = ToolResult<StudioTitle, Studio>

export type TopStudiosLoad = ToolLoad<StudioTitle, Studio>

/**
 * Reads the user's list fresh (nothing is cached) and ranks their studios: each title counts for each of its main
 * studios, in full. A token AniList refuses is dropped and the list read again without it, so a stale AniDuel! login
 * never stands between the page and a public list. `onProgress` hears how far the read has got.
 */
export function loadTopStudios(session: TopStudiosSession, userName: string, onProgress?: OnProgress): Promise<TopStudiosLoad> {
  return loadTool(session, userName, TOP_STUDIOS, readStudioList, (title) => title.studios, onProgress)
}
