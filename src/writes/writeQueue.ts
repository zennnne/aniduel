// The write queue: every write the app sends to one user's AniList list, in one line. Import's scores and Catch-up's
// list statuses join the same queue, are written one at a time inside the rate limit, and are saved after every
// write so the queue carries on where it stopped after a reload.
import { AniListError, type AniListGateway } from '../anilist/gateway.ts'
import type { ListEntry, ListStatus, MediaType, ScoreFormat } from '../anilist/types.ts'
import type { Clock } from '../clock.ts'
import type { ImportState } from '../import/importState.ts'
import type { PendingWrite } from '../ranking/preview.ts'
import { DEFAULT_RESET_WAIT_MS, createRequestLimiter, type RequestLimiter } from './limiter.ts'

/** Normal spacing between two writes, which keeps under AniList's 30 requests a minute. */
export const WRITE_SPACING_MS = 2200
/** Spacing once `X-RateLimit-Remaining` is at or below LOW_REMAINING. */
export const SLOW_SPACING_MS = 4000
export const LOW_REMAINING = 5

export type WriteStatus = 'pending' | 'done' | 'failed' | 'skipped'

/** Sets a title's list status, adding it to the list if it isn't there yet (Catch-up). `name` is for the failure bar. */
export type StatusWrite = { mediaId: number; listStatus: ListStatus; name?: string }

/** What the queue can write: a score (Import) or a list status (Catch-up). */
export type Write = PendingWrite | StatusWrite

/** A write with how far it got. `error` says why a failed or skipped write didn't go, e.g. "network error". */
export type QueuedWrite<W extends Write = Write> = W & { status: WriteStatus; error?: string }

/** A write in the queue, with the Media Type of the list it goes to. */
export type QueueEntry = QueuedWrite & { mediaType: MediaType }

/** The Import plan a Media Type's score writes come from, checked before they resume (ADR 0003). One per Media Type. */
export type QueuedImport = { mediaType: MediaType; hash: string; format: ScoreFormat }

/** Everything waiting to be written for one user, saved after every write. */
export type WriteQueueState = { imports: QueuedImport[]; writes: QueueEntry[] }

/** What the queue is doing right now, for the Import screen and Catch-up. */
export type RunnerStatus =
  | { phase: 'reading' }
  | { phase: 'writing'; mediaId: number; spacingMs: number }
  /** Rate limit reached (a 429): nothing is sent until `until` (epoch ms). */
  | { phase: 'waiting'; until: number }

export type WriteQueueSnapshot = {
  state: WriteQueueState
  running: boolean
  status: RunnerStatus | null
  /** Media Types whose Import is being written in this visit. Any other Import waits until it is resumed. */
  released: readonly MediaType[]
}

export type WriteQueueDeps = {
  gateway: AniListGateway
  clock: Clock
  /** Shared with every other request sent for the user (Catch-up's reads), so together they keep to the limit. */
  limiter?: RequestLimiter
  userId: number
  /** What was saved for the user, or null. */
  initial: WriteQueueState | null
  /** Called after every change; null when nothing is left worth keeping. */
  save: (state: WriteQueueState | null) => void
  /** A run ended on an error it doesn't record per write (an expired login, AniList unreachable): writes stay pending. */
  onError: (error: unknown) => void
}

export type WriteQueue = {
  snapshot(): WriteQueueSnapshot
  /** Called on every change; returns an unsubscribe. */
  subscribe(listener: (snapshot: WriteQueueSnapshot) => void): () => void
  /** Queues list status writes (a saved Catch-up page) behind everything already queued, and writes them. */
  addStatuses(writes: readonly StatusWrite[], mediaType: MediaType): void
  /** Puts the failed status writes back in line and writes them. */
  retryStatuses(): void
  /** Replaces the Media Type's Import with this one and writes it, behind what is already queued. */
  writeImport(mediaType: MediaType, plan: ImportState): void
  /** Stop: no more of the Import is written until `writeImport` again. A write already sent still lands. */
  holdImport(mediaType: MediaType): void
  /** Takes the Import and its scores out of the queue (Start over, a changed Score Format, an Import finished). */
  dropImport(mediaType: MediaType): void
  /** Writes what a reload left unwritten (Imports wait to be resumed), and reports the saved queue either way. */
  resume(): void
  /**
   * Stops after the current write and lets go of the saved queue (logout, or another user): nothing more is saved or
   * reported. What was saved before resumes next time; a write that was in flight is recognised then.
   */
  stop(): void
  /** Resolves once no run is going. */
  idle(): Promise<void>
}

