// The Ranking's lifecycle through its interface: in-memory storage that can be made to refuse saving, the real Duel
// log store and engine, a fixed seed, and a `discardImport` that records the keys it was called with.
import { describe, expect, it } from 'vitest'
import { replay, startLog, type DuelLog } from '../ranking/engine.ts'
import { planFromScores } from '../ranking/fromScores.ts'
import { goalOf } from '../ranking/sortGoal.ts'
import { createDuelLogStore } from './duelLogStore.ts'
import { memoryStorage } from './memoryStorage.ts'
import { loadDuelLog, progressStorageKey, saveDuelLog, savePoolSettings, saveTickOverrides, loadTickOverrides, type RankingKey } from './progress.ts'
import { createRankingLifecycle, type KeepMyScalePicks, type NewRanking } from './rankingLifecycle.ts'
import { createSplitChoiceStore } from './splitChoice.ts'

const ANIME: RankingKey = { userId: 7, mediaType: 'ANIME' }
const MANGA: RankingKey = { userId: 7, mediaType: 'MANGA' }
const SEED = 42
const FORMAT = 'POINT_10_DECIMAL'

/** A Pool of four titles in Rough Sort order. */
const ORDER = [1, 2, 3, 4]
const scores: NewRanking = { order: ORDER, goal: 'scores', fromScores: null }

// Anchors 101.. on 9, 8, 7 (two each); the Picker's result on the picked titles 1..5.
const anchors = [9, 9, 8, 8, 7, 7].map((level, i) => ({ id: 101 + i, level }))
const picks: KeepMyScalePicks = { order: [1, 2, 3, 4, 5], anchors, split: 'on-the-score', ownSplit: null }

/** A saved log as Start would have left it, for arranging what is in storage. */
const savedLog = startLog({ ...ANIME, seed: 1, ids: ORDER, scoreFormat: FORMAT })
/** Title 9 is not in the Pool, so the engine refuses it. */
const unreplayable: DuelLog = { ...savedLog, events: [...savedLog.events, { type: 'forgotten', id: 9 }] }

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
      steps.push(`save ${key.split('/').at(-1)}`)
    },
    removeItem: (key) => {
      memory.removeItem(key)
      steps.push(`remove ${key.split('/').at(-1)}`)
    },
  }
  const store = createDuelLogStore(storage)
  const discarded: RankingKey[] = []
  /** What was written, removed and discarded, in order. */
  const steps: string[] = []
  const discardImport = (key: RankingKey) => {
    discarded.push(key)
    steps.push('discard Import')
  }
  const lifecycle = createRankingLifecycle({ storage, duelLog: store, seed: () => SEED, discardImport })
  return {
    storage,
    store,
    lifecycle,
    discarded,
    steps,
    refuseSaves: (refuse = true) => void (refusing = refuse),
    /** Every key and value in storage, to compare before and after. */
    everything: () => Object.fromEntries(Array.from({ length: storage.length }, (_, i) => [storage.key(i)!, storage.getItem(storage.key(i)!)])),
    /** Puts text where the Duel log is saved, as it is. */
    saveRaw: (key: RankingKey, raw: string) => storage.setItem(progressStorageKey({ ...key, part: 'duel-log' }), raw),
    splitChoice: () => createSplitChoiceStore(storage, ANIME.userId).choice(),
  }
}

/**
 * Answers the open Keep My Scale Ranking's Duels through the store, as the app does, for the titles whose score is
 * given, until a title without one comes up.
 */
function settle(store: ReturnType<typeof setup>['store'], truth: ReadonlyMap<number, number>) {
  for (let s = store.latest()!.ranking; s.prompt.kind === 'anchor-duel'; s = store.latest()!.ranking) {
    const { a, b } = s.prompt
    const mine = truth.get(a)
    if (mine === undefined) return
    const theirs = anchors.find((x) => x.id === b)!.level
    expect(store.append({ type: 'duel-answered', a, b, result: mine === theirs ? 'tie' : mine > theirs ? 'a' : 'b' })).toMatchObject({ ok: true })
  }
}

