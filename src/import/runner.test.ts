import { describe, expect, it } from 'vitest'
import { createAniListGateway } from '../anilist/gateway.ts'
import {
  formatDuration,
  importSummary,
  newImport,
  retryFailed,
  runImport,
  skippedWrites,
  timeLeftMs,
  type Clock,
  type ImportState,
} from './runner.ts'

const START = 1_760_000_000_000

/** A clock whose sleep moves time forward at once, so tests never wait. */
function fakeClock(): Clock & { sleeps: number[] } {
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

/**
 * A fake AniList behind a fake `fetch`: it keeps each title's score, answers the list query and
 * SaveMediaListEntry, and records when each write arrived. Scripted replies are used for writes, in order.
 */
function fakeAniList(clock: Clock, scores: Record<number, number>, options: { remaining?: (n: number) => number } = {}) {
  const store = new Map(Object.entries(scores).map(([id, s]) => [Number(id), s]))
  const writes: Array<{ mediaId: number; scoreRaw: number; at: number }> = []
  const script: Reply[] = []
  let requests = 0
  const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    requests++
    const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, number> }
    const remaining = String(options.remaining?.(requests) ?? 25)
    const resetAt = String(Math.floor(clock.now() / 1000) + 60)
    const json = (status: number, data: unknown, headers: Record<string, string> = {}) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'X-RateLimit-Remaining': remaining, 'X-RateLimit-Reset': resetAt, ...headers },
      })
    if (body.query.includes('MediaListCollection')) {
      const entries = [...store].map(([mediaId, score]) => listEntry(mediaId, score))
      return json(200, { data: { MediaListCollection: { hasNextChunk: false, lists: [{ entries }] } } })
    }
    if (!body.query.includes('SaveMediaListEntry')) throw new Error('unexpected query')
    const reply = script.shift() ?? { kind: 'ok' }
    const { mediaId, scoreRaw } = body.variables
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
        writes.push({ mediaId, scoreRaw, at: clock.now() })
        store.set(mediaId, scoreRaw)
        return json(200, { data: { SaveMediaListEntry: { mediaId } } })
    }
  }
  return { fetch: fetch as typeof globalThis.fetch, store, writes, script }
}

