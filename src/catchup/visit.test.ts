import { describe, expect, it } from 'vitest'
import type { CatchUpMedia, Era } from '../anilist/candidates.ts'
import { fakeAniList, fakeClock } from '../anilist/fakeAniList.ts'
import { AniListError, createAniListGateway, type AniListGateway } from '../anilist/gateway.ts'
import type { ListEntry, ListStatus, Viewer } from '../anilist/types.ts'
import { memoryStorage } from '../persistence/memoryStorage.ts'
import { loadWriteQueue, saveWriteQueue } from '../persistence/progress.ts'
import { createWriteQueue, type WriteQueueState } from '../writes/writeQueue.ts'
import { createPassedStore } from './passed.ts'
import { createStartingEraStore } from './startingEra.ts'
import type { CandidateSource } from './suggestionCandidates.ts'
import { createCatchUpVisit, type CatchUpVisit, type CatchUpVisitSnapshot } from './visit.ts'

const USER = 7

function anime(id: number, overrides: Partial<CatchUpMedia> = {}): CatchUpMedia {
  return {
    id,
    title: { romaji: `Anime ${id}`, english: null, native: null },
    coverUrl: null,
    coverColor: null,
    siteUrl: '',
    year: 2015,
    format: 'TV',
    status: 'FINISHED',
    watched: 10_000,
    tags: [],
    relations: [],
    recommendations: [],
    ...overrides,
  }
}

const range = (count: number) => Array.from({ length: count }, (_, i) => i)

/** Sixty watched titles (ids 100..159): a list past the cold-start threshold. */
const LONG_LIST = Object.fromEntries(range(60).map((i) => [100 + i, 0]))

/** Forty popular titles unrelated to anything (ids 1000..1039). */
const FILLER = range(40).map((i) => anime(1000 + i, { watched: 5_000 + i }))

/** All-time favourites (ids 500..524), as the Starting era question shows them. */
const FAVOURITES = range(25).map((i) => anime(500 + i))

/**
 * Popular titles as a near-empty list gets them: 25 from the middle year of the era (ids from `from` × 100), each with
 * a sequel AniList doesn't know, so marking one sends the candidates reading.
 */
const popularInEra = (era: Era | null) =>
  era === null
    ? FAVOURITES
    : range(25).map((i) => {
        const id = era.from * 100 + i
        return anime(id, { year: era.from + 2, relations: [{ type: 'SEQUEL', mediaId: id + 5_000_000 }] })
      })

/** Lets everything already resolved run to its end. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** A fake AniList for the candidates: knows `catalog`, records what was asked, and can hold its answers back. */
function fakeSource(catalog: CatchUpMedia[], popular: (era: Era | null) => CatchUpMedia[]) {
  const byId = new Map(catalog.map((m) => [m.id, m]))
  const asked: number[][] = []
  const eras: Array<Era | null> = []
  let held: Promise<void> | null = null
  let release = () => {}
  const source: CandidateSource = {
    media: async (ids) => {
      asked.push([...ids])
      await held
      return ids.flatMap((id) => byId.get(id) ?? [])
    },
    popular: async (era) => {
      eras.push(era)
      await held
      return popular(era)
    },
  }
  return {
    source,
    asked,
    eras,
    /** Reads asked from now on don't answer until `release`. */
    hold: () => void (held = new Promise((resolve) => (release = resolve))),
    release: () => {
      release()
      held = null
    },
  }
}

/**
 * User 7 with `listed` on their anime list (all Completed), the write queue, and the app around a Catch-up visit.
 * `catalog` and `popular` are what AniList knows of anime; `savedQueue` is what an earlier visit left unwritten.
 */
