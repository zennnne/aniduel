// How every AniLyze tool reads a user's anime list and favourite anime by user name, over the AniList Gateway's
// `request` helper. Needs no login; a token, when given, opens the owner's private list. Each tool asks for its own
// extra media fields (studios, staff) and reads who each title counts for from them. Queries stay flat: AniList
// answers deeply nested ones with 500.
import { request } from '../anilist/gateway.ts'
import type { ListStatus, Title } from '../anilist/types.ts'
import type { FranchiseRelation, ListTitle, ToolSession } from './types.ts'

/** The most entries AniList returns in one MediaListCollection chunk. */
const PER_CHUNK = 500

const listQuery = (mediaFields: string) => `query ($userName: String, $chunk: Int, $perChunk: Int) {
  MediaListCollection(userName: $userName, type: ANIME, chunk: $chunk, perChunk: $perChunk) {
    hasNextChunk
    lists {
      entries {
        mediaId
        status
        progress
        repeat
        score(format: POINT_10_DECIMAL)
        media {
          id
          title { romaji english native }
          coverImage { large color }
          bannerImage
          siteUrl
          episodes
          duration
          ${mediaFields}
          relations { edges { relationType node { id } } }
        }
      }
    }
  }
}`

const FAVOURITE_ANIME_QUERY = `query ($userName: String, $page: Int) {
  User(name: $userName) {
    favourites {
      anime(page: $page, perPage: 25) {
        pageInfo { hasNextPage }
        nodes { id }
      }
    }
  }
}`

/** One list entry as AniList returns it; `Media` is the tool's own extra media fields. */
export type RawEntry<Media> = {
  mediaId: number
  status: ListStatus
  progress: number | null
  repeat: number | null
  score: number | null
  media: Media & {
    id: number
    title: Title
    coverImage: { large: string | null; color: string | null } | null
    bannerImage: string | null
    siteUrl: string
    episodes: number | null
    duration: number | null
    relations: { edges: Array<{ relationType: string | null; node: { id: number } | null }> } | null
  }
}

type RawCollection<Media> = { hasNextChunk: boolean; lists: Array<{ entries: Array<RawEntry<Media>> }> }

type RawFavourites = {
  User: { favourites: { anime: { pageInfo: { hasNextPage: boolean }; nodes: Array<{ id: number }> } } }
}

function isFranchiseLink(type: string | null): type is FranchiseRelation['type'] {
  return type === 'SEQUEL' || type === 'PREQUEL'
}

function toListTitle<Media>(raw: RawEntry<Media>): ListTitle {
  const { media } = raw
  const relations: FranchiseRelation[] = []
  for (const edge of media.relations?.edges ?? []) {
    if (edge.node && isFranchiseLink(edge.relationType)) relations.push({ type: edge.relationType, mediaId: edge.node.id })
  }
  return {
    mediaId: raw.mediaId,
    status: raw.status,
    score: raw.score ?? 0,
    progress: raw.progress ?? 0,
    repeat: raw.repeat ?? 0,
    episodes: media.episodes,
    duration: media.duration,
    relations,
    title: media.title,
    coverUrl: media.coverImage?.large ?? null,
    coverColor: media.coverImage?.color ?? null,
    bannerUrl: media.bannerImage,
    siteUrl: media.siteUrl,
  }
}

/**
 * The user's whole anime list, every status, following every chunk. `mediaFields` is the GraphQL selection the tool
 * adds to each title's media; `extend` reads what the tool keeps from it. `onChunk` hears how many titles are read so
 * far after each chunk (a chunk with staff takes seconds, and a long list has several).
 */
export async function readToolList<Media, Extra>(
  session: ToolSession,
  userName: string,
  mediaFields: string,
  extend: (media: RawEntry<Media>['media']) => Extra,
  onChunk?: (titles: number) => void,
): Promise<Array<ListTitle & Extra>> {
  const query = listQuery(mediaFields)
  const byMediaId = new Map<number, ListTitle & Extra>()
  for (let chunk = 1; ; chunk++) {
    const { MediaListCollection: collection } = await request<{ MediaListCollection: RawCollection<Media> }>(
      session,
      query,
      { userName, chunk, perChunk: PER_CHUNK },
    )
    // A title in a custom list also appears in its status list; keep the first.
    for (const list of collection.lists) {
      for (const raw of list.entries) {
        if (!byMediaId.has(raw.mediaId)) byMediaId.set(raw.mediaId, { ...toListTitle(raw), ...extend(raw.media) })
      }
    }
    onChunk?.(byMediaId.size)
    if (!collection.hasNextChunk) break
  }
  return [...byMediaId.values()]
}

/** The ids of the user's favourite anime, following every page. */
export async function readFavouriteAnime(session: ToolSession, userName: string): Promise<number[]> {
  const ids: number[] = []
  for (let page = 1; ; page++) {
    const data = await request<RawFavourites>(session, FAVOURITE_ANIME_QUERY, { userName, page })
    const { anime } = data.User.favourites
    ids.push(...anime.nodes.map((n) => n.id))
    if (!anime.pageInfo.hasNextPage) break
  }
  return ids
}