const LIST_STATUSES: readonly ListStatus[] = ['CURRENT', 'PLANNING', 'COMPLETED', 'DROPPED', 'PAUSED', 'REPEATING']
const FORMATS: readonly string[] = ['POINT_100', 'POINT_10_DECIMAL', 'POINT_10', 'POINT_5', 'POINT_3'] satisfies ScoreFormat[]
const STATUSES: readonly string[] = ['pending', 'done', 'failed', 'skipped'] satisfies WriteStatus[]
const MEDIA_TYPES: readonly string[] = ['ANIME', 'MANGA'] satisfies MediaType[]

const EMPTY: WriteQueueState = { imports: [], writes: [] }

export function isStatusWrite(write: Write): write is StatusWrite {
  return 'listStatus' in write
}

type SavedWrite = Partial<PendingWrite & StatusWrite & { status: unknown; error: unknown; mediaType: unknown }>

export const isSavedScoreWrite = (w: SavedWrite) => Number.isInteger(w?.scoreRaw) && Number.isInteger(w?.oldScore100)
const isSavedStatusWrite = (w: SavedWrite) =>
  (LIST_STATUSES as readonly unknown[]).includes(w?.listStatus) && (w.name === undefined || typeof w.name === 'string')
export const isSavedProgress = (w: SavedWrite) =>
  Number.isInteger(w?.mediaId) && STATUSES.includes(w.status as string) && (w.error === undefined || typeof w.error === 'string')
export const isScoreFormat = (format: unknown) => FORMATS.includes(format as string)

/** A saved write queue read back from storage, or null if it isn't one. Score writes need their Import's plan. */
export function parseWriteQueueState(value: unknown): WriteQueueState | null {
  const v = value as Partial<WriteQueueState> | null
  if (typeof v !== 'object' || v === null || !Array.isArray(v.imports) || !Array.isArray(v.writes)) return null
  const imports = v.imports as Partial<QueuedImport>[]
  const okImports = imports.every(
    (i) => MEDIA_TYPES.includes(i?.mediaType as string) && typeof i.hash === 'string' && isScoreFormat(i.format),
  )
  if (!okImports) return null
  const planned = new Set(imports.map((i) => i.mediaType))
  const okWrites = (v.writes as SavedWrite[]).every(
    (w) =>
      isSavedProgress(w) &&
      MEDIA_TYPES.includes(w.mediaType as string) &&
      (isSavedStatusWrite(w) || (isSavedScoreWrite(w) && planned.has(w.mediaType as MediaType))),
  )
  return okWrites ? (v as WriteQueueState) : null
}

/** Settles pending writes to one Media Type against the list AniList has now (by mediaId). */
function reconcile(state: WriteQueueState, mediaType: MediaType, list: ReadonlyMap<number, ListedTitle>): WriteQueueState {
  return { ...state, writes: state.writes.map((w) => (w.mediaType === mediaType ? settle(w, list.get(w.mediaId)) : w)) }
}

type ListedTitle = Pick<ListEntry, 'status' | 'oldScore100'>

