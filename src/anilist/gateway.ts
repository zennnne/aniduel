// AniList Gateway: a thin GraphQL client over an injected `fetch`.
import type { ListEntry, ListStatus, MediaType, RateLimit, Viewer } from './types.ts'

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
          coverImage { large color }
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
    coverImage: { large: string | null; color: string | null } | null
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
    coverUrl: media.coverImage?.large ?? null,
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

export function createAniListGateway(deps: { fetch: typeof fetch; token: string }): AniListGateway {
  let lastRateLimit: RateLimit = { remaining: null, resetAt: null }

  async function request<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    let response: Response
    try {
      response = await deps.fetch(ANILIST_GRAPHQL_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${deps.token}`,
        },
        body: JSON.stringify({ query, variables }),
      })
    } catch (cause) {
      throw new AniListError('unreachable', `AniList is unreachable: ${String(cause)}`)
    }

    lastRateLimit = {
      remaining: numberHeader(response.headers, 'X-RateLimit-Remaining'),
      resetAt: numberHeader(response.headers, 'X-RateLimit-Reset'),
    }

    const body = (await response.json().catch(() => null)) as {
      data?: T
      errors?: Array<{ message: string; status?: number }>
    } | null
    const message = body?.errors?.map((e) => e.message).join('; ') || `HTTP ${response.status}`

    if (response.status === 401 || body?.errors?.some((e) => e.status === 401)) {
      throw new AniListError('auth', message, 401)
    }
    if (response.status === 429) throw new AniListError('rate-limited', message, 429)
    if (!response.ok || !body?.data || body.errors?.length) {
      throw new AniListError('api', message, response.status)
    }
    return body.data
  }

  return {
    async viewer() {
      const { Viewer: v } = await request<{ Viewer: RawViewer }>(VIEWER_QUERY)
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
        const { MediaListCollection: collection } = await request<{ MediaListCollection: RawCollection }>(
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

    rateLimit: () => lastRateLimit,
  }
}
