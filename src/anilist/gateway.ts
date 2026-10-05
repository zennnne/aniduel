// AniList Gateway: a thin GraphQL client over an injected `fetch`.
import type { Cover, ListEntry, ListStatus, MediaType, RateLimit, Viewer } from './types.ts'

export const ANILIST_GRAPHQL_URL = 'https://graphql.anilist.co'

/** The most entries AniList returns in one MediaListCollection chunk. */
const PER_CHUNK = 500

export type AniListErrorKind = 'auth' | 'rate-limited' | 'unreachable' | 'api'

export class AniListError extends Error {
  readonly kind: AniListErrorKind
  readonly status: number | null

  constructor(kind: AniListErrorKind, message: string, status: number | null = null) {
    super(message)
    this.name = 'AniListError'
    this.kind = kind
    this.status = status
  }
}

export type MediaListQuery = { userId: number; type: MediaType; statuses: readonly ListStatus[] }

export type AniListGateway = {
  viewer(): Promise<Viewer>
  /** The user's whole list for one Media Type and set of statuses, following every chunk. */
  mediaList(query: MediaListQuery): Promise<ListEntry[]>
  /**
   * Writes one title's score with `SaveMediaListEntry`. Only `mediaId` and `scoreRaw` are sent: spike #3 found every
   * other field of the entry is kept.
   */
  saveScore(mediaId: number, scoreRaw: number): Promise<void>
  /** Rate-limit headers from the most recent response. */
  rateLimit(): RateLimit
}

const VIEWER_QUERY = `query {
  Viewer {
    id
    name
    avatar { medium }
    options { titleLanguage }
    mediaListOptions { scoreFormat }
  }
}`

const MEDIA_LIST_QUERY = `query ($userId: Int, $type: MediaType, $statusIn: [MediaListStatus], $chunk: Int, $perChunk: Int) {
  MediaListCollection(userId: $userId, type: $type, status_in: $statusIn, chunk: $chunk, perChunk: $perChunk) {
    hasNextChunk
    lists {
      entries {
        mediaId
        status
        score(format: POINT_100)
        completedAt { year month day }
        media {
          title { romaji english native }
          coverImage { extraLarge large color }
          bannerImage
          startDate { year }
          format
          episodes
          chapters
          siteUrl
        }
      }
    }
  }
}`

const SAVE_SCORE_MUTATION = `mutation ($mediaId: Int, $scoreRaw: Int) {
  SaveMediaListEntry(mediaId: $mediaId, scoreRaw: $scoreRaw) {
    mediaId
  }
}`

type RawViewer = {
  id: number
  name: string
  avatar: { medium: string | null } | null
  options: { titleLanguage: Viewer['titleLanguage'] }
  mediaListOptions: { scoreFormat: Viewer['scoreFormat'] }
}

type RawEntry = {
  mediaId: number
  status: ListStatus
  score: number | null
  completedAt: ListEntry['completedAt'] | null
  media: {
    title: ListEntry['title']
    coverImage: { extraLarge?: string | null; large: string | null; color: string | null } | null
    bannerImage: string | null
    startDate: { year: number | null } | null
    format: string | null
    episodes: number | null
    chapters: number | null
    siteUrl: string
  }
}

type RawCollection = { hasNextChunk: boolean; lists: Array<{ entries: RawEntry[] }> }

function toListEntry(raw: RawEntry): ListEntry {
  const { media } = raw
  return {
    mediaId: raw.mediaId,
    status: raw.status,
    oldScore100: raw.score ?? 0,
    completedAt: raw.completedAt ?? { year: null, month: null, day: null },
    title: media.title,
    coverUrl: media.coverImage?.extraLarge ?? media.coverImage?.large ?? null,
    coverColor: media.coverImage?.color ?? null,
    bannerUrl: media.bannerImage,
    year: media.startDate?.year ?? null,
    format: media.format,
    length: media.episodes ?? media.chapters ?? null,
    siteUrl: media.siteUrl,
  }
}

