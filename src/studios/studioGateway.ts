// Studio data gateway: reads one user's anime list (with studios and franchise links) and favourite anime by user
// name, over the AniList Gateway's `request` helper. Needs no login; a token, when given, opens the owner's private
// list. Queries stay flat: AniList answers deeply nested ones with 500.
import { request } from '../anilist/gateway.ts'
import type { ListStatus, Title } from '../anilist/types.ts'
import type { FranchiseRelation, StudioTitle, TopStudiosSession } from './types.ts'

/** The most entries AniList returns in one MediaListCollection chunk. */
const PER_CHUNK = 500

const STUDIO_LIST_QUERY = `query ($userName: String, $chunk: Int, $perChunk: Int) {
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
          studios { edges { isMain node { id name } } }
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

type RawEntry = {
  mediaId: number
  status: ListStatus
  progress: number | null
  repeat: number | null
  score: number | null
  media: {
    id: number
    title: Title
    coverImage: { large: string | null; color: string | null } | null
    bannerImage: string | null
    siteUrl: string
    episodes: number | null
    duration: number | null
    studios: { edges: Array<{ isMain: boolean; node: { id: number; name: string } }> } | null
    relations: { edges: Array<{ relationType: string | null; node: { id: number } | null }> } | null
  }
}

type RawCollection = { hasNextChunk: boolean; lists: Array<{ entries: RawEntry[] }> }

type RawFavourites = {
  User: { favourites: { anime: { pageInfo: { hasNextPage: boolean }; nodes: Array<{ id: number }> } } }
}

function isFranchiseLink(type: string | null): type is FranchiseRelation['type'] {
  return type === 'SEQUEL' || type === 'PREQUEL'
}

function toStudioTitle(raw: RawEntry): StudioTitle {
  const { media } = raw
  const studios = new Map<number, string>()
  for (const edge of media.studios?.edges ?? []) {
    if (edge.isMain && !studios.has(edge.node.id)) studios.set(edge.node.id, edge.node.name)
  }
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
    studios: [...studios].map(([id, name]) => ({ id, name })),
    relations,
    title: media.title,
    coverUrl: media.coverImage?.large ?? null,
    coverColor: media.coverImage?.color ?? null,
    bannerUrl: media.bannerImage,
    siteUrl: media.siteUrl,
  }
}

/** The user's whole anime list, every status, following every chunk. */
export async function readStudioList(session: TopStudiosSession, userName: string): Promise<StudioTitle[]> {
  const byMediaId = new Map<number, StudioTitle>()
  for (let chunk = 1; ; chunk++) {
    const { MediaListCollection: collection } = await request<{ MediaListCollection: RawCollection }>(
      session,
      STUDIO_LIST_QUERY,
      { userName, chunk, perChunk: PER_CHUNK },
    )
    // A title in a custom list also appears in its status list; keep the first.
    for (const list of collection.lists) {
      for (const raw of list.entries) {
        if (!byMediaId.has(raw.mediaId)) byMediaId.set(raw.mediaId, toStudioTitle(raw))
      }
    }
    if (!collection.hasNextChunk) break
  }
  return [...byMediaId.values()]
}

/** The ids of the user's favourite anime, following every page. */
export async function readFavouriteAnime(session: TopStudiosSession, userName: string): Promise<number[]> {
  const ids: number[] = []
  for (let page = 1; ; page++) {
    const data = await request<RawFavourites>(session, FAVOURITE_ANIME_QUERY, { userName, page })
    const { anime } = data.User.favourites
    ids.push(...anime.nodes.map((n) => n.id))
    if (!anime.pageInfo.hasNextPage) break
  }
  return ids
}
