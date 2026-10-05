// Ranking Engine (ADR 0001, ADR 0005): pure, no I/O. The Duel log is the source of truth;
// every derived thing (next prompt, the Ranking, progress) is rebuilt by replaying it.
import type { MediaType } from '../anilist/types.ts'

export const LOG_FORMAT_VERSION = 1
/**
 * 2 added `band-split` and `sub` on `band-assigned` (ADR 0006). Version 2 replays every version 1 log exactly as
 * version 1 did, so both are accepted; a version 1 log may not contain version 2 events. `appendEvent` stamps
 * the current version on the header, so an older app refuses a log it would replay differently (ADR 0005).
 * 3 added `band-selected`; it replays every version 1 and 2 log exactly as before.
 * 5 added `band-moved`, `rerank-requested` and `unforgotten`; it replays every older log exactly as before.
 */
export const ENGINE_VERSION = 5
const KNOWN_ENGINE_VERSIONS: readonly number[] = [1, 2, 3, 4, 5]

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
  /**
   * Navigation (ADR 0005): Duels go on in this Band until it has no title left to place. Engine version 3+.
   * Ignored while Rough Sort isn't done or when the Band has nothing to place. Undo skips over it.
   */
  | { type: 'band-selected'; band: BandIndex }
  /**
   * Fixing the Ranking (ADR 0005), engine version 4+. `band-moved` takes a title out of its Band (or Sub-band) and
   * puts it at the front of another one's insertion queue; `sub` follows the `band-assigned` rule (required for a
   * split Band, refused otherwise). It may name another Sub-band of the same Band.
   */
  | { type: 'band-moved'; id: number; band: BandIndex; sub?: SubBandIndex }
  /** Takes a title out of its place and puts it at the front of its own (Sub-)band's insertion queue. */
  | { type: 'rerank-requested'; id: number }
  /**
   * Brings a Forgotten title back: to the front of the (Sub-)band it was last in, or to the front of the Rough Sort
   * queue if it never had one, or if its Band was split since (so the second tap asks for the Sub-band).
   */
  | { type: 'unforgotten'; id: number }
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
  /**
   * A Band choice is due: Rough Sort is done, some Band still has titles to place, and no Band is being worked
   * on (right after Rough Sort, or because the chosen Band just finished). `finished` is the Band that just
   * finished (null right after Rough Sort); `next` is the default, the top Band with titles to place, which is
   * also the Band the Duel prompt is in until a `band-selected` picks another.
   */
  bandChoice: { finished: BandIndex | null; next: BandIndex } | null
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
  /** Every Segment of every Band, top to bottom (`bands` flattened; rebuilt when a Band is split). */
  segments: Segment[]
  forgotten: number[]
  /** Every title currently in the log's Pool (Rough Sort queue, a Band, or Forgotten). */
  present: Set<number>
  total: number
  /** The Band Duels are worked on in (chosen, or the one a Duel was answered in); null while a choice is due. */
  focus: BandIndex | null
  /** The Band whose last title was just placed while it had the focus; null right after Rough Sort. */
  finished: BandIndex | null
  /** The (Sub-)band each title in a Band is in, kept after it is Forgotten so Unforgotten can send it back. */
  lastPlace: Map<number, Place>
  /**
   * A title sent to the front of a queue by a fix (move, Re-rank, Unforgotten) is placed straight away; then Duels
   * go back to where they were (`resume`). Null when no fix is being placed.
   */
  detour: { id: number; band: BandIndex; sub?: SubBandIndex; resume: Resume } | null
  /** Unforgotten titles waiting in Rough Sort (no usable last Sub-band): the detour starts once they are sorted. */
  returning: Map<number, Resume>
}

