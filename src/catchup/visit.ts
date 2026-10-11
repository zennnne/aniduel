// A Catch-up visit (#49, #57), from opening Catch-up to the moment its exit offer may show: the Starting era question,
// the batch on screen and its marks, "Save & next", the suggestion candidates behind the batches, and the write queue
// writing what was saved. It reports its own state and never changes screens; where the exit offer leads is the exit
// offer's own rule.
import type { CatchUpMedia } from '../anilist/candidates.ts'
import { AniListError, type AniListGateway } from '../anilist/gateway.ts'
import type { ListStatus, Viewer } from '../anilist/types.ts'
import type { Clock } from '../clock.ts'
import { displayTitle } from '../pool/pool.ts'
import type { QueuedWrite, StatusWrite, WriteQueue } from '../writes/writeQueue.ts'
import {
  cycleMark,
  firstBatch,
  saveBatch,
  setMark,
  withQueuedWrites,
  type BatchInput,
  type CatchUpBatch,
  type CatchUpEntry,
  type CatchUpMark,
} from './batch.ts'
import { isNearEmpty } from './entry.ts'
import { catchUpSnapshot, settledByRun, type QueueSnapshot } from './queue.ts'
import { createStartingEraStore, startingEraLabel, startingEraYears, type StartingEraAnswer } from './startingEra.ts'
import { createSuggestionCandidates, type CandidateSource, type SuggestionCandidates } from './suggestionCandidates.ts'

const ALL_STATUSES: readonly ListStatus[] = ['CURRENT', 'PLANNING', 'COMPLETED', 'DROPPED', 'PAUSED', 'REPEATING']

/** What the Catch-up screen shows. */
export type CatchUpView =
  | { phase: 'idle' }
  /** Reading the anime list and the first candidates; can take a while on a long list. */
  | { phase: 'loading' }
  | { phase: 'failed'; message: string }
  | { phase: 'ready'; batch: CatchUpBatch }
  /**
   * The Starting era question (#51), before the first batch of a near-empty list or from the era chip. `popular` is
   * all-time favourites for the covers beside the answer, null while loading; `answer` is the one saved, if any.
   */
  | { phase: 'era'; popular: CatchUpMedia[] | null; answer: StartingEraAnswer | undefined }

/**
 * Where Passed titles are kept between visits (#50). Without one, titles shown in this visit are still not shown again
 * in it, but nothing is remembered after a reload.
 */
export type PassedStore = {
  history(): ReadonlyMap<number, number>
  record(ids: readonly number[], at: number): void
  clear(): void
}

export type CatchUpVisitSnapshot = {
  view: CatchUpView
  /** "around 2012" for the era chip beside "Batch N", or null when the list is past the cold-start threshold. */
  startingEraLabel: string | null
  /** Catch-up's part of the write queue, for the screen and the sign on Start. */
  queue: QueueSnapshot
  /** Titles saved with a mark since Catch-up was last opened: the exit offer shows once there is one (#52). */
  added: number
  /** Whether every save has been written (or failed) and the app's anime list read since. */
  listed: boolean
}

/** What a Catch-up visit needs from the app around it. Read whenever it is needed, so it is always the latest. */
export type CatchUpVisitDeps = {
  storage: Storage
  /** Reads the user's anime list. */
  gateway: AniListGateway | null
  /** Reads of anime for the suggestion candidates. */
  source: CandidateSource | null
  viewer: Viewer | null
  passedStore?: PassedStore
  clock: Clock
  /** A new seed for each batch's exploratory titles. */
  seed: () => number
  onGatewayError: (error: unknown) => void
  /**
   * A run of the write queue ended with these titles on the user's anime list through Catch-up. Resolves once the
   * app has read that list again (or couldn't).
   */
  onWritten: (mediaIds: number[]) => Promise<void>
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
   * Opens Catch-up for a new visit: the first batch on a first visit (after the Starting era question on a near-empty
   * list), and what it showed when coming back to it. Resolves once that shows, or the failure.
   */
  open(): Promise<void>
  /** Logout: nothing of this user's visit stays, and nothing still loading arrives. */
  close(): void
  /** A tap on a cover: Completed → Dropped → Planning → Paused → unmarked. */
  cycle(id: number): void
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
  retryWrites(): void
  /** Clear Passed: titles Passed before, in earlier visits or this one, may be suggested from the next batch. */
  clearPassed(): void
}

