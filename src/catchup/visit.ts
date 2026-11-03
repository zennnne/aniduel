// A Catch-up visit (#49, #57), from opening Catch-up to the moment its exit offer may show: the Starting era question,
// the batch on screen and its marks, "Save & next", the suggestion candidates behind the batches, and the write queue
// writing what was saved. It reports its own state and never changes screens; where the exit offer leads is the exit
// offer's own rule. A visit is for one Media Type (#95): it reads that list, suggests that Media Type, and keeps its
// Passed titles and Starting era under it.
import type { CatchUpMedia } from '../anilist/candidates.ts'
import { AniListError, type AniListGateway } from '../anilist/gateway.ts'
import type { ListEntry, ListStatus, MediaType, Viewer } from '../anilist/types.ts'
import type { Clock } from '../clock.ts'
import { displayTitle } from '../pool/pool.ts'
import type { QueuedWrite, StatusWrite, WriteQueue, WriteQueueSnapshot } from '../writes/writeQueue.ts'
import {
  cycleMark,
  firstBatch,
  MARKS,
  saveBatch,
  setMark,
  withQueuedWrites,
  type BatchInput,
  type CatchUpBatch,
  type CatchUpEntry,
  type CatchUpMark,
} from './batch.ts'
import { isNearEmpty } from './entry.ts'
import { createPassedStore } from './passed.ts'
import { catchUpSnapshot, settledByRun, type QueueSnapshot } from './queue.ts'
import { createStartingEraStore, startingEraLabel, startingEraYears, type StartingEraAnswer } from './startingEra.ts'
import type { AnimeSignal } from './suggest.ts'
import { createSuggestionCandidates, DEFAULT_LIMITS, type CandidateSource, type SuggestionCandidates } from './suggestionCandidates.ts'

const ALL_STATUSES: readonly ListStatus[] = ['CURRENT', 'PLANNING', 'COMPLETED', 'DROPPED', 'PAUSED', 'REPEATING']
const WATCHED_STATUSES = ALL_STATUSES.filter((s) => s !== 'PLANNING')

/** What the Catch-up screen shows. */
export type CatchUpView =
  | { phase: 'idle' }
  /** Reading the list and the first candidates; can take a while on a long list. */
  | { phase: 'loading' }
  | { phase: 'failed'; message: string }
  | { phase: 'ready'; batch: CatchUpBatch }
  /**
   * The Starting era question (#51), before the first batch of a near-empty list or from the era chip. `popular` is
   * all-time favourites for the covers beside the answer, null while loading; `answer` is the one saved, if any.
   */
  | { phase: 'era'; popular: CatchUpMedia[] | null; answer: StartingEraAnswer | undefined }

export type CatchUpVisitSnapshot = {
  /** The visit's Media Type: the one Catch-up was last opened on, anime before that. */
  mediaType: MediaType
  /** The marks a title can have, in the order a tap on its cover steps through them. */
  marks: readonly CatchUpMark[]
  view: CatchUpView
  /** "around 2012" for the era chip beside "Batch N", or null when the list is past the cold-start threshold. */
  startingEraLabel: string | null
  /** The visit's Media Type's part of the write queue, for the screen. */
  queue: QueueSnapshot
  /** Titles saved with a mark since Catch-up was last opened: the exit offer shows once there is one (#52). */
  added: number
  /** Whether every save has been written (or failed) and the app's lists read since. */
  listed: boolean
}

/** What a Catch-up visit needs from the app around it. Read whenever it is needed, so it is always the latest. */
export type CatchUpVisitDeps = {
  /** Where the Passed titles (#50) and the Starting era are kept, per user and Media Type. */
  storage: Storage
  /** Reads the user's lists. */
  gateway: AniListGateway | null
  /**
   * Each list as the app has already read it: every status but Planning, or null while the app hasn't read it. With
   * the visit's own, opening reads only its Planning titles; a manga visit takes the anime one for the anime signal.
   */
  lists: Readonly<Record<MediaType, readonly ListEntry[] | null>>
  /** Reads for the suggestion candidates, and of the favourite anime. */
  source: CandidateSource | null
  viewer: Viewer | null
  clock: Clock
  /** A new seed for each batch's exploratory titles. */
  seed: () => number
  onGatewayError: (error: unknown) => void
  /**
   * A run of the write queue ended with these titles on the user's list of `mediaType` through Catch-up. Resolves once
   * the app has read that list again (or couldn't).
   */
  onWritten: (mediaIds: number[], mediaType: MediaType) => Promise<void>
}

