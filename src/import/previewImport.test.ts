import { describe, expect, it } from 'vitest'
import { fakeAniList, fakeClock } from '../anilist/fakeAniList.ts'
import { createAniListGateway } from '../anilist/gateway.ts'
import type { MediaType, ScoreFormat, Viewer } from '../anilist/types.ts'
import { memoryStorage } from '../persistence/memoryStorage.ts'
import {
  loadDuelLog,
  loadTickOverrides,
  loadWriteQueue,
  saveDuelLog,
  saveWriteQueue,
  type RankingKey,
} from '../persistence/progress.ts'
import { appendEvent, replay, type DuelLog, type LogEvent } from '../ranking/engine.ts'
import { rankingLogOf } from '../ranking/testRanking.ts'
import { createWriteQueue, type WriteQueueState } from '../writes/writeQueue.ts'
import { importOf } from './importState.ts'
import { createPreviewImport, type PreviewImportSnapshot } from './previewImport.ts'

const USER = 7
const ANIME: RankingKey = { userId: USER, mediaType: 'ANIME' }
const MANGA: RankingKey = { userId: USER, mediaType: 'MANGA' }

/** An Import of two scores planned on 10 point, cut off after the first: what an earlier visit left saved. */
const CUT_OFF: WriteQueueState = {
  imports: [{ mediaType: 'ANIME', hash: 'earlier', format: 'POINT_10' }],
  writes: [
    { mediaType: 'ANIME', mediaId: 1, scoreRaw: 100, oldScore100: 0, status: 'done' },
    { mediaType: 'ANIME', mediaId: 3, scoreRaw: 30, oldScore100: 0, status: 'pending' },
  ],
}

/**
 * User 7 on AniList (10 point) with a finished anime Ranking of titles 1 > 2 > 3, none scored yet, and the app around
 * Preview and Import: storage, the write queue, and the Duel log reached through `latestLog` and `append`.
 * `scores` are the titles' AniList scores; `inLog` puts the scoring settings in the log (Scores), as a new Ranking has.
 */
function setup(options: { scores?: Record<number, number>; inLog?: boolean; savedQueue?: WriteQueueState } = {}) {
  const clock = fakeClock()
  const scores = options.scores ?? { 1: 0, 2: 0, 3: 0 }
  const aniList = fakeAniList(clock, scores)
  aniList.viewer.id = USER
  const gateway = createAniListGateway({ fetch: aniList.fetch, token: 't' })
  const storage = memoryStorage()
  if (options.savedQueue) saveWriteQueue(storage, USER, options.savedQueue)
  const errors: unknown[] = []
  const queue = createWriteQueue({
    gateway,
    clock,
    userId: USER,
    initial: loadWriteQueue(storage, USER),
    save: (state) => saveWriteQueue(storage, USER, state),
    onError: (e) => errors.push(e),
  })

  const logs: Partial<Record<MediaType, DuelLog>> = {
    ANIME: rankingLogOf([[[1]], [[2]], [[3]]], [], options.inLog === false ? undefined : 'POINT_10'),
  }
  saveDuelLog(storage, logs.ANIME!)
  let mediaType: MediaType = 'ANIME'
  const append = (...events: LogEvent[]) => {
    const current = logs[mediaType]
    if (!current) return null
    const next = events.reduce(appendEvent, current)
    const state = replay(next)
    saveDuelLog(storage, next)
    logs[mediaType] = next
    return state
  }

  let viewer: Viewer | null = { id: USER, name: 'zen', avatarUrl: null, titleLanguage: 'ROMAJI', scoreFormat: 'POINT_10' }
  const written: Array<[RankingKey, Record<number, number>]> = []
  const finished: RankingKey[] = []
  const previewImport = createPreviewImport(() => ({
    storage,
    gateway: viewer && gateway,
    queue: viewer && queue,
    viewer,
    latestLog: () => logs[mediaType] ?? null,
    append,
    oldScores: new Map(Object.entries(scores).map(([id, s]) => [Number(id), s])),
    name: (id) => `T${id}`,
    onViewer: (fresh) => (viewer = fresh),
    onGatewayError: (e) => errors.push(e),
    onWritten: (key, scores) => written.push([key, Object.fromEntries(scores)]),
    onFinished: (key) => finished.push(key),
  }))
  const seen: PreviewImportSnapshot[] = []
  previewImport.subscribe((snapshot) => seen.push(snapshot))

  return {
    aniList,
    storage,
    queue,
    previewImport,
    errors,
    written,
    finished,
    seen,
    append,
    log: () => logs[mediaType]!,
    /** The user changes their Score Format on AniList. */
    changeFormat: (format: ScoreFormat) => (aniList.viewer.scoreFormat = format),
    /** The app opens the user's Ranking of a Media Type, as on login or a Media Type switch. */
    openRanking: (type: MediaType) => {
      mediaType = type
      previewImport.open({ userId: USER, mediaType: type })
    },
    logOut: () => {
      queue.stop()
      viewer = null
      previewImport.close()
    },
  }
}

