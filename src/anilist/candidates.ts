// Catch-up candidate query: anime by id, with the relations, recommendations, tags and status distribution the
// suggestion module scores from. Kept beside the gateway so it can grow without touching the Import's calls.
import { numberHeader, request } from './gateway.ts'
import type { RateLimit, Title } from './types.ts'

/** AniList clamps `Page(perPage)` to 50. */
export const CANDIDATES_PER_REQUEST = 50

/** One anime as Catch-up sees it: a seed from the user's list, or a candidate to suggest. */
export type CatchUpMedia = {
  id: number
  title: Title
  coverUrl: string | null
  coverColor: string | null
  year: number | null
  format: string | null
  /** AniList's MediaStatus: FINISHED, RELEASING, NOT_YET_RELEASED, CANCELLED or HIATUS. */
  status: string | null
  /** How many AniList users have it on their list as anything but Planning. */
  watched: number
  /** `rank` is AniList's 0–100 relevance of the tag to this title. */
  tags: Array<{ name: string; rank: number }>
  /** Links to other anime. `type` is AniList's MediaRelation, e.g. SEQUEL means `mediaId` is this title's sequel. */
  relations: Array<{ type: string; mediaId: number }>
  /** AniList community recommendations from this title; `rating` is the net vote count. */
  recommendations: Array<{ mediaId: number; rating: number }>
}

const CANDIDATE_QUERY = `query ($ids: [Int], $perPage: Int) {
  Page(perPage: $perPage) {
    media(id_in: $ids, type: ANIME) {
      id
      title { romaji english native }
      coverImage { large color }
      startDate { year }
      format
      status
      popularity
      stats { statusDistribution { status amount } }
      tags { name rank }
      relations { edges { relationType node { id type } } }
      recommendations(perPage: 25, sort: RATING_DESC) { nodes { rating mediaRecommendation { id } } }
    }
  }
}`

type RawCandidate = {
  id: number
  title: Title
  coverImage: { large: string | null; color: string | null } | null
  startDate: { year: number | null } | null
  format: string | null
  status: string | null
  popularity: number | null
  stats: { statusDistribution: Array<{ status: string; amount: number }> | null } | null
  tags: Array<{ name: string; rank: number | null }> | null
  relations: { edges: Array<{ relationType: string; node: { id: number; type: string } | null }> } | null
  recommendations: { nodes: Array<{ rating: number | null; mediaRecommendation: { id: number } | null }> } | null
}

function toCatchUpMedia(raw: RawCandidate): CatchUpMedia {
  const planning = raw.stats?.statusDistribution?.find((s) => s.status === 'PLANNING')?.amount ?? 0
  return {
    id: raw.id,
    title: raw.title,
    coverUrl: raw.coverImage?.large ?? null,
    coverColor: raw.coverImage?.color ?? null,
    year: raw.startDate?.year ?? null,
    format: raw.format,
    status: raw.status,
    watched: Math.max(0, (raw.popularity ?? 0) - planning),
    tags: (raw.tags ?? []).map((t) => ({ name: t.name, rank: t.rank ?? 0 })),
    relations: (raw.relations?.edges ?? []).flatMap((e) =>
      e.node && e.node.type === 'ANIME' ? [{ type: e.relationType, mediaId: e.node.id }] : [],
    ),
    recommendations: (raw.recommendations?.nodes ?? []).flatMap((n) =>
      n.mediaRecommendation ? [{ mediaId: n.mediaRecommendation.id, rating: n.rating ?? 0 }] : [],
    ),
  }
}

/**
 * Loads anime by id, 50 per request. Throws the gateway's typed `AniListError` (a 429 is
 * `rate-limited`) at the first failing request. `onRateLimit` gets the headers of every response.
 */
export async function fetchCatchUpMedia(
  deps: { fetch: typeof fetch; token: string; onRateLimit?: (rateLimit: RateLimit) => void },
  ids: readonly number[],
): Promise<CatchUpMedia[]> {
  const unique = [...new Set(ids)]
  const media: CatchUpMedia[] = []
  for (let i = 0; i < unique.length; i += CANDIDATES_PER_REQUEST) {
    const data = await request<{ Page: { media: RawCandidate[] } }>(
      deps,
      CANDIDATE_QUERY,
      { ids: unique.slice(i, i + CANDIDATES_PER_REQUEST), perPage: CANDIDATES_PER_REQUEST },
      (headers) =>
        deps.onRateLimit?.({
          remaining: numberHeader(headers, 'X-RateLimit-Remaining'),
          resetAt: numberHeader(headers, 'X-RateLimit-Reset'),
        }),
    )
    media.push(...data.Page.media.map(toCatchUpMedia))
  }
  return media
}
