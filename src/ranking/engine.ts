// Ranking Engine (ADR 0001, ADR 0005): pure, no I/O. The Duel log is the source of truth;
// every derived thing (next prompt, the Ranking, progress) is rebuilt by replaying it.
import type { MediaType } from '../anilist/types.ts'

export const LOG_FORMAT_VERSION = 1
/**
 * 2 added `band-split` and `sub` on `band-assigned` (ADR 0006). Version 2 replays every version 1 log exactly as
 * version 1 did, so both are accepted; a version 1 log may not contain version 2 events. `appendEvent` stamps
 * the current version on the header, so an older app refuses a log it would replay differently (ADR 0005).
 */
export const ENGINE_VERSION = 2
const KNOWN_ENGINE_VERSIONS: readonly number[] = [1, 2]

/** Band index: 0 = Loved (top) … 4 = Hated (bottom). There are always five Bands. */
export type BandIndex = 0 | 1 | 2 | 3 | 4
export const BANDS: readonly BandIndex[] = [0, 1, 2, 3, 4]

/** Sub-band index inside a split Band (ADR 0006): 0 = Best, 1 = Middle, 2 = Lowest. */
export type SubBandIndex = 0 | 1 | 2
export const SUB_BANDS: readonly SubBandIndex[] = [0, 1, 2]

export type LogHeader = {
  format: number
  engine: number
  seed: number
  userId: number
  mediaType: MediaType
}

export type DuelResult = 'a' | 'b' | 'tie'

export type LogEvent =
  | { type: 'titles-added'; ids: number[] }
  /** `sub` is required when the Band is split (the second tap in Rough Sort) and refused when it isn't. */
  | { type: 'band-assigned'; id: number; band: BandIndex; sub?: SubBandIndex }
  /** A Duel answer, by id (ADR 0005): `result` names the better title, or 'tie' for "about the same". */
  | { type: 'duel-answered'; a: number; b: number; result: DuelResult }
  | { type: 'forgotten'; id: number }
  /**
   * The whole split of one Band into three Sub-bands, as one user event (ADR 0006). Engine version 2+.
   * `cuts` are Tier indexes into the Band's Ranking at that moment: Best = Tiers [0, cuts[0]), Middle =
   * [cuts[0], cuts[1]), Lowest = [cuts[1], end). A cut is a Tier index, so it always falls on a Tier edge.
   * `unplaced` lists, per Sub-band, the titles without a place yet. Together they must be exactly the Band's
   * insertion queue; inside a Sub-band they keep the order they had in that queue.
   */
  | { type: 'band-split'; band: BandIndex; cuts: [number, number]; unplaced: [number[], number[], number[]] }
  | { type: 'undo' }

export type DuelLog = { header: LogHeader; events: LogEvent[] }

export type Prompt =
  | { kind: 'rough-sort'; id: number }
  | {
      kind: 'duel'
      band: BandIndex
      /** Only present when the Band is split: the Sub-band this Duel is in. */
      sub?: SubBandIndex
      /** The title being inserted. */
      a: number
      /** Its opponent: the pivot Tier's first-inserted member that is still present. */
      b: number
      /** Display only (ADR 0005): `hash(seed, min, max)` decides which card is on the left. */
      left: number
      right: number
      /**
       * Where the insertion stands, as Tier indexes into `bands[band].tiers` (the whole Band, also when it is
       * split): the title belongs somewhere in lo..hi (between Tier lo-1 and Tier hi), and `pivot` is the Tier
       * it is compared with now.
       */
      bounds: { lo: number; hi: number; pivot: number }
    }
  | { kind: 'all-complete' }

export type SubBandState = {
  /** The Ranking inside this Sub-band: Tiers best first. */
  tiers: readonly (readonly number[])[]
  /** Titles in this Sub-band without a place yet, in insertion order (the first is in progress). */
  unplaced: readonly number[]
}

export type BandState = {
  /**
   * The Ranking inside this Band: Tiers best first, each Tier's titles in the order they joined it.
   * For a split Band these are its Sub-bands' Tiers one after another (Best, Middle, Lowest), so it is still
   * the whole Band's order.
   */
  tiers: readonly (readonly number[])[]
  /** Titles in this Band without a place yet, in the order they will be inserted (the first is in progress). */
  unplaced: readonly number[]
  /** Only present once the Band is split (ADR 0006): Best, Middle, Lowest. */
  subBands?: readonly [SubBandState, SubBandState, SubBandState]
}

