// The studio data gateway: what it keeps of AniList's answer, and how it follows chunks and pages. The ranking built
// on it is pinned in loadTopStudios.test.ts.
import { describe, expect, it } from 'vitest'
import { readFavouriteAnime } from '../anilyze/listGateway.ts'
import { readStudioList } from './studioGateway.ts'

// A fake `fetch` answering from a queue of JSON bodies; it records each request's variables.
function fakeFetch(...bodies: unknown[]) {
  const variables: Array<Record<string, unknown>> = []
  const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    variables.push(JSON.parse(String(init?.body)).variables)
    const next = bodies.shift()
    if (!next) throw new Error('unexpected request')
    return new Response(JSON.stringify(next), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  return { session: { fetch: fetch as typeof globalThis.fetch, token: null }, variables }
}

type Edge = { isMain: boolean; node: { id: number; name: string } }

function rawEntry(mediaId: number, options: { studios?: Edge[]; relations?: unknown[]; score?: number | null } = {}) {
  return {
    mediaId,
    status: 'COMPLETED',
    progress: null,
    repeat: null,
    score: options.score === undefined ? 8 : options.score,
    media: {
      id: mediaId,
      title: { romaji: `Title ${mediaId}`, english: null, native: null },
      coverImage: null,
      bannerImage: null,
      siteUrl: `https://anilist.co/anime/${mediaId}`,
      episodes: 12,
      duration: 24,
      studios: { edges: options.studios ?? [] },
      relations: { edges: options.relations ?? [] },
    },
  }
}

const chunk = (hasNextChunk: boolean, ...lists: unknown[][]) => ({
  data: { MediaListCollection: { hasNextChunk, lists: lists.map((entries) => ({ entries })) } },
})

describe('readStudioList', () => {
  it('keeps only main studios, each once', async () => {
    const studios = [
      { isMain: true, node: { id: 1, name: 'Bones' } },
      { isMain: false, node: { id: 2, name: 'Aniplex' } },
      { isMain: true, node: { id: 1, name: 'Bones' } },
      { isMain: true, node: { id: 3, name: 'MAPPA' } },
    ]
    const { session } = fakeFetch(chunk(false, [rawEntry(10, { studios })]))

    const [title] = await readStudioList(session, 'zen')

    expect(title.studios).toEqual([
      { id: 1, name: 'Bones' },
      { id: 3, name: 'MAPPA' },
    ])
  })

  it('keeps only sequel and prequel links as franchise relations', async () => {
    const relations = [
      { relationType: 'SEQUEL', node: { id: 11 } },
      { relationType: 'SIDE_STORY', node: { id: 12 } },
      { relationType: 'PREQUEL', node: { id: 13 } },
      { relationType: 'PREQUEL', node: null },
    ]
    const { session } = fakeFetch(chunk(false, [rawEntry(10, { relations })]))

    const [title] = await readStudioList(session, 'zen')

    expect(title.relations).toEqual([
      { type: 'SEQUEL', mediaId: 11 },
      { type: 'PREQUEL', mediaId: 13 },
    ])
  })

  it('reads missing numbers as 0 and a missing cover as none', async () => {
    const { session } = fakeFetch(chunk(false, [rawEntry(10, { score: null })]))

    const [title] = await readStudioList(session, 'zen')

    expect(title).toMatchObject({ score: 0, progress: 0, repeat: 0, coverUrl: null, coverColor: null })
  })

  it('follows every chunk and keeps a title in a custom list once', async () => {
    const { session, variables } = fakeFetch(
      chunk(true, [rawEntry(1), rawEntry(2)], [rawEntry(2)]),
      chunk(false, [rawEntry(3)]),
    )

    const list = await readStudioList(session, 'zen')

    expect(list.map((t) => t.mediaId)).toEqual([1, 2, 3])
    expect(variables.map((v) => v.chunk)).toEqual([1, 2])
  })
})

describe('readFavouriteAnime', () => {
  const page = (hasNextPage: boolean, ids: number[]) => ({
    data: { User: { favourites: { anime: { pageInfo: { hasNextPage }, nodes: ids.map((id) => ({ id })) } } } },
  })

  it('follows every page of favourites', async () => {
    const { session, variables } = fakeFetch(page(true, [5, 6]), page(false, [7]))

    expect(await readFavouriteAnime(session, 'zen')).toEqual([5, 6, 7])
    expect(variables).toEqual([
      { userName: 'zen', page: 1 },
      { userName: 'zen', page: 2 },
    ])
  })
})
