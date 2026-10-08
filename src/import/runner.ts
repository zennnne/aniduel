// Import Runner: writes the Import plan (and Catch-up's list statuses) to AniList one write at a time, inside the rate limit.
import { AniListError, type AniListGateway } from '../anilist/gateway.ts'
import type { ListEntry, ListStatus, MediaType, ScoreFormat } from '../anilist/types.ts'
import type { PendingWrite } from '../ranking/preview.ts'

/** Injected time, so tests run the throttle without waiting. `sleep` may end early once `signal` aborts. */
export type Clock = { now(): number; sleep(ms: number, signal?: AbortSignal): Promise<void> }

/** The browser clock: a sleep ends early when the Import is stopped. */
export const browserClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve) => {
      if (signal?.aborted) return resolve()
      const timer = setTimeout(done, ms)
      function done() {
        clearTimeout(timer)
        signal?.removeEventListener('abort', done)
        resolve()
      }
      signal?.addEventListener('abort', done)
    }),
}

/** Normal spacing between two writes, which keeps under AniList's 30 requests a minute. */
export const WRITE_SPACING_MS = 2200

export type WriteStatus = 'pending' | 'done' | 'failed' | 'skipped'

/** Sets a title's list status, adding it to the list if it isn't there yet (Catch-up). */
export type StatusWrite = { mediaId: number; listStatus: ListStatus }

/** What the Runner can write: a score (Import) or a list status (Catch-up). */
export type Write = PendingWrite | StatusWrite

/** A write in the queue. `error` says why a failed write failed, e.g. "network error". */
export type QueuedWrite<W extends Write = Write> = W & { status: WriteStatus; error?: string }

export type ImportWrite = QueuedWrite<PendingWrite>

/** One Import, saved after every write so a cut-off Import carries on where it stopped. */
export type ImportState<W extends Write = PendingWrite> = {
  /** Hash of the Duel log and scoring settings the plan was made from. */
  hash: string
  format: ScoreFormat
  writes: QueuedWrite<W>[]
}

export function isStatusWrite(write: Write): write is StatusWrite {
  return 'listStatus' in write
}

const FORMATS: readonly string[] = ['POINT_100', 'POINT_10_DECIMAL', 'POINT_10', 'POINT_5', 'POINT_3'] satisfies ScoreFormat[]
const STATUSES: readonly string[] = ['pending', 'done', 'failed', 'skipped'] satisfies WriteStatus[]

const LIST_STATUSES: readonly string[] = ['CURRENT', 'PLANNING', 'COMPLETED', 'DROPPED', 'PAUSED', 'REPEATING'] satisfies ListStatus[]

/** A saved Import read back from storage, or null if it isn't one. Only score writes are accepted. */
export function parseImportState(value: unknown): ImportState | null {
  return parseQueue(value, isScoreWrite) as ImportState | null
}

/** A saved queue of score and list status writes read back from storage, or null if it isn't one. */
export function parseWriteQueue(value: unknown): ImportState<Write> | null {
  return parseQueue(value, (w) => isScoreWrite(w) || isSavedStatusWrite(w))
}

type SavedWrite = Partial<PendingWrite & StatusWrite & { status: unknown; error: unknown }>

const isScoreWrite = (w: SavedWrite) => Number.isInteger(w.scoreRaw) && Number.isInteger(w.oldScore100)
const isSavedStatusWrite = (w: SavedWrite) => LIST_STATUSES.includes(w.listStatus as string)

function parseQueue(value: unknown, isWrite: (w: SavedWrite) => boolean): ImportState<Write> | null {
  const v = value as Partial<ImportState<Write>> | null
  if (typeof v !== 'object' || v === null || typeof v.hash !== 'string' || !FORMATS.includes(v.format as string)) return null
  if (!Array.isArray(v.writes)) return null
  const ok = v.writes.every(
    (w: SavedWrite) =>
      Number.isInteger(w?.mediaId) &&
      isWrite(w) &&
      STATUSES.includes(w.status as string) &&
      (w.error === undefined || typeof w.error === 'string'),
  )
  return ok ? (v as ImportState<Write>) : null
}

export function newImport<W extends Write>(plan: readonly W[], from: { hash: string; format: ScoreFormat }): ImportState<W> {
  return { hash: from.hash, format: from.format, writes: plan.map((w) => ({ ...w, status: 'pending' as const })) }
}

export type RunnerDeps<W extends Write = PendingWrite> = {
  gateway: AniListGateway
  clock: Clock
  userId: number
  mediaType: MediaType
  save: (state: ImportState<W>) => void
}

const ALL_STATUSES = LIST_STATUSES as readonly ListStatus[]