function setup(
  options: {
    listed?: Record<number, number>
    catalog?: CatchUpMedia[]
    popular?: (era: Era | null) => CatchUpMedia[]
    savedQueue?: WriteQueueState
    /** What reading the anime list fails with. */
    listFails?: unknown
    /** Statuses on AniList other than Completed. */
    statuses?: Record<number, ListStatus>
    /** The anime list as the app has already read it. */
    appList?: ListEntry[]
  } = {},
) {
  const clock = fakeClock()
  const aniList = fakeAniList(clock, options.listed ?? {}, { statuses: options.statuses })
  const real = createAniListGateway({ fetch: aniList.fetch, token: 't' })
  const storage = memoryStorage()
  if (options.savedQueue) saveWriteQueue(storage, USER, options.savedQueue)
  const errors: unknown[] = []
  const queue = createWriteQueue({
    gateway: real,
    clock,
    userId: USER,
    initial: loadWriteQueue(storage, USER),
    save: (state) => saveWriteQueue(storage, USER, state),
    onError: (e) => errors.push(e),
  })
  const gateway: AniListGateway =
    options.listFails === undefined ? real : { ...real, mediaList: () => Promise.reject(options.listFails) }
  const candidates = fakeSource(options.catalog ?? [], options.popular ?? (() => FILLER))
  const passedStore = createPassedStore(storage, USER)

  let viewer: Viewer | null = { id: USER, name: 'zen', avatarUrl: null, titleLanguage: 'ROMAJI', scoreFormat: 'POINT_10' }
  let seeds = 0
  // The app's reads of the anime list after a run: each ends when the test says so.
  const listReads: Array<{ written: number[]; end: () => void }> = []
  const visit = createCatchUpVisit(() => ({
    storage,
    gateway: viewer && gateway,
    animeList: options.appList ?? null,
    source: viewer && candidates.source,
    viewer,
    passedStore,
    clock,
    seed: () => ++seeds,
    onGatewayError: (e) => errors.push(e),
    onWritten: (written) => new Promise<void>((end) => listReads.push({ written, end })),
  }))
  const detach = visit.attach(queue)
  const seen: CatchUpVisitSnapshot[] = []
  visit.subscribe((snapshot) => seen.push(snapshot))

  return {
    aniList,
    storage,
    queue,
    visit,
    /** The app lets go of the write queue, as when the user changes. */
    detach,
    candidates,
    passedStore,
    errors,
    seen,
    listReads,
    eraStore: createStartingEraStore(storage, USER),
    logOut: () => {
      queue.stop()
      viewer = null
      visit.close()
    },
  }
}

function batchOf(visit: CatchUpVisit) {
  const { view } = visit.snapshot()
  if (view.phase !== 'ready') throw new Error(`no batch on screen: ${view.phase}`)
  return view.batch
}

const idsOf = (visit: CatchUpVisit) => batchOf(visit).suggestions.map((s) => s.media.id)
const yearsOf = (visit: CatchUpVisit) => [...new Set(batchOf(visit).suggestions.map((s) => s.media.year))]

describe('opening Catch-up', () => {
  it('shows the first batch', async () => {
    const app = setup({ listed: LONG_LIST })
    expect(app.visit.snapshot().view).toEqual({ phase: 'idle' })

    const opening = app.visit.open()
    expect(app.visit.snapshot().view).toEqual({ phase: 'loading' })
    await opening

    expect(batchOf(app.visit).number).toBe(1)
    expect(idsOf(app.visit)).toHaveLength(20)
    expect(app.visit.snapshot().startingEraLabel).toBeNull()
  })

  it('reads only the Planning titles when the app has read the list already', async () => {
    const listed = { ...LONG_LIST, 1000: 0, 1001: 0 }
    const real = createAniListGateway({ fetch: fakeAniList(fakeClock(), listed).fetch, token: 't' })
    const appList = await real.mediaList({ userId: USER, type: 'ANIME', statuses: ['COMPLETED'] })
    const { visit, aniList, candidates } = setup({ listed, statuses: { 1001: 'PLANNING' }, appList })

    await visit.open()

    expect(aniList.listReads.map((r) => r.statuses)).toEqual([['PLANNING']])
    // The app's titles are the seeds, and neither they nor the Planning one are suggested.
    expect(candidates.asked[0]).toEqual(expect.arrayContaining([100, 159, 1000]))
    expect(candidates.asked[0]).not.toContain(1001)
    expect(idsOf(visit)).toHaveLength(20)
    expect(idsOf(visit)).not.toContain(1000)
    expect(idsOf(visit)).not.toContain(1001)
  })

  it('leaves the batch as it was when opened again while it shows', async () => {
    const app = setup({ listed: LONG_LIST })
    await app.visit.open()
    app.visit.cycle(idsOf(app.visit)[0])
    const left = app.visit.snapshot().view

    await app.visit.open()

    expect(app.visit.snapshot().view).toBe(left)
    expect(app.aniList.listReads).toHaveLength(1)
  })

  it('counts titles still in the write queue as on the list', async () => {
    const savedQueue: WriteQueueState = {
      imports: [],
      writes: [{ mediaType: 'ANIME', mediaId: 1039, listStatus: 'COMPLETED', name: 'Anime 1039', status: 'failed', error: 'network error' }],
    }
    const app = setup({ listed: LONG_LIST, savedQueue, popular: () => FILLER.slice(20) })

    await app.visit.open()

    expect(idsOf(app.visit)).toHaveLength(19)
    expect(idsOf(app.visit)).not.toContain(1039)
  })

  it('sends an expired login to the app’s gateway error handling', async () => {
    const expired = new AniListError('auth', 'Your AniList login expired', 401)
    const app = setup({ listed: LONG_LIST, listFails: expired })

    await app.visit.open()

    expect(app.errors).toEqual([expired])
    expect(app.seen.map((s) => s.view.phase)).not.toContain('failed')
  })

  it('shows any other failure as failed, and loads again on the next open', async () => {
    const app = setup({ listed: LONG_LIST })
    app.candidates.source.popular = () => Promise.reject(new AniListError('unreachable', 'AniList can’t be reached'))

    await app.visit.open()

    expect(app.visit.snapshot().view).toEqual({ phase: 'failed', message: 'AniList can’t be reached' })
    expect(app.errors).toEqual([])

    app.candidates.source.popular = async () => FILLER
    await app.visit.open()

    expect(batchOf(app.visit).number).toBe(1)
  })
})

