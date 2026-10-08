// Catch-up's write queue: every saved page's status writes, written in the background by the Import Runner (its
// spacing, rate-limit wait, retry and resume), saved in localStorage after every write.
import type { AniListGateway } from '../anilist/gateway.ts'
import {
  appendWrites,
  importSummary,
  newImport,
  retryFailed,
  startImport,
  type Clock,
  type ImportState,
  type RunningImport,
  type RunnerStatus,
} from '../import/runner.ts'
import { deleteCatchUpQueue, loadCatchUpQueue, saveCatchUpQueue, type NamedStatusWrite } from '../persistence/progress.ts'

/** One status write from a saved page, named for the failure bar. */
export type CatchUpWrite = NamedStatusWrite

export type CatchUpQueueState = ImportState<CatchUpWrite>

export type QueueSnapshot = {
  /** Null until something was saved (or a saved queue was found). */
  state: CatchUpQueueState | null
  running: boolean
  /** What the Runner is doing, e.g. waiting out a rate limit. */
  status: RunnerStatus | null
}

export type CatchUpQueueDeps = {
  gateway: AniListGateway
  clock: Clock
  storage: Storage
  userId: number
  onChange: (snapshot: QueueSnapshot) => void
  /** A run that ended on an error the Runner doesn't record per write (an expired login): its writes stay pending. */
  onError: (error: unknown) => void
  /** A run ended: the media ids now on the user's AniList list through Catch-up. */
  onSettled?: (written: number[]) => void
}

export type CatchUpQueue = {
  /** Queues a saved page's writes behind any still going, and starts writing if nothing is. */
  add(writes: readonly CatchUpWrite[]): void
  /** Puts the failed writes back in line and writes them. */
  retry(): void
  /** Writes what a reload left unwritten. Failed writes wait for Retry. */
  resume(): void
  /** Stops after the current write (logout); what is written so far is saved. */
  stop(): void
  snapshot(): QueueSnapshot
  /** Resolves once no run is going. */
  idle(): Promise<void>
}

/** Status writes don't use a Score Format; the Runner's saved state has one, so the queue carries a fixed one. */
const QUEUE_FROM = { hash: 'catch-up', format: 'POINT_100' } as const

/** Writes from earlier runs that are through: only failed ones are kept, for Retry. */
function withoutFinished(state: CatchUpQueueState): CatchUpQueueState {
  return { ...state, writes: state.writes.filter((w) => w.status === 'pending' || w.status === 'failed') }
}

export function createCatchUpQueue(deps: CatchUpQueueDeps): CatchUpQueue {
  let state: CatchUpQueueState | null = loadCatchUpQueue(deps.storage, deps.userId)
  let status: RunnerStatus | null = null
  let run: RunningImport<CatchUpWrite> | null = null
  let stop: AbortController | null = null
  let done: Promise<void> = Promise.resolve()

  const snapshot = (): QueueSnapshot => ({ state, running: run !== null, status })
  const changed = () => deps.onChange(snapshot())

  function save(next: CatchUpQueueState) {
    state = next
    const { left, failed } = importSummary(next)
    if (left + failed === 0 && run === null) deleteCatchUpQueue(deps.storage, deps.userId)
    else saveCatchUpQueue(deps.storage, deps.userId, next)
    changed()
  }

  function start(initial: CatchUpQueueState) {
    const abort = new AbortController()
    stop = abort
    const handle = startImport<CatchUpWrite>(
      { gateway: deps.gateway, clock: deps.clock, userId: deps.userId, mediaType: 'ANIME', save },
      initial,
      {
        signal: abort.signal,
        onStatus: (next) => {
          status = next
          changed()
        },
      },
    )
    run = handle
    save(initial)
    done = handle.done.then(
      () => ended(handle),
      (error: unknown) => {
        ended(handle)
        deps.onError(error)
      },
    )
  }

  function ended(handle: RunningImport<CatchUpWrite>) {
    if (run !== handle) return
    run = null
    stop = null
    status = null
    if (state) save(state)
    deps.onSettled?.(state ? state.writes.filter((w) => w.status === 'done').map((w) => w.mediaId) : [])
  }

  return {
    add(writes) {
      if (writes.length === 0) return
      if (run?.append(writes)) return
      const base = state ? withoutFinished(state) : newImport<CatchUpWrite>([], QUEUE_FROM)
      start(appendWrites(base, writes))
    },
    retry() {
      if (!state || run) return
      start(retryFailed(withoutFinished(state)))
    },
    resume() {
      if (!state || run || importSummary(state).left === 0) return
      start(state)
    },
    stop() {
      stop?.abort()
    },
    snapshot,
    idle: async () => {
      // A run started while waiting is waited for too.
      for (let current = done; ; current = done) {
        await current
        if (current === done) return
      }
    },
  }
}

export type QueueProgress = {
  /** Written (or found already on the list) in this run. */
  saved: number
  /** Every write in this run, failed ones not counted. */
  total: number
  left: number
  /** Writes that didn't reach AniList, waiting for Retry. */
  failed: CatchUpWrite[]
}

export function queueProgress(state: CatchUpQueueState): QueueProgress {
  const { written, skipped, failed, left, total } = importSummary(state)
  return {
    saved: written + skipped,
    total: total - failed,
    left,
    failed: state.writes
      .filter((w) => w.status === 'failed')
      .map(({ mediaId, listStatus, name }) => ({ mediaId, listStatus, name })),
  }
}
