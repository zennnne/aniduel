// Ranking Engine (ADR 0001, ADR 0005): pure, no I/O. The Duel log is the source of truth;
// every derived thing (next prompt, Band membership, progress) is rebuilt by replaying it.
import type { MediaType } from '../anilist/types.ts'

export const LOG_FORMAT_VERSION = 1
export const ENGINE_VERSION = 1

/** Band index: 0 = Loved (top) … 4 = Hated (bottom). There are always five Bands. */
export type BandIndex = 0 | 1 | 2 | 3 | 4
export const BANDS: readonly BandIndex[] = [0, 1, 2, 3, 4]

export type LogHeader = {
  format: number
  engine: number
  seed: number
  userId: number
  mediaType: MediaType
}

export type LogEvent =
  | { type: 'titles-added'; ids: number[] }
  | { type: 'band-assigned'; id: number; band: BandIndex }
  | { type: 'forgotten'; id: number }
  | { type: 'undo' }

export type DuelLog = { header: LogHeader; events: LogEvent[] }

export type Prompt = { kind: 'rough-sort'; id: number } | { kind: 'rough-sort-done' }

export type BandState = {
  /** Every title in the Band, in the order it joined. */
  titles: readonly number[]
}

export type RankingState = {
  prompt: Prompt
  bands: readonly BandState[]
  /** Forgotten titles, in the order they were marked. */
  forgotten: readonly number[]
  progress: { roughSort: { done: number; total: number } }
  /** Whether an Undo appended now would cancel anything. */
  canUndo: boolean
}

/** The log can't be replayed: unknown version, or an event that doesn't fit the state it lands on. */
export class ReplayError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReplayError'
  }
}

/** A new log for a first Pool load: the header plus one `titles-added` event in Rough Sort order. */
export function startLog(options: { seed: number; userId: number; mediaType: MediaType; ids: readonly number[] }): DuelLog {
  const { seed, userId, mediaType, ids } = options
  return {
    header: { format: LOG_FORMAT_VERSION, engine: ENGINE_VERSION, seed, userId, mediaType },
    events: [{ type: 'titles-added', ids: [...ids] }],
  }
}

type Machine = {
  roughSortQueue: number[]
  bands: number[][]
  forgotten: number[]
  /** Every title currently in the log's Pool (Rough Sort queue, a Band, or Forgotten). */
  present: Set<number>
  total: number
}

/** Takes a title out of wherever it is (Rough Sort queue or a Band). Every other title keeps its order. */
function takeOut(m: Machine, id: number): void {
  for (const list of [m.roughSortQueue, ...m.bands]) {
    const at = list.indexOf(id)
    if (at >= 0) list.splice(at, 1)
  }
}

/**
 * How Undo treats each event (ADR 0005): user events can be cancelled; system (sync) events are a barrier
 * that Undo never reaches past. Later kinds: `band-selected` is 'navigation' (skipped over).
 */
function undoRole(event: Exclude<LogEvent, { type: 'undo' }>): 'user' | 'barrier' {
  switch (event.type) {
    case 'titles-added':
      return 'barrier'
    case 'band-assigned':
    case 'forgotten':
      return 'user'
  }
}

/** Resolves every Undo: returns the events that still count, in log order, and whether one more Undo would act. */
function resolveUndo(events: readonly LogEvent[]): { effective: Exclude<LogEvent, { type: 'undo' }>[]; canUndo: boolean } {
  const cancelled = new Set<number>()
  let undoable: number[] = []
  events.forEach((event, i) => {
    if (event.type === 'undo') {
      const target = undoable.pop()
      if (target !== undefined) cancelled.add(target)
      return
    }
    if (undoRole(event) === 'barrier') undoable = []
    else undoable.push(i)
  })
  const effective = events.filter(
    (event, i): event is Exclude<LogEvent, { type: 'undo' }> => event.type !== 'undo' && !cancelled.has(i),
  )
  return { effective, canUndo: undoable.length > 0 }
}

function apply(m: Machine, event: Exclude<LogEvent, { type: 'undo' }>): void {
  switch (event.type) {
    case 'titles-added':
      for (const id of event.ids) {
        if (m.present.has(id)) throw new ReplayError(`Title ${id} was added twice`)
        m.present.add(id)
      }
      m.roughSortQueue.push(...event.ids)
      m.total += event.ids.length
      return
    case 'band-assigned':
      if (m.roughSortQueue[0] !== event.id) {
        throw new ReplayError(`Band assigned to title ${event.id}, but Rough Sort prompts ${m.roughSortQueue[0] ?? 'nothing'}`)
      }
      takeOut(m, event.id)
      m.bands[event.band].push(event.id)
      return
    case 'forgotten':
      if (!m.present.has(event.id) || m.forgotten.includes(event.id)) {
        throw new ReplayError(`Title ${event.id} can't be marked Forgotten: it is not in the Ranking or Rough Sort`)
      }
      takeOut(m, event.id)
      m.forgotten.push(event.id)
      return
  }
}

/** Rebuilds the derived state from the log. Throws ReplayError if the log can't be trusted. */
export function replay(log: DuelLog): RankingState {
  const { format, engine } = log.header
  if (format !== LOG_FORMAT_VERSION) throw new ReplayError(`Unknown log format version ${format}`)
  if (engine !== ENGINE_VERSION) throw new ReplayError(`Unknown engine version ${engine}`)
  const m: Machine = { roughSortQueue: [], bands: BANDS.map(() => []), forgotten: [], present: new Set(), total: 0 }
  const { effective, canUndo } = resolveUndo(log.events)
  for (const event of effective) apply(m, event)
  const next = m.roughSortQueue[0]
  return {
    prompt: next === undefined ? { kind: 'rough-sort-done' } : { kind: 'rough-sort', id: next },
    bands: m.bands.map((titles) => ({ titles })),
    forgotten: m.forgotten,
    progress: { roughSort: { done: m.total - m.roughSortQueue.length, total: m.total } },
    canUndo,
  }
}
