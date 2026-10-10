// Score New Titles (ADR 0009) inside the Ranking Engine: where each new title stands against the Anchor score
// levels, which Anchor it meets next, and what an answer tells. Pure; the engine owns one `NewTitles` per replay
// and calls in here for every event under this Sort Goal.
//
// A title's place is searched over 2k+1 positions for k Anchor levels (best first): position 2m+1 is level m itself
// ("about the same" as an Anchor on it), and position 2g is the gap above level g (gap 0 is above every Anchor, gap
// k below every one). A title knows the positions lo..hi it can still be at; it is settled once lo = hi.
//
// Confirmation (#45): the positions are split by 2k boundaries; boundary j lies between positions j-1 and j. Every
// boundary touches exactly one level: j = 2m+1 is the top of level m, j = 2m+2 its bottom. lo..hi only narrows when
// a boundary is decided, and a boundary is decided by the votes of different Anchors: two agreeing, or the majority
// once they disagree. The level's own Anchors vote first; once every one of them has answered (a single-Anchor level,
// or a split pair), the Anchors of the neighbouring levels vote too.
import type { ScoreFormat } from '../anilist/types.ts'
import { sideHash } from './hash.ts'
import { humanStepPast, levels as levelsOf } from './scoring.ts'

/** One Anchor in the snapshot (ADR 0009): its id and its score as a level of the snapshot's Score Format. */
export type AnchorScore = { id: number; level: number }

/** An Anchor score level and the Anchors on it, by id ascending. */
export type AnchorLevel = { level: number; anchors: readonly number[] }

/** A new title's standing: the levels it can still get, best first. Settled = exactly one level is left. */
export type NewTitle = { id: number; settled: boolean; levels: readonly number[] }

/** An Anchor no longer used as a reference: its old score (a level), and how many settled titles contradicted it. */
export type SuspectAnchor = { id: number; level: number; contradicted: number }

/** What replay shows of a Score New Titles Ranking. */
export type NewTitlesState = {
  /** The Score Format the Anchor snapshot was taken in: every level here is one of its levels. */
  format: ScoreFormat
  /** The Anchor score levels, best first. */
  levels: readonly AnchorLevel[]
  /** Every new title in the Ranking (Forgotten ones are not), in the order Duels work on them. */
  titles: readonly NewTitle[]
  /** Suspect Anchors (not Forgotten ones), best score first, then by id. Their scores are never changed. */
  suspect: readonly SuspectAnchor[]
}

/** One answered Duel of a new title: the Anchor, its level index, and how the title did against it. */
type AnchorAnswer = { anchor: number; level: number; result: 'win' | 'tie' | 'loss' }

/**
 * A new title being placed: the positions lo..hi it can still be at, every answer it was given against an Anchor, in
 * order (never the same Anchor twice), and its closer-to answer once given: the gap position it was asked at and the
 * score chosen, which counts only while the title is still at that gap. Once an answer settles it (lo = hi),
 * `contradicts` holds the Anchors whose answers disagree with where it settled; it is kept as it was then.
 */
type Placement = {
  id: number
  lo: number
  hi: number
  answers: AnchorAnswer[]
  closer?: { position: number; level: number }
  contradicts?: readonly number[]
}

/** Which side of boundary j a vote puts the title: 'above' = a position before j, 'below' = j or after. */
type Side = 'above' | 'below'

/** An Anchor that may be asked, with its level index. */
type Voter = { anchor: number; level: number }

export type NewTitles = {
  format: ScoreFormat
  levels: AnchorLevel[]
  anchorIds: ReadonlySet<number>
  /** Anchors no longer used as a reference (Forgotten): never chosen for a Duel, their levels and scores unchanged. */
  excluded: Set<number>
  /**
   * Suspect Anchors: contradicted by at least two titles still in the queue. Derived from the queue's `contradicts`
   * and refreshed whenever they change; never chosen for a Duel, and their answers stop counting, as if Forgotten.
   */
  suspect: Map<number, number>
  seed: number
  /** Every new title, in the order they joined (Unforgotten ones at the front). */
  queue: Placement[]
}

/** The next Duel: new title `a` against Anchor `b`, which is on Anchor level index `level`. */
export type AnchorDuel = { a: number; b: number; level: number }

/** The closer-to prompt (GLOSSARY): which of the scores `upper` and `lower` title `id` is closer to. */
export type CloserTo = { id: number; upper: number; lower: number }

