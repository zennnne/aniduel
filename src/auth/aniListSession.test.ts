// The AniList session (#78), against the fake AniList: the login, the Viewer, the lists, and what ends it.
import { describe, expect, it } from 'vitest'
import { fakeAniList, fakeClock } from '../anilist/fakeAniList.ts'
import type { MediaType } from '../anilist/types.ts'
import { memoryStorage } from '../persistence/memoryStorage.ts'
import { loadLastMediaType, saveLastMediaType } from '../persistence/progress.ts'
import { LIST_STATUSES } from '../pool/pool.ts'
import { createAniListSession } from './aniListSession.ts'

/** Lets everything already resolved run to its end. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** What AniList answers the next requests with, in order, instead of answering them: nothing, a refusal, or late. */
type Reply = 'network' | 'expired' | { hold: Promise<void> }

/** An answer held back until `release` is called. */
function held() {
  let release = () => {}
  const hold = new Promise<void>((resolve) => (release = resolve))
  return { reply: { hold }, release }
}

/** A fake AniList (titles 1 and 2 on the list) and a browser around a session, with everything the session reported. */
function browser(storage: Storage = memoryStorage()) {
  const aniList = fakeAniList(fakeClock(), { 1: 80, 2: 0 })
  const replies: Reply[] = []
  /** The `Authorization` header of every request sent. */
  const sent: Array<string | null> = []
  const fetch: typeof globalThis.fetch = async (url, init) => {
    sent.push(new Headers(init?.headers).get('Authorization'))
    const reply = replies.shift()
    if (reply === 'network') throw new TypeError('Failed to fetch')
    if (reply === 'expired') return new Response(JSON.stringify({ errors: [{ message: 'Invalid token', status: 400 }] }), { status: 400 })
    if (reply) await reply.hold
    return aniList.fetch(url, init)
  }
  const reported: string[] = []
  /** Opens the page: with `token`, AniList just redirected back with it. */
  function open(options: { token?: string; fake?: boolean } = {}) {
    const session = createAniListSession(
      {
        storage,
        location: { pathname: '/aniduel/', search: '', hash: options.token ? `#access_token=${options.token}` : '' },
        history: { replaceState: () => {} },
        fetch,
        clock: fakeClock(),
        fake: options.fake ? { fetch, token: 'fake' } : undefined,
      },
      () => ({
        onViewer: (viewer) => reported.push(`viewer ${viewer.name}`),
        onListRead: (type, list) => reported.push(`${type} ${list.map((e) => `${e.mediaId}:${e.oldScore100}`).join(' ')}`),
        onExpired: () => reported.push('expired'),
        onUnreachable: () => reported.push('unreachable'),
      }),
    )
    session.start()
    return session
  }
  return { aniList, storage, replies, sent, reported, open }
}

/** A session logged in, with its Viewer read. */
async function loggedIn(storage?: Storage) {
  const b = browser(storage)
  const session = b.open({ token: 'abc' })
  await settle()
  return { ...b, session }
}

describe('the login', () => {
  it('is the token AniList redirected back with, and the Viewer is read with it', async () => {
    const { session, sent, reported } = await loggedIn()
    expect(sent).toEqual(['Bearer abc'])
    expect(session.snapshot()).toMatchObject({ token: 'abc', viewer: { id: 1, name: 'zen' }, lists: {} })
    expect(session.saved).toBe(true)
    expect(reported).toEqual(['viewer zen'])
  })

  it('is restored on the next page load', async () => {
    const { storage } = await loggedIn()
    const next = browser(storage)
    const session = next.open()
    await settle()
    expect(next.sent).toEqual(['Bearer abc'])
    expect(session.snapshot().viewer?.name).toBe('zen')
  })

  it('has a gateway, a request limiter and a Catch-up candidate source for as long as it lasts', async () => {
    const { session } = await loggedIn()
    const { gateway, limiter, candidateSource } = session.snapshot()
    expect([gateway, limiter, candidateSource].every(Boolean)).toBe(true)
    session.viewerChecked({ ...session.snapshot().viewer!, scoreFormat: 'POINT_100' })
    expect(session.snapshot()).toMatchObject({ gateway, limiter, candidateSource })
  })

  it('holds for this page load when the browser refused to save it', async () => {
    const memory = memoryStorage()
    const refusing: Storage = {
      ...memory,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError')
      },
    }
    const { session, sent } = await loggedIn(refusing)
    expect(session.saved).toBe(false)
    expect(sent).toEqual(['Bearer abc'])
    expect(session.snapshot().viewer?.name).toBe('zen')
  })

  it('is missing without a token: nothing is read', async () => {
    const { open, sent, reported } = browser()
    const session = open()
    session.need(['ANIME'])
    await settle()
    expect(session.snapshot()).toEqual({ token: null, gateway: null, limiter: null, candidateSource: null, viewer: null, lists: {} })
    expect(sent).toEqual([])
    expect(reported).toEqual([])
  })

  it("is the fake session's when there is one, whatever is saved", async () => {
    const { storage } = await loggedIn()
    const next = browser(storage)
    const session = next.open({ fake: true })
    await settle()
    expect(next.sent).toEqual(['Bearer fake'])
    expect(session.snapshot().token).toBe('fake')
  })

  it('reads the Viewer once more when it is started again before the first answer', async () => {
    const { open, replies, sent, reported } = browser()
    const first = held()
    replies.push(first.reply)
    const session = open({ token: 'abc' })
    session.start()
    first.release()
    await settle()
    expect(sent).toHaveLength(2)
    expect(reported).toEqual(['viewer zen'])
  })
})

