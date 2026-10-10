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

/** One answered Duel of a new title: the Anchor, its level index, and how the title did against it. */
type AnchorAnswer = { anchor: number; level: number; result: 'win' | 'tie' | 'loss' }

/**
 * A new title being placed: the positions lo..hi it can still be at, and every answer it was given against an
 * Anchor, in order (never the same Anchor twice).
 */
type Placement = { id: number; lo: number; hi: number; answers: AnchorAnswer[] }

/** Which side of boundary j a vote puts the title: 'above' = a position before j, 'below' = j or after. */
type Side = 'above' | 'below'

/** An Anchor that may be asked, with its level index. */
type Voter = { anchor: number; level: number }

export type NewTitles = {
  format: ScoreFormat
  levels: AnchorLevel[]
  anchorIds: ReadonlySet<number>
  seed: number
  /** Every new title, in the order they joined (Unforgotten ones at the front). */
  queue: Placement[]
}

/** The next Duel: new title `a` against Anchor `b`, which is on Anchor level index `level`. */
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
  return { format, levels, anchorIds: ids, seed, queue: [] }
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
}

/**
 * The next Duel: the first title that isn't settled, at the middle Anchor level it can still be on (a binary search
 * over the positions), against the next Anchor that may vote on that level's first open boundary. Null once every
 * title is settled.
 */
export function nextAnchorDuel(state: NewTitles): AnchorDuel | null {
  for (const placement of state.queue) {
    const level = nextLevel(placement)
    if (level === null) continue
    // The level's own position is open, so at least one of its boundaries is inside lo..hi and still open: a
    // decided one would have moved lo or hi past it.
    const boundary = [2 * level + 1, 2 * level + 2].find((j) => isOpen(placement, j) && !decide(state, placement, j))!
    const voter = nextVoter(state, placement, boundary)!
    return { a: placement.id, b: voter.anchor, level: voter.level }
  }
  return null
}

/** The middle Anchor level whose own position is still open to the title, or null once it is settled. */
function nextLevel({ lo, hi }: Placement): number | null {
  if (lo === hi) return null
  // Two or more positions always hold a level's own position (an odd one).
  const first = Math.ceil((lo - 1) / 2)
  const last = Math.floor((hi - 1) / 2)
  return Math.floor((first + last) / 2)
}

/** Whether boundary j still splits the positions the title can be at. */
const isOpen = ({ lo, hi }: Placement, j: number) => lo < j && j <= hi

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
 * Who may vote on boundary j, in the order they are asked. Each level's Anchors start at a point picked from the
 * seed, the title and the level only, so replay asks the same Duels (ADR 0005) while different titles meet
 * different Anchors. The one place to leave out Anchors that may no longer be used (Forgotten, Suspect).
 */
function voters(state: NewTitles, id: number, j: number): Voter[] {
  return voterLevels(state, j).flatMap((level) => rotated(state, id, level))
}

function rotated(state: NewTitles, id: number, level: number): Voter[] {
  const { anchors } = state.levels[level]
  const start = sideHash(state.seed, id, 0xa0c4 + level) % anchors.length
  return anchors.map((_, i) => ({ anchor: anchors[(start + i) % anchors.length], level }))
}

/** The first voter on boundary j the title hasn't met yet, or null once every one has answered. */
function nextVoter(state: NewTitles, placement: Placement, j: number): Voter | null {
  const met = new Set(placement.answers.map((answer) => answer.anchor))
  return voters(state, placement.id, j).find((voter) => !met.has(voter.anchor)) ?? null
}

/**
 * How an answer against an Anchor of one of boundary j's voter levels votes on it. An Anchor of the boundary's own
 * level m tells it directly. An Anchor of a neighbouring level stands in for level m together with the gap between
 * them: one above votes 'above' when the title is at least as good as it, one below when the title beats it.
 */
function vote(j: number, { level, result }: AnchorAnswer): Side {
  const m = levelOfBoundary(j)
  if (level === m && j % 2 === 1) return result === 'win' ? 'above' : 'below'
  if (level === m) return result === 'loss' ? 'below' : 'above'
  if (level < m) return result === 'loss' ? 'below' : 'above'
  return result === 'win' ? 'above' : 'below'
}

/**
 * Boundary j's verdict from the answers so far, or null while it is open. Two votes on one side, and more than the
 * other side has, decide it: two agreeing Anchors, or 2 of 3. The voter levels count in turn: a neighbour's votes
 * count only once every Anchor of the levels before it has answered and they left the boundary open. Once every voter has answered without a
 * verdict, the side with more votes wins, and an even split goes to the own level's first answer.
 */
function decide(state: NewTitles, placement: Placement, j: number): Side | null {
  const own = placement.answers.filter((answer) => answer.level === levelOfBoundary(j))
  let above = 0
  let below = 0
  for (const level of voterLevels(state, j)) {
    const answers = placement.answers.filter((answer) => answer.level === level)
    for (const answer of answers) {
      if (vote(j, answer) === 'above') above++
      else below++
    }
    if (above >= 2 && above > below) return 'above'
    if (below >= 2 && below > above) return 'below'
    if (answers.length < state.levels[level].anchors.length) break
  }
  if (nextVoter(state, placement, j)) return null
  if (above !== below) return above > below ? 'above' : 'below'
  return own.length > 0 ? vote(j, own[0]) : null
}

/**
 * Narrows lo..hi by every boundary inside it that the answers now decide, from the top down. A decided boundary is
 * never reopened, so a settled title stays settled whatever later answers would say.
 */
function narrow(state: NewTitles, placement: Placement): void {
  for (let j = placement.lo + 1; j <= placement.hi; j++) {
    const side = decide(state, placement, j)
    if (side === 'below') placement.lo = j
    else if (side === 'above') placement.hi = j - 1
  }
}

/**
 * Applies an answer between `a` and `b` (`winner` = the better one, null = about the same). Returns false when it
 * isn't the Duel the engine prompts now, so replay can refuse it.
 */
export function answerAnchorDuel(state: NewTitles, a: number, b: number, winner: number | null): boolean {
  const duel = nextAnchorDuel(state)
  if (!duel || !((duel.a === a && duel.b === b) || (duel.a === b && duel.b === a))) return false
  const placement = state.queue.find((p) => p.id === duel.a)!
  const result = winner === null ? 'tie' : winner === duel.a ? 'win' : 'loss'
  placement.answers.push({ anchor: duel.b, level: duel.level, result })
  narrow(state, placement)
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
  const titles = state.queue.map(({ id, lo, hi }): NewTitle => {
    if (lo === hi) return { id, settled: true, levels: [settledLevel(state, lo)] }
    const levels = new Set<number>()
    for (let p = lo; p <= hi; p++) for (const level of levelsNear(state, p)) levels.add(level)
    return { id, settled: false, levels: [...levels].sort((x, y) => y - x) }
  })
  return { format: state.format, levels: state.levels, titles }
}