function listEntry(mediaId: number, score: number) {
  return {
    mediaId,
    status: 'COMPLETED',
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

function setup(scores: Record<number, number>, options: { remaining?: (n: number) => number } = {}) {
  const clock = fakeClock()
  const aniList = fakeAniList(clock, scores, options)
  const gateway = createAniListGateway({ fetch: aniList.fetch, token: 't' })
  const saved: ImportState[] = []
  const deps = { gateway, clock, userId: 1, mediaType: 'ANIME' as const, save: (s: ImportState) => saved.push(s) }
  return { clock, aniList, deps, saved }
}

const plan = [
  { mediaId: 1, scoreRaw: 90, oldScore100: 0 },
  { mediaId: 2, scoreRaw: 70, oldScore100: 50 },
  { mediaId: 3, scoreRaw: 30, oldScore100: 80 },
]
const oldScores = { 1: 0, 2: 50, 3: 80 }

describe('Import Runner: throttle', () => {
  it('writes every planned score one at a time, about 2.2 s apart', async () => {
    const { aniList, deps } = setup(oldScores)

    const done = await runImport(deps, newImport(plan, { hash: 'h', format: 'POINT_100' }))

    expect(aniList.writes.map((w) => [w.mediaId, w.scoreRaw])).toEqual([[1, 90], [2, 70], [3, 30]])
    expect(aniList.writes.map((w) => w.at - aniList.writes[0].at)).toEqual([0, 2200, 4400])
    expect(done.writes.map((w) => w.status)).toEqual(['done', 'done', 'done'])
  })

  it('slows to 1 write every 4 s once X-RateLimit-Remaining is 5 or less', async () => {
    // Request 1 is the list re-read; writes answer with remaining 6, then 5, then 4.
    const { aniList, deps } = setup({ ...oldScores, 4: 10 }, { remaining: (n) => [25, 6, 5, 4][n - 1] ?? 4 })

    await runImport(deps, newImport([...plan, { mediaId: 4, scoreRaw: 20, oldScore100: 10 }], { hash: 'h', format: 'POINT_100' }))

    const gaps = aniList.writes.slice(1).map((w, i) => w.at - aniList.writes[i].at)
    expect(gaps).toEqual([2200, 4000, 4000])
  })
})

describe('Import Runner: failures', () => {
  it('marks a title failed and carries on; the summary counts written / skipped / failed', async () => {
    const { aniList, deps } = setup(oldScores)
    aniList.script.push({ kind: 'ok' }, { kind: 'network' }, { kind: 'ok' })

    const done = await runImport(deps, newImport(plan, { hash: 'h', format: 'POINT_100' }))

    expect(done.writes.map((w) => w.status)).toEqual(['done', 'failed', 'done'])
    expect(done.writes[1].error).toBe('network error')
    expect(importSummary(done)).toEqual({ written: 2, skipped: 0, failed: 1, left: 0, total: 3 })
  })

  it('retries only the failed titles', async () => {
    const { aniList, deps } = setup(oldScores)
    aniList.script.push({ kind: 'api', status: 500 }, { kind: 'ok' }, { kind: 'network' })
    const first = await runImport(deps, newImport(plan, { hash: 'h', format: 'POINT_100' }))
    expect(first.writes.map((w) => w.status)).toEqual(['failed', 'done', 'failed'])

    const second = await runImport(deps, retryFailed(first))

    expect(aniList.writes.map((w) => w.mediaId)).toEqual([2, 1, 3])
    expect(importSummary(second)).toEqual({ written: 3, skipped: 0, failed: 0, left: 0, total: 3 })
  })

  it('stops on an expired login and keeps the progress so far', async () => {
    const { aniList, deps, saved } = setup(oldScores)
    aniList.script.push({ kind: 'ok' }, { kind: 'api', status: 401 })

    await expect(runImport(deps, newImport(plan, { hash: 'h', format: 'POINT_100' }))).rejects.toMatchObject({ kind: 'auth' })

    expect(saved.at(-1)?.writes.map((w) => w.status)).toEqual(['done', 'pending', 'pending'])
  })
})

describe('Import Runner: resume', () => {
  it('a resumed Import skips titles already written and never writes one twice', async () => {
    const { aniList, deps, saved } = setup(oldScores)
    const stop = new AbortController()
    const save = (s: ImportState) => {
      saved.push(s)
      if (s.writes.filter((w) => w.status === 'done').length === 2) stop.abort()
    }

    const cut = await runImport({ ...deps, save }, newImport(plan, { hash: 'h', format: 'POINT_100' }), { signal: stop.signal })
    expect(cut.writes.map((w) => w.status)).toEqual(['done', 'done', 'pending'])

    // The next visit starts from what was saved.
    const resumed = await runImport(deps, saved.at(-1)!)

    expect(aniList.writes.map((w) => w.mediaId)).toEqual([1, 2, 3])
    expect(importSummary(resumed)).toMatchObject({ written: 3, failed: 0, left: 0 })
  })

  it('counts a write that reached AniList before the tab closed as done, without writing it again', async () => {
    // Title 1 was written but its status never got saved: AniList already has the new score.
    const { aniList, deps } = setup({ ...oldScores, 1: 90 })

    const done = await runImport(deps, newImport(plan, { hash: 'h', format: 'POINT_100' }))

    expect(aniList.writes.map((w) => w.mediaId)).toEqual([2, 3])
    expect(done.writes[0].status).toBe('done')
  })

  it('skips titles whose AniList score changed since the plan was made', async () => {
    const { aniList, deps } = setup({ ...oldScores, 2: 65 })

    const done = await runImport(deps, newImport(plan, { hash: 'h', format: 'POINT_100' }))

    expect(aniList.writes.map((w) => w.mediaId)).toEqual([1, 3])
    expect(aniList.store.get(2)).toBe(65)
    expect(done.writes[1]).toMatchObject({ status: 'skipped', error: 'changed on AniList' })
    expect(importSummary(done)).toMatchObject({ written: 2, skipped: 1 })
  })

  it('skips titles no longer on the list, since writing would add them back', async () => {
    const { aniList, deps } = setup({ 1: 0, 2: 50 })

    const done = await runImport(deps, newImport(plan, { hash: 'h', format: 'POINT_100' }))

    expect(aniList.writes.map((w) => w.mediaId)).toEqual([1, 2])
    expect(done.writes[2]).toMatchObject({ status: 'skipped', error: 'not on your list' })
  })

  it('tells each skipped title’s own reason for the summary', async () => {
    const { deps } = setup({ 1: 0, 2: 65 })

    const done = await runImport(deps, newImport(plan, { hash: 'h', format: 'POINT_100' }))

    expect(skippedWrites(done)).toEqual([
      { mediaId: 2, reason: 'changed on AniList' },
      { mediaId: 3, reason: 'not on your list' },
    ])
  })
})

describe('Import progress', () => {
  const state = newImport([...plan, { mediaId: 4, scoreRaw: 20, oldScore100: 10 }], { hash: 'h', format: 'POINT_100' })
  state.writes[0].status = 'done'

  it('estimates the time left from the titles still to write and the current spacing', () => {
    expect(timeLeftMs(state, { phase: 'writing', mediaId: 2, spacingMs: 2200 }, START)).toBe(3 * 2200)
    expect(timeLeftMs(state, { phase: 'writing', mediaId: 2, spacingMs: 4000 }, START)).toBe(3 * 4000)
  })

  it('adds the rest of a rate-limit wait', () => {
    expect(timeLeftMs(state, { phase: 'waiting', until: START + 42_000 }, START)).toBe(42_000 + 3 * 2200)
  })

  it('reports each status to the screen while it runs', async () => {
    const { aniList, deps } = setup(oldScores)
    aniList.script.push({ kind: '429' })
    const seen: string[] = []

    await runImport(deps, newImport(plan, { hash: 'h', format: 'POINT_100' }), {
      onStatus: (s, st) => seen.push(`${s.phase}:${importSummary(st).written}`),
    })

    expect(seen).toEqual(['reading:0', 'writing:0', 'waiting:0', 'writing:0', 'writing:1', 'writing:2'])
  })

  it('shows a duration as minutes and seconds', () => {
    expect(formatDuration(84_000)).toBe('1 min 24 s')
    expect(formatDuration(33_400)).toBe('34 s')
    expect(formatDuration(120_000)).toBe('2 min 0 s')
  })
})

describe('Import Runner: 429', () => {
  it('waits until X-RateLimit-Reset, then retries the same title', async () => {
    const { clock, aniList, deps } = setup(oldScores)
    const reset = Math.floor(START / 1000) + 42
    aniList.script.push({ kind: '429', reset })

    const done = await runImport(deps, newImport(plan, { hash: 'h', format: 'POINT_100' }))

    expect(aniList.writes.map((w) => w.mediaId)).toEqual([1, 2, 3])
    expect(aniList.writes[0].at).toBeGreaterThanOrEqual(reset * 1000)
    expect(clock.sleeps).toContain(reset * 1000 - START)
    expect(done.writes.every((w) => w.status === 'done')).toBe(true)
  })

  it('stopping during a rate-limit wait writes nothing more', async () => {
    const { aniList, deps } = setup(oldScores)
    aniList.script.push({ kind: 'ok' }, { kind: '429' })
    const stop = new AbortController()

    const cut = await runImport(deps, newImport(plan, { hash: 'h', format: 'POINT_100' }), {
      signal: stop.signal,
      onStatus: (s) => s.phase === 'waiting' && stop.abort(),
    })

    expect(aniList.writes.map((w) => w.mediaId)).toEqual([1])
    expect(cut.writes.map((w) => w.status)).toEqual(['done', 'pending', 'pending'])
  })

  it('waits 60 s when the 429 has no reset header', async () => {
    const { clock, aniList, deps } = setup(oldScores)
    aniList.script.push({ kind: 'ok' }, { kind: '429' })

    await runImport(deps, newImport(plan, { hash: 'h', format: 'POINT_100' }))

    expect(clock.sleeps).toContain(60_000)
    expect(aniList.writes.map((w) => w.mediaId)).toEqual([1, 2, 3])
    expect(aniList.writes[1].at - aniList.writes[0].at).toBeGreaterThanOrEqual(60_000)
  })
})