export type Progress = { done: number; total: number }

export type RankingState = {
  prompt: Prompt
  bands: readonly BandState[]
  /** Forgotten titles, in the order they were marked. */
  forgotten: readonly number[]
  progress: {
    roughSort: Progress
    /** Per Band: titles with a place in the Ranking / titles in the Band. */
    bands: readonly Progress[]
    /** Over every Band. */
    ranked: Progress
  }
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

/**
 * Appends one event and stamps the current engine version on the header. This engine replays every older log
 * the same way, so the upgrade is safe, and it stops an older app from silently ignoring events it doesn't know.
 */
export function appendEvent(log: DuelLog, event: LogEvent): DuelLog {
  return { header: { ...log.header, engine: ENGINE_VERSION }, events: [...log.events, event] }
}

/** Titles the user considers equal. Members in the order they joined; the first is the Tier's face on a card. */
type Tier = { members: number[] }

/**
 * A title waiting for, or in the middle of, its binary insertion. Bounds are Tiers (by identity), so they
 * survive other titles being taken out: `above` is the Tier it is known to be worse than, `below` the Tier
 * it is known to be better than (null = the edge of the Segment).
 */
type Insertion = { id: number; above: Tier | null; below: Tier | null }

/**
 * A fixed boundary in the Ranking that Duels never cross: a Band, or a Sub-band of a split Band (ADR 0006).
 * It holds its own ordered Tiers and its own insertion queue (the front one is in progress).
 */
type Segment = { tiers: Tier[]; queue: Insertion[] }

type Machine = {
  /** The log header's engine version: version 2 events are refused in a version 1 log. */
  engine: number
  roughSortQueue: number[]
  /** Per Band: one Segment, or three (Best, Middle, Lowest) once it is split. */
  bands: Segment[][]
  forgotten: number[]
  /** Every title currently in the log's Pool (Rough Sort queue, a Band, or Forgotten). */
  present: Set<number>
  total: number
}

/** The open interval of Tier indexes an insertion may still land in: between Tier lo-1 and Tier hi. */
function interval(segment: Segment, insertion: Insertion): { lo: number; hi: number } {
  const lo = insertion.above ? segment.tiers.indexOf(insertion.above) + 1 : 0
  const hi = insertion.below ? segment.tiers.indexOf(insertion.below) : segment.tiers.length
  return { lo, hi }
}

/** Places every front insertion that needs no more Duels (an empty interval), in queue order. */
function settle(segment: Segment): void {
  for (let front = segment.queue[0]; front; front = segment.queue[0]) {
    const { lo, hi } = interval(segment, front)
    if (lo < hi) return
    segment.queue.shift()
    segment.tiers.splice(lo, 0, { members: [front.id] })
  }
}

/** Takes a title out of wherever it is (Rough Sort queue, an insertion queue, or a Tier). Every other title keeps its order. */
function takeOut(m: Machine, id: number): void {
  const at = m.roughSortQueue.indexOf(id)
  if (at >= 0) m.roughSortQueue.splice(at, 1)
  for (const segment of m.bands.flat()) {
    const queued = segment.queue.findIndex((insertion) => insertion.id === id)
    if (queued >= 0) segment.queue.splice(queued, 1)
    const t = segment.tiers.findIndex((tier) => tier.members.includes(id))
    if (t < 0) continue
    const tier = segment.tiers[t]
    tier.members.splice(tier.members.indexOf(id), 1)
    if (tier.members.length === 0) removeTier(segment, t)
  }
}

/** An emptied Tier disappears. A bound on it moves one Tier further out, which is still true by transitivity. */
function removeTier(segment: Segment, t: number): void {
  const tier = segment.tiers[t]
  for (const insertion of segment.queue) {
    if (insertion.above === tier) insertion.above = segment.tiers[t - 1] ?? null
    if (insertion.below === tier) insertion.below = segment.tiers[t + 1] ?? null
  }
  segment.tiers.splice(t, 1)
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
    case 'duel-answered':
    case 'forgotten':
    case 'band-split':
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

function apply(m: Machine, seed: number, event: Exclude<LogEvent, { type: 'undo' }>): void {
  switch (event.type) {
    case 'titles-added':
      for (const id of event.ids) {
        if (m.present.has(id)) throw new ReplayError(`Title ${id} was added twice`)
        m.present.add(id)
      }
      m.roughSortQueue.push(...event.ids)
      m.total += event.ids.length
      return
    case 'band-assigned': {
      if (m.roughSortQueue[0] !== event.id) {
        throw new ReplayError(`Band assigned to title ${event.id}, but Rough Sort prompts ${m.roughSortQueue[0] ?? 'nothing'}`)
      }
      const segment = destination(m, event.band, event.sub)
      takeOut(m, event.id)
      segment.queue.push({ id: event.id, above: null, below: null })
      return
    }
    case 'duel-answered': {
      const prompt = nextPrompt(m, seed)
      const samePair =
        prompt.kind === 'duel' &&
        ((event.a === prompt.a && event.b === prompt.b) || (event.a === prompt.b && event.b === prompt.a))
      const at = current(m)
      if (!samePair || !at) {
        const expected = prompt.kind === 'duel' ? `${prompt.a} vs ${prompt.b}` : prompt.kind
        throw new ReplayError(`Duel answer for ${event.a} vs ${event.b}, but the engine prompts ${expected}`)
      }
      const { segment, insertion } = at
      const pivot = segment.tiers[at.pivot]
      if (event.result === 'tie') {
        segment.queue.shift()
        pivot.members.push(insertion.id)
        return
      }
      const winner = event.result === 'a' ? event.a : event.b
      if (winner === insertion.id) insertion.below = pivot
      else insertion.above = pivot
      return
    }
    case 'forgotten':
      if (!m.present.has(event.id) || m.forgotten.includes(event.id)) {
        throw new ReplayError(`Title ${event.id} can't be marked Forgotten: it is not in the Ranking or Rough Sort`)
      }
      takeOut(m, event.id)
      m.forgotten.push(event.id)
      return
    case 'band-split':
      splitBand(m, event)
      return
  }
}

function requireEngine2(m: Machine, what: string): void {
  if (m.engine < 2) throw new ReplayError(`${what} needs engine version 2, but the log says ${m.engine}`)
}

/** The Segment a title goes to in a Band: the Band itself, or the chosen Sub-band of a split Band. */
function destination(m: Machine, band: BandIndex, sub: SubBandIndex | undefined): Segment {
  const segments = m.bands[band]
  if (sub !== undefined) requireEngine2(m, 'A Sub-band target')
  if (segments.length === 1) {
    if (sub !== undefined) throw new ReplayError(`Band ${band} is not split, so it has no Sub-band ${sub}`)
    return segments[0]
  }
  const segment = sub === undefined ? undefined : segments[sub]
  if (!segment) throw new ReplayError(`Band ${band} is split: a Sub-band must be chosen`)
  return segment
}

/**
 * Splits one Band into Best / Middle / Lowest (ADR 0006). Ranked titles are cut by their existing order; each
 * unplaced title goes where the event says, keeping its old queue order. An insertion in progress keeps the
 * bounds that fall inside its new Sub-band and drops the rest (that edge becomes the Sub-band's edge).
 */
function splitBand(m: Machine, event: Extract<LogEvent, { type: 'band-split' }>): void {
  requireEngine2(m, 'Band split')
  const segments = m.bands[event.band]
  if (segments.length !== 1) throw new ReplayError(`Band ${event.band} is already split`)
  const [whole] = segments
  const [c1, c2] = event.cuts
  const isCut = (c: number) => Number.isInteger(c) && c >= 0 && c <= whole.tiers.length
  if (!isCut(c1) || !isCut(c2) || c1 > c2) {
    throw new ReplayError(`Band split cut points ${c1}, ${c2} don't fit a Band of ${whole.tiers.length} Tiers`)
  }
  const subOf = new Map<number, SubBandIndex>()
  for (const sub of SUB_BANDS) for (const id of event.unplaced[sub]) subOf.set(id, sub)
  const listed = event.unplaced.reduce((sum, ids) => sum + ids.length, 0)
  if (listed !== whole.queue.length || subOf.size !== listed || whole.queue.some((q) => !subOf.has(q.id))) {
    throw new ReplayError(`Band split must list exactly the titles without a place in Band ${event.band}`)
  }
  const parts: Segment[] = [
    { tiers: whole.tiers.slice(0, c1), queue: [] },
    { tiers: whole.tiers.slice(c1, c2), queue: [] },
    { tiers: whole.tiers.slice(c2), queue: [] },
  ]
  for (const insertion of whole.queue) {
    const part = parts[subOf.get(insertion.id) ?? 1]
    const keep = (bound: Tier | null) => (bound && part.tiers.includes(bound) ? bound : null)
    part.queue.push({ id: insertion.id, above: keep(insertion.above), below: keep(insertion.below) })
  }
  m.bands[event.band] = parts
}

/** `hash(seed, min, max)` for left/right placement (display only). 32-bit FNV-1a over the three words, then a final mix. */
function sideHash(seed: number, low: number, high: number): number {
  let h = 0x811c9dc5
  for (const word of [seed, low, high]) {
    for (let shift = 0; shift < 32; shift += 8) {
      h ^= (word >>> shift) & 0xff
      h = Math.imul(h, 0x01000193)
    }
  }
  h ^= h >>> 16
  h = Math.imul(h, 0x45d9f3b)
  h ^= h >>> 16
  return h >>> 0
}

/**
 * The insertion Duels work on now: Band by Band from the top, and inside a split Band Best → Middle → Lowest.
 * lo / hi / pivot are Tier indexes inside its Segment; `offset` is how many of the Band's Tiers come before it.
 */
function current(m: Machine) {
  for (const band of BANDS) {
    const segments = m.bands[band]
    let offset = 0
    for (const [s, segment] of segments.entries()) {
      const insertion = segment.queue[0]
      if (insertion) {
        const { lo, hi } = interval(segment, insertion)
        const sub = segments.length > 1 ? (s as SubBandIndex) : undefined
        return { band, sub, segment, insertion, lo, hi, pivot: Math.floor((lo + hi) / 2), offset }
      }
      offset += segment.tiers.length
    }
  }
  return null
}

/** The next prompt: Rough Sort first, then Duels Band by Band from the top. */
function nextPrompt(m: Machine, seed: number): Prompt {
  const roughSort = m.roughSortQueue[0]
  if (roughSort !== undefined) return { kind: 'rough-sort', id: roughSort }
  const at = current(m)
  if (!at) return { kind: 'all-complete' }
  const { band, sub, segment, insertion, lo, hi, pivot, offset } = at
  const b = segment.tiers[pivot].members[0]
  const low = Math.min(insertion.id, b)
  const high = Math.max(insertion.id, b)
  const [left, right] = sideHash(seed, low, high) & 1 ? [high, low] : [low, high]
  const bounds = { lo: lo + offset, hi: hi + offset, pivot: pivot + offset }
  return { kind: 'duel', band, ...(sub === undefined ? {} : { sub }), a: insertion.id, b, left, right, bounds }
}

/** Rebuilds the derived state from the log. Throws ReplayError if the log can't be trusted. */
export function replay(log: DuelLog): RankingState {
  const { format, engine, seed } = log.header
  if (format !== LOG_FORMAT_VERSION) throw new ReplayError(`Unknown log format version ${format}`)
  if (!KNOWN_ENGINE_VERSIONS.includes(engine)) throw new ReplayError(`Unknown engine version ${engine}`)
  const m: Machine = {
    engine,
    roughSortQueue: [],
    bands: BANDS.map(() => [{ tiers: [], queue: [] }]),
    forgotten: [],
    present: new Set(),
    total: 0,
  }
  const { effective, canUndo } = resolveUndo(log.events)
  for (const event of effective) {
    apply(m, seed, event)
    m.bands.flat().forEach(settle)
  }
  const bands = m.bands.map((segments): BandState => {
    const parts = segments.map((segment) => ({
      tiers: segment.tiers.map((tier) => [...tier.members]),
      unplaced: segment.queue.map((insertion) => insertion.id),
    }))
    const whole = { tiers: parts.flatMap((p) => p.tiers), unplaced: parts.flatMap((p) => p.unplaced) }
    return parts.length === 3 ? { ...whole, subBands: [parts[0], parts[1], parts[2]] } : whole
  })
  const bandProgress = bands.map((band) => {
    const done = band.tiers.reduce((sum, tier) => sum + tier.length, 0)
    return { done, total: done + band.unplaced.length }
  })
  return {
    prompt: nextPrompt(m, seed),
    bands,
    forgotten: m.forgotten,
    progress: {
      roughSort: { done: m.total - m.roughSortQueue.length, total: m.total },
      bands: bandProgress,
      ranked: {
        done: bandProgress.reduce((sum, p) => sum + p.done, 0),
        total: bandProgress.reduce((sum, p) => sum + p.total, 0),
      },
    },
    canUndo,
  }
}