export type CatchUpVisit = {
  snapshot(): CatchUpVisitSnapshot
  /** Called on every change; returns an unsubscribe. */
  subscribe(listener: (snapshot: CatchUpVisitSnapshot) => void): () => void
  /**
   * The user's write queue, from login until the function returned is called: each saved batch's statuses join it,
   * in line with Import's scores, and every run of it that ends is reported through `onWritten`.
   */
  attach(queue: WriteQueue | null): () => void
  /**
   * Opens Catch-up on a Media Type (anime when left out) for a new visit: the first batch on a first visit (after the
   * Starting era question on a near-empty list), and what it showed when coming back to it on the same Media Type. On
   * the other Media Type, what the visit showed is dropped and it starts afresh. Resolves once that shows, or the
   * failure.
   */
  open(mediaType?: MediaType): Promise<void>
  /** Logout: nothing of this user's visit stays, and nothing still loading arrives. */
  close(): void
  /** A tap on a cover: the next of the visit's `marks`, then unmarked. */
  cycle(id: number): void
  /** Sets a title's mark, or clears it with null. A mark the visit's Media Type doesn't have is ignored. */
  mark(id: number, mark: CatchUpMark | null): void
  /**
   * "Save & next 20": the marks join the write queue, the next batch shows at once from what is already loaded, and the
   * suggestion candidates load what the newly marked titles point at, for the batches after it.
   */
  saveAndNext(): void
  /** The era chip: asks the Starting era again; the answer replaces the batch on screen, keeping its number. */
  changeStartingEra(): void
  /**
   * The Starting era answered (a year, or null for all-time favourites): the first batch loads, or, when changed from
   * the era chip, the batch on screen is replaced by one from the new era.
   */
  answerStartingEra(answer: StartingEraAnswer): Promise<void>
  /** Retry: the failed writes of the visit's Media Type are written again. */
  retryWrites(): void
  /**
   * Clear Passed on a Media Type (the visit's when left out): titles Passed on it before, in earlier visits or this
   * one, may be suggested from the next batch. The other Media Type's stay Passed.
   */
  clearPassed(mediaType?: MediaType): void
}

/**
 * The visit's working data: the list as Catch-up knows it (marked titles included), what is loaded about its Media
 * Type, titles shown in this visit, the candidates update in flight, and on manga the user's anime.
 */
type Loaded = {
  list: CatchUpEntry[]
  candidates: SuggestionCandidates
  history: ReadonlyMap<number, number>
  updating: Promise<void>
  anime: AnimeSignal | undefined
}

type QueuedStatuses = ReadonlyArray<QueuedWrite<StatusWrite>>

/** What opening read, kept while the Starting era question is answered before the first batch. */
type Opened = { read: CatchUpEntry[]; queued: QueuedStatuses; anime: AnimeSignal | undefined }

const NO_PASSED: ReadonlyMap<number, number> = new Map()
const NO_QUEUE: QueueSnapshot = { state: null, running: false, status: null }
const NOTHING: CatchUpVisitSnapshot = {
  mediaType: 'ANIME',
  marks: MARKS.ANIME,
  view: { phase: 'idle' },
  startingEraLabel: null,
  queue: NO_QUEUE,
  added: 0,
  listed: true,
}