describe('the Starting era', () => {
  it('is asked once on a near-empty list, and the first batch follows the answer', async () => {
    const app = setup({ popular: popularInEra })

    await app.visit.open()

    expect(app.visit.snapshot().view).toEqual({ phase: 'era', popular: null, answer: undefined })
    await settle()
    expect(app.visit.snapshot().view).toEqual({ phase: 'era', popular: FAVOURITES, answer: undefined })

    await app.visit.answerStartingEra(2012)

    expect(batchOf(app.visit).number).toBe(1)
    expect(idsOf(app.visit)).toHaveLength(20)
    expect(yearsOf(app.visit)).toEqual([2012])
    expect(app.candidates.eras).toContainEqual({ from: 2010, to: 2014 })
    expect(app.visit.snapshot().startingEraLabel).toBe('around 2012')
    expect(app.eraStore.answer()).toBe(2012)

    // The next visit, the list still near empty: no question.
    app.visit.close()
    await app.visit.open()

    expect(app.seen.filter((s) => s.view.phase === 'era' && s.view.popular === null)).toHaveLength(1)
    expect(yearsOf(app.visit)).toEqual([2012])
  })

  it('changed from the chip replaces the batch on screen and keeps its number', async () => {
    const app = setup({ popular: popularInEra })
    await app.visit.open()
    await app.visit.answerStartingEra(2012)
    app.visit.cycle(idsOf(app.visit)[0])
    app.visit.saveAndNext()
    await settle()
    expect(batchOf(app.visit).number).toBe(2)

    app.visit.changeStartingEra()

    expect(app.visit.snapshot().view).toMatchObject({ phase: 'era', answer: 2012 })

    await app.visit.answerStartingEra(2000)

    expect(batchOf(app.visit).number).toBe(2)
    expect(idsOf(app.visit)).toHaveLength(20)
    expect(yearsOf(app.visit)).toEqual([2000])
    expect(app.visit.snapshot().startingEraLabel).toBe('around 2000')
  })

  it('changed while the candidates are still updating replaces the batch all the same', async () => {
    const app = setup({ popular: popularInEra })
    await app.visit.open()
    await app.visit.answerStartingEra(2012)
    app.candidates.hold()
    app.visit.cycle(idsOf(app.visit)[0])
    app.visit.saveAndNext()
    await settle()
    expect(app.candidates.asked).toHaveLength(1) // reading what the marked title points at

    app.visit.changeStartingEra()
    const answering = app.visit.answerStartingEra(2000)
    await settle()

    expect(app.visit.snapshot().view).toEqual({ phase: 'loading' })
    // The new era's titles are asked for only once the update before it is through.
    expect(app.candidates.eras).not.toContainEqual({ from: 1998, to: 2002 })

    app.candidates.release()
    await answering

    expect(app.candidates.eras).toContainEqual({ from: 1998, to: 2002 })

    expect(batchOf(app.visit).number).toBe(2)
    expect(yearsOf(app.visit)).toEqual([2000])
  })
})

