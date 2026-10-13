// The way into a Keep My Scale Ranking through its interface: in-memory storage that can be made to refuse saving, the
// real Duel log store and Ranking lifecycle, and an app around it that records what it was told, in order.
import { describe, expect, it } from 'vitest'
import type { ListEntry, MediaType, Viewer } from '../../anilist/types.ts'
import { createDuelLogStore } from '../../persistence/duelLogStore.ts'
import { memoryStorage } from '../../persistence/memoryStorage.ts'
import { loadDuelLog, type RankingKey } from '../../persistence/progress.ts'
import { createRankingLifecycle, type KeepMyScalePicks } from '../../persistence/rankingLifecycle.ts'
import { createUnsettledStore } from '../../persistence/unsettledTitles.ts'
import { goalOf, isKeepMyScale } from '../../ranking/sortGoal.ts'
import { createKeepMyScaleFlow, type KeepMyScaleFlowSnapshot } from './keepMyScaleFlow.ts'

const USER = 7
const ANIME: RankingKey = { userId: USER, mediaType: 'ANIME' }
const MANGA: RankingKey = { userId: USER, mediaType: 'MANGA' }
const VIEWER: Viewer = { id: USER, name: 'zen', avatarUrl: null, titleLanguage: 'ROMAJI', scoreFormat: 'POINT_10_DECIMAL' }

// Anchors 101.. on 9, 8, 7 (two each); the Picker's result on the picked titles 1..5.
const anchors = [9, 9, 8, 8, 7, 7].map((level, i) => ({ id: 101 + i, level }))
const picks: KeepMyScalePicks = { order: [1, 2, 3, 4, 5], anchors, split: 'on-the-score', ownSplit: null }

function entry(mediaId: number, status: ListEntry['status'] = 'COMPLETED'): ListEntry {
  return {
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
  }
}

/** The picked titles on both lists; on anime, title 5 is Planning, which the Picker can't show. */
const LISTS: Partial<Record<MediaType, ListEntry[]>> = {
  ANIME: [1, 2, 3, 4].map((id) => entry(id)).concat(entry(5, 'PLANNING')),
  MANGA: [1, 2, 3, 4, 5].map((id) => entry(id)),
}

/**
 * User 7 logged in on anime with nothing saved, and the app around the flow: `told` is what it was told, in order.
 */
function setup() {
  const memory = memoryStorage()
  let refusing = false
  const storage: Storage = {
    ...memory,
    get length() {
      return memory.length
    },
    setItem: (key, value) => {
      if (refusing) throw new DOMException('full', 'QuotaExceededError')
      memory.setItem(key, value)
    },
  }
  const store = createDuelLogStore(storage)
  const lifecycle = createRankingLifecycle({ storage, duelLog: store, seed: () => 42, discardImport: () => {} })
  const told: string[] = []
  let viewer: Viewer | null = VIEWER
  let mediaType: MediaType = 'ANIME'
  const flow = createKeepMyScaleFlow(() => ({
    storage,
    viewer,
    mediaType,
    lists: LISTS,
    duelLog: store,
    lifecycle,
    showDialog: (dialog) => told.push(`dialog ${dialog}`),
    onPicker: () => told.push('picker'),
    onStarted: () => told.push('started'),
    onReplaced: (key) => told.push(`replaced ${key.mediaType}`),
    onNotStarted: (failure) => told.push(`not started: ${failure.reason}`),
    onEnded: () => told.push('ended'),
    onSaveRefused: () => told.push('save refused'),
  }))
  const seen: KeepMyScaleFlowSnapshot[] = []
  flow.subscribe((snapshot) => seen.push(snapshot))
  return {
    storage,
    store,
    lifecycle,
    flow,
    told,
    seen,
    /** What the app was told since the last call. */
    next: () => told.splice(0),
    refuseSaves: (refuse = true) => void (refusing = refuse),
    logout: () => void (viewer = null),
    select: (type: MediaType) => {
      mediaType = type
      lifecycle.open({ userId: USER, mediaType: type })
    },
    /** A Scores Ranking saved and open on anime. */
    saveScoresRanking: () => lifecycle.start(ANIME, VIEWER.scoreFormat, { order: [1, 2, 3, 4], goal: 'scores', fromScores: null }),
    /** A Keep My Scale Ranking on the picks, ended by its Import with every title still unsettled. */
    leaveUnsettled: (key: RankingKey = ANIME) => {
      lifecycle.open(key)
      lifecycle.startKeepMyScale(key, VIEWER.scoreFormat, picks)
      lifecycle.endKeepMyScale(key)
      lifecycle.open({ userId: USER, mediaType })
    },
  }
}