describe('opening Preview', () => {
  it('converts the settings into the Duel log after the Score Format changed, drops a saved Import, and says so', async () => {
    const app = setup({ savedQueue: CUT_OFF })
    app.openRanking('ANIME')
    expect(app.previewImport.snapshot().unfinished).not.toBeNull()
    expect(app.previewImport.snapshot().preview).toBeNull()

    app.changeFormat('POINT_100')
    const opened = await app.previewImport.openPreview()

    expect(opened).toEqual({ format: 'POINT_100', converted: true })
    expect(app.previewImport.snapshot().preview).toEqual({ format: 'POINT_100', converted: true })
    // Best 10 / worst 3 on 10 point are 100 / 30 on 100 point.
    expect(app.log().events.at(-1)).toEqual({
      type: 'scoring-set',
      format: 'POINT_100',
      settings: { distribution: 'linear', step: 'whole', best: 100, worst: 30 },
    })
    expect(loadDuelLog(app.storage, ANIME)).toEqual(app.log())
    expect(app.previewImport.snapshot().unfinished).toBeNull()
    expect(importOf(app.queue.snapshot().state, 'ANIME')).toBeNull()
  })

  it('puts the settings of an older log without any into the Duel log, and keeps a saved Import', async () => {
    const app = setup({ inLog: false, savedQueue: CUT_OFF })
    app.openRanking('ANIME')

    expect(await app.previewImport.openPreview()).toEqual({ format: 'POINT_10', converted: false })

    expect(app.log().events.at(-1)).toEqual({
      type: 'scoring-set',
      format: 'POINT_10',
      settings: { distribution: 'linear', step: 'human', best: 10, worst: 3 },
    })
    expect(app.previewImport.snapshot().unfinished).not.toBeNull()
  })

  it('may be open only after a fresh Viewer check in this Ranking session (ADR 0003)', async () => {
    const app = setup()
    app.openRanking('ANIME')
    expect(app.previewImport.planImport()).toBe(false)

    const opening = app.previewImport.openPreview()
    expect(app.previewImport.snapshot().openingPreview).toBe(true)
    await opening
    expect(app.previewImport.snapshot()).toMatchObject({ openingPreview: false, preview: { format: 'POINT_10', converted: false } })
    // Nothing to put in a log that holds its settings already.
    expect(app.log().events.filter((e) => e.type === 'scoring-set')).toHaveLength(1)

    app.openRanking('ANIME')
    expect(app.previewImport.snapshot().preview).toBeNull()
  })

  it('stays closed when the Ranking was left before AniList answered', async () => {
    const app = setup()
    app.openRanking('ANIME')
    const opening = app.previewImport.openPreview()
    app.logOut()

    expect(await opening).toBeNull()
    expect(app.previewImport.snapshot()).toMatchObject({ openingPreview: false, preview: null })
  })
})

/** Opens the anime Ranking and Preview, and shows the Import plan for confirmation. */
async function planned(options: Parameters<typeof setup>[0] = {}) {
  const app = setup(options)
  app.openRanking('ANIME')
  await app.previewImport.openPreview()
  expect(app.previewImport.planImport()).toBe(true)
  return app
}

