// Score New Titles (ADR 0009) inside the Ranking Engine: where each new title stands against the Anchor score
// levels, which Anchor it meets next, and what an answer tells. Pure; the engine owns one `NewTitles` per replay
// and calls in here for every event under this Sort Goal.
//
// A title's place is searched over 2k+1 positions for k Anchor levels (best first): position 2m+1 is level m itself
// ("about the same" as an Anchor on it), and position 2g is the gap above level g (gap 0 is above every Anchor, gap
// k below every one). A title knows the positions lo..hi it can still be at; it is settled once lo = hi.
import type { ScoreFormat } from '../anilist/types.ts'
import { sideHash } from './hash.ts'
import { levels as levelsOf } from './scoring.ts'

/** One Anchor in the snapshot (ADR 0009): its id and its score as a level of the snapshot's Score Format. */
export type AnchorScore = { id: number; level: number }

/** An Anchor score level and the Anchors on it, by id ascending. */
export type AnchorLevel = { level: number; anchors: readonly number[] }

/** A new title's standing: the levels it can still get, best first. Settled = exactly one level is left. */
export type NewTitle = { id: number; settled: boolean; levels: readonly number[] }

/** What replay shows of a Score New Titles Ranking. */
export type NewTitlesState = {
  /** The Score Format the Anchor snapshot was taken in: every level here is one of its levels. */
  format: ScoreFormat
  /** The Anchor score levels, best first. */
  levels: readonly AnchorLevel[]
  /** Every new title in the Ranking (Forgotten ones are not), in the order Duels work on them. */
  titles: readonly NewTitle[]
}

/** A new title being placed: the positions lo..hi it can still be at. */
type Placement = { id: number; lo: number; hi: number }

export type NewTitles = {
  format: ScoreFormat
  levels: AnchorLevel[]
  anchorIds: ReadonlySet<number>
  /** Anchors no longer used as a reference (Forgotten): never chosen for a Duel, their levels and scores unchanged. */
  excluded: Set<number>
  seed: number
  /** Every new title, in the order they joined (Unforgotten ones at the front). */
  queue: Placement[]
}

/** The next Duel: new title `a` against Anchor `b`, at Anchor level index `level`. */
export type AnchorDuel = { a: number; b: number; level: number }

/**
 * Builds the search from the Anchor snapshot, or returns why the snapshot can't be used. Anchors are grouped by
 * score, best first; inside a level they are kept by id, so the choice of Anchor never depends on snapshot order.
 */
export function startNewTitles(format: ScoreFormat, anchors: readonly AnchorScore[], seed: number): NewTitles | string {
  if (!Array.isArray(anchors) || anchors.length === 0) return 'The Anchor snapshot must list at least one Anchor'
  const valid = new Set(levelsOf(format))
  const byLevel = new Map<number, number[]>()
  const ids = new Set<number>()
  for (const { id, level } of anchors) {
    if (ids.has(id)) return `Anchor ${id} is listed twice`
    if (!valid.has(level)) return `Anchor ${id} has score ${String(level)}, which is not a level of ${format}`
    ids.add(id)
    byLevel.set(level, [...(byLevel.get(level) ?? []), id])
  }
  const levels = [...byLevel]
    .sort((x, y) => y[0] - x[0])
    .map(([level, members]) => ({ level, anchors: members.sort((x, y) => x - y) }))
  return { format, levels, anchorIds: ids, excluded: new Set(), seed, queue: [] }
}

/** New titles join at the back, knowing nothing yet. */
export function addNewTitles(state: NewTitles, ids: readonly number[]): void {
  for (const id of ids) state.queue.push(fresh(state, id))
}

/** An Unforgotten title starts its search again, at the front. */
export function returnNewTitle(state: NewTitles, id: number): void {
  state.queue.unshift(fresh(state, id))
}

function fresh(state: NewTitles, id: number): Placement {
  return { id, lo: 0, hi: 2 * state.levels.length }
}

/** Takes a title out (Forgotten, or it left the Pool). Every other title keeps what it knows. */
export function takeOutNewTitle(state: NewTitles, id: number): void {
  const at = state.queue.findIndex((p) => p.id === id)
  if (at >= 0) state.queue.splice(at, 1)
}

/** Forgotten on an Anchor: it stops being chosen for Duels. What titles learnt from it before still counts. */
export function excludeAnchor(state: NewTitles, id: number): void {
  state.excluded.add(id)
}

/** Unforgotten on an Anchor: it can be chosen again. */
export function includeAnchor(state: NewTitles, id: number): void {
  state.excluded.delete(id)
}

