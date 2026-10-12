// Remembered unsettled titles (#66, ADR 0011): the picked titles a Keep My Scale Ranking left unsettled when its
// Import ended it, kept per user and Media Type in injected Storage.
import { describe, expect, it } from 'vitest'
import type { ListEntry, ListStatus } from '../anilist/types.ts'
import { appendEvent, replay, startKeepMyScaleLog, type DuelLog } from '../ranking/engine.ts'
import { memoryStorage } from './memoryStorage.ts'
import { createUnsettledStore } from './unsettledTitles.ts'

const ANIME = { userId: 7, mediaType: 'ANIME' } as const

const entry = (mediaId: number, status: ListStatus = 'COMPLETED'): ListEntry => ({
  mediaId,
  status,
  oldScore100: 0,
  completedAt: { year: null, month: null, day: null },
  title: { romaji: `T${mediaId}`, english: null, native: null },
  coverUrl: null,
  coverColor: null,
  bannerUrl: null,
  year: null,
  format: null,
  length: null,
  siteUrl: '',
})

// Anchors 101.. on 9, 8, 7 (two each); picked titles 1..5 with these true scores. Duels are answered for 1 and 2
// only, so they settle; 3 is Forgotten; 4 and 5 are left unsettled.
const anchors = [9, 9, 8, 8, 7, 7].map((level, i) => ({ id: 101 + i, level }))
const truth = new Map([[1, 7], [2, 9]])
function endedRanking() {
  let log: DuelLog = startKeepMyScaleLog({ seed: 3, userId: 7, mediaType: 'ANIME', format: 'POINT_10', anchors, ids: [1, 2, 3, 4, 5] })
  log = appendEvent(log, { type: 'forgotten', id: 3 })
  for (let s = replay(log); s.prompt.kind === 'anchor-duel'; s = replay(log)) {
    const { a, b } = s.prompt
    const mine = truth.get(a)
    if (mine === undefined) break
    const theirs = anchors.find((x) => x.id === b)!.level
    log = appendEvent(log, { type: 'duel-answered', a, b, result: mine === theirs ? 'tie' : mine > theirs ? 'a' : 'b' })
  }
  return replay(log)
}
const list = [1, 2, 3, 4, 5].map((id) => entry(id))

describe('remembered unsettled titles', () => {
  it('are the picked titles neither Settled nor Forgotten when the Import ended the Ranking', () => {
    const storage = memoryStorage()
    const ranking = endedRanking()
    expect(ranking.keepMyScale!.titles.filter((t) => t.settled).map((t) => t.id)).toEqual([1, 2])

    createUnsettledStore(storage, ANIME).remember(ranking)

    expect(createUnsettledStore(storage, ANIME).titles(list)).toEqual([4, 5])
  })

  it('drop titles gone from the list or now Planning, without touching what is stored', () => {
    const storage = memoryStorage()
    createUnsettledStore(storage, ANIME).remember(endedRanking())
    const changed = [entry(1), entry(5, 'PLANNING')]

    expect(createUnsettledStore(storage, ANIME).titles(changed)).toEqual([])
    expect(createUnsettledStore(storage, ANIME).titles(list)).toEqual([4, 5])
  })

  it('are cleared by an Import that leaves nothing unsettled', () => {
    const storage = memoryStorage()
    const store = createUnsettledStore(storage, ANIME)
    store.remember(endedRanking())
    let log: DuelLog = startKeepMyScaleLog({ seed: 3, userId: 7, mediaType: 'ANIME', format: 'POINT_10', anchors, ids: [4] })
    log = appendEvent(log, { type: 'forgotten', id: 4 })

    store.remember(replay(log))

    expect(store.titles(list)).toEqual([])
    expect(storage.length).toBe(0)
  })

  it('are cleared when the next Keep My Scale Ranking starts', () => {
    const storage = memoryStorage()
    const store = createUnsettledStore(storage, ANIME)
    store.remember(endedRanking())

    store.clear()

    expect(store.titles(list)).toEqual([])
  })

  it('are never shared between users or Media Types', () => {
    const storage = memoryStorage()
    createUnsettledStore(storage, ANIME).remember(endedRanking())

    expect(createUnsettledStore(storage, { userId: 8, mediaType: 'ANIME' }).titles(list)).toEqual([])
    expect(createUnsettledStore(storage, { userId: 7, mediaType: 'MANGA' }).titles(list)).toEqual([])
    createUnsettledStore(storage, { userId: 7, mediaType: 'MANGA' }).clear()
    expect(createUnsettledStore(storage, ANIME).titles(list)).toEqual([4, 5])
  })
})