describe('what is saved for a user and Media Type', () => {
  it('is no Ranking and the default statuses when nothing is saved', () => {
    const { lifecycle, store } = setup()

    expect(lifecycle.saved(ANIME)).toEqual({ statuses: ['COMPLETED', 'REPEATING'], kind: 'none' })
    expect(store.latest()).toBeNull()
  })

  it('is the saved Ranking with its replay and the Pool statuses saved with it', () => {
    const { lifecycle, storage } = setup()
    saveDuelLog(storage, savedLog)
    savePoolSettings(storage, ANIME, { statuses: ['DROPPED'] })

    expect(lifecycle.saved(ANIME)).toEqual({ statuses: ['DROPPED'], kind: 'usable', log: savedLog, ranking: replay(savedLog) })
  })

  it("reads another Media Type's Ranking without changing what is open", () => {
    const { lifecycle, storage, store } = setup()
    saveDuelLog(storage, savedLog)
    const manga = startLog({ ...MANGA, seed: 2, ids: [5, 6] })
    saveDuelLog(storage, manga)
    lifecycle.open(MANGA)
    const open = store.latest()

    expect(lifecycle.saved(ANIME)).toMatchObject({ kind: 'usable', log: savedLog })
    expect(store.latest()).toBe(open)
    expect(open!.log).toEqual(manga)
  })

  it('is unusable, with the reason, when the saved log can not be parsed or does not replay', () => {
    const { lifecycle, storage, saveRaw, everything } = setup()
    saveRaw(ANIME, '{not json')
    saveDuelLog(storage, { ...unreplayable, header: { ...unreplayable.header, mediaType: 'MANGA' } })
    const before = everything()

    expect(lifecycle.saved(ANIME)).toEqual({
      statuses: ['COMPLETED', 'REPEATING'],
      kind: 'unusable',
      reason: 'unreadable',
      message: 'The saved Ranking in this browser is unreadable.',
    })
    expect(lifecycle.saved(MANGA)).toMatchObject({ kind: 'unusable', reason: 'does-not-replay', message: expect.stringContaining('9') })
    expect(everything()).toEqual(before)
  })
})

describe('opening a Ranking', () => {
  it('shows the saved Ranking in the store and answers with the Pool statuses', () => {
    const { lifecycle, storage, store, everything } = setup()
    saveDuelLog(storage, savedLog)
    savePoolSettings(storage, ANIME, { statuses: ['PAUSED', 'COMPLETED'] })
    const before = everything()

    const opened = lifecycle.open(ANIME)

    expect(opened).toEqual({ statuses: ['PAUSED', 'COMPLETED'], kind: 'usable', log: savedLog, ranking: replay(savedLog) })
    expect(store.latest()).toEqual({ log: savedLog, ranking: replay(savedLog) })
    expect(everything()).toEqual(before)
  })

  it('leaves no Ranking open when nothing is saved under the key', () => {
    const { lifecycle, storage, store } = setup()
    saveDuelLog(storage, savedLog)
    lifecycle.open(ANIME)

    expect(lifecycle.open(MANGA)).toEqual({ statuses: ['COMPLETED', 'REPEATING'], kind: 'none' })
    expect(store.latest()).toBeNull()
    expect(loadDuelLog(storage, ANIME)).toEqual(savedLog)
  })

  it('leaves no Ranking open, and storage byte for byte, when the saved log can not be parsed', () => {
    const { lifecycle, storage, store, saveRaw, everything } = setup()
    saveDuelLog(storage, startLog({ ...MANGA, seed: 2, ids: [5, 6] }))
    lifecycle.open(MANGA)
    saveRaw(ANIME, '{not json')
    const before = everything()

    expect(lifecycle.open(ANIME)).toMatchObject({ kind: 'unusable', reason: 'unreadable', message: 'The saved Ranking in this browser is unreadable.' })
    expect(store.latest()).toBeNull()
    expect(everything()).toEqual(before)
  })

  it("is unusable when the saved log is another account's", () => {
    const { lifecycle, store, saveRaw } = setup()
    saveRaw(ANIME, JSON.stringify(startLog({ userId: 8, mediaType: 'ANIME', seed: 1, ids: ORDER })))

    expect(lifecycle.open(ANIME)).toMatchObject({
      kind: 'unusable',
      reason: 'unreadable',
      message: 'The saved Ranking in this browser does not belong to this account.',
    })
    expect(store.latest()).toBeNull()
  })

  it("leaves no Ranking open, and storage byte for byte, when the engine can't replay the saved log", () => {
    const { lifecycle, storage, store, everything } = setup()
    saveDuelLog(storage, startLog({ ...MANGA, seed: 2, ids: [5, 6] }))
    lifecycle.open(MANGA)
    saveDuelLog(storage, unreplayable)
    const before = everything()
    let engine = ''
    try {
      replay(unreplayable)
    } catch (e) {
      engine = (e as Error).message
    }

    expect(lifecycle.open(ANIME)).toEqual({ statuses: ['COMPLETED', 'REPEATING'], kind: 'unusable', reason: 'does-not-replay', message: engine })
    expect(engine).not.toBe('')
    expect(store.latest()).toBeNull()
    expect(everything()).toEqual(before)
  })
})