export function createCatchUpVisit(deps: () => CatchUpVisitDeps): CatchUpVisit {
  let state = NOTHING
  let queue: WriteQueue | null = null
  // The write queue as it last reported, all Media Types: the visit shows its own Media Type's part of it.
  let queueState: WriteQueueSnapshot | null = null
  let loaded: Loaded | null = null
  /**
   * Counts the times the visit was dropped (closed, or opened on the other Media Type), so what was still loading for
   * an earlier user or Media Type changes nothing.
   */
  let drops = 0
  let unanswered: Opened | null = null
  let popular: Promise<CatchUpMedia[]> | null = null
  // The number of the batch the era chip is replacing.
  let replacedBatch = 1
  // Saves with a mark, ever, and how many of them the app's lists account for: the exit offer waits for the rest
  // (#52). Never reset, so a list read that ends after a logout or a new visit can't count for a later save.
  let saves = 0
  let listedSaves = 0
  const listeners = new Set<(snapshot: CatchUpVisitSnapshot) => void>()

  function set(change: Partial<Pick<CatchUpVisitSnapshot, 'mediaType' | 'view' | 'added'>>) {
    const next = { ...state, ...change }
    state = {
      ...next,
      marks: MARKS[next.mediaType],
      queue: queueState ? catchUpSnapshot(queueState, next.mediaType) : NO_QUEUE,
      startingEraLabel: eraChip(next.view),
      listed: listedSaves >= saves,
    }
    for (const listener of [...listeners]) listener(state)
  }

  const show = (batch: CatchUpBatch) => set({ view: { phase: 'ready', batch } })

  /** The visit's Media Type. */
  const visitType = () => state.mediaType

  const eraStore = () => {
    const { viewer, storage } = deps()
    return viewer ? createStartingEraStore(storage, viewer.id, visitType()) : null
  }
  const passedStore = (mediaType: MediaType) => {
    const { viewer, storage } = deps()
    return viewer ? createPassedStore(storage, viewer.id, mediaType) : null
  }
  /** The Starting era's years for the suggestions; they use it only while the list is near empty. */
  const startingEra = () => startingEraYears(eraStore()?.answer() ?? null)
  /** What the suggestion candidates load popular titles for: the Starting era while the list is near empty, else the list's own era. */
  const candidatesEra = (list: readonly CatchUpEntry[]) => (isNearEmpty(list, visitType()) ? startingEra() : undefined)

  /** The era chip's text: while the list is near empty, the Starting era can be changed. */
  function eraChip(view: CatchUpView): string | null {
    if (view.phase !== 'ready' || !loaded || !isNearEmpty(loaded.list, visitType())) return null
    const answer = eraStore()?.answer()
    return answer === undefined ? null : startingEraLabel(answer)
  }

  /** What a batch is chosen from now: Passed titles are those stored and those shown in this visit. */
  function batchInput(from: Loaded): BatchInput {
    const stored = passedStore(visitType())?.history() ?? NO_PASSED
    return {
      mediaType: visitType(),
      list: from.list,
      media: from.candidates.media(),
      passed: new Map([...stored, ...from.history]),
      now: deps().clock.now(),
      seed: deps().seed(),
      startingEra: startingEra(),
      anime: from.anime,
    }
  }

  /** Loads what `list` calls for, after any update still going: each asks only for what the ones before it didn't. */
  function update(from: Loaded, list: readonly CatchUpEntry[]): Promise<void> {
    const updated = from.updating.then(() => from.candidates.update(list, candidatesEra(list)))
    from.updating = updated.catch(() => {})
    return updated
  }

  function fail(error: unknown) {
    if (error instanceof AniListError && error.kind === 'auth') {
      deps().onGatewayError(error)
      return
    }
    set({ view: { phase: 'failed', message: error instanceof AniListError ? error.message : String(error) } })
  }

  /** Drops what the visit holds and anything still loading for it, as logout does and opening on the other Media Type. */
  function drop() {
    drops++
    loaded = null
    unanswered = null
    popular = null
  }

  /** Shows the Starting era question, with all-time favourites loading for its covers. */
  function askStartingEra() {
    set({ view: { phase: 'era', popular: null, answer: eraStore()?.answer() } })
    const { source } = deps()
    if (!source) return
    const asked = drops
    popular ??= source.popular(null, visitType())
    const covers = (media: CatchUpMedia[]) => {
      if (asked === drops && state.view.phase === 'era') set({ view: { ...state.view, popular: media } })
    }
    popular.then(covers, () => {
      if (asked !== drops) return
      popular = null
      covers([])
    })
  }

  /**
   * Manga only: the user's anime for the anime signal, from the list the app has read or else read here, with their
   * favourite anime. A weak signal: if it can't be read, the visit goes on without it.
   */
  async function readAnime(gateway: AniListGateway, source: CandidateSource, viewer: Viewer): Promise<AnimeSignal | undefined> {
    if (visitType() !== 'MANGA') return undefined
    const appList = deps().lists.ANIME
    try {
      const [list, favourites] = await Promise.all([
        appList ?? gateway.mediaList({ userId: viewer.id, type: 'ANIME', statuses: WATCHED_STATUSES }),
        source.favouriteAnime(viewer.id),
      ])
      return { list, favourites: new Set(favourites) }
    } catch {
      return undefined
    }
  }

  /** Loads the candidates for the list and shows the first batch. */
  async function start({ read, queued, anime }: Opened) {
    const { source } = deps()
    if (!source) return
    const asked = drops
    const candidates = createSuggestionCandidates(source, DEFAULT_LIMITS, visitType())
    const from: Loaded = { list: withQueuedWrites(read, queued, []), candidates, history: new Map(), updating: Promise.resolve(), anime }
    loaded = from
    await update(from, from.list)
    if (asked !== drops) return
    from.list = withQueuedWrites(read, queued, candidates.media())
    show(firstBatch(batchInput(from)))
  }

  /** Fills the empty batch `number`, unless the user has moved on from it. */
  function refill(from: Loaded, number: number, asked: number) {
    const { view } = state
    if (asked !== drops || view.phase !== 'ready' || view.batch.number !== number || view.batch.suggestions.length > 0) return
    show({ ...firstBatch(batchInput(from)), number })
  }

  function change(update: (batch: CatchUpBatch) => CatchUpBatch) {
    if (state.view.phase === 'ready') show(update(state.view.batch))
  }

  /** A run of the write queue ended: the titles it added can join their Pool, once the app has read their list again. */
  function runEnded(written: ReadonlyMap<MediaType, number[]>) {
    const upTo = saves
    void Promise.all([...written].map(([mediaType, ids]) => deps().onWritten(ids, mediaType))).then(() => {
      listedSaves = Math.max(listedSaves, upTo)
      set({})
    })
  }

  return {
    snapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    attach(next) {
      queue = next
      if (!next) return () => {}
      let last = next.snapshot()
      queueState = last
      set({})
      const unsubscribe = next.subscribe((snapshot) => {
        const written = settledByRun(last, snapshot)
        last = snapshot
        queueState = snapshot
        set({})
        if (written) runEnded(written)
      })
      return () => {
        unsubscribe()
        queue = null
        queueState = null
        set({})
      }
    },
    async open(mediaType = 'ANIME') {
      if (mediaType !== visitType()) {
        drop()
        set({ mediaType, view: { phase: 'idle' } })
      }
      if (state.added > 0) set({ added: 0 })
      const { gateway, source, viewer, lists } = deps()
      if (!gateway || !source || !viewer) return
      const { phase } = state.view
      if (phase === 'ready' || phase === 'loading' || phase === 'era') return
      const asked = drops
      set({ view: { phase: 'loading' } })
      try {
        // Reading a long list takes seconds, so what the app has read isn't read again: only Planning is missing from it.
        const appList = lists[mediaType]
        const [fresh, anime] = await Promise.all([
          gateway.mediaList({ userId: viewer.id, type: mediaType, statuses: appList ? ['PLANNING'] : ALL_STATUSES }),
          readAnime(gateway, source, viewer),
        ])
        if (asked !== drops) return
        const planned = new Set(fresh.map((e) => e.mediaId))
        const entries = [...fresh, ...(appList ?? []).filter((e) => !planned.has(e.mediaId))]
        const read: CatchUpEntry[] = entries.map(({ mediaId, status, year, format }) => ({ mediaId, status, year, format }))
        // Titles marked earlier whose writes haven't reached AniList yet are on the list all the same.
        const queued = queue ? (catchUpSnapshot(queue.snapshot(), mediaType).state?.writes ?? []) : []
        // A near-empty list first asks roughly when the user started watching or reading, once.
        if (isNearEmpty(withQueuedWrites(read, queued, []), mediaType) && eraStore()?.answer() === undefined) {
          unanswered = { read, queued, anime }
          askStartingEra()
          return
        }
        await start({ read, queued, anime })
      } catch (e) {
        if (asked === drops) fail(e)
      }
    },
    close() {
      drop()
      set({ view: { phase: 'idle' }, added: 0 })
    },
    cycle: (id) => change((b) => cycleMark(b, id, visitType())),
    mark(id, mark) {
      if (mark === null || state.marks.includes(mark)) change((b) => setMark(b, id, mark))
    },
    saveAndNext() {
      const from = loaded
      const { viewer } = deps()
      if (state.view.phase !== 'ready' || !from || !viewer) return
      const { batch } = state.view
      const input = batchInput(from)
      const saved = saveBatch(batch, input)
      const names = new Map(batch.suggestions.map((s) => [s.media.id, displayTitle(s.media.title, viewer.titleLanguage)]))
      if (saved.writes.length > 0) saves++
      queue?.addStatuses(
        saved.writes.map((w) => ({ ...w, name: names.get(w.mediaId) ?? `Title #${w.mediaId}` })),
        visitType(),
      )
      passedStore(visitType())?.record(saved.passed, input.now)
      from.list = saved.list
      from.history = saved.history
      void update(from, saved.list)
      set({ view: { phase: 'ready', batch: saved.next }, added: state.added + saved.writes.length })
      // Nothing left in what is loaded: the batch fills once the titles just marked have brought their neighbours.
      const asked = drops
      if (saved.next.suggestions.length === 0) void from.updating.then(() => refill(from, saved.next.number, asked))
    },
    changeStartingEra() {
      if (state.view.phase !== 'ready') return
      replacedBatch = state.view.batch.number
      askStartingEra()
    },
    async answerStartingEra(answer) {
      if (state.view.phase !== 'era') return
      const number = replacedBatch
      const asked = drops
      eraStore()?.save(answer)
      set({ view: { phase: 'loading' } })
      try {
        const from = loaded
        if (!from) {
          const pending = unanswered
          unanswered = null
          if (pending) await start(pending)
          return
        }
        await update(from, from.list)
        if (asked === drops) show({ ...firstBatch(batchInput(from)), number })
      } catch (e) {
        if (asked === drops) fail(e)
      }
    },
    retryWrites: () => queue?.retryStatuses(visitType()),
    clearPassed(mediaType = visitType()) {
      passedStore(mediaType)?.clear()
      if (loaded && mediaType === visitType()) loaded.history = new Map()
    },
  }
}
