import { describe, expect, it } from 'vitest'
import { AniListError, type AniListGateway } from '../anilist/gateway.ts'
import type { ListEntry, ListStatus } from '../anilist/types.ts'
import type { Clock } from '../import/runner.ts'
import { createCatchUpQueue, queueProgress, type CatchUpWrite, type QueueSnapshot } from './queue.ts'

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  }
}

function fakeClock(): Clock {
  let now = 1_760_000_000_000
  return { now: () => now, sleep: async (ms) => void (now += ms) }
}

type Failure = 'network' | 'auth'

/** A fake AniList: the user's anime statuses, every status write in order, and scripted failures by media id. */
function fakeGateway(failures: Map<number, Failure> = new Map()) {
  const statuses = new Map<number, ListStatus>()
  const writes: Array<[number, ListStatus]> = []
  let listReads = 0
  const gateway: AniListGateway = {
    viewer: async () => {
      throw new Error('not used')
    },
    mediaList: async () => {
      listReads++
      return [...statuses].map(([mediaId, status]) => ({ mediaId, status }) as ListEntry)
    },
    saveScore: async () => {
      throw new Error('not used')
    },
    saveStatus: async (mediaId, status) => {
      const failure = failures.get(mediaId)
      if (failure === 'network') throw new AniListError('unreachable', 'down')
      if (failure === 'auth') throw new AniListError('auth', 'Invalid token', 401)
      writes.push([mediaId, status])
      statuses.set(mediaId, status)
    },
    rateLimit: () => ({ remaining: null, resetAt: null }),
  }
  return { gateway, statuses, writes, failures, listReads: () => listReads }
}

const write = (mediaId: number, listStatus: ListStatus = 'COMPLETED'): CatchUpWrite => ({ mediaId, listStatus, name: `Anime ${mediaId}` })

function setup(aniList = fakeGateway(), storage = memoryStorage()) {
  const snapshots: QueueSnapshot[] = []
  const errors: unknown[] = []
  const settled: number[][] = []
  const queue = createCatchUpQueue({
    gateway: aniList.gateway,
    clock: fakeClock(),
    storage,
    userId: 7,
    onChange: (s) => snapshots.push(s),
    onError: (e) => errors.push(e),
    onSettled: (written) => settled.push(written),
  })
  return { queue, aniList, storage, snapshots, errors, settled }
}

describe('Catch-up write queue', () => {
  it('writes each saved page’s statuses through the runner, in order, and reports progress as it goes', async () => {
    const { queue, aniList, snapshots, settled } = setup()

    queue.add([write(1), write(2, 'DROPPED'), write(3, 'PLANNING')])
    await queue.idle()

    expect(aniList.writes).toEqual([[1, 'COMPLETED'], [2, 'DROPPED'], [3, 'PLANNING']])
    const progress = snapshots.map((s) => s.state && queueProgress(s.state))
    expect(progress).toContainEqual({ saved: 1, total: 3, left: 2, failed: [] })
    expect(queueProgress(queue.snapshot().state!)).toEqual({ saved: 3, total: 3, left: 0, failed: [] })
    expect(queue.snapshot().running).toBe(false)
    expect(settled).toEqual([[1, 2, 3]])
  })

  it('adds a page saved while writing to the same run', async () => {
    const { queue, aniList } = setup()

    queue.add([write(1), write(2)])
    queue.add([write(3)])
    await queue.idle()

    expect(aniList.writes.map(([id]) => id)).toEqual([1, 2, 3])
    expect(aniList.listReads()).toBe(1)
    expect(queueProgress(queue.snapshot().state!)).toMatchObject({ saved: 3, total: 3 })
  })

  it('counts only the new page once the earlier ones are written', async () => {
    const { queue } = setup()
    queue.add([write(1), write(2)])
    await queue.idle()

    queue.add([write(3)])
    await queue.idle()

    expect(queueProgress(queue.snapshot().state!)).toEqual({ saved: 1, total: 1, left: 0, failed: [] })
  })

  it('resumes unfinished writes after a reload, without writing the finished ones again', async () => {
    const storage = memoryStorage()
    const aniList = fakeGateway(new Map([[2, 'auth']]))
    const first = setup(aniList, storage)
    first.queue.add([write(1), write(2), write(3)])
    await first.queue.idle() // the login expired after the first write: the run ends, the rest stays pending
    expect(first.errors).toHaveLength(1)
    aniList.failures.clear()

    const reloaded = setup(aniList, storage)
    expect(queueProgress(reloaded.queue.snapshot().state!)).toMatchObject({ saved: 1, left: 2 })
    reloaded.queue.resume()
    await reloaded.queue.idle()

    expect(aniList.writes.map(([id]) => id)).toEqual([1, 2, 3])
    expect(queueProgress(reloaded.queue.snapshot().state!)).toMatchObject({ saved: 3, left: 0 })
  })

  it('shows failed writes by name, and Retry writes them again', async () => {
    const aniList = fakeGateway(new Map([[2, 'network']]))
    const { queue } = setup(aniList)
    queue.add([write(1), write(2), write(3)])
    await queue.idle()
    expect(queueProgress(queue.snapshot().state!).failed.map((w) => w.name)).toEqual(['Anime 2'])

    aniList.failures.clear()
    queue.retry()
    await queue.idle()

    expect(aniList.writes.map(([id]) => id)).toEqual([1, 3, 2])
    expect(queueProgress(queue.snapshot().state!).failed).toEqual([])
  })

  it('keeps failed writes waiting for Retry when a new page is saved', async () => {
    const aniList = fakeGateway(new Map([[1, 'network']]))
    const { queue } = setup(aniList)
    queue.add([write(1)])
    await queue.idle()
    aniList.failures.clear()

    queue.add([write(2)])
    await queue.idle()

    expect(aniList.writes.map(([id]) => id)).toEqual([2])
    expect(queueProgress(queue.snapshot().state!)).toEqual({ saved: 1, total: 1, left: 0, failed: [write(1)] })
  })

  it('forgets the saved queue once every write is through', async () => {
    const { queue, storage } = setup()
    queue.add([write(1)])
    await queue.idle()

    expect(setup(fakeGateway(), storage).queue.snapshot().state).toBeNull()
  })

  it('does nothing on resume when nothing is left to write', async () => {
    const { queue, aniList } = setup()

    queue.resume()
    await queue.idle()

    expect(aniList.listReads()).toBe(0)
  })
})