describe('starting a Ranking', () => {
  it('saves a log under Scores with the injected seed, then opens it', () => {
    const { lifecycle, storage, store, discarded } = setup()

    const started = lifecycle.start(ANIME, FORMAT, scores)

    const saved = loadDuelLog(storage, ANIME)!
    expect(saved.header).toMatchObject({ ...ANIME, seed: SEED })
    expect(goalOf(replay(saved))).toBe('scores')
    expect(replay(saved).progress.roughSort).toEqual({ done: 0, total: ORDER.length })
    expect(started).toEqual({ ok: true, log: saved, ranking: replay(saved) })
    expect(store.latest()).toEqual({ log: saved, ranking: replay(saved) })
    expect(discarded).toEqual([])
  })

  it('under Full Ranking saves a log that replays on Full Ranking', () => {
    const { lifecycle, storage } = setup()

    expect(lifecycle.start(ANIME, FORMAT, { ...scores, goal: 'full-ranking' })).toMatchObject({ ok: true })

    expect(goalOf(replay(loadDuelLog(storage, ANIME)!))).toBe('full-ranking')
  })

  it('fills the Bands of Rough Sort from Scores when the user turned it on and the plan is offerable', () => {
    const { lifecycle, storage } = setup()
    const plan = planFromScores([{ id: 1, score100: 90 }, { id: 2, score100: 70 }, { id: 3, score100: 50 }, { id: 4, score100: 0 }])
    expect(plan.offerable).toBe(true)

    expect(lifecycle.start(ANIME, FORMAT, { ...scores, goal: 'full-ranking', fromScores: plan })).toMatchObject({ ok: true })

    const saved = loadDuelLog(storage, ANIME)!
    expect(saved.events.at(-1)).toEqual({ type: 'bands-from-scores', bands: plan.bands })
    expect(goalOf(replay(saved))).toBe('full-ranking')
    // Only the title without a score is left for Rough Sort by hand.
    expect(replay(saved).progress.roughSort).toEqual({ done: 3, total: 4 })
  })

  it('does not fill the Bands from a plan that is not offerable', () => {
    const { lifecycle, storage } = setup()
    const plan = planFromScores(ORDER.map((id) => ({ id, score100: 80 })))
    expect(plan.offerable).toBe(false)

    expect(lifecycle.start(ANIME, FORMAT, { ...scores, fromScores: plan })).toMatchObject({ ok: true })

    const saved = loadDuelLog(storage, ANIME)!
    expect(saved.events.some((e) => e.type === 'bands-from-scores')).toBe(false)
    expect(replay(saved).progress.roughSort).toEqual({ done: 0, total: 4 })
  })

  it('is refused, writing nothing, when a Ranking is saved under the key, open or not', () => {
    const { lifecycle, storage, store, everything } = setup()
    saveDuelLog(storage, savedLog)
    const before = everything()

    expect(lifecycle.start(ANIME, FORMAT, scores)).toEqual({ ok: false, reason: 'in-the-way' })
    expect(lifecycle.startKeepMyScale(ANIME, FORMAT, picks)).toEqual({ ok: false, reason: 'in-the-way' })
    expect(store.latest()).toBeNull()

    lifecycle.open(ANIME)
    const open = store.latest()
    expect(lifecycle.start(ANIME, FORMAT, scores)).toEqual({ ok: false, reason: 'in-the-way' })
    expect(lifecycle.startKeepMyScale(ANIME, FORMAT, picks)).toEqual({ ok: false, reason: 'in-the-way' })
    expect(store.latest()).toBe(open)
    expect(everything()).toEqual(before)
  })

  it('is refused, writing nothing, when an unusable log is saved under the key', () => {
    const { lifecycle, storage, store, saveRaw, everything, discarded } = setup()
    saveRaw(ANIME, '{not json')
    saveDuelLog(storage, { ...unreplayable, header: { ...unreplayable.header, mediaType: 'MANGA' } })
    const before = everything()

    for (const key of [ANIME, MANGA]) {
      expect(lifecycle.start(key, FORMAT, scores)).toEqual({ ok: false, reason: 'in-the-way' })
      expect(lifecycle.startKeepMyScale(key, FORMAT, picks)).toEqual({ ok: false, reason: 'in-the-way' })
    }
    expect(store.latest()).toBeNull()
    expect(everything()).toEqual(before)
    expect(discarded).toEqual([])
  })

  it('saves and opens nothing when the browser refuses to save', () => {
    const { lifecycle, store, everything, refuseSaves } = setup()
    refuseSaves()

    expect(lifecycle.start(ANIME, FORMAT, scores)).toEqual({ ok: false, reason: 'save-refused' })
    expect(store.latest()).toBeNull()
    expect(everything()).toEqual({})
  })

  it("saves and opens nothing when the engine can't replay the new log", () => {
    const { lifecycle, store, everything } = setup()

    // The same title twice is no Pool.
    const started = lifecycle.start(ANIME, FORMAT, { ...scores, order: [1, 1] })

    expect(started).toMatchObject({ ok: false, reason: 'does-not-replay' })
    expect(started.ok === false && started.reason === 'does-not-replay' && started.message).toBeTruthy()
    expect(store.latest()).toBeNull()
    expect(everything()).toEqual({})
  })
})