/**
 * The visit's working data: the list as Catch-up knows it (marked titles included), what is loaded about anime, titles
 * shown in this visit, and the candidates update in flight.
 */
type Loaded = {
  list: CatchUpEntry[]
  candidates: SuggestionCandidates
  history: ReadonlyMap<number, number>
  updating: Promise<void>
}

type QueuedStatuses = ReadonlyArray<QueuedWrite<StatusWrite>>

const NO_PASSED: ReadonlyMap<number, number> = new Map()
const NO_QUEUE: QueueSnapshot = { state: null, running: false, status: null }
const NOTHING: CatchUpVisitSnapshot = { view: { phase: 'idle' }, startingEraLabel: null, queue: NO_QUEUE, added: 0, listed: true }

export function createCatchUpVisit(deps: () => CatchUpVisitDeps): CatchUpVisit {
  let state = NOTHING
  let queue: WriteQueue | null = null
  let loaded: Loaded | null = null
  /** Counts the times Catch-up was closed, so what was still loading for an earlier user changes nothing. */
  let closes = 0
  // The list read when opening, kept while the Starting era question is answered before the first batch.
  let unanswered: { read: CatchUpEntry[]; queued: QueuedStatuses } | null = null
  let popular: Promise<CatchUpMedia[]> | null = null
  // The number of the batch the era chip is replacing.
  let replacedBatch = 1
  // Saves with a mark, ever, and how many of them the app's anime list accounts for: the exit offer waits for the
  // rest (#52). Never reset, so a list read that ends after a logout or a new visit can't count for a later save.
  let saves = 0
  let listedSaves = 0
  const listeners = new Set<(snapshot: CatchUpVisitSnapshot) => void>()

  function set(change: Partial<Pick<CatchUpVisitSnapshot, 'view' | 'queue' | 'added'>>) {
    const next = { ...state, ...change }
    state = { ...next, startingEraLabel: eraChip(next.view), listed: listedSaves >= saves }
    for (const listener of [...listeners]) listener(state)
  }

  const show = (batch: CatchUpBatch) => set({ view: { phase: 'ready', batch } })

  const eraStore = () => {
    const { viewer, storage } = deps()
    return viewer ? createStartingEraStore(storage, viewer.id) : null
  }
  /** The Starting era's years for the suggestions; they use it only while the list is near empty. */
  const startingEra = () => startingEraYears(eraStore()?.answer() ?? null)
  /** What the suggestion candidates load popular titles for: the Starting era while the list is near empty, else the list's own era. */
  const candidatesEra = (list: readonly CatchUpEntry[]) => (isNearEmpty(list) ? startingEra() : undefined)

  /** The era chip's text: while the list is near empty, the Starting era can be changed. */
  function eraChip(view: CatchUpView): string | null {
    if (view.phase !== 'ready' || !loaded || !isNearEmpty(loaded.list)) return null
    const answer = eraStore()?.answer()
    return answer === undefined ? null : startingEraLabel(answer)
  }

  /** What a batch is chosen from now: Passed titles are those stored and those shown in this visit. */
  function batchInput(from: Loaded): BatchInput {
    const stored = deps().passedStore?.history() ?? NO_PASSED
    return {
      list: from.list,
      media: from.candidates.media(),
      passed: new Map([...stored, ...from.history]),
      now: deps().clock.now(),
      seed: deps().seed(),
      startingEra: startingEra(),
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

  /** Shows the Starting era question, with all-time favourites loading for its covers. */
  function askStartingEra() {
    set({ view: { phase: 'era', popular: null, answer: eraStore()?.answer() } })
    const { source } = deps()
    if (!source) return
    const asked = closes
    popular ??= source.popular(null)
    const covers = (media: CatchUpMedia[]) => {
      if (asked === closes && state.view.phase === 'era') set({ view: { ...state.view, popular: media } })
    }
    popular.then(covers, () => {
      if (asked !== closes) return
      popular = null
      covers([])
    })
  }

  /** Loads the candidates for the list and shows the first batch. */
  async function start(read: CatchUpEntry[], queued: QueuedStatuses) {
    const { source } = deps()
    if (!source) return
    const asked = closes
    const candidates = createSuggestionCandidates(source)
    const from: Loaded = { list: withQueuedWrites(read, queued, []), candidates, history: new Map(), updating: Promise.resolve() }
    loaded = from
    await update(from, from.list)
    if (asked !== closes) return
    from.list = withQueuedWrites(read, queued, candidates.media())
    show(firstBatch(batchInput(from)))
  }

  /** Fills the empty batch `number`, unless the user has moved on from it. */
  function refill(from: Loaded, number: number, asked: number) {
    const { view } = state
    if (asked !== closes || view.phase !== 'ready' || view.batch.number !== number || view.batch.suggestions.length > 0) return
    show({ ...firstBatch(batchInput(from)), number })
  }

  function change(update: (batch: CatchUpBatch) => CatchUpBatch) {
    if (state.view.phase === 'ready') show(update(state.view.batch))
  }

  /** A run of the write queue ended: the titles it added can join the anime Pool, once the app has read the list again. */
  function runEnded(written: number[]) {
    const upTo = saves
    const listRead = written.length > 0 ? deps().onWritten(written) : Promise.resolve()
    void listRead.then(() => {
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
      set({ queue: catchUpSnapshot(last) })
      const unsubscribe = next.subscribe((snapshot) => {
        const written = settledByRun(last, snapshot)
        last = snapshot
        set({ queue: catchUpSnapshot(snapshot) })
        if (written) runEnded(written)
      })
      return () => {
        unsubscribe()
        queue = null
        set({ queue: NO_QUEUE })
      }
    },
    async open() {
      if (state.added > 0) set({ added: 0 })
      const { gateway, source, viewer } = deps()
      if (!gateway || !source || !viewer) return
      const { phase } = state.view
      if (phase === 'ready' || phase === 'loading' || phase === 'era') return
      const asked = closes
      set({ view: { phase: 'loading' } })
      try {
        const entries = await gateway.mediaList({ userId: viewer.id, type: 'ANIME', statuses: ALL_STATUSES })
        if (asked !== closes) return
        const read: CatchUpEntry[] = entries.map(({ mediaId, status, year, format }) => ({ mediaId, status, year, format }))
        // Titles marked earlier whose writes haven't reached AniList yet are on the list all the same.
        const queued = queue ? (catchUpSnapshot(queue.snapshot()).state?.writes ?? []) : []
        // A near-empty list first asks roughly when the user started watching, once.
        if (isNearEmpty(withQueuedWrites(read, queued, [])) && eraStore()?.answer() === undefined) {
          unanswered = { read, queued }
          askStartingEra()
          return
        }
        await start(read, queued)
      } catch (e) {
        if (asked === closes) fail(e)
      }
    },
    close() {
      closes++
      loaded = null
      unanswered = null
      popular = null
      set({ view: { phase: 'idle' }, added: 0 })
    },
    cycle: (id) => change((b) => cycleMark(b, id)),
    mark: (id, mark) => change((b) => setMark(b, id, mark)),
    saveAndNext() {
      const from = loaded
      const { viewer, passedStore } = deps()
      if (state.view.phase !== 'ready' || !from || !viewer) return
      const { batch } = state.view
      const input = batchInput(from)
      const saved = saveBatch(batch, input)
      const names = new Map(batch.suggestions.map((s) => [s.media.id, displayTitle(s.media.title, viewer.titleLanguage)]))
      if (saved.writes.length > 0) saves++
      queue?.addStatuses(
        saved.writes.map((w) => ({ ...w, name: names.get(w.mediaId) ?? `Title #${w.mediaId}` })),
        'ANIME',
      )
      passedStore?.record(saved.passed, input.now)
      from.list = saved.list
      from.history = saved.history
      void update(from, saved.list)
      set({ view: { phase: 'ready', batch: saved.next }, added: state.added + saved.writes.length })
      // Nothing left in what is loaded: the batch fills once the titles just marked have brought their neighbours.
      const asked = closes
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
      const asked = closes
      eraStore()?.save(answer)
      set({ view: { phase: 'loading' } })
      try {
        const from = loaded
        if (!from) {
          const pending = unanswered
          unanswered = null
          if (pending) await start(pending.read, pending.queued)
          return
        }
        await update(from, from.list)
        if (asked === closes) show({ ...firstBatch(batchInput(from)), number })
      } catch (e) {
        if (asked === closes) fail(e)
      }
    },
    retryWrites: () => queue?.retryStatuses(),
    clearPassed() {
      deps().passedStore?.clear()
      if (loaded) loaded.history = new Map()
    },
  }
}
