import { useMemo, useRef, useState } from 'react'
import { saveDuelLog } from '../persistence/progress.ts'
import { appendEvent, replay, type DuelLog, type LogEvent, type RankingState } from '../ranking/engine.ts'

export type DuelLogStore = {
  /** The log on screen; null when this Media Type has no usable Ranking. */
  log: DuelLog | null
  /** `log` replayed. */
  ranking: RankingState | null
  /** The latest log, updated synchronously, so two quick key presses never append to a stale log. For handlers only. */
  latest: () => DuelLog | null
  /** Shows another log (a loaded, new or restored one) without saving it. */
  show: (next: DuelLog | null) => void
  /** Saves a log (e.g. a new one) and shows it. */
  save: (next: DuelLog) => void
  /**
   * Appends events (ADR 0005), checks the log still replays, saves it, then shows it, and returns the new state.
   * Throws (ReplayError) if it doesn't replay; nothing is saved then. Without a log there is nothing to append to.
   */
  append: (...events: LogEvent[]) => RankingState | null
}

/** The Duel log of the open Ranking: appended to, replayed and saved after every answer (ADR 0001, ADR 0005). */
export function useDuelLog(storage: Storage): DuelLogStore {
  const [log, setLog] = useState<DuelLog | null>(null)
  const latestRef = useRef<DuelLog | null>(null)
  const ranking = useMemo(() => (log ? replay(log) : null), [log])

  function show(next: DuelLog | null) {
    latestRef.current = next
    setLog(next)
  }

  function save(next: DuelLog) {
    saveDuelLog(storage, next)
    show(next)
  }

  function append(...events: LogEvent[]): RankingState | null {
    const current = latestRef.current
    if (!current) return null
    const next = events.reduce(appendEvent, current)
    const state = replay(next)
    save(next)
    return state
  }

  return { log, ranking, latest: () => latestRef.current, show, save, append }
}
