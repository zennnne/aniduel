// Test helpers (not used by the app): a fake AniList behind a fake `fetch`, and a clock that never waits.
import type { Clock } from '../clock.ts'
import type { MediaType, ScoreFormat } from './types.ts'

export const START = 1_760_000_000_000

/** A clock whose sleep moves time forward at once, so tests never wait. */
export function fakeClock(): Clock & { sleeps: number[] } {
  let now = START
  const sleeps: number[] = []
  return {
    sleeps,
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms)
      now += ms
    },
  }
}

type Reply =
  | { kind: 'ok' }
  | { kind: '429'; reset?: number }
  | { kind: 'network' }
  | { kind: 'api'; status: number }

export type FakeOptions = { remaining?: (n: number) => number; statuses?: Record<number, string> }

/** What the fake answers to `Viewer`. Change `scoreFormat` to play the user changing it on AniList. */
export type FakeViewer = { id: number; name: string; scoreFormat: ScoreFormat }

/**
 * A fake AniList behind a fake `fetch`: it keeps each title's score and status, answers the list query and
 * SaveMediaListEntry, and records when each request arrived. Scripted replies are used for writes, in order. `Viewer`
 * answers with `viewer`.
 */
export function fakeAniList(clock: Clock, scores: Record<number, number>, options: FakeOptions = {}) {
  const store = new Map(Object.entries(scores).map(([id, s]) => [Number(id), s]))
  const statuses = new Map<number, string>(Object.entries(options.statuses ?? {}).map(([id, s]) => [Number(id), s]))
  const writes: Array<{ mediaId: number; scoreRaw?: number; status?: string; at: number }> = []
  const listReads: Array<{ type: MediaType; statuses: string[]; at: number }> = []
  const script: Reply[] = []
  const viewer: FakeViewer = { id: 1, name: 'zen', scoreFormat: 'POINT_10' }
  let requests = 0
  const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    requests++
    const body = JSON.parse(String(init?.body)) as {
      query: string
      variables: { mediaId: number; scoreRaw?: number; status?: string; type?: MediaType; statusIn?: string[] }
    }
    const remaining = String(options.remaining?.(requests) ?? 25)
    const resetAt = String(Math.floor(clock.now() / 1000) + 60)
    const json = (status: number, data: unknown) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'X-RateLimit-Remaining': remaining, 'X-RateLimit-Reset': resetAt },
      })
    if (body.query.includes('MediaListCollection')) {
      const { statusIn = [] } = body.variables
      listReads.push({ type: body.variables.type!, statuses: statusIn, at: clock.now() })
      const entries = [...store]
        .map(([mediaId, score]) => listEntry(mediaId, score, statuses.get(mediaId)))
        .filter((e) => statusIn.includes(e.status))
      return json(200, { data: { MediaListCollection: { hasNextChunk: false, lists: [{ entries }] } } })
    }
    if (body.query.includes('Viewer')) {
      const { id, name, scoreFormat } = viewer
      return json(200, { data: { Viewer: { id, name, avatar: null, options: { titleLanguage: 'ROMAJI' }, mediaListOptions: { scoreFormat } } } })
    }
    if (!body.query.includes('SaveMediaListEntry')) throw new Error('unexpected query')
    const reply = script.shift() ?? { kind: 'ok' }
    const { mediaId, scoreRaw, status } = body.variables
    switch (reply.kind) {
      case 'network':
        throw new TypeError('Failed to fetch')
      case 'api':
        return json(reply.status, { errors: [{ message: 'Internal Server Error' }] })
      case '429':
        return new Response(JSON.stringify({ errors: [{ message: 'Too Many Requests.', status: 429 }] }), {
          status: 429,
          headers: reply.reset === undefined ? { 'X-RateLimit-Remaining': '0' } : { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(reply.reset) },
        })
      case 'ok':
        if (status === undefined) {
          writes.push({ mediaId, scoreRaw, at: clock.now() })
          store.set(mediaId, scoreRaw!)
        } else {
          writes.push({ mediaId, status, at: clock.now() })
          statuses.set(mediaId, status)
          if (!store.has(mediaId)) store.set(mediaId, 0)
        }
        return json(200, { data: { SaveMediaListEntry: { mediaId } } })
    }
  }
  return { fetch: fetch as typeof globalThis.fetch, store, statuses, writes, listReads, script, viewer }
}

function listEntry(mediaId: number, score: number, status = 'COMPLETED') {
  return {
    mediaId,
    status,
    score,
    completedAt: null,
    media: {
      title: { romaji: `T${mediaId}`, english: null, native: null },
      coverImage: null,
      bannerImage: null,
      startDate: null,
      format: 'TV',
      episodes: 12,
      chapters: null,
      siteUrl: '',
    },
  }
}
