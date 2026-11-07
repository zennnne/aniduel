// Director data gateway: reads one user's anime list with each title's Directors (and franchise links) by user name,
// over the list read every AniLyze tool shares (src/anilyze/listGateway.ts). Staff sit on the list query itself, which
// holds on the largest lists (docs/research/top-director-score.md §2): no requests beyond the list chunks.
import { readToolList } from '../anilyze/listGateway.ts'
import type { Director, DirectorTitle, TopDirectorsSession } from './types.ts'

/**
 * The first page of 25 credits, by RELEVANCE: a title's Directors come first there (a title has 100 to 1,000 credits,
 * and paging them all would cost hundreds of requests). The prototype reads the same page, so parity holds.
 */
const STAFF_FIELDS = 'staff(sort: [RELEVANCE], perPage: 25) { edges { role node { id name { full } image { large } siteUrl } } }'

type StaffMedia = {
  staff: {
    edges: Array<{
      role: string | null
      node: { id: number; name: { full: string | null }; image: { large: string | null } | null; siteUrl: string } | null
    }>
  } | null
}

const DIRECTOR_ROLES: ReadonlySet<string> = new Set(['Director', 'Chief Director', 'Series Director'])
/** An opening or ending named in the parenthesis: OP, ED, OP2, ED1-ED3, "Opening", "Ending" (owner, #101). */
const OPENING_OR_ENDING = [/\b(?:OP|ED)\d*\b/, /\b(?:opening|ending)s?\b/i]

/**
 * The Director rule (GLOSSARY.md): the role before any parenthesis is exactly Director, Chief Director or Series
 * Director ("Director (eps 1-6)" counts), and the parenthesis doesn't name an opening or ending ("Director (OP)").
 */
function isDirector(role: string): boolean {
  const at = role.indexOf('(')
  const head = at === -1 ? role : role.slice(0, at)
  const paren = at === -1 ? '' : role.slice(at + 1)
  return DIRECTOR_ROLES.has(head.trim()) && !OPENING_OR_ENDING.some((pattern) => pattern.test(paren))
}

/** The title's Directors, each person once, in credit order. */
function directorsOf(media: StaffMedia): { directors: Director[] } {
  const directors = new Map<number, Director>()
  for (const { role, node } of media.staff?.edges ?? []) {
    if (!node || !role || !isDirector(role) || directors.has(node.id)) continue
    directors.set(node.id, { id: node.id, name: node.name.full ?? '', image: node.image?.large ?? null, siteUrl: node.siteUrl })
  }
  return { directors: [...directors.values()] }
}

/** The user's whole anime list, every status, following every chunk, with each title's Directors. */
export function readDirectorList(
  session: TopDirectorsSession,
  userName: string,
  onChunk?: (titles: number) => void,
): Promise<DirectorTitle[]> {
  return readToolList<StaffMedia, { directors: Director[] }>(session, userName, STAFF_FIELDS, directorsOf, onChunk)
}
