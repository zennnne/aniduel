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
import { createCandidatePool, type CandidatePool, type CandidateSource } from '../../catchup/candidatePool.ts'
import { createCatchUpQueue, type CatchUpQueue, type QueueSnapshot } from '../../catchup/queue.ts'
import { browserClock } from '../../import/runner.ts'
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
  /** Writes go through the shared write lane, so Import and Catch-up keep to one rate limit together. */
  gateway: AniListGateway | null
  /** Reads of anime for the candidate pool. */
  source: CandidateSource | null
  viewer: Viewer | null
  passedStore?: PassedStore
  onGatewayError: (error: unknown) => void
  /** A write run ended with these titles on the user's anime list. */
  onWritten: (mediaIds: number[]) => void
}

const NO_PASSED: ReadonlyMap<number, number> = new Map()

function newSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]
}

/**
 * Catch-up (#49): the batch on screen and its marks, the candidate pool behind it, and the background write queue.
 * Lives at App level, so the queue keeps writing (and resumes after a reload) whichever screen shows.
 */
export function useCatchUp(deps: CatchUpDeps) {
  const [view, setView] = useState<CatchUpView>({ phase: 'idle' })
  const [queueSnapshot, setQueueSnapshot] = useState<QueueSnapshot>({ state: null, running: false, status: null })
  const queue = useRef<CatchUpQueue | null>(null)
  // The visit's working data: the list as Catch-up knows it (marked titles included), what is loaded about anime,
  // titles shown in this visit, and the pool update in flight.
  const session = useRef<{
    list: CatchUpEntry[]
    pool: CandidatePool
    history: ReadonlyMap<number, number>
    updating: Promise<void>
  } | null>(null)
  const userId = deps.viewer?.id ?? null
  const { gateway } = deps

  const onError = useEffectEvent((error: unknown) => deps.onGatewayError(error))
  const onWritten = useEffectEvent((ids: number[]) => deps.onWritten(ids))

  // One queue per logged-in user; it resumes what a reload left unwritten straight away.
  useEffect(() => {
    if (!gateway || userId === null) return
    const q = createCatchUpQueue({
      gateway,
      clock: browserClock,
      storage: deps.storage,
      userId,
      onChange: (s) => queue.current === q && setQueueSnapshot(s),
      onError: (e) => queue.current === q && onError(e),
      onSettled: (written) => queue.current === q && written.length > 0 && onWritten(written),
    })
    queue.current = q
    q.resume() // also reports what was saved, e.g. failures waiting for Retry
    return () => {
      queue.current = null
      q.stop()
    }
  }, [gateway, userId, deps.storage])

  const passed = (): ReadonlyMap<number, number> => {
    const stored = deps.passedStore?.history() ?? NO_PASSED
    const shown = session.current?.history ?? NO_PASSED
    return new Map([...stored, ...shown])
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
    if (view.phase === 'ready' || view.phase === 'loading') return
    setView({ phase: 'loading' })
    try {
      const entries = await gateway.mediaList({ userId: viewer.id, type: 'ANIME', statuses: ALL_STATUSES })
      const read: CatchUpEntry[] = entries.map(({ mediaId, status, year, format }) => ({ mediaId, status, year, format }))
      // Titles marked earlier whose writes haven't reached AniList yet are on the list all the same.
      const queued = queue.current?.snapshot().state?.writes ?? []
      const pool = createCandidatePool(source)
      const updating = pool.update(withQueuedWrites(read, queued, []))
      session.current = { list: read, pool, history: new Map(), updating }
      await updating
      if (session.current?.pool !== pool) return // logged out meanwhile
      const list = withQueuedWrites(read, queued, pool.media())
      session.current.list = list
      setView({
        phase: 'ready',
        batch: firstBatch({ list, media: pool.media(), passed: passed(), now: browserClock.now(), seed: newSeed() }),
      })
    } catch (e) {
      fail(e)
    }
  }

  function change(update: (batch: CatchUpBatch) => CatchUpBatch) {
    setView((v) => (v.phase === 'ready' ? { ...v, batch: update(v.batch) } : v))
  }

  /**
   * "Save & next 20": the marks join the write queue, the next batch shows at once from what is already loaded, and the
   * pool loads what the newly marked titles point at, for the batches after it.
   */
  function saveAndNext() {
    const current = session.current
    if (view.phase !== 'ready' || !current || !deps.viewer) return
    const now = browserClock.now()
    const saved = saveBatch(view.batch, { list: current.list, media: current.pool.media(), passed: passed(), now, seed: newSeed() })
    const language = deps.viewer.titleLanguage
    const names = new Map(view.batch.suggestions.map((s) => [s.media.id, displayTitle(s.media.title, language)]))
    queue.current?.add(saved.writes.map((w) => ({ ...w, name: names.get(w.mediaId) ?? `Title #${w.mediaId}` })))
    deps.passedStore?.record(saved.passed, now)
    current.list = saved.list
    current.history = saved.history
    current.updating = current.updating.then(() => current.pool.update(saved.list)).catch(() => {})
    setView({ phase: 'ready', batch: saved.next })
    // Nothing left in what is loaded: the batch fills once the titles just marked have brought their neighbours.
    if (saved.next.suggestions.length === 0) void current.updating.then(() => refill(current, saved.next.number))
  }

  function refill(current: NonNullable<typeof session.current>, number: number) {
    if (session.current !== current) return
    const batch = firstBatch({ list: current.list, media: current.pool.media(), passed: passed(), now: browserClock.now(), seed: newSeed() })
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

  /** Logout: the queue stops and lets go of what it saved, before the user's progress is deleted. */
  function close() {
    queue.current?.stop()
    queue.current = null
    session.current = null
    setView({ phase: 'idle' })
    setQueueSnapshot({ state: null, running: false, status: null })
  }

  return {
    view,
    queue: queueSnapshot,
    open: () => void open(),
    cycle: (id: number) => change((b) => cycleMark(b, id)),
    mark: (id: number, mark: CatchUpMark | null) => change((b) => setMark(b, id, mark)),
    saveAndNext,
    retryWrites: () => queue.current?.retry(),
    clearPassed,
    close,
  }
}