/** What a Score New Titles Ranking asks next. */
export type NewTitlesQuestion = ({ kind: 'anchor-duel' } & AnchorDuel) | ({ kind: 'closer-to' } & CloserTo)

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
  return { format, levels, anchorIds: ids, excluded: new Set(), suspect: new Map(), seed, queue: [] }
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
  return { id, lo: 0, hi: 2 * state.levels.length, answers: [] }
}

/** Takes a title out (Forgotten, or it left the Pool). Every other title keeps what it knows. */
export function takeOutNewTitle(state: NewTitles, id: number): void {
  const at = state.queue.findIndex((p) => p.id === id)
  if (at >= 0) state.queue.splice(at, 1)
  refreshSuspects(state)
}

/** An Anchor contradicted by this many titles becomes Suspect (ADR 0009). */
const SUSPECT_AFTER = 2

/**
 * Suspect Anchors (#47). A title records its contradictions when an answer settles it, and keeps them, so whether an
 * Anchor is Suspect depends only on answers already given, in log order, never on where other titles would settle
 * without it: suspicion can't feed back into the placements it was judged from. Forgotten or Unforgotten titles take
 * their record with them.
 */
function refreshSuspects(state: NewTitles): void {
  state.suspect.clear()
  for (const placement of state.queue) {
    for (const anchor of placement.contradicts ?? []) state.suspect.set(anchor, (state.suspect.get(anchor) ?? 0) + 1)
  }
  for (const [anchor, times] of state.suspect) if (times < SUSPECT_AFTER) state.suspect.delete(anchor)
}

/**
 * Whether an answer disagrees with the Anchor's own score, for a title settled at `position`: it beat an Anchor it
 * isn't above, lost to one it isn't below, or was about the same as one whose score it didn't get.
 */
