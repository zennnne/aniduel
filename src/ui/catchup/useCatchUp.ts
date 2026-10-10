import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { AniListError, type AniListGateway } from '../../anilist/gateway.ts'
import type { ListStatus, Viewer } from '../../anilist/types.ts'
import {
  cycleMark,
  firstBatch,
  saveBatch,
  setMark,
  withQueuedWrites,
  type CatchUpBatch,
  type CatchUpEntry,
  type CatchUpMark,
} from '../../catchup/batch.ts'
import { createSuggestionCandidates, type SuggestionCandidates, type CandidateSource } from '../../catchup/suggestionCandidates.ts'
import { catchUpSnapshot, settledByRun, type QueueSnapshot } from '../../catchup/queue.ts'
import {
  createStartingEraStore,
  startingEraLabel,
  startingEraYears,
  type StartingEraAnswer,
} from '../../catchup/startingEra.ts'
import { isNearEmpty } from '../../catchup/entry.ts'
import type { CatchUpMedia } from '../../anilist/candidates.ts'
import { browserClock } from '../../clock.ts'
import type { WriteQueue, WriteQueueSnapshot } from '../../writes/writeQueue.ts'
import { displayTitle } from '../../pool/pool.ts'

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

export type CatchUpDeps = {
  storage: Storage
  /** Reads the user's anime list. */
  gateway: AniListGateway | null
  /** The user's write queue: each saved page's statuses join it, in line with Import's scores. */
  queue: WriteQueue | null
  queueSnapshot: WriteQueueSnapshot | null
  /** Reads of anime for the suggestion candidates. */
  source: CandidateSource | null
  viewer: Viewer | null
  passedStore?: PassedStore
  onGatewayError: (error: unknown) => void
  /**
   * A run of the write queue ended with these titles on the user's anime list through Catch-up. Resolves once the
   * app has read that list again (or couldn't).
   */
  onWritten: (mediaIds: number[]) => Promise<void>
}

const NO_PASSED: ReadonlyMap<number, number> = new Map()
const NO_QUEUE: QueueSnapshot = { state: null, running: false, status: null }

function newSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]
}

/**
 * Catch-up (#49): the batch on screen and its marks, the suggestion candidates behind it, and the background write queue.
 * Lives at App level, so the queue keeps writing (and resumes after a reload) whichever screen shows.
 */