const stage = (app: ReturnType<typeof setup>) => app.previewImport.snapshot().importing?.stage ?? null

/** Each planned title with how far its write got. */
function statuses(app: ReturnType<typeof setup>) {
  const importing = app.previewImport.snapshot().importing
  if (!importing || importing.stage === 'dropped') return null
  return Object.fromEntries(importing.state.writes.map((w) => [w.mediaId, w.status]))
}

/** Stops the Import once `count` scores are written, as the user pressing Stop then. */
function stopAfter(app: ReturnType<typeof setup>, count: number) {
  const unsubscribe = app.previewImport.subscribe(() => {
    if (Object.values(statuses(app) ?? {}).filter((s) => s === 'done').length < count) return
    unsubscribe()
    app.previewImport.stop()
  })
}

describe('an Import', () => {
  it('waits for confirmation, writes every ticked score, ends as done and reports that it finished', async () => {
    const app = await planned()
    expect(stage(app)).toBe('confirm')
    expect(statuses(app)).toEqual({ 1: 'pending', 2: 'pending', 3: 'pending' })
    await app.queue.idle()
    expect(app.aniList.writes).toEqual([])

    app.previewImport.confirm()
    expect(stage(app)).toBe('running')
    await app.queue.idle()

    expect(stage(app)).toBe('done')
    expect(statuses(app)).toEqual({ 1: 'done', 2: 'done', 3: 'done' })
    // Linear between best 10 and worst 3 on 10 point.
    expect(Object.fromEntries(app.aniList.store)).toEqual({ 1: 100, 2: 70, 3: 30 })
    expect(app.written).toEqual([[ANIME, { 1: 100, 2: 70, 3: 30 }]])
    expect(app.finished).toEqual([ANIME])
    expect(app.previewImport.snapshot().unfinished).toBeNull()
    expect(loadWriteQueue(app.storage, USER)).toBeNull()
  })

  it('stopped half-way ends as stopped, stays saved, and is offered for Resume', async () => {
    const app = await planned()
    stopAfter(app, 1)
    app.previewImport.confirm()
    await app.queue.idle()

    expect(stage(app)).toBe('stopped')
    expect(statuses(app)).toEqual({ 1: 'done', 2: 'pending', 3: 'pending' })
    expect(app.aniList.writes.map((w) => w.mediaId)).toEqual([1])
    expect(app.written).toEqual([[ANIME, { 1: 100 }]])
    expect(app.finished).toEqual([])
    const offered = app.previewImport.snapshot().unfinished
    expect(offered?.writes.map((w) => w.status)).toEqual(['done', 'pending', 'pending'])
    expect(importOf(loadWriteQueue(app.storage, USER)!, 'ANIME')).toEqual(offered)
  })

  it('with failures ends as done without finishing, and is offered for Retry', async () => {
    const app = await planned()
    app.aniList.script.push({ kind: 'ok' }, { kind: 'network' })
    app.previewImport.confirm()
    await app.queue.idle()

    expect(stage(app)).toBe('done')
    expect(statuses(app)).toEqual({ 1: 'done', 2: 'failed', 3: 'done' })
    expect(app.finished).toEqual([])
    expect(app.previewImport.snapshot().unfinished?.writes.map((w) => w.status)).toEqual(['done', 'failed', 'done'])

    expect(await app.previewImport.retry()).toMatchObject({ stage: 'running' })
    await app.queue.idle()

    expect(stage(app)).toBe('done')
    expect(statuses(app)).toEqual({ 1: 'done', 2: 'done', 3: 'done' })
    expect(app.aniList.store.get(2)).toBe(70)
    expect(app.finished).toEqual([ANIME])
    expect(app.previewImport.snapshot().unfinished).toBeNull()
  })
})

/** An Import stopped after its first score (title 1) was written. */
async function stopped() {
  const app = await planned()
  stopAfter(app, 1)
  app.previewImport.confirm()
  await app.queue.idle()
  expect(stage(app)).toBe('stopped')
  return app
}