/** Spacing once `X-RateLimit-Remaining` is at or below LOW_REMAINING. */
export const SLOW_SPACING_MS = 4000
export const LOW_REMAINING = 5
/** Wait after a 429 without an `X-RateLimit-Reset` header. `Retry-After` is never read: CORS doesn't expose it. */
export const DEFAULT_RESET_WAIT_MS = 60_000

/** What the Runner is doing right now, for the Import screen. */
export type RunnerStatus =
  | { phase: 'reading' }
  | { phase: 'writing'; mediaId: number; spacingMs: number }
  /** Rate limit reached (a 429): nothing is sent until `until` (epoch ms). */
  | { phase: 'waiting'; until: number }

export type RunOptions<W extends Write = PendingWrite> = {
  /** Stops before the next write; what was written so far is saved. */
  signal?: AbortSignal
  onStatus?: (status: RunnerStatus, state: ImportState<W>) => void
}

/**
 * Runs every pending write in order and returns the final state; `deps.save` gets the state after each write.
 * First it re-reads the list: a pending title whose AniList score is already the new one counts as done (it was
 * written before the tab closed), and one whose score changed since the plan, or that left the list, is skipped.
 * A pending status write whose title is already on the list counts as done with the same status, or is skipped.
 * Then one write at a time, about 1 every 2.2 s (4 s once few requests remain); a 429 waits for the reset and retries.
 */
export function runImport<W extends Write>(
  deps: RunnerDeps<W>,
  initial: ImportState<W>,
  options: RunOptions<W> = {},
): Promise<ImportState<W>> {
  return startImport(deps, initial, options).done
}

/** A run in progress. */
export type RunningImport<W extends Write = Write> = {
  /**
   * Queues more writes behind the ones already queued (Catch-up appends each saved page). Saved at once. Returns false
   * once the run has ended: start a new run from `appendWrites(finalState, writes)` instead.
   */
  append(writes: readonly W[]): boolean
  /** The final state, as `runImport` returns it. */
  done: Promise<ImportState<W>>
}

/** Queues more pending writes after the existing ones, for a run that isn't going. */
export function appendWrites<W extends Write>(state: ImportState<W>, writes: readonly W[]): ImportState<W> {
  return { ...state, writes: [...state.writes, ...writes.map((w) => ({ ...w, status: 'pending' as const }))] }
}

/** `runImport`, with a handle to append writes while it runs. */
export function startImport<W extends Write>(
  deps: RunnerDeps<W>,
  initial: ImportState<W>,
  options: RunOptions<W> = {},
): RunningImport<W> {
  const { gateway, clock } = deps
  const { signal, onStatus } = options
  let state = initial
  let ended = false
  /** The list as re-read at the start, to settle writes appended after it. */
  let current: ReadonlyMap<number, ListEntry> | null = null

  function append(writes: readonly W[]): boolean {
    if (ended) return false
    state = appendWrites(state, writes)
    if (current !== null) state = reconcile(state, current)
    deps.save(state)
    return true
  }

  /** Runs one request; on a 429 waits until the reset time (or 60 s) and tries again. */
  async function withRateLimit<T>(request: () => Promise<T>): Promise<T> {
    for (;;) {
      try {
        return await request()
      } catch (e) {
        if (!(e instanceof AniListError) || e.kind !== 'rate-limited') throw e
        const { resetAt } = gateway.rateLimit()
        const wait = resetAt === null ? DEFAULT_RESET_WAIT_MS : Math.max(0, resetAt * 1000 - clock.now())
        onStatus?.({ phase: 'waiting', until: clock.now() + wait }, state)
        await clock.sleep(wait, signal)
        if (signal?.aborted) throw new StoppedError()
      }
    }
  }

  function spacing(): number {
    const { remaining } = gateway.rateLimit()
    return remaining !== null && remaining <= LOW_REMAINING ? SLOW_SPACING_MS : WRITE_SPACING_MS
  }

  async function run(): Promise<ImportState<W>> {
    try {
      onStatus?.({ phase: 'reading' }, state)
      const list = await withRateLimit(() => gateway.mediaList({ userId: deps.userId, type: deps.mediaType, statuses: ALL_STATUSES }))
      current = new Map(list.map((e) => [e.mediaId, e]))
      state = reconcile(state, current)
      deps.save(state)

      let lastWriteAt: number | null = null
      for (let i = 0; i < state.writes.length; i++) {
        const write = state.writes[i]
        if (write.status !== 'pending') continue
        let result: Pick<QueuedWrite, 'status' | 'error'>
        try {
          await withRateLimit(async () => {
            const gap = spacing()
            onStatus?.({ phase: 'writing', mediaId: write.mediaId, spacingMs: gap }, state)
            if (lastWriteAt !== null) await clock.sleep(Math.max(0, lastWriteAt + gap - clock.now()), signal)
            if (signal?.aborted) throw new StoppedError()
            lastWriteAt = clock.now()
            if (isStatusWrite(write)) await gateway.saveStatus(write.mediaId, write.listStatus)
            else await gateway.saveScore(write.mediaId, write.scoreRaw)
          })
          result = { status: 'done' }
        } catch (e) {
          // A stop or an expired login ends the run; the saved state resumes later.
          if (e instanceof StoppedError || (e instanceof AniListError && e.kind === 'auth')) throw e
          result = { status: 'failed', error: failureReason(e) }
        }
        state = updateWrite(state, i, result)
        deps.save(state)
      }
    } catch (e) {
      if (!(e instanceof StoppedError)) throw e
    } finally {
      ended = true
    }
    return state
  }

  return { append, done: run() }
}

