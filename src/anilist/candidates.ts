// Catch-up candidate query: anime or manga by id, with the relations, recommendations, tags and status distribution the
// suggestion module scores from. Kept beside the gateway so it can grow without touching the Import's calls.
import { numberHeader, request } from './gateway.ts'
import type { MediaType, RateLimit, Title } from './types.ts'

/** AniList clamps `Page(perPage)` to 50. */
export const CANDIDATES_PER_REQUEST = 50

/** One anime or manga as Catch-up sees it: a seed from the user's list, or a candidate to suggest. */
export type CatchUpMedia = {
  id: number
  title: Title
  coverUrl: string | null
  coverColor: string | null
  siteUrl: string
  year: number | null
  format: string | null
  /** AniList's MediaStatus: FINISHED, RELEASING, NOT_YET_RELEASED, CANCELLED or HIATUS. */
  status: string | null
  /** AniList's countryOfOrigin, e.g. JP, KR (manhwa) or CN (manhua). */
  country: string | null
  /** How many AniList users have it on their list as anything but Planning. */
  watched: number
  /** `rank` is AniList's 0–100 relevance of the tag to this title. */
  tags: Array<{ name: string; rank: number }>
  /**
   * Links to other titles of the same Media Type. `type` is AniList's MediaRelation, e.g. SEQUEL means `mediaId` is
   * this title's sequel.
   */
  relations: Array<{ type: string; mediaId: number }>
  /** AniList community recommendations from this title; `rating` is the net vote count. */
  recommendations: Array<{ mediaId: number; rating: number }>
  /** Titles of the other Media Type linked by SOURCE or ADAPTATION: an anime's manga source, a manga's anime. */
  adaptations: number[]
}

/** Relations to the other Media Type that `adaptations` keeps. */
const ADAPTATION_LINKS = new Set(['SOURCE', 'ADAPTATION'])

/** Everything the suggestion module scores a title from. */
const CANDIDATE_FIELDS = `
      id
      title { romaji english native }
      coverImage { large color }
      siteUrl
      startDate { year }
      format
      status
      countryOfOrigin
      popularity
      stats { statusDistribution { status amount } }
      tags { name rank }
      relations { edges { relationType node { id type } } }
      recommendations(perPage: 25, sort: RATING_DESC) { nodes { rating mediaRecommendation { id } } }`

const CANDIDATE_QUERY = `query ($ids: [Int], $perPage: Int, $type: MediaType) {
  Page(perPage: $perPage) {
    media(id_in: $ids, type: $type) {${CANDIDATE_FIELDS}
    }
  }
}`

const POPULAR_QUERY = `query ($page: Int, $perPage: Int, $type: MediaType, $from: FuzzyDateInt, $to: FuzzyDateInt) {
  Page(page: $page, perPage: $perPage) {
    media(type: $type, sort: POPULARITY_DESC, isAdult: false, startDate_greater: $from, startDate_lesser: $to) {${CANDIDATE_FIELDS}
    }
  }
}`

type RawCandidate = {
  id: number
  title: Title
  coverImage: { large: string | null; color: string | null } | null
  siteUrl: string
  startDate: { year: number | null } | null
  format: string | null
  status: string | null
  countryOfOrigin: string | null
  popularity: number | null
  stats: { statusDistribution: Array<{ status: string; amount: number }> | null } | null
  tags: Array<{ name: string; rank: number | null }> | null
  relations: { edges: Array<{ relationType: string; node: { id: number; type: string } | null }> } | null
  recommendations: { nodes: Array<{ rating: number | null; mediaRecommendation: { id: number } | null }> } | null
}

function toCatchUpMedia(raw: RawCandidate, mediaType: MediaType): CatchUpMedia {
  const edges = raw.relations?.edges ?? []
  const planning = raw.stats?.statusDistribution?.find((s) => s.status === 'PLANNING')?.amount ?? 0
  return {
    id: raw.id,
    title: raw.title,
    coverUrl: raw.coverImage?.large ?? null,
    coverColor: raw.coverImage?.color ?? null,
    siteUrl: raw.siteUrl,
    year: raw.startDate?.year ?? null,
    format: raw.format,
    status: raw.status,
    country: raw.countryOfOrigin ?? null,
    watched: Math.max(0, (raw.popularity ?? 0) - planning),
    tags: (raw.tags ?? []).map((t) => ({ name: t.name, rank: t.rank ?? 0 })),
    relations: edges.flatMap((e) => (e.node && e.node.type === mediaType ? [{ type: e.relationType, mediaId: e.node.id }] : [])),
    recommendations: (raw.recommendations?.nodes ?? []).flatMap((n) =>
      n.mediaRecommendation ? [{ mediaId: n.mediaRecommendation.id, rating: n.rating ?? 0 }] : [],
    ),
    adaptations: edges.flatMap((e) =>
      e.node && e.node.type !== mediaType && ADAPTATION_LINKS.has(e.relationType) ? [e.node.id] : [],
    ),
  }
}