describe('Resume', () => {
  it('continues an unchanged plan without asking again', async () => {
    const app = await stopped()

    expect(await app.previewImport.resume()).toMatchObject({ stage: 'running' })
    await app.queue.idle()

    expect(stage(app)).toBe('done')
    expect(Object.fromEntries(app.aniList.store)).toEqual({ 1: 100, 2: 70, 3: 30 })
    expect(app.finished).toEqual([ANIME])
  })

  it('makes the plan of an earlier visit again after a fresh Viewer check, and asks to confirm it', async () => {
    const app = setup({ savedQueue: CUT_OFF })
    app.openRanking('ANIME')

    // The saved plan was made from another Duel log; title 1 was written before.
    expect(await app.previewImport.resume()).toMatchObject({ stage: 'confirm', writtenBefore: 1 })
    expect(app.previewImport.snapshot().preview).toEqual({ format: 'POINT_10', converted: false })
  })

  it('asks to confirm again when the Duel log changed, even if the scores stay the same', async () => {
    const app = await stopped()
    // Alone in its Band, the title needs no Duel to get its place back.
    app.append({ type: 'rerank-requested', id: 2 })

    expect(await app.previewImport.resume()).toMatchObject({ stage: 'confirm', writtenBefore: 1 })
    expect(statuses(app)).toEqual({ 1: 'pending', 2: 'pending', 3: 'pending' })
    await app.queue.idle()
    expect(app.aniList.writes.map((w) => w.mediaId)).toEqual([1])
  })

  it('asks to confirm again when the scoring settings in the Duel log changed', async () => {
    const app = await stopped()
    app.append({ type: 'scoring-set', format: 'POINT_10', settings: { distribution: 'linear', step: 'whole', best: 9, worst: 3 } })

    expect(await app.previewImport.resume()).toMatchObject({ stage: 'confirm', writtenBefore: 1 })
    // Title 1 is written again from the 10 it got, not from the list in memory.
    expect(app.previewImport.snapshot().importing).toMatchObject({
      state: {
        writes: [
          { mediaId: 1, scoreRaw: 90, oldScore100: 100, status: 'pending' },
          { mediaId: 2, scoreRaw: 60, oldScore100: 0, status: 'pending' },
          { mediaId: 3, scoreRaw: 30, oldScore100: 0, status: 'pending' },
        ],
      },
    })
    await app.queue.idle()
    expect(app.aniList.writes.map((w) => w.mediaId)).toEqual([1])
  })

  it('asks to confirm again when the ticks changed, without the title unticked since', async () => {
    const app = await stopped()
    app.previewImport.tick(3, false)

    expect(await app.previewImport.resume()).toMatchObject({ stage: 'confirm', writtenBefore: 1 })
    expect(statuses(app)).toEqual({ 1: 'pending', 2: 'pending' })
  })

  it('drops the plan when the Score Format changed, and says so', async () => {
    const app = await stopped()
    app.changeFormat('POINT_100')

    const dropped = { stage: 'dropped', reason: 'format-changed', format: 'POINT_100', previewOpen: true }
    expect(await app.previewImport.resume()).toEqual(dropped)
    expect(app.previewImport.snapshot()).toMatchObject({ importing: dropped, unfinished: null, preview: { format: 'POINT_100', converted: true } })
    expect(loadWriteQueue(app.storage, USER)).toBeNull()
    await app.queue.idle()
    expect(app.aniList.writes.map((w) => w.mediaId)).toEqual([1])
  })

  it('drops the plan when nothing is left to write', async () => {
    const app = await stopped()
    for (const id of [1, 2, 3]) app.previewImport.tick(id, false)

    const dropped = { stage: 'dropped', reason: 'nothing-left', format: 'POINT_10', previewOpen: true }
    expect(await app.previewImport.resume()).toEqual(dropped)
    expect(app.previewImport.snapshot().unfinished).toBeNull()
    expect(loadWriteQueue(app.storage, USER)).toBeNull()
  })

  it('drops the plan when the Ranking is no longer finished', async () => {
    const app = await stopped()
    // A sync added a title: it is back in Rough Sort.
    app.append({ type: 'titles-added', ids: [4] })

    expect(await app.previewImport.resume()).toEqual({ stage: 'dropped', reason: 'ranking-unfinished', format: 'POINT_10', previewOpen: false })
    expect(app.previewImport.snapshot().unfinished).toBeNull()
  })
})