describe('"Save & next"', () => {
  it('puts the marked titles in the write queue, records the Passed ones, and shows the next batch without waiting', async () => {
    const app = setup({ listed: LONG_LIST })
    await app.visit.open()
    const first = idsOf(app.visit)
    const [completed, dropped, ...unmarked] = first
    app.visit.cycle(completed)
    app.visit.mark(dropped, 'DROPPED')
    app.candidates.hold() // nothing more is read from here on

    app.visit.saveAndNext()

    expect(app.queue.snapshot().state.writes).toEqual([
      { mediaType: 'ANIME', mediaId: completed, listStatus: 'COMPLETED', name: `Anime ${completed}`, status: 'pending' },
      { mediaType: 'ANIME', mediaId: dropped, listStatus: 'DROPPED', name: `Anime ${dropped}`, status: 'pending' },
    ])
    expect([...app.passedStore.history().keys()].sort()).toEqual([...unmarked].sort())
    expect(batchOf(app.visit).number).toBe(2)
    expect(batchOf(app.visit).marks.size).toBe(0)
    expect(idsOf(app.visit)).toHaveLength(20)
    expect(idsOf(app.visit).filter((id) => first.includes(id))).toEqual([])
    expect(app.visit.snapshot().added).toBe(2)

    await app.queue.idle()

    expect(app.aniList.writes.map(({ mediaId, status }) => ({ mediaId, status }))).toEqual([
      { mediaId: completed, status: 'COMPLETED' },
      { mediaId: dropped, status: 'DROPPED' },
    ])
    expect(app.visit.snapshot().queue.state?.writes.map((w) => w.status)).toEqual(['done', 'done'])
  })

  it('may suggest Passed titles again after Clear Passed', async () => {
    const app = setup({ listed: LONG_LIST, popular: () => FILLER.slice(0, 20) })
    await app.visit.open()
    const first = idsOf(app.visit)
    app.visit.saveAndNext()
    expect(idsOf(app.visit)).toEqual([])

    app.visit.clearPassed()
    app.visit.saveAndNext()

    expect(app.passedStore.history().size).toBe(0)
    expect(idsOf(app.visit).sort()).toEqual([...first].sort())
  })

  it('starts counting the titles added again on the next visit', async () => {
    const app = setup({ listed: LONG_LIST })
    await app.visit.open()
    app.visit.cycle(idsOf(app.visit)[0])
    app.visit.saveAndNext()
    const left = app.visit.snapshot().view

    await app.visit.open()

    expect(app.visit.snapshot().added).toBe(0)
    expect(app.visit.snapshot().view).toBe(left)
  })
})

/** A long list and two titles to suggest; the first one's sequel is read only once that title is marked. */
const twoTitles = () =>
  setup({
    listed: LONG_LIST,
    catalog: [anime(2000)],
    popular: (era) => (era === null ? [anime(1000, { relations: [{ type: 'SEQUEL', mediaId: 2000 }] }), anime(1001)] : []),
  })

describe('a batch that came up empty', () => {
  it('fills once the candidates have caught up', async () => {
    const app = twoTitles()
    await app.visit.open()
    expect(idsOf(app.visit).sort()).toEqual([1000, 1001])
    app.candidates.hold()
    app.visit.mark(1000, 'COMPLETED')

    app.visit.saveAndNext()
    await settle()

    expect(batchOf(app.visit)).toMatchObject({ number: 2, suggestions: [] })

    app.candidates.release()
    await settle()

    expect(batchOf(app.visit).number).toBe(2)
    expect(idsOf(app.visit)).toEqual([2000])
  })

  it('is left alone if the user moved on meanwhile', async () => {
    const app = twoTitles()
    await app.visit.open()
    app.candidates.hold()
    app.visit.mark(1000, 'COMPLETED')
    app.visit.saveAndNext()
    app.visit.saveAndNext() // on to batch 3, empty too

    app.candidates.release()
    await settle()

    expect(batchOf(app.visit).number).toBe(3)
    expect(idsOf(app.visit)).toEqual([2000])
    const filled = app.seen.flatMap((s) => (s.view.phase === 'ready' && s.view.batch.suggestions.length === 1 ? [s.view.batch.number] : []))
    expect(new Set(filled)).toEqual(new Set([3]))
  })
})