describe('starting a Keep My Scale Ranking', () => {
  it("saves a log on the Picker's result with the injected seed, then opens it", () => {
    const { lifecycle, storage, store, discarded } = setup()

    const started = lifecycle.startKeepMyScale(ANIME, 'POINT_10', { ...picks, split: 'deciding-duels' })

    const saved = loadDuelLog(storage, ANIME)!
    expect(saved.header).toMatchObject({ ...ANIME, seed: SEED })
    expect(saved.events).toContainEqual({ type: 'anchors-set', format: 'POINT_10', anchors, split: 'deciding-duels' })
    const ranking = replay(saved)
    expect(goalOf(ranking)).toBe('score-new-titles')
    expect(ranking.keepMyScale!.titles.map((t) => t.id)).toEqual(picks.order)
    expect(started).toEqual({ ok: true, log: saved, ranking })
    expect(store.latest()).toEqual({ log: saved, ranking })
    expect(discarded).toEqual([])
  })

  it('clears the remembered titles not yet Settled, and remembers only a split choice the user made themselves', () => {
    const { lifecycle, storage, store, splitChoice } = setup()
    // An earlier Keep My Scale Ranking ended by its Import, leaving its five titles.
    lifecycle.startKeepMyScale(ANIME, 'POINT_10', picks)
    lifecycle.endKeepMyScale(ANIME)
    expect(storage.getItem(progressStorageKey({ ...ANIME, part: 'keep-my-scale-unsettled' }))).toBe('[1,2,3,4,5]')

    // The selection followed the recommendation: nothing to remember.
    expect(lifecycle.startKeepMyScale(ANIME, 'POINT_10', { ...picks, split: 'deciding-duels', ownSplit: null })).toMatchObject({ ok: true })
    expect(storage.getItem(progressStorageKey({ ...ANIME, part: 'keep-my-scale-unsettled' }))).toBeNull()
    expect(splitChoice()).toBeNull()

    lifecycle.startOver(ANIME)
    expect(lifecycle.startKeepMyScale(ANIME, 'POINT_10', { ...picks, split: 'deciding-duels', ownSplit: 'deciding-duels' })).toMatchObject({ ok: true })
    expect(splitChoice()).toBe('deciding-duels')
    expect(store.latest()).not.toBeNull()
  })

  it('does neither when the browser refuses to save', () => {
    const { lifecycle, store, everything, refuseSaves, splitChoice } = setup()
    lifecycle.startKeepMyScale(ANIME, 'POINT_10', picks)
    lifecycle.endKeepMyScale(ANIME)
    const before = everything()
    expect(Object.keys(before)).toEqual([progressStorageKey({ ...ANIME, part: 'keep-my-scale-unsettled' })])

    refuseSaves()
    expect(lifecycle.startKeepMyScale(ANIME, 'POINT_10', { ...picks, ownSplit: 'on-the-score' })).toEqual({ ok: false, reason: 'save-refused' })

    expect(store.latest()).toBeNull()
    expect(everything()).toEqual(before)
    expect(splitChoice()).toBeNull()
  })

  it("changes nothing when the engine can't replay the new log", () => {
    const { lifecycle, store, everything } = setup()

    // A picked title is never an Anchor (ADR 0011).
    const started = lifecycle.startKeepMyScale(ANIME, 'POINT_10', { ...picks, order: [101], ownSplit: 'on-the-score' })

    expect(started).toMatchObject({ ok: false, reason: 'does-not-replay' })
    expect(store.latest()).toBeNull()
    expect(everything()).toEqual({})
  })
})

