import { describe, expect, it } from 'vitest'
import { createAniListGateway } from '../anilist/gateway.ts'
import type { ListStatus, MediaType } from '../anilist/types.ts'
import type { Clock } from '../clock.ts'
import { catchUpSnapshot, queueProgress, type CatchUpWrite } from '../catchup/queue.ts'
import { importOf, importSummary, newImport, retryFailed, skippedWrites, type ImportState } from '../import/importState.ts'
import { createRequestLimiter } from './limiter.ts'
import {
  createWriteQueue,
  parseWriteQueueState,
  type RunnerStatus,
  type WriteQueue,
  type WriteQueueSnapshot,
  type WriteQueueState,
} from './writeQueue.ts'

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

type FakeOptions = { remaining?: (n: number) => number; statuses?: Record<number, string> }

/**
 * A fake AniList behind a fake `fetch`: it keeps each title's score and status, answers the list query and
 * SaveMediaListEntry, and records when each request arrived. Scripted replies are used for writes, in order.
 */
function fakeAniList(clock: Clock, scores: Record<number, number>, options: FakeOptions = {}) {
  const store = new Map(Object.entries(scores).map(([id, s]) => [Number(id), s]))
  const statuses = new Map<number, string>(Object.entries(options.statuses ?? {}).map(([id, s]) => [Number(id), s]))
  const writes: Array<{ mediaId: number; scoreRaw?: number; status?: string; at: number }> = []
  const listReads: Array<{ type: MediaType; at: number }> = []
  const script: Reply[] = []
  let requests = 0
  const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    requests++
    const body = JSON.parse(String(init?.body)) as {
      query: string
      variables: { mediaId: number; scoreRaw?: number; status?: string; type?: MediaType }
    }
    const remaining = String(options.remaining?.(requests) ?? 25)
    const resetAt = String(Math.floor(clock.now() / 1000) + 60)
    const json = (status: number, data: unknown) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'X-RateLimit-Remaining': remaining, 'X-RateLimit-Reset': resetAt },
      })
    if (body.query.includes('MediaListCollection')) {
      listReads.push({ type: body.variables.type!, at: clock.now() })
      const entries = [...store].map(([mediaId, score]) => listEntry(mediaId, score, statuses.get(mediaId)))
      return json(200, { data: { MediaListCollection: { hasNextChunk: false, lists: [{ entries }] } } })
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
  return { fetch: fetch as typeof globalThis.fetch, store, statuses, writes, listReads, script }
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

/** A user's AniList and a write queue for them; `reload()` makes a new queue from what was saved, as the next visit does. */
function setup(scores: Record<number, number>, options: FakeOptions & { perMinute?: number } = {}) {
  const clock = fakeClock()
  const aniList = fakeAniList(clock, scores, options)
  const gateway = createAniListGateway({ fetch: aniList.fetch, token: 't' })
  const limiter = createRequestLimiter(clock, options.perMinute)
  const saved: Array<WriteQueueState | null> = []
  const errors: unknown[] = []
  const make = (initial: WriteQueueState | null) =>
    createWriteQueue({ gateway, clock, limiter, userId: 1, initial, save: (s) => saved.push(s), onError: (e) => errors.push(e) })
  // Read back through JSON, as storage would.
  const lastSaved = () => {
    const last = saved.at(-1) ?? null
    return last && parseWriteQueueState(JSON.parse(JSON.stringify(last)))
  }
  return { clock, aniList, queue: make(null), saved, errors, reload: () => make(lastSaved()), lastSaved }
}

/** Every status the queue reports, in order, each once. */
function statusesSeen(queue: WriteQueue, describe: (s: RunnerStatus, snap: WriteQueueSnapshot) => string) {
  const seen: string[] = []
  let last: RunnerStatus | null = null
  queue.subscribe((snap) => {
    if (snap.status && snap.status !== last) seen.push(describe(snap.status, snap))
    last = snap.status
  })
  return seen
}

/** Writes an Import plan for anime and returns where the Import ended. */
async function runImport(queue: WriteQueue, state: ImportState): Promise<ImportState> {
  queue.writeImport('ANIME', state)
  await queue.idle()
  return importOf(queue.snapshot().state, 'ANIME')!
}

const planOf = (writes: ImportState['writes'] extends Array<infer W> ? Omit<W, 'status' | 'error'>[] : never) =>
  newImport(writes, { hash: 'h', format: 'POINT_100' })

const plan = [
  { mediaId: 1, scoreRaw: 90, oldScore100: 0 },
  { mediaId: 2, scoreRaw: 70, oldScore100: 50 },
  { mediaId: 3, scoreRaw: 30, oldScore100: 80 },
]
const oldScores = { 1: 0, 2: 50, 3: 80 }

const mark = (mediaId: number, listStatus: ListStatus = 'COMPLETED'): CatchUpWrite => ({ mediaId, listStatus, name: `Anime ${mediaId}` })
const marks = [mark(11), mark(12, 'DROPPED'), mark(13, 'PLANNING')]

/** Catch-up's view of the queue's writes. */
const catchUp = (queue: WriteQueue) => catchUpSnapshot(queue.snapshot())

describe('Write queue: throttle', () => {
  it('writes every planned score one at a time, about 2.2 s apart', async () => {
    const { aniList, queue } = setup(oldScores)

    const done = await runImport(queue, planOf(plan))

    expect(aniList.writes.map((w) => [w.mediaId, w.scoreRaw])).toEqual([[1, 90], [2, 70], [3, 30]])
    expect(aniList.writes.map((w) => w.at - aniList.writes[0].at)).toEqual([0, 2200, 4400])
    expect(done.writes.map((w) => w.status)).toEqual(['done', 'done', 'done'])
  })

  it('slows to 1 write every 4 s once X-RateLimit-Remaining is 5 or less', async () => {
    // Request 1 is the list re-read; writes answer with remaining 6, then 5, then 4.
    const { aniList, queue } = setup({ ...oldScores, 4: 10 }, { remaining: (n) => [25, 6, 5, 4][n - 1] ?? 4 })

    await runImport(queue, planOf([...plan, { mediaId: 4, scoreRaw: 20, oldScore100: 10 }]))

    const gaps = aniList.writes.slice(1).map((w, i) => w.at - aniList.writes[i].at)
    expect(gaps).toEqual([2200, 4000, 4000])
  })

  it('keeps list reads and writes together under the per-minute limit', async () => {
    // A limit of 3 a minute: the list read and two writes go, the third write waits for the minute to pass.
    const { aniList, queue } = setup(oldScores, { perMinute: 3 })

    await runImport(queue, planOf(plan))

    expect(aniList.listReads.map((r) => r.at - START)).toEqual([0])
    expect(aniList.writes.map((w) => w.at - START)).toEqual([0, 2200, 60_000])
  })
})

describe('Write queue: failures', () => {
  it('marks a title failed and carries on; the summary counts written / skipped / failed', async () => {
    const { aniList, queue } = setup(oldScores)
    aniList.script.push({ kind: 'ok' }, { kind: 'network' }, { kind: 'ok' })

    const done = await runImport(queue, planOf(plan))

    expect(done.writes.map((w) => w.status)).toEqual(['done', 'failed', 'done'])
    expect(done.writes[1].error).toBe('network error')
    expect(importSummary(done)).toEqual({ written: 2, skipped: 0, failed: 1, left: 0, total: 3 })
  })

  it('retries only the failed titles', async () => {
    const { aniList, queue } = setup(oldScores)
    aniList.script.push({ kind: 'api', status: 500 }, { kind: 'ok' }, { kind: 'network' })
    const first = await runImport(queue, planOf(plan))
    expect(first.writes.map((w) => w.status)).toEqual(['failed', 'done', 'failed'])

    const second = await runImport(queue, retryFailed(first))

    expect(aniList.writes.map((w) => w.mediaId)).toEqual([2, 1, 3])
    expect(importSummary(second)).toEqual({ written: 3, skipped: 0, failed: 0, left: 0, total: 3 })
  })

  it('stops on an expired login and keeps the progress so far', async () => {
    const { aniList, queue, errors, lastSaved } = setup(oldScores)
    aniList.script.push({ kind: 'ok' }, { kind: 'api', status: 401 })

    await runImport(queue, planOf(plan))

    expect(errors).toMatchObject([{ kind: 'auth' }])
    expect(importOf(lastSaved()!, 'ANIME')?.writes.map((w) => w.status)).toEqual(['done', 'pending', 'pending'])
  })
})

describe('Write queue: resume', () => {
  it('a resumed Import skips titles already written and never writes one twice', async () => {
    const { aniList, queue, reload } = setup(oldScores)
    queue.subscribe((snap) => {
      const written = importOf(snap.state, 'ANIME')?.writes.filter((w) => w.status === 'done').length
      if (written === 2) queue.holdImport('ANIME') // Stop
    })

    const cut = await runImport(queue, planOf(plan))
    expect(cut.writes.map((w) => w.status)).toEqual(['done', 'done', 'pending'])

    // The next visit starts from what was saved, once the user resumes the Import.
    const next = reload()
    const resumed = await runImport(next, importOf(next.snapshot().state, 'ANIME')!)

    expect(aniList.writes.map((w) => w.mediaId)).toEqual([1, 2, 3])
    expect(importSummary(resumed)).toMatchObject({ written: 3, failed: 0, left: 0 })
  })

  it('counts a write that reached AniList before the tab closed as done, without writing it again', async () => {
    // Title 1 was written but its status never got saved: AniList already has the new score.
    const { aniList, queue } = setup({ ...oldScores, 1: 90 })

    const done = await runImport(queue, planOf(plan))

    expect(aniList.writes.map((w) => w.mediaId)).toEqual([2, 3])
    expect(done.writes[0].status).toBe('done')
  })

  it('skips titles whose AniList score changed since the plan was made', async () => {
    const { aniList, queue } = setup({ ...oldScores, 2: 65 })

    const done = await runImport(queue, planOf(plan))

    expect(aniList.writes.map((w) => w.mediaId)).toEqual([1, 3])
    expect(aniList.store.get(2)).toBe(65)
    expect(done.writes[1]).toMatchObject({ status: 'skipped', error: 'changed on AniList' })
    expect(importSummary(done)).toMatchObject({ written: 2, skipped: 1 })
  })

  it('skips titles no longer on the list, since writing would add them back', async () => {
    const { aniList, queue } = setup({ 1: 0, 2: 50 })

    const done = await runImport(queue, planOf(plan))

    expect(aniList.writes.map((w) => w.mediaId)).toEqual([1, 2])
    expect(done.writes[2]).toMatchObject({ status: 'skipped', error: 'not on your list' })
  })

  it('tells each skipped title’s own reason for the summary', async () => {
    const { queue } = setup({ 1: 0, 2: 65 })

    const done = await runImport(queue, planOf(plan))

    expect(skippedWrites(done)).toEqual([
      { mediaId: 2, reason: 'changed on AniList' },
      { mediaId: 3, reason: 'not on your list' },
    ])
  })

  it('re-reads the list for a new Import, so a score this run wrote is not taken for a change on AniList', async () => {
    const { aniList, queue } = setup(oldScores)
    await runImport(queue, planOf([plan[0]]))

    // A recalculated plan for title 1 starts from the score the first Import wrote.
    const done = await runImport(queue, planOf([{ mediaId: 1, scoreRaw: 95, oldScore100: 90 }]))

    expect(aniList.writes.map((w) => [w.mediaId, w.scoreRaw])).toEqual([[1, 90], [1, 95]])
    expect(done.writes[0].status).toBe('done')
  })
})

describe('Write queue: what it reports', () => {
  it('reports each status while it runs', async () => {
    const { aniList, queue } = setup(oldScores)
    aniList.script.push({ kind: '429' })
    const seen = statusesSeen(queue, (s, snap) => `${s.phase}:${importSummary(importOf(snap.state, 'ANIME')!).written}`)

    await runImport(queue, planOf(plan))

    expect(seen).toEqual(['reading:0', 'writing:0', 'waiting:0', 'writing:0', 'writing:1', 'writing:2'])
  })
})

describe('Write queue: 429', () => {
  it('waits until X-RateLimit-Reset, then retries the same title', async () => {
    const { clock, aniList, queue } = setup(oldScores)
    const reset = Math.floor(START / 1000) + 42
    aniList.script.push({ kind: '429', reset })

    const done = await runImport(queue, planOf(plan))

    expect(aniList.writes.map((w) => w.mediaId)).toEqual([1, 2, 3])
    expect(aniList.writes[0].at).toBeGreaterThanOrEqual(reset * 1000)
    expect(clock.sleeps).toContain(reset * 1000 - START)
    expect(done.writes.every((w) => w.status === 'done')).toBe(true)
  })

  it('stopping an Import during a rate-limit wait writes nothing more of it', async () => {
    const { aniList, queue } = setup(oldScores)
    aniList.script.push({ kind: 'ok' }, { kind: '429' })
    queue.subscribe((snap) => snap.status?.phase === 'waiting' && queue.holdImport('ANIME'))

    const cut = await runImport(queue, planOf(plan))

    expect(aniList.writes.map((w) => w.mediaId)).toEqual([1])
    expect(cut.writes.map((w) => w.status)).toEqual(['done', 'pending', 'pending'])
  })

  it('waits 60 s when the 429 has no reset header', async () => {
    const { clock, aniList, queue } = setup(oldScores)
    aniList.script.push({ kind: 'ok' }, { kind: '429' })

    await runImport(queue, planOf(plan))

    expect(clock.sleeps).toContain(60_000)
    expect(aniList.writes.map((w) => w.mediaId)).toEqual([1, 2, 3])
    expect(aniList.writes[1].at - aniList.writes[0].at).toBeGreaterThanOrEqual(60_000)
  })
})

describe('Write queue: list status writes', () => {
  it('adds titles not yet on the list with their status, in the same line and spacing as score writes', async () => {
    const { aniList, queue, saved } = setup(oldScores)

    queue.writeImport('ANIME', planOf([plan[0]]))
    queue.addStatuses(marks, 'ANIME')
    await queue.idle()

    expect(aniList.writes.map((w) => [w.mediaId, w.scoreRaw ?? w.status])).toEqual([
      [1, 90],
      [11, 'COMPLETED'],
      [12, 'DROPPED'],
      [13, 'PLANNING'],
    ])
    expect(aniList.writes.map((w) => w.at - aniList.writes[0].at)).toEqual([0, 2200, 4400, 6600])
    expect(aniList.listReads).toHaveLength(1)
    // One saved queue holds both kinds of write.
    expect(saved.some((s) => s?.writes.length === 4 && s.imports.length === 1)).toBe(true)
  })

  it('waits out a 429 on a status write, then retries the same title', async () => {
    const { clock, aniList, queue } = setup({})
    const reset = Math.floor(START / 1000) + 42
    aniList.script.push({ kind: '429', reset })

    queue.addStatuses(marks, 'ANIME')
    await queue.idle()

    expect(aniList.writes.map((w) => w.mediaId)).toEqual([11, 12, 13])
    expect(aniList.writes[0].at).toBeGreaterThanOrEqual(reset * 1000)
    expect(clock.sleeps).toContain(reset * 1000 - START)
    expect(queueProgress(catchUp(queue).state!)).toMatchObject({ saved: 3, left: 0 })
  })

  it('counts a status that reached AniList before the tab closed as done, without writing it again', async () => {
    const { aniList, queue } = setup({ 11: 0 }, { statuses: { 11: 'COMPLETED' } })

    queue.addStatuses(marks, 'ANIME')
    await queue.idle()

    expect(aniList.writes.map((w) => w.mediaId)).toEqual([12, 13])
    expect(catchUp(queue).state!.writes[0].status).toBe('done')
  })

  it('skips a title put on the list with another status since it was marked, leaving it as it is', async () => {
    const { aniList, queue } = setup({ 12: 0 }, { statuses: { 12: 'CURRENT' } })

    queue.addStatuses(marks, 'ANIME')
    await queue.idle()

    expect(aniList.writes.map((w) => w.mediaId)).toEqual([11, 13])
    expect(aniList.statuses.get(12)).toBe('CURRENT')
    expect(catchUp(queue).state!.writes[1]).toMatchObject({ status: 'skipped', error: 'already on your list' })
  })
})

describe('Write queue: Catch-up pages', () => {
  it('writes each saved page’s statuses in order and reports progress as it goes', async () => {
    const { aniList, queue } = setup({})
    const progress: unknown[] = []
    queue.subscribe((snap) => {
      const state = catchUpSnapshot(snap).state
      if (state) progress.push(queueProgress(state))
    })

    queue.addStatuses([mark(1), mark(2, 'DROPPED'), mark(3, 'PLANNING')], 'ANIME')
    await queue.idle()

    expect(aniList.writes.map((w) => [w.mediaId, w.status])).toEqual([[1, 'COMPLETED'], [2, 'DROPPED'], [3, 'PLANNING']])
    expect(progress).toContainEqual({ saved: 1, total: 3, left: 2, failed: [] })
    expect(queueProgress(catchUp(queue).state!)).toEqual({ saved: 3, total: 3, left: 0, failed: [] })
    expect(queue.snapshot().running).toBe(false)
  })

  it('adds a page saved while writing to the same run, without reading the list again', async () => {
    const { aniList, queue } = setup({})

    queue.addStatuses([mark(1), mark(2)], 'ANIME')
    queue.addStatuses([mark(3)], 'ANIME')
    await queue.idle()

    expect(aniList.writes.map((w) => w.mediaId)).toEqual([1, 2, 3])
    expect(aniList.listReads).toHaveLength(1)
    expect(aniList.writes.map((w) => w.at - aniList.writes[0].at)).toEqual([0, 2200, 4400])
  })

  it('counts only the new page once the earlier ones are written', async () => {
    const { queue } = setup({})
    queue.addStatuses([mark(1), mark(2)], 'ANIME')
    await queue.idle()

    queue.addStatuses([mark(3)], 'ANIME')
    await queue.idle()

    expect(queueProgress(catchUp(queue).state!)).toEqual({ saved: 1, total: 1, left: 0, failed: [] })
  })

  it('shows failed writes by name, and Retry writes them again', async () => {
    const { aniList, queue } = setup({})
    aniList.script.push({ kind: 'ok' }, { kind: 'network' })
    queue.addStatuses([mark(1), mark(2), mark(3)], 'ANIME')
    await queue.idle()
    expect(queueProgress(catchUp(queue).state!).failed.map((w) => w.name)).toEqual(['Anime 2'])

    queue.retryStatuses()
    await queue.idle()

    expect(aniList.writes.map((w) => w.mediaId)).toEqual([1, 3, 2])
    expect(queueProgress(catchUp(queue).state!).failed).toEqual([])
  })

  it('keeps failed writes waiting for Retry when a new page is saved', async () => {
    const { aniList, queue } = setup({})
    aniList.script.push({ kind: 'network' })
    queue.addStatuses([mark(1)], 'ANIME')
    await queue.idle()

    queue.addStatuses([mark(2)], 'ANIME')
    await queue.idle()

    expect(aniList.writes.map((w) => w.mediaId)).toEqual([2])
    expect(queueProgress(catchUp(queue).state!)).toEqual({ saved: 1, total: 1, left: 0, failed: [mark(1)] })
  })

  it('forgets the saved queue once every write is through', async () => {
    const { queue, saved } = setup({})
    queue.addStatuses([mark(1)], 'ANIME')
    await queue.idle()

    expect(saved.at(-1)).toBeNull()
  })

  it('lets go of the saved queue on stop: nothing written after it is saved', async () => {
    const { queue, saved } = setup({})
    queue.addStatuses([mark(1), mark(2), mark(3)], 'ANIME')
    const before = saved.length
    queue.stop()
    await queue.idle()

    expect(saved).toHaveLength(before)
  })
})

describe('Write queue: Import and Catch-up in one line', () => {
  it('after a reload, writes Catch-up’s statuses at once and keeps the Import until it is resumed', async () => {
    const { aniList, queue, errors, reload } = setup(oldScores)
    aniList.script.push({ kind: 'api', status: 401 }) // the login expired at the first write: everything stays
    queue.writeImport('ANIME', planOf(plan))
    queue.addStatuses([mark(11)], 'ANIME')
    await queue.idle()
    expect(errors).toHaveLength(1)

    const next = reload()
    next.resume()
    await next.idle()

    expect(aniList.writes.map((w) => w.mediaId)).toEqual([11])
    expect(importSummary(importOf(next.snapshot().state, 'ANIME')!)).toMatchObject({ left: 3 })

    await runImport(next, importOf(next.snapshot().state, 'ANIME')!)
    expect(aniList.writes.map((w) => w.mediaId)).toEqual([11, 1, 2, 3])
  })

  it('stopping an Import holds only its scores: Catch-up’s statuses carry on', async () => {
    const { aniList, queue } = setup(oldScores)
    queue.writeImport('ANIME', planOf(plan))
    queue.addStatuses([mark(11), mark(12)], 'ANIME')
    queue.subscribe((snap) => {
      if (importSummary(importOf(snap.state, 'ANIME')!).written === 1) queue.holdImport('ANIME')
    })
    await queue.idle()

    expect(aniList.writes.map((w) => w.mediaId)).toEqual([1, 11, 12])
    expect(importSummary(importOf(queue.snapshot().state, 'ANIME')!)).toMatchObject({ written: 1, left: 2 })
  })

  it('drops an Import’s scores from the queue, and nothing else', async () => {
    const { queue } = setup(oldScores)
    queue.addStatuses([mark(11)], 'ANIME')
    queue.writeImport('ANIME', planOf(plan))

    queue.dropImport('ANIME')
    await queue.idle()

    expect(importOf(queue.snapshot().state, 'ANIME')).toBeNull()
    expect(queueProgress(catchUp(queue).state!)).toMatchObject({ saved: 1, total: 1 })
  })

  it('reads each Media Type’s list once for the writes going to it', async () => {
    const { aniList, queue } = setup(oldScores)

    queue.addStatuses([mark(11)], 'ANIME')
    queue.writeImport('MANGA', planOf([plan[0]]))
    await queue.idle()

    expect(aniList.listReads.map((r) => r.type)).toEqual(['ANIME', 'MANGA'])
    expect(importOf(queue.snapshot().state, 'MANGA')?.writes[0].status).toBe('done')
  })
})

describe('Saved write queue', () => {
  const state: WriteQueueState = {
    imports: [{ mediaType: 'ANIME', hash: 'h', format: 'POINT_10' }],
    writes: [
      { mediaType: 'ANIME', mediaId: 1, scoreRaw: 90, oldScore100: 0, status: 'done' },
      { mediaType: 'ANIME', mediaId: 11, listStatus: 'COMPLETED', name: 'Anime 11', status: 'failed', error: 'network error' },
    ],
  }

  it('reads back what was saved', () => {
    expect(parseWriteQueueState(JSON.parse(JSON.stringify(state)))).toEqual(state)
  })

  it('refuses scores without the Import plan they came from, or an unknown Score Format', () => {
    expect(parseWriteQueueState({ ...state, imports: [] })).toBeNull()
    expect(parseWriteQueueState({ ...state, imports: [{ mediaType: 'ANIME', hash: 'h', format: 'POINT_7' }] })).toBeNull()
  })

  it('refuses writes it doesn’t understand', () => {
    expect(parseWriteQueueState({ ...state, writes: [{ mediaType: 'ANIME', mediaId: 1, status: 'pending' }] })).toBeNull()
    expect(parseWriteQueueState({ ...state, writes: [{ ...state.writes[1], listStatus: 'WATCHED' }] })).toBeNull()
    expect(parseWriteQueueState(null)).toBeNull()
  })
})
