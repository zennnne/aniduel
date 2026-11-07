// Studio data gateway: reads one user's anime list with each title's main studios (and franchise links) by user name,
// over the list read every AniLyze tool shares (src/anilyze/listGateway.ts).
import { readToolList } from '../anilyze/listGateway.ts'
import type { Studio, StudioTitle, TopStudiosSession } from './types.ts'

const STUDIO_FIELDS = 'studios { edges { isMain node { id name } } }'

type StudioMedia = { studios: { edges: Array<{ isMain: boolean; node: { id: number; name: string } }> } | null }

/** Main studios only: AniList also returns the others (its `isMain` argument doesn't filter). Each studio once. */
function mainStudios(media: StudioMedia): { studios: Studio[] } {
  const studios = new Map<number, string>()
  for (const edge of media.studios?.edges ?? []) {
    if (edge.isMain && !studios.has(edge.node.id)) studios.set(edge.node.id, edge.node.name)
  }
  return { studios: [...studios].map(([id, name]) => ({ id, name })) }
}

/** The user's whole anime list, every status, following every chunk. */
export function readStudioList(session: TopStudiosSession, userName: string): Promise<StudioTitle[]> {
  return readToolList<StudioMedia, { studios: Studio[] }>(session, userName, STUDIO_FIELDS, mainStudios)
}