export function useCatchUp(deps: CatchUpDeps) {
  const [view, setView] = useState<CatchUpView>({ phase: 'idle' })
  // Titles saved with a mark since Catch-up was last opened: the exit offer shows once there is one (#52).
  const [added, setAdded] = useState(0)
  // The visit's working data: the list as Catch-up knows it (marked titles included), what is loaded about anime,
  // titles shown in this visit, and the candidates update in flight.
  const session = useRef<{
    list: CatchUpEntry[]
    candidates: SuggestionCandidates
    history: ReadonlyMap<number, number>
    updating: Promise<void>
  } | null>(null)
  // The list read when opening, kept while the Starting era question is answered before the first batch.
  const unanswered = useRef<{ read: CatchUpEntry[]; queued: Parameters<typeof withQueuedWrites>[1] } | null>(null)
  const popular = useRef<Promise<CatchUpMedia[]> | null>(null)
  // The number of the batch the era chip is replacing.
  const replacedBatch = useRef(1)
  // Saves with a mark, ever, and how many of them the app's anime list accounts for: the exit offer waits for the
  // rest (#52). Never reset, so a list read that ends after a logout or a new visit can't count for a later save.
  const [saves, setSaves] = useState(0)
  const [listedSaves, setListedSaves] = useState(0)
  const onRunEnded = useEffectEvent((written: number[]) => {
    const upTo = saves
    const listed = written.length > 0 ? deps.onWritten(written) : Promise.resolve()
    void listed.then(() => setListedSaves((n) => Math.max(n, upTo)))
  })

  // When a run of the write queue ends, the titles it added can join the anime Pool.
  const lastSnapshot = useRef<WriteQueueSnapshot | null>(null)
  const { queueSnapshot } = deps
  useEffect(() => {
    const before = lastSnapshot.current
    lastSnapshot.current = queueSnapshot
    const written = before && queueSnapshot ? settledByRun(before, queueSnapshot) : null
    if (written) onRunEnded(written)
  }, [queueSnapshot])

  const passed = (): ReadonlyMap<number, number> => {
    const stored = deps.passedStore?.history() ?? NO_PASSED
    const shown = session.current?.history ?? NO_PASSED
    return new Map([...stored, ...shown])
  }

  const eraStore = () => (deps.viewer ? createStartingEraStore(deps.storage, deps.viewer.id) : null)
  /** The Starting era's years for the suggestions; they use it only while the list is near empty. */
  const startingEra = () => startingEraYears(eraStore()?.answer() ?? null)
  /** What the suggestion candidates load popular titles for: the Starting era while the list is near empty, else the list's own era. */
  const candidatesEra = (list: readonly CatchUpEntry[]) => (isNearEmpty(list) ? startingEra() : undefined)

  /** Shows the Starting era question, with all-time favourites loading for its covers. */
  function askStartingEra() {
    const answer = eraStore()?.answer()
    setView({ phase: 'era', popular: null, answer })
    if (!deps.source) return
    popular.current ??= deps.source.popular(null)
    const loading = popular.current
    loading.then(
      (media) => setView((v) => (v.phase === 'era' && popular.current === loading ? { ...v, popular: media } : v)),
      () => {
        if (popular.current === loading) popular.current = null
        setView((v) => (v.phase === 'era' ? { ...v, popular: [] } : v))
      },
    )
  }

  function fail(error: unknown) {
    if (error instanceof AniListError && error.kind === 'auth') {
      deps.onGatewayError(error)
      return
    }
    setView({ phase: 'failed', message: error instanceof AniListError ? error.message : String(error) })
  }

  /** Opens Catch-up: the first batch on a first visit, the same batch when coming back to it. */
  async function open() {
    const { gateway, source, viewer } = deps
    if (!gateway || !source || !viewer) return
    if (view.phase === 'ready' || view.phase === 'loading' || view.phase === 'era') return
    setView({ phase: 'loading' })
    try {
      const entries = await gateway.mediaList({ userId: viewer.id, type: 'ANIME', statuses: ALL_STATUSES })
      const read: CatchUpEntry[] = entries.map(({ mediaId, status, year, format }) => ({ mediaId, status, year, format }))
      // Titles marked earlier whose writes haven't reached AniList yet are on the list all the same.
      const queued = deps.queue ? (catchUpSnapshot(deps.queue.snapshot()).state?.writes ?? []) : []
      // A near-empty list first asks roughly when the user started watching, once.
      if (isNearEmpty(withQueuedWrites(read, queued, [])) && eraStore()?.answer() === undefined) {
        unanswered.current = { read, queued }
        askStartingEra()
        return
      }
      await start(read, queued)
    } catch (e) {
      fail(e)
    }
  }

  /** Loads the candidates for the list and shows the first batch. */
  async function start(read: CatchUpEntry[], queued: Parameters<typeof withQueuedWrites>[1]) {
    if (!deps.source) return
    const candidates = createSuggestionCandidates(deps.source)
    const known = withQueuedWrites(read, queued, [])
    const updating = candidates.update(known, candidatesEra(known))
    session.current = { list: read, candidates, history: new Map(), updating }
    await updating
    if (session.current?.candidates !== candidates) return // logged out meanwhile
    const list = withQueuedWrites(read, queued, candidates.media())
    session.current.list = list
    setView({ phase: 'ready', batch: firstBatch({ ...batchInput(list), seed: newSeed() }) })
  }

  function batchInput(list: readonly CatchUpEntry[]) {
    const media = session.current?.candidates.media() ?? []
    return { list, media, passed: passed(), now: browserClock.now(), startingEra: startingEra() }
  }

  /**
   * The Starting era answered (a year, or null for all-time favourites): the first batch loads, or, when changed from
   * the era chip, the batch on screen is replaced by one from the new era.
   */
  async function answerStartingEra(answer: StartingEraAnswer) {
    const batchNumber = replacedBatch.current
    eraStore()?.save(answer)
    setView({ phase: 'loading' })
    try {
      const current = session.current
      if (!current) {
        const pending = unanswered.current
        unanswered.current = null
        if (pending) await start(pending.read, pending.queued)
        return
      }
      const updating = current.updating.then(() => current.candidates.update(current.list, candidatesEra(current.list)))
      current.updating = updating.catch(() => {})
      await updating
      if (session.current !== current) return
      const batch = firstBatch({ ...batchInput(current.list), seed: newSeed() })
      setView({ phase: 'ready', batch: { ...batch, number: batchNumber } })
    } catch (e) {
      fail(e)
    }
  }

  function change(update: (batch: CatchUpBatch) => CatchUpBatch) {
    setView((v) => (v.phase === 'ready' ? { ...v, batch: update(v.batch) } : v))
  }

  /**
   * "Save & next 20": the marks join the write queue, the next batch shows at once from what is already loaded, and the
   * suggestion candidates load what the newly marked titles point at, for the batches after it.
   */
  function saveAndNext() {
    const current = session.current
    if (view.phase !== 'ready' || !current || !deps.viewer) return
    const now = browserClock.now()
    const saved = saveBatch(view.batch, { ...batchInput(current.list), now, seed: newSeed() })
    const language = deps.viewer.titleLanguage
    const names = new Map(view.batch.suggestions.map((s) => [s.media.id, displayTitle(s.media.title, language)]))
    deps.queue?.addStatuses(
      saved.writes.map((w) => ({ ...w, name: names.get(w.mediaId) ?? `Title #${w.mediaId}` })),
      'ANIME',
    )
    setAdded((n) => n + saved.writes.length)
    if (saved.writes.length > 0) setSaves((n) => n + 1)
    deps.passedStore?.record(saved.passed, now)
    current.list = saved.list
    current.history = saved.history
    current.updating = current.updating.then(() => current.candidates.update(saved.list, candidatesEra(saved.list))).catch(() => {})
    setView({ phase: 'ready', batch: saved.next })
    // Nothing left in what is loaded: the batch fills once the titles just marked have brought their neighbours.
    if (saved.next.suggestions.length === 0) void current.updating.then(() => refill(current, saved.next.number))
  }

  function refill(current: NonNullable<typeof session.current>, number: number) {
    if (session.current !== current) return
    const batch = firstBatch({ ...batchInput(current.list), seed: newSeed() })
    setView((v) =>
      v.phase === 'ready' && v.batch.number === number && v.batch.suggestions.length === 0
        ? { phase: 'ready', batch: { ...batch, number } }
        : v,
    )
  }

  /** Clear Passed: titles Passed before, in earlier visits or this one, may be suggested from the next batch. */
  function clearPassed() {
    deps.passedStore?.clear()
    if (session.current) session.current.history = new Map()
  }

  /** Logout: nothing of this user's visit stays. */
  function close() {
    session.current = null
    unanswered.current = null
    popular.current = null
    setView({ phase: 'idle' })
    setAdded(0)
  }

  // The era chip beside "Batch N": while the list is near empty, the Starting era can be changed.
  const answer = view.phase === 'ready' && session.current && isNearEmpty(session.current.list) ? eraStore()?.answer() : undefined

  /** The era chip: asks the Starting era again; the answer replaces the batch on screen, keeping its number. */
  function changeStartingEra() {
    if (view.phase !== 'ready') return
    replacedBatch.current = view.batch.number
    askStartingEra()
  }

  return {
    view,
    /** "around 2012" for the era chip, or null when the list is past the cold-start threshold. */
    startingEraLabel: answer === undefined ? null : startingEraLabel(answer),
    changeStartingEra,
    answerStartingEra: (answer: StartingEraAnswer) => void answerStartingEra(answer),
    queue: queueSnapshot ? catchUpSnapshot(queueSnapshot) : NO_QUEUE,
    /** Titles saved with a mark in this visit. */
    added,
    /** Whether every save has been written (or failed) and the app's anime list read since. */
    listed: listedSaves >= saves,
    /** Opens Catch-up for a new visit; what it shows stays as it was left. */
    open: () => {
      setAdded(0)
      void open()
    },
    cycle: (id: number) => change((b) => cycleMark(b, id)),
    mark: (id: number, mark: CatchUpMark | null) => change((b) => setMark(b, id, mark)),
    saveAndNext,
    retryWrites: () => deps.queue?.retryStatuses(),
    clearPassed,
    close,
  }
}
