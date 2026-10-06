// The Scores Sort Goal inside one Segment (ADR 0007): what the Duels so far say about each title's place, which
// titles are settled, and which Duel to ask next. Pure and stateless: everything is derived from the Segment's
// Tiers and insertion bounds, so any event (an answer, a settings change, a title taken out) is picked up as is.
//
// Knowledge is the engine's: Tiers in a known order, and each title without a place known to sit strictly between
// two Tiers (`above`, `below`), possibly equal to a Tier in between. Every Duel compares such a title with a Tier.

/** A Tier: titles the user considers equal. */
export type LevelTier = { readonly members: readonly number[] }
/** A title without a place: known worse than `above` and better than `below` (null = the Segment's edge). */
export type LevelInsertion = { readonly id: number; readonly above: LevelTier | null; readonly below: LevelTier | null }
export type LevelSegment = { readonly tiers: readonly LevelTier[]; readonly queue: readonly LevelInsertion[] }

/** Where a Segment sits in the whole Ranking, and the level each position there gets. */
export type LevelContext = {
  /** Position (0 = best) of the Segment's first title among every title in a Band. */
  offset: number
  /** The level at a (Tier average) position. Must not increase with the position. */
  levelAt: (position: number) => number
  /** Sample order: the title with the lowest priority is sorted first. From the seed, never `Math.random`. */
  priority: (id: number) => number
}

/** The Tier-average positions a title can still end up at, over every title in a Band. */
export type PositionRange = { min: number; max: number }

export type SegmentStanding = {
  /** Per Tier, then per insertion (same index as `queue`). */
  tiers: PositionRange[]
  queue: PositionRange[]
  tierSettled: boolean[]
  queueSettled: boolean[]
  unsettled: boolean
}

/** A Duel: the insertion at `insertion` (index into `queue`) against the Tier at `tier`. */
export type LevelDuel = { insertion: number; tier: number }

/** Per insertion, its interval as Tier indexes: it may land in gaps lo..hi, or tie a Tier lo..hi-1. */
function intervals(segment: LevelSegment): { lo: number[]; hi: number[] } {
  const index = new Map(segment.tiers.map((tier, i) => [tier, i]))
  const lo = segment.queue.map((q) => (q.above ? index.get(q.above)! + 1 : 0))
  const hi = segment.queue.map((q) => (q.below ? index.get(q.below)! : segment.tiers.length))
  return { lo, hi }
}

/** What the Duels so far say about one Segment: worked out once, read by `nextLevelDuel` and the standing. */
export type SegmentKnowledge = {
  readonly segment: LevelSegment
  readonly context: LevelContext
  readonly standing: SegmentStanding
  /** Per insertion: its interval (see `intervals`). */
  readonly lo: readonly number[]
  readonly hi: readonly number[]
  /** before[i] = titles in Tiers before Tier i; hiUpTo[g] = insertions known better than Tier g - 1 (hi < g). */
  readonly before: readonly number[]
  readonly hiUpTo: readonly number[]
}

/**
 * Each title's range of positions. A title is strictly below every title known better (Tiers above it, titles known
 * above those) and strictly above every title known worse; whatever ties it gets, its Tier average stays between
 * the two counts. So if both ends of the range give one level, no answer can change its level: it is settled.
 */
export function knowledgeOf(segment: LevelSegment, context: LevelContext): SegmentKnowledge {
  const { lo, hi } = intervals(segment)
  const k = segment.tiers.length
  const q = segment.queue.length
  const before = [0] // titles in Tiers before Tier i
  for (const tier of segment.tiers) before.push(before[before.length - 1] + tier.members.length)
  const m = before[k] + q
  // hiUpTo[g + 1] = insertions with hi <= g (known better than Tier g); loFrom[g] = insertions with lo >= g.
  const hiUpTo = new Array<number>(k + 2).fill(0)
  const loFrom = new Array<number>(k + 2).fill(0)
  for (let u = 0; u < q; u++) {
    hiUpTo[hi[u] + 1]++
    loFrom[lo[u]]++
  }
  for (let g = 1; g < k + 2; g++) hiUpTo[g] += hiUpTo[g - 1]
  for (let g = k; g >= 0; g--) loFrom[g] += loFrom[g + 1]
  const { offset, levelAt } = context
  const range = (better: number, worse: number, size: number): PositionRange => ({
    min: offset + better + (size - 1) / 2,
    max: offset + m - 1 - worse - (size - 1) / 2,
  })
  const settledIn = (r: PositionRange) => levelAt(r.min) === levelAt(r.max)
  const tiers = segment.tiers.map((tier, i) =>
    range(before[i] + hiUpTo[i + 1], before[k] - before[i + 1] + loFrom[i + 1], tier.members.length),
  )
  const queue = segment.queue.map((_, u) => range(before[lo[u]] + hiUpTo[lo[u]], before[k] - before[hi[u]] + loFrom[hi[u] + 1], 1))
  const tierSettled = tiers.map(settledIn)
  const queueSettled = queue.map(settledIn)
  const unsettled = tierSettled.includes(false) || queueSettled.includes(false)
  return { segment, context, standing: { tiers, queue, tierSettled, queueSettled, unsettled }, lo, hi, before, hiUpTo }
}

/**
 * The next Duel in this Segment, or null once every title in it is settled. The level-targeted multi-selection
 * from the spike (ADR 0007), worked out afresh from the knowledge each time:
 *
 * 1. Tiers no insertion may cross ("pinned") cut the Segment into groups with exactly known positions. The first
 *    group with an unsettled title is worked on.
 * 2. Its Tiers are its sample. Until it holds about √(size · boundaries) Tiers, the lowest-priority title in it is
 *    sorted by binary insertion (reusing the bounds it has).
 * 3. Then the Tier whose expected position is nearest each level boundary is a pivot, and each title crossing a
 *    pivot is sent towards its group by comparing it with the pivot that splits its expected positions most evenly.
 *    Once no title crosses a pivot, the pivots are pinned and step 1 recurses into the smaller groups.
 *
 * `first` (a title just moved, re-ranked or brought back) is worked on before anything else while it is unsettled.
 */