describe('the lists', () => {
  it('waits for the app to say which it needs, then reads it in every status', async () => {
    const { session, aniList, reported } = await loggedIn()
    expect(aniList.listReads).toEqual([])
    session.need(['MANGA'])
    await settle()
    expect(aniList.listReads).toMatchObject([{ type: 'MANGA', statuses: LIST_STATUSES }])
    expect(session.snapshot().lists.MANGA?.map((e) => e.mediaId)).toEqual([1, 2])
    expect(session.snapshot().lists.ANIME).toBeUndefined()
    expect(reported).toEqual(['viewer zen', 'MANGA 1:80 2:0'])
  })

  it('reads the lists needed one at a time, and none of them twice', async () => {
    const { session, aniList, reported } = await loggedIn()
    session.need(['MANGA', 'ANIME'])
    expect(aniList.listReads).toHaveLength(1)
    await settle()
    session.need(['MANGA', 'ANIME'])
    session.need(['ANIME'])
    await settle()
    expect(aniList.listReads.map((r) => r.type)).toEqual(['MANGA', 'ANIME'])
    expect(reported).toEqual(['viewer zen', 'MANGA 1:80 2:0', 'ANIME 1:80 2:0'])
  })

  it('drops a read still in flight when another list is needed instead', async () => {
    const { session, replies, reported } = await loggedIn()
    const manga = held()
    replies.push(manga.reply)
    session.need(['MANGA'])
    session.need(['ANIME'])
    manga.release()
    await settle()
    expect(Object.keys(session.snapshot().lists)).toEqual(['ANIME'])
    expect(reported).toEqual(['viewer zen', 'ANIME 1:80 2:0'])
  })

  it('reads a list again, showing what AniList has now', async () => {
    const { session, aniList, reported } = await loggedIn()
    session.need(['ANIME'])
    await settle()
    aniList.store.set(3, 0)
    await session.refresh('ANIME')
    expect(session.snapshot().lists.ANIME?.map((e) => e.mediaId)).toEqual([1, 2, 3])
    expect(reported).toEqual(['viewer zen', 'ANIME 1:80 2:0', 'ANIME 1:80 2:0 3:0'])
  })

  it('drops a first read still in flight when the list read again lands: it may have left before the write', async () => {
    const { session, aniList, replies, sent, reported } = await loggedIn()
    const first = held()
    replies.push(first.reply)
    session.need(['ANIME'])
    aniList.store.set(3, 0)
    await session.refresh('ANIME')
    aniList.store.delete(3)
    first.release()
    await settle()
    expect(session.snapshot().lists.ANIME?.map((e) => e.mediaId)).toEqual([1, 2, 3])
    expect(reported).toEqual(['viewer zen', 'ANIME 1:80 2:0 3:0'])
    expect(sent).toHaveLength(3)
  })

  it('leaves a list that could not be read again as it was, without a word', async () => {
    const { session, replies, reported } = await loggedIn()
    session.need(['ANIME'])
    await settle()
    replies.push('network')
    await session.refresh('ANIME')
    expect(session.snapshot().lists.ANIME).toHaveLength(2)
    expect(reported).toEqual(['viewer zen', 'ANIME 1:80 2:0'])
  })

  it('shows the scores an Import wrote, on the list they were written to', async () => {
    const { session } = await loggedIn()
    session.need(['ANIME'])
    await settle()
    const before = session.snapshot()
    session.scoresWritten('MANGA', new Map([[2, 70]]))
    expect(session.snapshot()).toBe(before)
    session.scoresWritten('ANIME', new Map([[2, 70]]))
    expect(session.snapshot().lists.ANIME?.map((e) => e.oldScore100)).toEqual([80, 70])
  })

  it('takes the Viewer as AniList reports it later, without reporting a new login', async () => {
    const { session, reported } = await loggedIn()
    session.viewerChecked({ ...session.snapshot().viewer!, scoreFormat: 'POINT_100' })
    expect(session.snapshot().viewer?.scoreFormat).toBe('POINT_100')
    expect(reported).toEqual(['viewer zen'])
  })

  it('tells every subscriber of each change, until it unsubscribes', async () => {
    const { session } = await loggedIn()
    let changes = 0
    const unsubscribe = session.subscribe(() => changes++)
    session.need(['ANIME'])
    await settle()
    expect(changes).toBe(1)
    unsubscribe()
    await session.refresh('ANIME')
    expect(changes).toBe(1)
  })
})