describe('replacing the open Ranking with a Keep My Scale one', () => {
  /** A Scores Ranking started and open, with a tick saved for its Import. */
  function withScoresRanking() {
    const made = setup()
    made.lifecycle.start(ANIME, FORMAT, scores)
    saveTickOverrides(made.storage, ANIME, new Map([[1, false]]))
    return made
  }

  it('saves the new log over the old one, opens it, and discards the old Import state once, after the save', () => {
    const { lifecycle, storage, store, steps, discarded, splitChoice } = withScoresRanking()
    steps.length = 0

    const replaced = lifecycle.replaceWithKeepMyScale(ANIME, 'POINT_10', { ...picks, ownSplit: 'on-the-score' })

    const saved = loadDuelLog(storage, ANIME)!
    expect(goalOf(replay(saved))).toBe('score-new-titles')
    expect(replaced).toEqual({ ok: true, log: saved, ranking: replay(saved) })
    expect(store.latest()).toEqual({ log: saved, ranking: replay(saved) })
    // No delete first: the first thing to happen is the save, and the discard follows it.
    expect(steps.slice(0, 2)).toEqual(['save duel-log', 'discard Import'])
    expect(steps).not.toContain('remove duel-log')
    expect(discarded).toEqual([ANIME])
    expect(splitChoice()).toBe('on-the-score')
  })

  it('leaves the old Ranking saved and open, and its Import state alone, when the browser refuses to save', () => {
    const { lifecycle, storage, store, everything, discarded, refuseSaves, splitChoice } = withScoresRanking()
    storage.setItem(progressStorageKey({ ...ANIME, part: 'keep-my-scale-unsettled' }), '[3]')
    const before = everything()
    const open = store.latest()

    refuseSaves()
    expect(lifecycle.replaceWithKeepMyScale(ANIME, 'POINT_10', { ...picks, ownSplit: 'deciding-duels' })).toEqual({ ok: false, reason: 'save-refused' })

    expect(store.latest()).toBe(open)
    expect(goalOf(open!.ranking)).toBe('scores')
    expect(everything()).toEqual(before)
    expect(loadTickOverrides(storage, ANIME)).toEqual(new Map([[1, false]]))
    expect(discarded).toEqual([])
    expect(splitChoice()).toBeNull()
  })

  it("changes nothing when the engine can't replay the new log", () => {
    const { lifecycle, store, everything, discarded } = withScoresRanking()
    const before = everything()
    const open = store.latest()

    expect(lifecycle.replaceWithKeepMyScale(ANIME, 'POINT_10', { ...picks, order: [101] })).toMatchObject({ ok: false, reason: 'does-not-replay' })

    expect(store.latest()).toBe(open)
    expect(everything()).toEqual(before)
    expect(discarded).toEqual([])
  })

  it('is refused, changing nothing, when no Ranking is open, the open one is another key\'s, or it is on Keep My Scale', () => {
    const { lifecycle, storage, store, everything, discarded } = setup()
    const nothing = { ok: false, reason: 'nothing-to-replace' }

    // Saved but not open.
    saveDuelLog(storage, savedLog)
    expect(lifecycle.replaceWithKeepMyScale(ANIME, 'POINT_10', picks)).toEqual(nothing)
    expect(store.latest()).toBeNull()

    // Open under Anime, asked for Manga.
    lifecycle.open(ANIME)
    expect(lifecycle.replaceWithKeepMyScale(MANGA, 'POINT_10', picks)).toEqual(nothing)

    // A Keep My Scale Ranking is not replaced by another.
    lifecycle.startKeepMyScale(MANGA, 'POINT_10', picks)
    const before = everything()
    const open = store.latest()
    expect(lifecycle.replaceWithKeepMyScale(MANGA, 'POINT_10', { ...picks, order: [1] })).toEqual(nothing)

    expect(store.latest()).toBe(open)
    expect(everything()).toEqual(before)
    expect(discarded).toEqual([])
  })
})

