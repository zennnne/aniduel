// The Duel log of the open Ranking (ADR 0001): appended to (ADR 0005), replayed and saved after every answer. It keeps
// the log with its replay, so each log is replayed once, and hands every failure back as a value: nothing here throws
// because the browser refused to save or the engine refused the log. It never loads or deletes a saved log itself.
import { appendEvent, replayer, type DuelLog, type LogEvent, type RankingState } from '../ranking/engine.ts'
import { SaveError, saveDuelLog } from './progress.ts'

/** A log and its replay, kept together so each log is replayed once. */
export type ReplayedLog = { log: DuelLog; ranking: RankingState }

/** Why the open Ranking's Duel log stayed as it was. */
export type DuelLogFailure =
  /** The browser refused to save (its storage is full or blocked). What was saved before is still there, and open. */
  | { reason: 'save-refused' }
  /** The engine can't replay the log; `message` is the engine's own. Nothing of it was saved. */
  | { reason: 'does-not-replay'; message: string }
  /** No Ranking is open, so there is no log to append to. */
  | { reason: 'no-open-log' }

/** The log now open with its replay, or why nothing changed. */
export type DuelLogResult = ({ ok: true } & ReplayedLog) | ({ ok: false } & DuelLogFailure)

export type DuelLogStore = {
  /**
   * The open Ranking's log with its replay, or null when no Ranking is open. Updated synchronously, so two quick key
   * presses never append to a stale log, and the same object until the log changes.
   */
  latest(): ReplayedLog | null
  /** Called on every change; returns an unsubscribe. */
  subscribe(listener: (latest: ReplayedLog | null) => void): () => void
  /** Opens another log (a loaded or restored one) without saving it, once it replays. */
  show(next: DuelLog): DuelLogResult
  /** No Ranking is open any more (logout, a Ranking thrown away or ended). Nothing saved is touched. */
  close(): void
  /** Saves a log (a new one) and opens it, once it replays. */
  save(next: DuelLog): DuelLogResult
  /**
   * Appends events to the open log (ADR 0005), checks it still replays, saves it, then opens it. A log that doesn't
   * replay is not saved; one that can't be saved is not opened, so the store stays on what is saved.
   */
  append(...events: LogEvent[]): DuelLogResult
}

/** The Duel log of the open Ranking, saved in `storage`. */
export function createDuelLogStore(storage: Storage): DuelLogStore {
  let open: ReplayedLog | null = null
  // One replayer for the open Ranking: an answer applies its own event instead of replaying the whole log.
  const replayLog = replayer()
  const listeners = new Set<(latest: ReplayedLog | null) => void>()

  function set(next: ReplayedLog | null) {
    open = next
    for (const listener of [...listeners]) listener(open)
  }

  /** Replays `log`, saves it if asked to, and only then opens it. */
  function put(log: DuelLog, save: boolean): DuelLogResult {
    let ranking: RankingState
    try {
      ranking = replayLog(log)
    } catch (e) {
      return { ok: false, reason: 'does-not-replay', message: e instanceof Error ? e.message : 'unknown error' }
    }
    if (save) {
      try {
        saveDuelLog(storage, log)
      } catch (e) {
        if (!(e instanceof SaveError)) throw e
        return { ok: false, reason: 'save-refused' }
      }
    }
    set({ log, ranking })
    return { ok: true, log, ranking }
  }

  return {
    latest: () => open,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    show: (next) => put(next, false),
    close: () => set(null),
    save: (next) => put(next, true),
    append(...events) {
      if (!open) return { ok: false, reason: 'no-open-log' }
      return put(events.reduce(appendEvent, open.log), true)
    },
  }
}