function settle(w: QueueEntry, entry: ListedTitle | undefined): QueueEntry {
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

const unfinished = (w: QueuedWrite) => w.status === 'pending' || w.status === 'failed'

/**
 * What a new run starts from: status writes that are through are let go (Catch-up counts each run's writes), and so
 * is an Import with nothing left to write or retry.
 */
function withoutFinished(state: WriteQueueState): WriteQueueState {
  const open = new Set(state.writes.filter((w) => !isStatusWrite(w) && unfinished(w)).map((w) => w.mediaType))
  return {
    imports: state.imports.filter((i) => open.has(i.mediaType)),
    writes: state.writes.filter((w) => (isStatusWrite(w) ? unfinished(w) : open.has(w.mediaType))),
  }
}

function withoutImport(state: WriteQueueState, mediaType: MediaType): WriteQueueState {
  return {
    imports: state.imports.filter((i) => i.mediaType !== mediaType),
    writes: state.writes.filter((w) => isStatusWrite(w) || w.mediaType !== mediaType),
  }
}

function failureReason(e: unknown): string {
  if (e instanceof AniListError && e.kind === 'unreachable') return 'network error'
  if (e instanceof AniListError && e.status !== null) return `AniList error ${e.status}`
  return 'AniList error'
}

class StoppedError extends Error {}

/** The write that went somewhere else while the queue waited its turn (held, dropped or replaced). */
class ChangedError extends Error {}

export function createWriteQueue(deps: WriteQueueDeps): WriteQueue {
  const { gateway, clock } = deps
  const limiter = deps.limiter ?? createRequestLimiter(clock)
  let state: WriteQueueState = deps.initial ?? EMPTY
  let status: RunnerStatus | null = null
  const released = new Set<MediaType>()
  const listeners = new Set<(snapshot: WriteQueueSnapshot) => void>()
  let run: { stop: AbortController } | null = null
  let done: Promise<void> = Promise.resolve()
  let detached = false
  /** Each Media Type's list as read in this run, kept up to date with what the run wrote. */
  const lists = new Map<MediaType, Map<number, ListedTitle>>()

  const snapshot = (): WriteQueueSnapshot => ({ state, running: run !== null, status, released: [...released] })

  function notify() {
    if (detached) return
    const snap = snapshot()
    for (const listener of listeners) listener(snap)
  }

  function commit(next: WriteQueueState) {
    if (detached) return
    state = next
    deps.save(run !== null || state.writes.some(unfinished) ? state : null)
    notify()
  }

  /** A change that may give the queue something to write: the run starts (if it can) before anyone is told. */
  function change(next: WriteQueueState) {
    if (detached) return
    state = next
    ensureRunning()
    commit(state)
  }

  function setStatus(next: RunnerStatus) {
    status = next
    notify()
  }

  const runnable = (w: QueueEntry) => w.status === 'pending' && (isStatusWrite(w) || released.has(w.mediaType))
  const pick = () => state.writes.find(runnable)

  function spacing(): number {
    const { remaining } = gateway.rateLimit()
    return remaining !== null && remaining <= LOW_REMAINING ? SLOW_SPACING_MS : WRITE_SPACING_MS
  }

  /** Runs one request in its turn; on a 429 waits until the reset time (or 60 s) and tries again. */
  async function withRateLimit<T>(signal: AbortSignal, request: () => Promise<T>): Promise<T> {
    for (;;) {
      try {
        return await request()
      } catch (e) {
        if (!(e instanceof AniListError) || e.kind !== 'rate-limited') throw e
        const { resetAt } = gateway.rateLimit()
        const wait = resetAt === null ? DEFAULT_RESET_WAIT_MS : Math.max(0, resetAt * 1000 - clock.now())
        setStatus({ phase: 'waiting', until: clock.now() + wait })
        await clock.sleep(wait, signal)
        if (signal.aborted) throw new StoppedError()
      }
    }
  }

  async function readList(mediaType: MediaType, signal: AbortSignal) {
    setStatus({ phase: 'reading' })
    const list = await withRateLimit(signal, async () => {
      await limiter.turn(signal)
      if (signal.aborted) throw new StoppedError()
      return gateway.mediaList({ userId: deps.userId, type: mediaType, statuses: LIST_STATUSES })
    })
    if (signal.aborted) throw new StoppedError()
    const titles = new Map(list.map((e) => [e.mediaId, { status: e.status, oldScore100: e.oldScore100 }]))
    lists.set(mediaType, titles)
    commit(reconcile(state, mediaType, titles))
  }

  /** Records how a write went, and what AniList has now. */
  function record(write: QueueEntry, result: Pick<QueuedWrite, 'status' | 'error'>) {
    const index = state.writes.indexOf(write)
    if (index === -1) return // dropped while it was being written
    const { error: _old, ...rest } = write
    const next: QueueEntry = result.error === undefined ? { ...rest, status: result.status } : { ...rest, ...result }
    if (result.status === 'done') {
      const list = lists.get(write.mediaType)
      const before = list?.get(write.mediaId)
      list?.set(
        write.mediaId,
        isStatusWrite(write)
          ? { status: write.listStatus, oldScore100: before?.oldScore100 ?? 0 }
          : { status: before?.status ?? 'COMPLETED', oldScore100: write.scoreRaw },
      )
    }
    commit({ ...state, writes: state.writes.map((w, i) => (i === index ? next : w)) })
  }

  /** Writes the runnable writes in order, one at a time, until none is left. */
  async function loop(signal: AbortSignal) {
    let lastWriteAt: number | null = null
    for (let write = pick(); write; write = pick()) {
      if (!lists.has(write.mediaType)) {
        // First the list is read: a pending title already written before the tab closed counts as done, and one that
        // changed on AniList since it was queued is skipped.
        await readList(write.mediaType, signal)
        continue
      }
      const next = write
      let result: Pick<QueuedWrite, 'status' | 'error'>
      try {
        await withRateLimit(signal, async () => {
          const gap = spacing()
          setStatus({ phase: 'writing', mediaId: next.mediaId, spacingMs: gap })
          if (lastWriteAt !== null) await clock.sleep(Math.max(0, lastWriteAt + gap - clock.now()), signal)
          if (signal.aborted) throw new StoppedError()
          if (pick() !== next) throw new ChangedError()
          await limiter.turn(signal)
          if (signal.aborted) throw new StoppedError()
          if (pick() !== next) throw new ChangedError()
          lastWriteAt = clock.now()
          if (isStatusWrite(next)) await gateway.saveStatus(next.mediaId, next.listStatus)
          else await gateway.saveScore(next.mediaId, next.scoreRaw)
        })
        result = { status: 'done' }
      } catch (e) {
        if (e instanceof ChangedError) continue
        // A stop or an expired login ends the run; the saved state resumes later.
        if (e instanceof StoppedError || (e instanceof AniListError && e.kind === 'auth')) throw e
        result = { status: 'failed', error: failureReason(e) }
      }
      record(next, result)
    }
  }

  /** Starts a run unless one is going or nothing can be written. Returns whether one is going. */
  function ensureRunning(): boolean {
    if (run) return true
    if (detached || !pick()) return false
    const handle = { stop: new AbortController() }
    run = handle
    lists.clear()
    done = loop(handle.stop.signal).then(
      () => ended(handle, null),
      (e: unknown) => ended(handle, e instanceof StoppedError ? null : e),
    )
    return true
  }

  function ended(handle: NonNullable<typeof run>, error: unknown) {
    if (run !== handle) return
    run = null
    status = null
    if (detached) return
    commit(state)
    if (error !== null) deps.onError(error)
    // Writes queued just as the last one finished.
    else ensureRunning()
  }

  /** The state a change starts from: a new run starts without what earlier runs finished. */
  const base = () => (run ? state : withoutFinished(state))

  return {
    snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    addStatuses(writes, mediaType) {
      if (detached || writes.length === 0) return
      const added: QueueEntry[] = writes.map((w) => ({ ...w, mediaType, status: 'pending' }))
      let next: WriteQueueState = { ...base(), writes: [...base().writes, ...added] }
      const list = lists.get(mediaType)
      if (run && list) next = reconcile(next, mediaType, list)
      change(next)
    },
    retryStatuses() {
      if (detached) return
      const writes = base().writes.map((w) => {
        if (!isStatusWrite(w) || w.status !== 'failed') return w
        const { error: _e, ...rest } = w
        return { ...rest, status: 'pending' as const }
      })
      change({ ...base(), writes })
    },
    writeImport(mediaType, plan) {
      if (detached) return
      const rest = withoutImport(base(), mediaType)
      released.add(mediaType)
      // Every Import reads the list again before writing, as a resumed Import always has.
      lists.delete(mediaType)
      change({
        imports: [...rest.imports, { mediaType, hash: plan.hash, format: plan.format }],
        writes: [...rest.writes, ...plan.writes.map((w) => ({ ...w, mediaType }))],
      })
    },
    holdImport(mediaType) {
      if (!released.delete(mediaType)) return
      notify()
    },
    dropImport(mediaType) {
      released.delete(mediaType)
      commit(withoutImport(state, mediaType))
    },
    resume() {
      if (!ensureRunning()) notify()
    },
    stop() {
      detached = true
      listeners.clear()
      run?.stop.abort()
    },
    idle: async () => {
      // A run started while waiting is waited for too.
      for (let current = done; ; current = done) {
        await current
        if (current === done) return
      }
    },
  }
}

export type WriteSummary = { written: number; skipped: number; failed: number; left: number; total: number }

export function writeSummary(writes: readonly QueuedWrite[]): WriteSummary {
  const count = (status: WriteStatus) => writes.filter((w) => w.status === status).length
  return { written: count('done'), skipped: count('skipped'), failed: count('failed'), left: count('pending'), total: writes.length }
}