describe('a failed read', () => {
  it('of the Viewer with an expired or revoked login says so, and leaves ending the session to the app', async () => {
    const { open, replies, reported } = browser()
    replies.push('expired')
    const session = open({ token: 'abc' })
    await settle()
    expect(reported).toEqual(['expired'])
    expect(session.snapshot()).toMatchObject({ token: 'abc', viewer: null })
  })

  it('of a list with an expired or revoked login says so', async () => {
    const { session, replies, reported } = await loggedIn()
    replies.push('expired')
    session.need(['ANIME'])
    await settle()
    expect(reported).toEqual(['viewer zen', 'expired'])
  })

  it('of the Viewer with AniList unreachable says so, and Retry reads it', async () => {
    const { open, replies, reported } = browser()
    replies.push('network')
    const session = open({ token: 'abc' })
    await settle()
    expect(reported).toEqual(['unreachable'])
    expect(session.snapshot().viewer).toBeNull()
    session.retry()
    await settle()
    expect(reported).toEqual(['unreachable', 'viewer zen'])
    expect(session.snapshot().viewer?.name).toBe('zen')
  })

  it('of a list with AniList unreachable says so, and Retry reads it', async () => {
    const { session, replies, sent, reported } = await loggedIn()
    replies.push('network')
    session.need(['ANIME'])
    await settle()
    expect(reported).toEqual(['viewer zen', 'unreachable'])
    expect(session.snapshot().lists).toEqual({})
    session.retry()
    await settle()
    expect(reported).toEqual(['viewer zen', 'unreachable', 'ANIME 1:80 2:0'])
    expect(sent).toHaveLength(3)
  })

  it('reported from elsewhere is told apart the same way', async () => {
    const { session, aniList, reported } = await loggedIn()
    session.need(['ANIME'])
    await settle()
    reported.length = 0
    await session.snapshot().gateway!.saveScore(1, 90).catch(session.failed)
    expect(reported).toEqual([])
    aniList.script.push({ kind: 'api', status: 500 }, { kind: 'network' })
    await session.snapshot().gateway!.saveScore(1, 90).catch(session.failed)
    await session.snapshot().gateway!.saveScore(1, 90).catch(session.failed)
    expect(reported).toEqual(['unreachable', 'unreachable'])
  })

  it('Retry reads nothing that has already arrived', async () => {
    const { session, sent } = await loggedIn()
    session.need(['ANIME'])
    await settle()
    session.retry()
    await settle()
    expect(sent).toHaveLength(2)
  })
})

describe('logout', () => {
  const type: MediaType = 'MANGA'

  it('forgets the login, the Viewer and the lists, and keeps the progress saved in this browser', async () => {
    const { session, storage } = await loggedIn()
    session.need(['ANIME'])
    await settle()
    saveLastMediaType(storage, 1, type)
    session.end(false)
    expect(session.snapshot()).toEqual({ token: null, gateway: null, limiter: null, candidateSource: null, viewer: null, lists: {} })
    expect(loadLastMediaType(storage, 1)).toBe(type)
    const next = browser(storage)
    expect(next.open().snapshot().token).toBeNull()
  })

  it("deletes this user's progress in this browser when asked to, and nobody else's", async () => {
    const { session, storage } = await loggedIn()
    saveLastMediaType(storage, 1, type)
    saveLastMediaType(storage, 2, type)
    session.end(true)
    expect(loadLastMediaType(storage, 1)).toBeNull()
    expect(loadLastMediaType(storage, 2)).toBe(type)
  })

  it('drops what is still being read', async () => {
    const { session, replies, reported } = await loggedIn()
    const first = held()
    const again = held()
    replies.push(first.reply, again.reply)
    session.need(['ANIME'])
    const refreshed = session.refresh('ANIME')
    session.end(false)
    first.release()
    again.release()
    await refreshed
    await settle()
    expect(session.snapshot().lists).toEqual({})
    expect(reported).toEqual(['viewer zen'])
  })

  it('reads nothing afterwards', async () => {
    const { session, sent } = await loggedIn()
    session.end(false)
    session.need(['ANIME'])
    session.retry()
    await session.refresh('ANIME')
    await settle()
    expect(sent).toHaveLength(1)
  })

  it("of the fake session leaves the real login's token saved, and the progress too", async () => {
    const { storage } = await loggedIn()
    const next = browser(storage)
    const session = next.open({ fake: true })
    await settle()
    saveLastMediaType(storage, 1, type)
    session.end(true)
    expect(session.snapshot().token).toBeNull()
    expect(loadLastMediaType(storage, 1)).toBe(type)
    expect(browser(storage).open().snapshot().token).toBe('abc')
  })
})