describe('an Import ending a Keep My Scale Ranking (ADR 0010)', () => {
  /** A Keep My Scale Ranking with titles 1 and 2 Settled, 3 Forgotten, and 4 and 5 not yet Settled. */
  function withKeepMyScaleRanking() {
    const made = setup()
    made.lifecycle.startKeepMyScale(ANIME, 'POINT_10', picks)
    expect(made.store.append({ type: 'forgotten', id: 3 })).toMatchObject({ ok: true })
    settle(made.store, new Map([[1, 7], [2, 9]]))
    expect(made.store.latest()!.ranking.keepMyScale!.titles.filter((t) => t.settled).map((t) => t.id)).toEqual([1, 2])
    return made
  }

  it('keeps only the titles not yet Settled, deletes the log, discards the Import state and closes the Ranking', () => {
    const { lifecycle, store, everything, discarded } = withKeepMyScaleRanking()

    expect(lifecycle.endKeepMyScale(ANIME)).toEqual({ ended: true, unsettled: 'kept' })

    expect(everything()).toEqual({ [progressStorageKey({ ...ANIME, part: 'keep-my-scale-unsettled' })]: '[4,5]' })
    expect(discarded).toEqual([ANIME])
    expect(store.latest()).toBeNull()
    expect(lifecycle.saved(ANIME)).toMatchObject({ kind: 'none' })
  })

  it('deletes the log before it saves the list', () => {
    const { lifecycle, steps } = withKeepMyScaleRanking()
    steps.length = 0

    lifecycle.endKeepMyScale(ANIME)

    expect(steps).toEqual(['remove duel-log', 'save keep-my-scale-unsettled', 'discard Import'])
  })

  it('says none were left when every title is Settled or Forgotten', () => {
    const { lifecycle, store, everything } = withKeepMyScaleRanking()
    expect(store.append({ type: 'forgotten', id: 4 }, { type: 'forgotten', id: 5 })).toMatchObject({ ok: true })

    expect(lifecycle.endKeepMyScale(ANIME)).toEqual({ ended: true, unsettled: 'none' })
    expect(everything()).toEqual({})
  })

  it('has still ended the Ranking when the list can not be saved, and says the list was lost', () => {
    const { lifecycle, store, everything, discarded, refuseSaves } = withKeepMyScaleRanking()

    refuseSaves()
    expect(lifecycle.endKeepMyScale(ANIME)).toEqual({ ended: true, unsettled: 'lost' })

    expect(everything()).toEqual({})
    expect(discarded).toEqual([ANIME])
    expect(store.latest()).toBeNull()
  })

  it('does nothing for a Scores Ranking', () => {
    const { lifecycle, store, everything, discarded } = setup()
    lifecycle.start(ANIME, FORMAT, scores)
    const before = everything()
    const open = store.latest()

    expect(lifecycle.endKeepMyScale(ANIME)).toEqual({ ended: false })

    expect(store.latest()).toBe(open)
    expect(everything()).toEqual(before)
    expect(discarded).toEqual([])
  })

  it("does nothing for a key that is not the open Ranking's, or with no Ranking open", () => {
    const { lifecycle, store, everything, discarded } = withKeepMyScaleRanking()
    const before = everything()
    const open = store.latest()

    expect(lifecycle.endKeepMyScale(MANGA)).toEqual({ ended: false })
    expect(lifecycle.endKeepMyScale({ userId: 8, mediaType: 'ANIME' })).toEqual({ ended: false })
    expect(store.latest()).toBe(open)

    lifecycle.close()
    expect(lifecycle.endKeepMyScale(ANIME)).toEqual({ ended: false })
    expect(everything()).toEqual(before)
    expect(discarded).toEqual([])
  })
})