describe('closing (logout)', () => {
  it('while the list is loading leaves nothing of the visit, and nothing arrives later', async () => {
    const app = setup({ listed: LONG_LIST })
    const opening = app.visit.open()

    app.visit.close() // the app around it still has the user, as it does until its next render
    const after = app.seen.length
    await opening
    await settle()

    expect(app.visit.snapshot()).toMatchObject({ view: { phase: 'idle' }, added: 0 })
    expect(app.seen).toHaveLength(after)
    expect(app.candidates.asked).toEqual([])
    expect(app.errors).toEqual([])
  })

  it('while the candidates are loading leaves nothing of the visit, and nothing arrives later', async () => {
    const app = setup({ listed: LONG_LIST })
    app.candidates.hold()
    const opening = app.visit.open()
    await settle()
    expect(app.candidates.asked).toHaveLength(1)

    app.logOut()
    const after = app.seen.length
    app.candidates.release()
    await opening
    await settle()

    expect(app.visit.snapshot().view).toEqual({ phase: 'idle' })
    expect(app.seen).toHaveLength(after)
  })

  it('while the Starting era is asked leaves no question, and its covers don’t arrive later', async () => {
    const app = setup({ popular: popularInEra })
    app.candidates.hold()
    await app.visit.open()
    expect(app.visit.snapshot().view.phase).toBe('era')

    app.visit.close()
    const after = app.seen.length
    app.candidates.release()
    await settle()

    expect(app.visit.snapshot().view).toEqual({ phase: 'idle' })
    expect(app.seen).toHaveLength(after)
  })

  it('while an empty batch waits for the candidates leaves it unfilled', async () => {
    const app = twoTitles()
    await app.visit.open()
    app.candidates.hold()
    app.visit.mark(1000, 'COMPLETED')
    app.visit.saveAndNext()

    app.logOut()
    const after = app.seen.length
    app.candidates.release()
    await settle()

    expect(app.visit.snapshot().view).toEqual({ phase: 'idle' })
    expect(app.seen).toHaveLength(after)
  })
})

describe('the exit offer', () => {
  it('isn’t ready until every save was written and the anime list was read again', async () => {
    const app = setup({ listed: LONG_LIST })
    await app.visit.open()
    expect(app.visit.snapshot()).toMatchObject({ added: 0, listed: true })
    const [id] = idsOf(app.visit)
    app.visit.cycle(id)

    app.visit.saveAndNext()

    expect(app.visit.snapshot()).toMatchObject({ added: 1, listed: false })

    await app.queue.idle()
    await settle()

    expect(app.listReads.map((r) => r.written)).toEqual([[id]])
    expect(app.visit.snapshot().listed).toBe(false)

    app.listReads[0].end()
    await settle()

    expect(app.visit.snapshot()).toMatchObject({ added: 1, listed: true })
  })

  it('is ready once a save that failed is through, with nothing to read again', async () => {
    const app = setup({ listed: LONG_LIST })
    await app.visit.open()
    app.visit.cycle(idsOf(app.visit)[0])
    app.aniList.script.push({ kind: 'api', status: 500 })

    app.visit.saveAndNext()
    await app.queue.idle()
    await settle()

    expect(app.visit.snapshot().queue.state?.writes.map((w) => w.status)).toEqual(['failed'])
    expect(app.listReads).toEqual([])
    expect(app.visit.snapshot()).toMatchObject({ added: 1, listed: true })
  })

  it('isn’t made ready for a later save by a read that ends after a new visit started', async () => {
    const app = setup({ listed: LONG_LIST })
    await app.visit.open()
    app.visit.cycle(idsOf(app.visit)[0])
    app.visit.saveAndNext()
    await app.queue.idle()
    await settle()
    expect(app.listReads).toHaveLength(1) // still reading

    await app.visit.open() // a new visit
    app.visit.cycle(idsOf(app.visit)[0])
    app.visit.saveAndNext()
    await app.queue.idle()
    await settle()
    expect(app.listReads).toHaveLength(2)

    app.listReads[0].end()
    await settle()

    expect(app.visit.snapshot()).toMatchObject({ added: 1, listed: false })

    app.listReads[1].end()
    await settle()

    expect(app.visit.snapshot().listed).toBe(true)
  })

  it('doesn’t wait for a save without a mark', async () => {
    const app = setup({ listed: LONG_LIST })
    await app.visit.open()

    app.visit.saveAndNext()

    expect(app.visit.snapshot()).toMatchObject({ added: 0, listed: true })
  })
})

describe('the write queue', () => {
  it('shows nothing of it once the app lets go of it', async () => {
    const app = setup({ listed: LONG_LIST })
    await app.visit.open()
    app.visit.cycle(idsOf(app.visit)[0])
    app.visit.saveAndNext()
    expect(app.visit.snapshot().queue.state?.writes).toHaveLength(1)

    app.detach()

    expect(app.visit.snapshot().queue).toEqual({ state: null, running: false, status: null })
  })
})