describe('an Import being written', () => {
  /** Runs `then` once title `after` is written: after the first, the rest of the Import is still to write. */
  async function writing(then: (app: ReturnType<typeof setup>) => void, after = 1) {
    const app = await planned()
    const unsubscribe = app.previewImport.subscribe(() => {
      if (statuses(app)?.[after] !== 'done') return
      unsubscribe()
      then(app)
    })
    app.previewImport.confirm()
    await app.queue.idle()
    return app
  }

  it('stays saved and no longer reaches the screen after a switch of Media Type', async () => {
    const app = await writing((app) => app.openRanking('MANGA'))

    expect(app.previewImport.snapshot()).toMatchObject({ importing: null, unfinished: null })
    expect(app.written).toEqual([])
    expect(app.finished).toEqual([])
    expect(app.aniList.writes.map((w) => w.mediaId)).toEqual([1])

    app.openRanking('ANIME')
    expect(app.previewImport.snapshot().unfinished?.writes.map((w) => w.status)).toEqual(['done', 'pending', 'pending'])
  })

  it('no longer reaches the screen even when the switch comes with its last score', async () => {
    const app = await writing((app) => app.openRanking('MANGA'), 3)

    expect(app.previewImport.snapshot()).toMatchObject({ importing: null, unfinished: null })
    expect(app.written).toEqual([])
    expect(app.finished).toEqual([])
  })

  it('stays saved and no longer reaches the screen after a logout', async () => {
    const app = await writing((app) => app.logOut())

    expect(app.previewImport.snapshot()).toMatchObject({ importing: null, unfinished: null, preview: null })
    expect(app.written).toEqual([])
    expect(app.finished).toEqual([])
    expect(importOf(loadWriteQueue(app.storage, USER)!, 'ANIME')?.writes.map((w) => w.status)).toEqual(['done', 'pending', 'pending'])
  })

  it('is taken over by a newer Import, which alone reaches the screen', async () => {
    const app = await stopped()

    // Resume pressed twice: both pass the Viewer check, the second takes over from the first.
    await Promise.all([app.previewImport.resume(), app.previewImport.resume()])
    await app.queue.idle()

    expect(stage(app)).toBe('done')
    expect(app.written).toEqual([[ANIME, { 1: 100 }], [ANIME, { 1: 100, 2: 70, 3: 30 }]])
    expect(app.finished).toEqual([ANIME])
  })
})

describe('ticks', () => {
  it('are saved per user and Media Type', () => {
    const app = setup()
    app.openRanking('ANIME')
    app.previewImport.tick(2, false)
    expect(app.previewImport.snapshot().ticks).toEqual(new Map([[2, false]]))

    app.openRanking('MANGA')
    expect(app.previewImport.snapshot().ticks).toEqual(new Map())
    app.previewImport.open({ userId: 8, mediaType: 'ANIME' })
    expect(app.previewImport.snapshot().ticks).toEqual(new Map())

    app.openRanking('ANIME')
    expect(app.previewImport.snapshot().ticks).toEqual(new Map([[2, false]]))
    expect(loadTickOverrides(app.storage, MANGA)).toEqual(new Map())
  })

  it('leave an unticked title out of the Import plan', async () => {
    const app = setup()
    app.openRanking('ANIME')
    await app.previewImport.openPreview()
    app.previewImport.tick(2, false)

    app.previewImport.planImport()
    expect(statuses(app)).toEqual({ 1: 'pending', 3: 'pending' })
  })

  it('are discarded with the Ranking, like its saved Import', () => {
    const app = setup({ savedQueue: CUT_OFF })
    app.openRanking('ANIME')
    app.previewImport.tick(2, false)

    app.previewImport.discard(ANIME)

    expect(app.previewImport.snapshot().ticks).toEqual(new Map())
    expect(loadTickOverrides(app.storage, ANIME)).toEqual(new Map())
    expect(loadWriteQueue(app.storage, USER)).toBeNull()
  })
})