type Deps = {
  fetch: typeof fetch
  token: string | null
  onRateLimit?: (rateLimit: RateLimit) => void
  /** Awaited before every request, e.g. to keep to the rate limit. */
  beforeRequest?: () => Promise<void>
}

function rateLimitHeaders(deps: Deps) {
  return (headers: Headers) =>
    deps.onRateLimit?.({
      remaining: numberHeader(headers, 'X-RateLimit-Remaining'),
      resetAt: numberHeader(headers, 'X-RateLimit-Reset'),
    })
}

/**
 * Loads titles of `mediaType` by id, 50 per request; ids of the other Media Type are left out. Throws the gateway's typed `AniListError` (a 429 is
 * `rate-limited`) at the first failing request. `onRateLimit` gets the headers of every response.
 */
export async function fetchCatchUpMedia(
  deps: Deps,
  ids: readonly number[],
  mediaType: MediaType,
): Promise<CatchUpMedia[]> {
  const unique = [...new Set(ids)]
  const media: CatchUpMedia[] = []
  for (let i = 0; i < unique.length; i += CANDIDATES_PER_REQUEST) {
    await deps.beforeRequest?.()
    const data = await request<{ Page: { media: RawCandidate[] } }>(
      deps,
      CANDIDATE_QUERY,
      { ids: unique.slice(i, i + CANDIDATES_PER_REQUEST), perPage: CANDIDATES_PER_REQUEST, type: mediaType },
      rateLimitHeaders(deps),
    )
    media.push(...data.Page.media.map((m) => toCatchUpMedia(m, mediaType)))
  }
  return media
}

/** Years in which titles started, both ends included. */
export type Era = { from: number; to: number }

/**
 * The most popular titles of `mediaType` that started within `era` (all-time without one), `pages` pages of 50, with
 * the same fields as `fetchCatchUpMedia`. Throws the gateway's `AniListError` like it.
 */
export async function fetchPopularMedia(
  deps: Deps,
  mediaType: MediaType,
  era: Era | null,
  pages: number,
): Promise<CatchUpMedia[]> {
  // FuzzyDateInt is YYYYMMDD and both bounds are exclusive.
  const range = era ? { from: (era.from - 1) * 10000 + 1231, to: (era.to + 1) * 10000 } : {}
  // The pages are asked for together.
  const loaded = await Promise.all(
    Array.from({ length: pages }, async (_, i) => {
      await deps.beforeRequest?.()
      const data = await request<{ Page: { media: RawCandidate[] } }>(
        deps,
        POPULAR_QUERY,
        { page: i + 1, perPage: CANDIDATES_PER_REQUEST, type: mediaType, ...range },
        rateLimitHeaders(deps),
      )
      return data.Page.media.map((m) => toCatchUpMedia(m, mediaType))
    }),
  )
  return loaded.flat()
}

const FAVOURITE_ANIME_QUERY = `query ($userId: Int, $page: Int) {
  User(id: $userId) {
    favourites { anime(page: $page, perPage: 25) { pageInfo { hasNextPage } nodes { id } } }
  }
}`

type RawFavourites = { User: { favourites: { anime: { pageInfo: { hasNextPage: boolean }; nodes: Array<{ id: number }> } } } }

/** The user's favourite anime, by media id, every page. Throws the gateway's `AniListError` like `fetchCatchUpMedia`. */
export async function fetchFavouriteAnime(deps: Deps, userId: number): Promise<number[]> {
  const ids: number[] = []
  for (let page = 1; ; page++) {
    await deps.beforeRequest?.()
    const data = await request<RawFavourites>(deps, FAVOURITE_ANIME_QUERY, { userId, page }, rateLimitHeaders(deps))
    const { anime } = data.User.favourites
    ids.push(...anime.nodes.map((n) => n.id))
    if (!anime.pageInfo.hasNextPage) return ids
  }
}