describe('opening the Picker', () => {
  it('goes straight to the Picker when no unsettled titles are remembered', () => {
    const { flow, told } = setup()
    flow.openPicker({ from: 'start' })
    expect(told).toEqual(['dialog null', 'picker'])
    expect(flow.snapshot()).toEqual({ wayIn: { from: 'start' }, pickAgain: [] })
  })

  it('asks about remembered unsettled titles first (#66)', () => {
    const { flow, told, leaveUnsettled } = setup()
    leaveUnsettled()
    flow.openPicker({ from: 'start' })
    expect(told).toEqual(['dialog pick-again'])
  })

  it('opens with the remembered titles to pick again once the user says yes', () => {
    const { flow, next, leaveUnsettled, storage } = setup()
    leaveUnsettled()
    flow.openPicker({ from: 'start' })
    next()
    flow.enterPicker(createUnsettledStore(storage, ANIME).titles(LISTS.ANIME!))
    expect(next()).toEqual(['dialog null', 'picker'])
    expect(flow.snapshot().pickAgain).toEqual([1, 2, 3, 4])
  })

  it('opens with none of them once the user says no, and lets go of those of an earlier visit', () => {
    const { flow, next, leaveUnsettled } = setup()
    leaveUnsettled()
    flow.enterPicker([1, 2])
    flow.openPicker({ from: 'start' })
    next()
    flow.enterPicker([])
    expect(next()).toEqual(['dialog null', 'picker'])
    expect(flow.snapshot().pickAgain).toEqual([])
  })

  it('does not ask when every remembered title is one the Picker cannot show', () => {
    const { flow, told, storage, lifecycle } = setup()
    lifecycle.startKeepMyScale(ANIME, VIEWER.scoreFormat, { ...picks, order: [5] })
    lifecycle.endKeepMyScale(ANIME)
    expect(createUnsettledStore(storage, ANIME).titles([entry(5)])).toEqual([5])
    flow.openPicker({ from: 'start' })
    expect(told).toEqual(['dialog null', 'picker'])
  })

  it('remembers how it was opened, and reads the Media Type it is opened for (#65)', () => {
    const { flow, told, leaveUnsettled, select } = setup()
    leaveUnsettled()
    select('MANGA')
    // Catch-up's exit offer switches to anime in the same click: the selected Media Type is still manga.
    flow.openPicker({ from: 'catch-up' }, 'ANIME')
    expect(told).toEqual(['dialog pick-again'])
    expect(flow.snapshot().wayIn).toEqual({ from: 'catch-up' })
  })

  it('asks about the selected Media Type when none is named', () => {
    const { flow, next, leaveUnsettled, select } = setup()
    leaveUnsettled(MANGA)
    flow.openPicker({ from: 'start' })
    expect(next()).toEqual(['dialog null', 'picker'])
    select('MANGA')
    flow.openPicker({ from: 'start' })
    expect(next()).toEqual(['dialog pick-again'])
  })

  it('goes straight to the Picker before login', () => {
    const { flow, told, leaveUnsettled, logout } = setup()
    leaveUnsettled()
    logout()
    flow.openPicker({ from: 'start' })
    expect(told).toEqual(['dialog null', 'picker'])
  })

  it('tells its subscribers of every change, until they unsubscribe', () => {
    const { flow, seen } = setup()
    const later: KeepMyScaleFlowSnapshot[] = []
    const unsubscribe = flow.subscribe((snapshot) => later.push(snapshot))
    flow.openPicker({ from: 'catch-up' })
    expect(seen.at(-1)).toBe(flow.snapshot())
    expect(later.at(-1)).toBe(flow.snapshot())
    const count = later.length
    unsubscribe()
    flow.enterPicker([1])
    expect(later).toHaveLength(count)
    expect(seen.at(-1)).toEqual({ wayIn: { from: 'catch-up' }, pickAgain: [1] })
  })
})