describe('Start over', () => {
  it('throws away the saved Ranking with its Import state, and closes it', () => {
    const { lifecycle, storage, store, everything, discarded } = setup()
    savePoolSettings(storage, ANIME, { statuses: ['DROPPED'] })
    lifecycle.start(ANIME, FORMAT, scores)

    lifecycle.startOver(ANIME)

    expect(store.latest()).toBeNull()
    expect(discarded).toEqual([ANIME])
    // The Pool settings stay, so a new Ranking starts from the same statuses.
    expect(everything()).toEqual({ [progressStorageKey({ ...ANIME, part: 'pool-settings' })]: JSON.stringify({ statuses: ['DROPPED'] }) })
    expect(lifecycle.start(ANIME, FORMAT, scores)).toMatchObject({ ok: true })
  })

  it('throws away an unusable log too, so a Ranking can start again', () => {
    const { lifecycle, storage, saveRaw, everything, discarded } = setup()
    saveRaw(ANIME, '{not json')
    saveDuelLog(storage, { ...unreplayable, header: { ...unreplayable.header, mediaType: 'MANGA' } })

    lifecycle.startOver(ANIME)
    lifecycle.startOver(MANGA)

    expect(everything()).toEqual({})
    expect(discarded).toEqual([ANIME, MANGA])
    expect(lifecycle.open(ANIME)).toMatchObject({ kind: 'none' })
    expect(lifecycle.start(ANIME, FORMAT, scores)).toMatchObject({ ok: true })
  })

  it("leaves another Media Type's open Ranking open and saved", () => {
    const { lifecycle, storage, store } = setup()
    lifecycle.start(ANIME, FORMAT, scores)
    const open = store.latest()
    saveDuelLog(storage, startLog({ ...MANGA, seed: 2, ids: [5, 6] }))

    lifecycle.startOver(MANGA)

    expect(store.latest()).toBe(open)
    expect(loadDuelLog(storage, ANIME)).toEqual(open!.log)
    expect(loadDuelLog(storage, MANGA)).toBeNull()
  })
})

describe('closing', () => {
  it('leaves no Ranking open and touches nothing saved', () => {
    const { lifecycle, store, everything, discarded } = setup()
    lifecycle.start(ANIME, FORMAT, scores)
    const before = everything()

    lifecycle.close()

    expect(store.latest()).toBeNull()
    expect(everything()).toEqual(before)
    expect(discarded).toEqual([])
    expect(lifecycle.open(ANIME)).toMatchObject({ kind: 'usable' })
  })
})