function contradicts(position: number, { level, result }: AnchorAnswer): boolean {
  const own = 2 * level + 1
  if (result === 'win') return position >= own
  if (result === 'loss') return position <= own
  return position !== own
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
 * What to ask next, for the first title that isn't settled. Strictly between two Anchor levels: the closer-to prompt.
 * Otherwise a Duel at the middle Anchor level it can still be on (a binary search over the positions), against the
 * next Anchor that may vote on that level's first open boundary. Null once every title is settled.
 */
export function nextQuestion(state: NewTitles): NewTitlesQuestion | null {
  for (const placement of state.queue) {
    const at = range(state, placement)
    const between = closerTo(state, placement, at)
    if (between) return { kind: 'closer-to', ...between }
    const level = nextLevel(state, at)
    if (level === null) continue
    // The level's own position is inside lo..hi, so at least one of its boundaries is too, and every boundary inside
    // lo..hi is still open. An open boundary of a level with a usable Anchor always has a voter left.
    const boundary = [2 * level + 1, 2 * level + 2].find((j) => at.lo < j && j <= at.hi)!
    const voter = nextVoter(state, placement, boundary)!
    return { kind: 'anchor-duel', a: placement.id, b: voter.anchor, level: voter.level }
  }
  return null
}

/**
 * The closer-to prompt a title is waiting on, or null: its place is a gap between two Anchor levels (not one past the
 * extremes), and it has no closer-to answer for that gap yet.
 */
function closerTo(state: NewTitles, placement: Placement, at: Range): CloserTo | null {
  const gap = at.lo / 2
  if (at.lo !== at.hi || at.lo % 2 === 1 || gap === 0 || gap === state.levels.length) return null
  if (placement.closer?.position === at.lo) return null
  return { id: placement.id, upper: state.levels[gap - 1].level, lower: state.levels[gap].level }
}

/** Positions lo..hi a title can be at. */
type Range = { lo: number; hi: number }

/** The level indexes whose own position is still open to the title (none once lo = hi), and the middle one. */
function openLevels({ lo, hi }: Range): { first: number; last: number; middle: number } | null {
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
function nextLevel(state: NewTitles, at: Range): number | null {
  const open = openLevels(at)
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
function settledPosition(state: NewTitles, at: Range): number | null {
  const open = openLevels(at)
  if (!open) return at.lo
  return nextLevel(state, at) === null ? 2 * open.middle + 1 : null
}

/** A level's Anchors that may still be chosen, by id ascending. */
function usable(state: NewTitles, level: number): readonly number[] {
  return state.levels[level].anchors.filter((id) => !state.excluded.has(id) && !state.suspect.has(id))
}

/** The level boundary j touches: 2m+1 is the top of level m, 2m+2 its bottom. */
const levelOfBoundary = (j: number) => Math.floor((j - 1) / 2)

/**
 * The levels whose Anchors may vote on boundary j, in the order they are asked: its own level, then the neighbouring
 * level across it (above a top, below a bottom), then the other neighbour.
 */
function voterLevels(state: NewTitles, j: number): number[] {
  const m = levelOfBoundary(j)
  const across = j % 2 === 1 ? m - 1 : m + 1
  const other = j % 2 === 1 ? m + 1 : m - 1
  return [m, across, other].filter((level) => state.levels[level] !== undefined)
}

/**
 * The first usable Anchor on boundary j the title hasn't met yet, or null once every one has answered. Each level's
 * Anchors start at a point picked from the seed, the title and the level only, so replay asks the same Duels
 * (ADR 0005) while different titles meet different Anchors.
 */
function nextVoter(state: NewTitles, placement: Placement, j: number): Voter | null {
  const met = new Set(placement.answers.map((answer) => answer.anchor))
  const unmet = (level: number): Voter | null => {
    const anchors = usable(state, level)
    const start = sideHash(state.seed, placement.id, 0xa0c4 + level) % Math.max(anchors.length, 1)
    for (let i = 0; i < anchors.length; i++) {
      const anchor = anchors[(start + i) % anchors.length]
      if (!met.has(anchor)) return { anchor, level }
    }
    return null
  }
  const [own, ...neighbours] = voterLevels(state, j)
  const first = unmet(own)
  if (first) return first
  // The neighbours take turns, the one asked least first (the one across the boundary on a draw), so both are heard.
  const asked = (level: number) => placement.answers.filter((answer) => answer.level === level).length
  const voters = neighbours
    .map((level) => ({ level, voter: unmet(level) }))
    .filter((n) => n.voter !== null)
    .sort((x, y) => asked(x.level) - asked(y.level))
  return voters[0]?.voter ?? null
}

/**
 * How an answer against an Anchor of one of boundary j's voter levels votes on it, or null when it doesn't tell. An
 * Anchor of the boundary's own level m tells it directly. An Anchor of a neighbouring level tells only when the title
 * is level with it or past it: at least as good as one above votes 'above', no better than one below votes 'below'.
 * Losing to one above (or beating one below) fits both sides: the title may be on level m, or in the gap between
 * them, the strict between-level case of the closer-to prompt (#48).
 */
function vote(j: number, { level, result }: AnchorAnswer): Side | null {
  const m = levelOfBoundary(j)
  if (level === m && j % 2 === 1) return result === 'win' ? 'above' : 'below'
  if (level === m) return result === 'loss' ? 'below' : 'above'
  if (level < m) return result === 'loss' ? null : 'above'
  return result === 'win' ? null : 'below'
}

/**
 * Boundary j's verdict from the answers so far, or null while it is open. Two votes on one side, and more than the
 * other side has, decide it: two agreeing Anchors, or 2 of 3. The level's own Anchors vote first; the neighbouring
 * levels' votes count only once every usable Anchor of the own level has answered and left the boundary open (a
 * single-Anchor level, or a split). Then the side the own level leans to (more votes, or its first answer on an even
 * split) stands once each neighbour has been asked and it still has more votes: the neighbours confirm it by not
 * contradicting it. Once every voter has answered without a verdict, the side with more votes wins, and an even split
 * goes to the own level's lean. Answers from Forgotten or Suspect Anchors don't count.
 */
function decide(state: NewTitles, placement: Placement, j: number): Side | null {
  const counts = placement.answers.filter((answer) => !state.excluded.has(answer.anchor) && !state.suspect.has(answer.anchor))
  const [ownLevel, ...neighbours] = voterLevels(state, j)
  const own = counts.filter((answer) => answer.level === ownLevel)
  const tally = { above: 0, below: 0 }
  const verdict = (): Side | null =>
    tally.above >= 2 && tally.above > tally.below ? 'above' : tally.below >= 2 && tally.below > tally.above ? 'below' : null
  for (const answer of own) tally[vote(j, answer)!]++
  if (verdict() || own.length < usable(state, ownLevel).length) return verdict()
  const lean = tally.above !== tally.below ? (tally.above > tally.below ? 'above' : 'below') : own.length > 0 ? vote(j, own[0]) : null
  const heard = neighbours.every((level) => usable(state, level).length === 0 || counts.some((answer) => answer.level === level))
  for (const answer of counts) {
    const side = neighbours.includes(answer.level) ? vote(j, answer) : null
    if (side) tally[side]++
  }
  if (verdict()) return verdict()
  if (lean && heard && tally[lean] > tally[lean === 'above' ? 'below' : 'above']) return lean
  if (nextVoter(state, placement, j)) return null
  if (tally.above !== tally.below) return tally.above > tally.below ? 'above' : 'below'
  return lean
}

/**
 * The positions a title can be at now: its stored lo..hi narrowed, from the top down, by every boundary inside it
 * that the answers decide. Derived, so a Forgotten or Brought back Anchor changes it without an answer.
 */
function range(state: NewTitles, placement: Placement): Range {
  let { lo, hi } = placement
  for (let j = lo + 1; j <= hi; j++) {
    const side = decide(state, placement, j)
    if (side === 'below') lo = j
    else if (side === 'above') hi = j - 1
  }
  return { lo, hi }
}

/**
 * Applies an answer between `a` and `b` (`winner` = the better one, null = about the same). Returns false when it
 * isn't the Duel the engine prompts now, so replay can refuse it. What the answer decides is kept in lo..hi: a
 * decided boundary is never reopened by later answers.
 */
export function answerAnchorDuel(state: NewTitles, a: number, b: number, winner: number | null): boolean {
  const duel = nextQuestion(state)
  if (duel?.kind !== 'anchor-duel' || !((duel.a === a && duel.b === b) || (duel.a === b && duel.b === a))) return false
  const placement = state.queue.find((p) => p.id === duel.a)!
  const result = winner === null ? 'tie' : winner === duel.a ? 'win' : 'loss'
  placement.answers.push({ anchor: duel.b, level: duel.level, result })
  Object.assign(placement, range(state, placement))
  if (placement.lo === placement.hi) {
    placement.contradicts = placement.answers.filter((answer) => contradicts(placement.lo, answer)).map((answer) => answer.anchor)
    refreshSuspects(state)
  }
  return true
}

/**
 * Applies a closer-to answer: title `id` takes `level`. Returns false when it isn't the closer-to prompt asked now, or
 * `level` isn't one of its two scores, so replay can refuse it.
 */
export function answerCloserTo(state: NewTitles, id: number, level: number): boolean {
  const question = nextQuestion(state)
  if (question?.kind !== 'closer-to' || question.id !== id || (level !== question.upper && level !== question.lower)) return false
  const placement = state.queue.find((p) => p.id === id)!
  placement.closer = { position: range(state, placement).lo, level }
  return true
}

/**
 * The score a settled title gets at its position. A tie gives that Anchor level. A title above every Anchor gets one
 * human Score Step above the top Anchor score, one below every Anchor one step below the bottom, never past the Score
 * Format's ends (ADR 0009). One between two levels gets the score its closer-to answer chose.
 */
function settledLevel(state: NewTitles, placement: Placement, position: number): number {
  const k = state.levels.length
  if (position % 2 === 1) return state.levels[(position - 1) / 2].level
  const gap = position / 2
  if (gap === 0) return humanStepPast(state.format, state.levels[0].level, 1)
  if (gap === k) return humanStepPast(state.format, state.levels[k - 1].level, -1)
  return placement.closer!.level
}

/** The levels a position may still give: its own level, or for a gap the levels on either side of it. */
function levelsNear(state: NewTitles, position: number): number[] {
  if (position % 2 === 1) return [state.levels[(position - 1) / 2].level]
  const gap = position / 2
  const k = state.levels.length
  const above = gap === 0 ? humanStepPast(state.format, state.levels[0].level, 1) : state.levels[gap - 1].level
  const below = gap === k ? humanStepPast(state.format, state.levels[k - 1].level, -1) : state.levels[gap].level
  return [above, below]
}

export function newTitlesView(state: NewTitles): NewTitlesState {
  const titles = state.queue.map((placement): NewTitle => {
    const { id } = placement
    const at = range(state, placement)
    const { lo, hi } = at
    const settled = closerTo(state, placement, at) ? null : settledPosition(state, at)
    if (settled !== null) return { id, settled: true, levels: [settledLevel(state, placement, settled)] }
    const levels = new Set<number>()
    for (let p = lo; p <= hi; p++) for (const level of levelsNear(state, p)) levels.add(level)
    return { id, settled: false, levels: [...levels].sort((x, y) => y - x) }
  })
  const suspect = state.levels.flatMap(({ level, anchors }) =>
    anchors
      .filter((id) => state.suspect.has(id) && !state.excluded.has(id))
      .map((id): SuspectAnchor => ({ id, level, contradicted: state.suspect.get(id)! })),
  )
  return { format: state.format, levels: state.levels, titles, suspect }
}