function numberHeader(headers: Headers, name: string): number | null {
  const value = headers.get(name)
  if (value === null || value.trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

async function request<T>(
  deps: { fetch: typeof fetch; token: string | null },
  query: string,
  variables: Record<string, unknown> = {},
  onHeaders?: (headers: Headers) => void,
): Promise<T> {
  let response: Response
  try {
    response = await deps.fetch(ANILIST_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(deps.token ? { Authorization: `Bearer ${deps.token}` } : {}),
      },
      body: JSON.stringify({ query, variables }),
    })
  } catch (cause) {
    throw new AniListError('unreachable', `AniList is unreachable: ${String(cause)}`)
  }
  onHeaders?.(response.headers)

  const body = (await response.json().catch(() => null)) as {
    data?: T
    errors?: Array<{ message: string; status?: number }>
  } | null
  const message = body?.errors?.map((e) => e.message).join('; ') || `HTTP ${response.status}`

  // A revoked token gets 401; a malformed one gets 400 "Invalid token". Either way the user must log in again.
  const authFailed =
    response.status === 401 ||
    body?.errors?.some((e) => e.status === 401 || /invalid token|unauthori[sz]ed/i.test(e.message))
  if (authFailed) {
    throw new AniListError('auth', message, 401)
  }
  if (response.status === 429) throw new AniListError('rate-limited', message, 429)
  if (!response.ok || !body?.data || body.errors?.length) {
    throw new AniListError('api', message, response.status)
  }
  return body.data
}

const TRENDING_QUERY = `query ($perPage: Int) {
  Page(perPage: $perPage) {
    media(type: ANIME, sort: TRENDING_DESC, isAdult: false) {
      id
      title { romaji english native }
      coverImage { large color }
    }
  }
}`

type RawTrending = {
  id: number
  title: Cover['title']
  coverImage: { large: string | null; color: string | null } | null
}

/** Covers of what is trending on AniList now. Needs no login, so Start can show real anime before one. */
export async function trendingCovers(deps: { fetch: typeof fetch }, count: number): Promise<Cover[]> {
  const data = await request<{ Page: { media: RawTrending[] } }>({ fetch: deps.fetch, token: null }, TRENDING_QUERY, {
    perPage: count,
  })
  return data.Page.media.map((m) => ({
    mediaId: m.id,
    title: m.title,
    coverUrl: m.coverImage?.large ?? null,
    coverColor: m.coverImage?.color ?? null,
  }))
}

export function createAniListGateway(deps: { fetch: typeof fetch; token: string }): AniListGateway {
  let lastRateLimit: RateLimit = { remaining: null, resetAt: null }

  function authed<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    return request<T>(deps, query, variables, (headers) => {
      lastRateLimit = {
        remaining: numberHeader(headers, 'X-RateLimit-Remaining'),
        resetAt: numberHeader(headers, 'X-RateLimit-Reset'),
      }
    })
  }

  return {
    async viewer() {
      const { Viewer: v } = await authed<{ Viewer: RawViewer }>(VIEWER_QUERY)
      return {
        id: v.id,
        name: v.name,
        avatarUrl: v.avatar?.medium ?? null,
        titleLanguage: v.options.titleLanguage,
        scoreFormat: v.mediaListOptions.scoreFormat,
      }
    },

    async mediaList({ userId, type, statuses }) {
      const byMediaId = new Map<number, ListEntry>()
      for (let chunk = 1; ; chunk++) {
        const { MediaListCollection: collection } = await authed<{ MediaListCollection: RawCollection }>(
          MEDIA_LIST_QUERY,
          { userId, type, statusIn: statuses, chunk, perChunk: PER_CHUNK },
        )
        // A title in a custom list also appears in its status list; keep the first.
        for (const list of collection.lists) {
          for (const raw of list.entries) {
            if (!byMediaId.has(raw.mediaId)) byMediaId.set(raw.mediaId, toListEntry(raw))
          }
        }
        if (!collection.hasNextChunk) break
      }
      return [...byMediaId.values()]
    },

    async saveScore(mediaId, scoreRaw) {
      await authed<{ SaveMediaListEntry: { mediaId: number } }>(SAVE_SCORE_MUTATION, { mediaId, scoreRaw })
    },

    rateLimit: () => lastRateLimit,
  }
}