class StoppedError extends Error {}

/** Settles pending writes against the list AniList has now (by mediaId). */
function reconcile<W extends Write>(state: ImportState<W>, current: ReadonlyMap<number, ListEntry>): ImportState<W> {
  return { ...state, writes: state.writes.map((w) => settle(w, current.get(w.mediaId))) }
}

function settle<W extends Write>(w: QueuedWrite<W>, entry: ListEntry | undefined): QueuedWrite<W> {
  if (w.status !== 'pending') return w
  if (isStatusWrite(w)) {
    // Writing would overwrite a status the user set on AniList since marking the title.
    if (entry === undefined) return w
    if (entry.status === w.listStatus) return { ...w, status: 'done' }
    return { ...w, status: 'skipped', error: 'already on your list' }
  }
  // A score write: 100-point scores.
  const now = entry?.oldScore100
  if (now === undefined) return { ...w, status: 'skipped', error: 'not on your list' }
  if (now === w.scoreRaw) return { ...w, status: 'done' }
  if (now !== w.oldScore100) return { ...w, status: 'skipped', error: 'changed on AniList' }
  return w
}

function failureReason(e: unknown): string {
  if (e instanceof AniListError && e.kind === 'unreachable') return 'network error'
  if (e instanceof AniListError && e.status !== null) return `AniList error ${e.status}`
  return 'AniList error'
}

function updateWrite<W extends Write>(
  state: ImportState<W>,
  index: number,
  change: Pick<QueuedWrite, 'status' | 'error'>,
): ImportState<W> {
  return {
    ...state,
    writes: state.writes.map((w, j) => {
      if (j !== index) return w
      const { error: _old, ...rest } = w
      const next = change.error === undefined ? { ...rest, status: change.status } : { ...rest, ...change }
      return next as QueuedWrite<W>
    }),
  }
}

/** Puts every failed title back in line, for the Retry button. */
export function retryFailed<W extends Write>(state: ImportState<W>): ImportState<W> {
  const writes = state.writes.map(({ error: _e, ...w }) => (w.status === 'failed' ? { ...w, status: 'pending' } : w))
  return { ...state, writes: writes as QueuedWrite<W>[] }
}

/** Estimated time until every pending title is written: one spacing each, plus what is left of a rate-limit wait. */
export function timeLeftMs(state: ImportState<Write>, status: RunnerStatus, now: number): number {
  const left = state.writes.filter((w) => w.status === 'pending').length
  if (status.phase === 'waiting') return Math.max(0, status.until - now) + left * WRITE_SPACING_MS
  return left * (status.phase === 'writing' ? status.spacingMs : WRITE_SPACING_MS)
}

/** "1 min 24 s", or "34 s" under a minute. */
export function formatDuration(ms: number): string {
  const seconds = Math.ceil(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  return minutes === 0 ? `${seconds} s` : `${minutes} min ${seconds % 60} s`
}

/** Each skipped title with why it was skipped ("changed on AniList", "not on your list"), in plan order. */
export function skippedWrites(state: ImportState<Write>): { mediaId: number; reason: string }[] {
  return state.writes.filter((w) => w.status === 'skipped').map((w) => ({ mediaId: w.mediaId, reason: w.error ?? 'skipped' }))
}

export type ImportSummary = { written: number; skipped: number; failed: number; left: number; total: number }

export function importSummary(state: ImportState<Write>): ImportSummary {
  const count = (status: WriteStatus) => state.writes.filter((w) => w.status === status).length
  return { written: count('done'), skipped: count('skipped'), failed: count('failed'), left: count('pending'), total: state.writes.length }
}