export function nextLevelDuel(knowledge: SegmentKnowledge, first?: number): LevelDuel | null {
  const { segment, context, standing, lo, hi, before, hiUpTo } = knowledge
  if (!standing.unsettled) return null
  const k = segment.tiers.length
  const q = segment.queue.length
  const { offset, levelAt } = context

  // Insertions crossing each Tier, and their expected share above it (each gap of an interval equally likely).
  const cover = new Array<number>(k + 1).fill(0)
  const slope = new Array<number>(k + 1).fill(0)
  const intercept = new Array<number>(k + 1).fill(0)
  for (let u = 0; u < q; u++) {
    const gaps = hi[u] - lo[u] + 1
    cover[lo[u]]++
    cover[hi[u]]--
    slope[lo[u]] += 1 / gaps
    slope[hi[u]] -= 1 / gaps
    intercept[lo[u]] += (1 - lo[u]) / gaps
    intercept[hi[u]] -= (1 - lo[u]) / gaps
  }
  const crossing = new Float64Array(k)
  const expected = new Float64Array(k)
  let c = 0
  let s = 0
  let b = 0
  for (let i = 0; i < k; i++) {
    c += cover[i]
    s += slope[i]
    b += intercept[i]
    crossing[i] = c
    const size = segment.tiers[i].members.length
    expected[i] = offset + before[i] + hiUpTo[i + 1] + (c > 0 ? i * s + b : 0) + (size - 1) / 2
  }

  const middle = (u: number): LevelDuel => ({ insertion: u, tier: Math.floor((lo[u] + hi[u]) / 2) })
  /** The pivot in u's interval nearest the middle of u's expected positions, or null if none is in it. */
  const towardsPivot = (u: number, pivots: readonly number[]): LevelDuel | null => {
    const top = lo[u] > 0 ? expected[lo[u] - 1] : offset - 0.5
    const bottom = hi[u] < k ? expected[hi[u]] : offset + before[k] + q - 0.5
    const centre = (top + bottom) / 2
    let best: number | null = null
    for (const p of pivots) {
      if (p < lo[u] || p >= hi[u]) continue
      if (best === null || Math.abs(expected[p] - centre) < Math.abs(expected[best] - centre)) best = p
    }
    return best === null ? null : { insertion: u, tier: best }
  }

  // Groups: between pinned Tiers (no insertion crosses them), top to bottom. A group from Tier `from` to the pinned
  // Tier `to` (or the end) holds Tiers from..to-1 and the insertions whose interval ends in from..to.
  const unsettledEndingAt = new Array<number>(k + 1).fill(0)
  for (let u = 0; u < q; u++) if (!standing.queueSettled[u]) unsettledEndingAt[hi[u]]++
  const firstAt = first === undefined ? -1 : segment.queue.findIndex((x) => x.id === first)
  const working = firstAt >= 0 && !standing.queueSettled[firstAt]
  let from = -1
  let to = -1
  for (let start = 0, i = 0; i <= k; i++) {
    if (i < k && crossing[i] > 0) continue
    // Tiers start..i-1 are not pinned; i is pinned (or the end).
    let unsettled = false
    if (working) unsettled = lo[firstAt] >= start && hi[firstAt] <= i
    else {
      for (let t = start; t < i && !unsettled; t++) unsettled = !standing.tierSettled[t]
      for (let g = start; g <= i && !unsettled; g++) unsettled = unsettledEndingAt[g] > 0
    }
    if (unsettled) {
      ;[from, to] = [start, i]
      break
    }
    start = i + 1
  }
  if (from < 0) return null
  const members: number[] = [] // in queue order
  for (let u = 0; u < q; u++) if (hi[u] >= from && hi[u] <= to) members.push(u)
  if (members.length === 0) return null
  const group = { from, to, start: offset + before[from] + hiUpTo[from], size: before[to] - before[from] + members.length }

  const boundaries: number[] = []
  for (let p = group.start + 1; p < group.start + group.size; p++) if (levelAt(p - 1) !== levelAt(p)) boundaries.push(p)
  const pivots = new Set<number>()
  for (const boundary of boundaries) {
    let best = -1
    for (let t = group.from; t < group.to; t++) {
      if (best < 0 || Math.abs(expected[t] - (boundary - 0.5)) < Math.abs(expected[best] - (boundary - 0.5))) best = t
    }
    if (best >= 0) pivots.add(best)
  }

  const pivotList = [...pivots]
  if (working) return towardsPivot(firstAt, pivotList) ?? middle(firstAt)

  const sample = Math.ceil(Math.sqrt(group.size * Math.max(1, boundaries.length)))
  if (group.to - group.from < sample) {
    let next = members[0]
    let lowest = Infinity
    for (const u of members) {
      const priority = context.priority(segment.queue[u].id)
      // Ties (equal hashes) go to the earlier insertion, so the choice never depends on anything but the log.
      if (priority < lowest || (priority === lowest && u < next)) [next, lowest] = [u, priority]
    }
    return middle(next)
  }
  // Routing goes title by title in queue order; each is sent to its group before the next starts.
  for (const u of members) {
    const duel = towardsPivot(u, pivotList)
    if (duel) return duel
  }
  // Not reached (a group's Tiers are crossed by its titles, so some title crosses a pivot), but never stop early.
  return middle(members[0])
}