type Place = { band: BandIndex; sub?: SubBandIndex }
type Resume = { focus: BandIndex | null; finished: BandIndex | null }

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
  for (const segment of m.segments) {
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
 * that Undo never reaches past; navigation (`band-selected`) is skipped over, neither a step nor a barrier.
 */
function undoRole(event: Exclude<LogEvent, { type: 'undo' }>): 'user' | 'barrier' | 'navigation' {
  switch (event.type) {
    case 'titles-added':
      return 'barrier'
    case 'band-selected':
      return 'navigation'
    case 'band-assigned':
    case 'duel-answered':
    case 'forgotten':
    case 'band-split':
    case 'band-moved':
    case 'rerank-requested':
    case 'unforgotten':
      return 'user'
  }
}

/**
 * Resolves every Undo: returns the events that still count, in log order, and whether one more Undo would act.
 * Navigation after the cancelled event goes with it: it was chosen from a state that no longer exists, and this
 * way Undo returns to the prompt the cancelled answer was given at (e.g. the last Duel of a finished Band).
 */
function resolveUndo(events: readonly LogEvent[]): { effective: Exclude<LogEvent, { type: 'undo' }>[]; canUndo: boolean } {
  const cancelled = new Set<number>()
  let undoable: number[] = []
  let navigation: number[] = []
  events.forEach((event, i) => {
    if (event.type === 'undo') {
      const target = undoable.pop()
      if (target === undefined) return
      cancelled.add(target)
      for (const n of navigation) if (n > target) cancelled.add(n)
      navigation = navigation.filter((n) => n < target)
      return
    }
    const role = undoRole(event)
    if (role === 'barrier') {
      undoable = []
      navigation = []
    } else if (role === 'navigation') navigation.push(i)
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
      const place = placeAt(event.band, event.sub)
      m.lastPlace.set(event.id, place)
      const resume = m.returning.get(event.id)
      if (!resume) {
        segment.queue.push({ id: event.id, above: null, below: null })
        return
      }
      // A title brought back through Rough Sort is placed next, like any other fix.
      m.returning.delete(event.id)
      segment.queue.unshift({ id: event.id, above: null, below: null })
      if (m.roughSortQueue.length === 0) startDetour(m, event.id, place, resume)
      return
    }
    case 'duel-answered': {
      const at = m.roughSortQueue.length === 0 ? current(m) : null
      const pivot = at?.segment.tiers[at.pivot]
      const a = at?.insertion.id
      const b = pivot?.members[0]
      if (!at || !pivot || !((event.a === a && event.b === b) || (event.a === b && event.b === a))) {
        const prompt = nextPrompt(m, seed)
        const expected = prompt.kind === 'duel' ? `${prompt.a} vs ${prompt.b}` : prompt.kind
        throw new ReplayError(`Duel answer for ${event.a} vs ${event.b}, but the engine prompts ${expected}`)
      }
      const { segment, insertion } = at
      m.focus = at.band
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
    case 'band-selected':
      requireEngine(m, 3, 'Band selected')
      if (!BANDS.includes(event.band)) throw new ReplayError(`There is no Band ${String(event.band)}`)
      if (m.roughSortQueue.length === 0 && hasWork(m.bands[event.band])) {
        m.focus = event.band
        m.finished = null
        m.detour = null
      }
      return
    case 'band-moved': {
      requireEngine(m, 5, 'Band moved')
      if (!placeOf(m, event.id)) throw new ReplayError(`Title ${event.id} can't be moved: it is not in a Band`)
      sendToFront(m, event.id, placeAt(event.band, event.sub))
      return
    }
    case 'rerank-requested': {
      requireEngine(m, 5, 'Re-rank requested')
      const place = placeOf(m, event.id)
      if (!place) throw new ReplayError(`Title ${event.id} can't be re-ranked: it is not in a Band`)
      sendToFront(m, event.id, place)
      return
    }
    case 'unforgotten': {
      requireEngine(m, 5, 'Unforgotten')
      const at = m.forgotten.indexOf(event.id)
      if (at < 0) throw new ReplayError(`Title ${event.id} can't be brought back: it is not Forgotten`)
      m.forgotten.splice(at, 1)
      const last = m.lastPlace.get(event.id)
      // Its last Sub-band only counts if the Band is still split the same way (a Band split since needs a second tap).
      if (last && (last.sub === undefined) === (m.bands[last.band].length === 1)) {
        sendToFront(m, event.id, last)
        return
      }
      m.roughSortQueue.unshift(event.id)
      m.returning.set(event.id, m.detour?.resume ?? { focus: m.focus, finished: m.finished })
      return
    }
  }
}

function placeAt(band: BandIndex, sub: SubBandIndex | undefined): Place {
  return sub === undefined ? { band } : { band, sub }
}

/** The Band (and Sub-band) a title is in, ranked or waiting in its insertion queue; null if it is in none. */
function placeOf(m: Machine, id: number): Place | null {
  for (const band of BANDS) {
    const segments = m.bands[band]
    for (let s = 0; s < segments.length; s++) {
      const segment = segments[s]
      if (segment.queue.some((q) => q.id === id) || segment.tiers.some((tier) => tier.members.includes(id))) {
        return placeAt(band, segments.length > 1 ? (s as SubBandIndex) : undefined)
      }
    }
  }
  return null
}

/** Band moved / Re-rank / Unforgotten (ADR 0005): out of its place, to the front of `place`'s queue, placed next. */
function sendToFront(m: Machine, id: number, place: Place): void {
  const segment = destination(m, place.band, place.sub)
  takeOut(m, id)
  segment.queue.unshift({ id, above: null, below: null })
  m.lastPlace.set(id, place)
  startDetour(m, id, place, m.detour?.resume ?? { focus: m.focus, finished: m.finished })
}

function startDetour(m: Machine, id: number, place: Place, resume: Resume): void {
  m.detour = { id, ...place, resume }
  m.focus = place.band
  m.finished = null
}

/** The Segment the detour title waits at the front of, or null once it is placed (or gone). */
function detourSegment(m: Machine): Segment | null {
  const d = m.detour
  if (!d) return null
  const segments = m.bands[d.band]
  if ((d.sub === undefined) !== (segments.length === 1)) return null
  const segment = segments[d.sub ?? 0]
  return segment.queue[0]?.id === d.id ? segment : null
}

function hasWork(segments: readonly Segment[]): boolean {
  return segments.some((segment) => segment.queue.length > 0)
}

/**
 * Runs after every event: Duels never start while a title waits in Rough Sort, so a pending Rough Sort drops the
 * focus; a focused Band with nothing left to place is finished, so a Band choice is due.
 */
function refocus(m: Machine): void {
  if (m.detour && !detourSegment(m)) {
    m.focus = m.detour.resume.focus
    m.finished = m.detour.resume.finished
    m.detour = null
  }
  if (m.roughSortQueue.length > 0) {
    m.focus = null
    m.finished = null
    m.detour = null
  } else if (m.focus !== null && !hasWork(m.bands[m.focus])) {
    m.finished = m.focus
    m.focus = null
  }
}

function requireEngine(m: Machine, version: number, what: string): void {
  if (m.engine < version) throw new ReplayError(`${what} needs engine version ${version}, but the log says ${m.engine}`)
}

/** The Segment a title goes to in a Band: the Band itself, or the chosen Sub-band of a split Band. */
function destination(m: Machine, band: BandIndex, sub: SubBandIndex | undefined): Segment {
  const segments = m.bands[band]
  if (sub !== undefined) requireEngine(m, 2, 'A Sub-band target')
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
  requireEngine(m, 2, 'Band split')
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
  m.segments = m.bands.flat()
  parts.forEach((part, sub) => {
    const place = placeAt(event.band, sub as SubBandIndex)
    for (const tier of part.tiers) for (const id of tier.members) m.lastPlace.set(id, place)
    for (const insertion of part.queue) m.lastPlace.set(insertion.id, place)
  })
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
 * The insertion Duels work on now: in the focused Band if there is one, else Band by Band from the top; inside a
 * split Band Best → Middle → Lowest (so a chosen split Band starts at its first Sub-band with titles to place).
 * lo / hi / pivot are Tier indexes inside its Segment; `offset` is how many of the Band's Tiers come before it.
 */
function current(m: Machine) {
  const detour = detourSegment(m)
  const bands = m.detour && detour ? [m.detour.band] : m.focus === null ? BANDS : [m.focus]
  for (const band of bands) {
    const segments = m.bands[band]
    let offset = 0
    for (let s = 0; s < segments.length; s++) {
      const segment = segments[s]
      const insertion = segment.queue[0]
      if (insertion && (!detour || segment === detour)) {
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
  const bandSegments: Segment[][] = BANDS.map(() => [{ tiers: [], queue: [] }])
  const m: Machine = {
    engine,
    roughSortQueue: [],
    bands: bandSegments,
    segments: bandSegments.flat(),
    forgotten: [],
    present: new Set(),
    total: 0,
    focus: null,
    finished: null,
    lastPlace: new Map(),
    detour: null,
    returning: new Map(),
  }
  const { effective, canUndo } = resolveUndo(log.events)
  for (const event of effective) {
    apply(m, seed, event)
    m.segments.forEach(settle)
    refocus(m)
  }
  const bands = m.bands.map((segments): BandState => {
    const parts = segments.map((segment) => ({
      tiers: segment.tiers.map((tier) => [...tier.members]),
      unplaced: segment.queue.map((insertion) => insertion.id),
    }))
    const whole = { tiers: parts.flatMap((p) => p.tiers), unplaced: parts.flatMap((p) => p.unplaced) }
    return parts.length === 3 ? { ...whole, subBands: [parts[0], parts[1], parts[2]] } : whole
  })
  const at = m.roughSortQueue.length === 0 && m.focus === null ? current(m) : null
  const bandChoice = at ? { finished: m.finished, next: at.band } : null
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
    bandChoice,
    canUndo,
  }
}
