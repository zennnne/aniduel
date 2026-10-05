// Import Runner: writes the Import plan to AniList one score at a time, inside the rate limit.
import { AniListError, type AniListGateway } from '../anilist/gateway.ts'
import type { ListStatus, MediaType, ScoreFormat } from '../anilist/types.ts'
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

/** `error` says why a failed write failed, e.g. "network error". */
export type ImportWrite = PendingWrite & { status: WriteStatus; error?: string }

/** One Import, saved after every write so a cut-off Import carries on where it stopped. */
export type ImportState = {
  /** Hash of the Duel log and scoring settings the plan was made from. */
  hash: string
  format: ScoreFormat
  writes: ImportWrite[]
}

const FORMATS: readonly string[] = ['POINT_100', 'POINT_10_DECIMAL', 'POINT_10', 'POINT_5', 'POINT_3'] satisfies ScoreFormat[]
const STATUSES: readonly string[] = ['pending', 'done', 'failed', 'skipped'] satisfies WriteStatus[]

/** A saved Import read back from storage, or null if it isn't one. */
export function parseImportState(value: unknown): ImportState | null {
  const v = value as Partial<ImportState> | null
  if (typeof v !== 'object' || v === null || typeof v.hash !== 'string' || !FORMATS.includes(v.format as string)) return null
  if (!Array.isArray(v.writes)) return null
  const ok = v.writes.every(
    (w: Partial<ImportWrite>) =>
      Number.isInteger(w?.mediaId) &&
      Number.isInteger(w.scoreRaw) &&
      Number.isInteger(w.oldScore100) &&
      STATUSES.includes(w.status as string) &&
      (w.error === undefined || typeof w.error === 'string'),
  )
  return ok ? (v as ImportState) : null
}

export function newImport(plan: readonly PendingWrite[], from: { hash: string; format: ScoreFormat }): ImportState {
  return { hash: from.hash, format: from.format, writes: plan.map((w) => ({ ...w, status: 'pending' })) }
}

export type RunnerDeps = {
  gateway: AniListGateway
  clock: Clock
  userId: number
  mediaType: MediaType
  save: (state: ImportState) => void
}

const ALL_STATUSES: readonly ListStatus[] = ['CURRENT', 'PLANNING', 'COMPLETED', 'DROPPED', 'PAUSED', 'REPEATING']

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

export type RunOptions = {
  /** Stops before the next write; what was written so far is saved. */
  signal?: AbortSignal
  onStatus?: (status: RunnerStatus, state: ImportState) => void
}

/**
 * Runs every pending write in order and returns the final state; `deps.save` gets the state after each write.
 * First it re-reads the list: a pending title whose AniList score is already the new one counts as done (it was
 * written before the tab closed), and one whose score changed since the plan, or that left the list, is skipped.
 * Then one write at a time, about 1 every 2.2 s (4 s once few requests remain); a 429 waits for the reset and retries.
 */
export async function runImport(deps: RunnerDeps, initial: ImportState, options: RunOptions = {}): Promise<ImportState> {
  const { gateway, clock } = deps
  const { signal, onStatus } = options
  let state = initial

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

  try {
    onStatus?.({ phase: 'reading' }, state)
    const list = await withRateLimit(() => gateway.mediaList({ userId: deps.userId, type: deps.mediaType, statuses: ALL_STATUSES }))
    state = reconcile(state, new Map(list.map((e) => [e.mediaId, e.oldScore100])))
    deps.save(state)

    let lastWriteAt: number | null = null
    for (let i = 0; i < state.writes.length; i++) {
      const write = state.writes[i]
      if (write.status !== 'pending') continue
      let result: Pick<ImportWrite, 'status' | 'error'>
      try {
        await withRateLimit(async () => {
          const gap = spacing()
          onStatus?.({ phase: 'writing', mediaId: write.mediaId, spacingMs: gap }, state)
          if (lastWriteAt !== null) await clock.sleep(Math.max(0, lastWriteAt + gap - clock.now()), signal)
          if (signal?.aborted) throw new StoppedError()
          lastWriteAt = clock.now()
          await gateway.saveScore(write.mediaId, write.scoreRaw)
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
  }
  return state
}

class StoppedError extends Error {}

/** Settles pending writes against the scores AniList has now (by mediaId, 100-point). */
function reconcile(state: ImportState, current: ReadonlyMap<number, number>): ImportState {
  return {
    ...state,
    writes: state.writes.map((w) => {
      if (w.status !== 'pending') return w
      const now = current.get(w.mediaId)
      if (now === undefined) return { ...w, status: 'skipped', error: 'not on your list' }
      if (now === w.scoreRaw) return { ...w, status: 'done' }
      if (now !== w.oldScore100) return { ...w, status: 'skipped', error: 'changed on AniList' }
      return w
    }),
  }
}

function failureReason(e: unknown): string {
  if (e instanceof AniListError && e.kind === 'unreachable') return 'network error'
  if (e instanceof AniListError && e.status !== null) return `AniList error ${e.status}`
  return 'AniList error'
}

function updateWrite(state: ImportState, index: number, change: Pick<ImportWrite, 'status' | 'error'>): ImportState {
  return {
    ...state,
    writes: state.writes.map((w, j) => {
      if (j !== index) return w
      const { error: _old, ...rest } = w
      return change.error === undefined ? { ...rest, status: change.status } : { ...rest, ...change }
    }),
  }
}

/** Puts every failed title back in line, for the Retry button. */
export function retryFailed(state: ImportState): ImportState {
  return { ...state, writes: state.writes.map(({ error: _e, ...w }) => (w.status === 'failed' ? { ...w, status: 'pending' } : w)) }
}

/** Estimated time until every pending title is written: one spacing each, plus what is left of a rate-limit wait. */
export function timeLeftMs(state: ImportState, status: RunnerStatus, now: number): number {
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

export type ImportSummary ={ written: number; skipped: number; failed: number; left: number; total: number }

export function importSummary(state: ImportState): ImportSummary {
  const count = (status: WriteStatus) => state.writes.filter((w) => w.status === status).length
  return { written: count('done'), skipped: count('skipped'), failed: count('failed'), left: count('pending'), total: state.writes.length }
}