/**
 * The next Duel: the first title that isn't settled, against an Anchor of the middle level it can still be on
 * (a plain binary search over the positions). Null once every title is settled.
 */
export function nextAnchorDuel(state: NewTitles): AnchorDuel | null {
  for (const placement of state.queue) {
    const level = nextLevel(state, placement)
    if (level !== null) return { a: placement.id, b: chooseAnchor(state, placement.id, level), level }
  }
  return null
}

/** The level indexes whose own position is still open to the title (none once lo = hi), and the middle one. */
function openLevels({ lo, hi }: Placement): { first: number; last: number; middle: number } | null {
  if (lo === hi) return null
  // Two or more positions always hold a level's own position (an odd one).
  const first = Math.ceil((lo - 1) / 2)
  const last = Math.floor((hi - 1) / 2)
  return { first, last, middle: Math.floor((first + last) / 2) }
}

/**
 * The open level to ask next: the middle one, or when every Anchor on it is Forgotten the nearest open level that
 * still has one (the upper first). Null once the title is settled, or when no open level has an Anchor left.
 */
function nextLevel(state: NewTitles, placement: Placement): number | null {
  const open = openLevels(placement)
  if (!open) return null
  const { first, last, middle } = open
  for (let d = 0; middle - d >= first || middle + d <= last; d++) {
    for (const level of [middle - d, middle + d]) {
      if (level >= first && level <= last && usable(state, level).length > 0) return level
    }
  }
  return null
}

/**
 * Where a title is settled, or null while Duels can still move it: lo = hi, or no open level has an Anchor left to
 * ask (every one Forgotten), and then it takes the middle open level, the score it can't be told apart from.
 */
function settledPosition(state: NewTitles, placement: Placement): number | null {
  const open = openLevels(placement)
  if (!open) return placement.lo
  return nextLevel(state, placement) === null ? 2 * open.middle + 1 : null
}

/**
 * The Anchor a title meets on a level: picked from the seed, the title and the level only, so replay asks the same
 * Duel (ADR 0005), while different titles meet different Anchors. The place to leave out Anchors that may no longer
 * be used, or that already gave their answer for this boundary.
 */
function chooseAnchor(state: NewTitles, id: number, level: number): number {
  const anchors = usable(state, level)
  return anchors[sideHash(state.seed, id, 0xa0c4 + level) % anchors.length]
}

/** A level's Anchors that may still be chosen, by id ascending. */
function usable(state: NewTitles, level: number): readonly number[] {
  return state.levels[level].anchors.filter((id) => !state.excluded.has(id))
}

/**
 * Applies an answer between `a` and `b` (`winner` = the better one, null = about the same). Returns false when it
 * isn't the Duel the engine prompts now, so replay can refuse it.
 */
export function answerAnchorDuel(state: NewTitles, a: number, b: number, winner: number | null): boolean {
  const duel = nextAnchorDuel(state)
  if (!duel || !((duel.a === a && duel.b === b) || (duel.a === b && duel.b === a))) return false
  const placement = state.queue.find((p) => p.id === duel.a)!
  const at = 2 * duel.level + 1
  if (winner === null) placement.lo = placement.hi = at
  else if (winner === duel.a) placement.hi = at - 1
  else placement.lo = at + 1
  return true
}

/**
 * The score a settled title gets at its position. A tie gives that Anchor level. For now a title above every Anchor
 * gets the top level, one below every one the bottom level, and one between two levels the upper one: the closer-to
 * prompt and the levels past the extremes (#48) replace these.
 */
function settledLevel(state: NewTitles, position: number): number {
  const k = state.levels.length
  if (position % 2 === 1) return state.levels[(position - 1) / 2].level
  const gap = position / 2
  return state.levels[Math.min(Math.max(gap - 1, 0), k - 1)].level
}

/** The levels a position may still give: its own level, or for a gap both levels around it. */
function levelsNear(state: NewTitles, position: number): number[] {
  if (position % 2 === 1) return [state.levels[(position - 1) / 2].level]
  const gap = position / 2
  return [state.levels[gap - 1], state.levels[gap]].filter((l) => l !== undefined).map((l) => l.level)
}

export function newTitlesView(state: NewTitles): NewTitlesState {
  const titles = state.queue.map((placement): NewTitle => {
    const { id, lo, hi } = placement
    const settled = settledPosition(state, placement)
    if (settled !== null) return { id, settled: true, levels: [settledLevel(state, settled)] }
    const levels = new Set<number>()
    for (let p = lo; p <= hi; p++) for (const level of levelsNear(state, p)) levels.add(level)
    return { id, settled: false, levels: [...levels].sort((x, y) => y - x) }
  })
  return { format: state.format, levels: state.levels, titles }
}