describe("the Picker's Confirm", () => {
  it('starts the Keep My Scale Ranking when nothing is saved', () => {
    const { flow, told, store, storage } = setup()
    flow.confirm(picks)
    expect(told).toEqual(['started'])
    expect(isKeepMyScale(store.latest()!.ranking)).toBe(true)
    expect(loadDuelLog(storage, ANIME)).toEqual(store.latest()!.log)
  })

  it('starts it under the selected Media Type', () => {
    const { flow, store, select } = setup()
    select('MANGA')
    flow.confirm(picks)
    expect(store.latest()!.log.header.mediaType).toBe('MANGA')
  })

  it('tells the app when the browser refuses to save, and starts nothing', () => {
    const { flow, told, store, storage, refuseSaves } = setup()
    refuseSaves()
    flow.confirm(picks)
    expect(told).toEqual(['not started: save-refused'])
    expect(store.latest()).toBeNull()
    expect(loadDuelLog(storage, ANIME)).toBeNull()
  })

  it('asks before replacing a saved Ranking on another Sort Goal (#46, #64)', () => {
    const { flow, told, store, saveScoresRanking } = setup()
    saveScoresRanking()
    flow.confirm(picks)
    expect(told).toEqual(['dialog replace-with-keep-my-scale'])
    expect(goalOf(store.latest()!.ranking)).toBe('scores')
  })

  it('does nothing before login', () => {
    const { flow, told, store, logout } = setup()
    logout()
    flow.confirm(picks)
    expect(told).toEqual([])
    expect(store.latest()).toBeNull()
  })
})

describe('the Replace dialog', () => {
  it('confirmed: the Keep My Scale Ranking is saved over the saved one', () => {
    const { flow, next, store, storage, saveScoresRanking } = setup()
    saveScoresRanking()
    flow.confirm(picks)
    next()
    flow.replace()
    expect(next()).toEqual(['dialog null', 'replaced ANIME'])
    expect(isKeepMyScale(store.latest()!.ranking)).toBe(true)
    expect(loadDuelLog(storage, ANIME)).toEqual(store.latest()!.log)
  })

  it('confirmed, but the browser refuses to save: the saved Ranking stays, and the picks are let go', () => {
    const { flow, next, store, saveScoresRanking, refuseSaves } = setup()
    saveScoresRanking()
    flow.confirm(picks)
    next()
    refuseSaves()
    flow.replace()
    expect(next()).toEqual(['dialog null', 'not started: save-refused'])
    expect(goalOf(store.latest()!.ranking)).toBe('scores')
    refuseSaves(false)
    flow.replace()
    expect(next()).toEqual([])
  })

  it('cancelled: the picks are let go and the saved Ranking stays', () => {
    const { flow, next, store, saveScoresRanking } = setup()
    saveScoresRanking()
    flow.confirm(picks)
    next()
    flow.cancelReplace()
    expect(next()).toEqual(['dialog null'])
    flow.replace()
    expect(next()).toEqual([])
    expect(goalOf(store.latest()!.ranking)).toBe('scores')
  })

  it('does nothing without picks held for it', () => {
    const { flow, told, saveScoresRanking } = setup()
    saveScoresRanking()
    flow.replace()
    expect(told).toEqual([])
  })
})

describe('the Ranking ending with its Import (ADR 0010)', () => {
  it('ends the Keep My Scale Ranking and keeps its unsettled titles for the next Picker', () => {
    const { flow, next, store, storage } = setup()
    flow.confirm(picks)
    next()
    flow.end(ANIME)
    expect(next()).toEqual(['ended'])
    expect(store.latest()).toBeNull()
    expect(loadDuelLog(storage, ANIME)).toBeNull()
    flow.openPicker({ from: 'start' })
    expect(next()).toEqual(['dialog pick-again'])
  })

  it('says so when the browser refuses to save the unsettled titles; the Ranking ends anyway', () => {
    const { flow, next, store, refuseSaves } = setup()
    flow.confirm(picks)
    next()
    refuseSaves()
    flow.end(ANIME)
    expect(next()).toEqual(['save refused', 'ended'])
    expect(store.latest()).toBeNull()
  })

  it("leaves a Scores Ranking's Import alone", () => {
    const { flow, told, store, saveScoresRanking } = setup()
    saveScoresRanking()
    flow.end(ANIME)
    expect(told).toEqual([])
    expect(store.latest()).not.toBeNull()
  })

  it('leaves the open Ranking alone when the Import was of another Media Type', () => {
    const { flow, next, store } = setup()
    flow.confirm(picks)
    next()
    flow.end(MANGA)
    expect(next()).toEqual([])
    expect(store.latest()).not.toBeNull()
  })
})
