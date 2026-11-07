// Studio Score v2.8 over "who a title counts for" (research spec docs/research/top-studio-score.md, prototype
// scripts/top-studio-score/prototype.py): Votes, Franchise, Love count, Gate, Labels and the Watchlist for any tool.
// The tool says who each title counts for (its main studios, its Directors) and passes the numbers research sets
// apart per tool (ScoringParams). Pure: takes the titles on the user's list and their favourite anime. No I/O.
import type { ListStatus } from '../anilist/types.ts'
import { isDropped, rewatchesOf, type ListTitle, type Who } from './types.ts'

/** α: how far the entropic mean leans toward a ranked one's best titles. At α → 0 it is a plain mean. */
const ALPHA = 1
/** Below this many scored titles there is no scale to read z from: the list is too little to rank. */
export const MIN_SCORED = 10
/** The SD never counts as smaller than this, so a user who scores everything alike doesn't blow z up. */
const SD_FLOOR = 0.5
/** Added to the z of a favourite anime (flat: most users don't rank their favourites). */
const FAV_BONUS = 0.5
/** A scored drop counts at most this z. */
const DROP_Z_CAP = -0.5
/** Unscored titles count only through a signal the user gave: a drop or a rewatch. */
const UNSCORED_DROP_Z = -1
const UNSCORED_REWATCH_Z = 0.5
/** Titles closer than this to the user's mean (|z|) weigh half: neutral titles shouldn't drag a score much. */
const MID_BAND = 0.5
const MID_WEIGHT = 0.5
/** An unscored drop weighs half: it says less than a real score. */
const UNSCORED_DROP_WEIGHT = 0.5
/** γ: weight of the Love count, ln(1 + n_love), which rewards the number of loved works. */
const GAMMA = 0.1
/** A vote counts as loved from about this z (≈ 8+ on the owner's scale)... */
const LOVE_Z = 0.9
/** ...with this soft edge, σ((Z − LOVE_Z) / LOVE_SOFT), so there is no cliff at LOVE_Z. */
const LOVE_SOFT = 0.15
/**
 * Every Vote of an n-title Franchise weighs n^−p, whatever its order: one rule for every Franchise, light on short ones.
 * The Gate still counts each Vote in full.
 */
const FRANCHISE_P = 0.3
/** How many below the Gate the Watchlist shows. */
const WATCHLIST_SIZE = 5
/** A vote is a hit from this z, a flop up to this one. */
const HIT_Z = 1.2
const FLOP_Z = -1

/** The numbers research may set apart per tool. Every other rule is the same on every tool. */
export type ScoringParams = {
  /**
   * Votes needed to be ranked: `start`, lowered one Vote at a time while fewer than `target` would rank, but never
   * below `floor`.
   */
  gate: { start: number; target: number; floor: number }
  /** Pseudo-votes at the user's average every ranked one starts with: "this much evidence is needed". */
  k: number
  /**
   * Labels compare rates with the pooled rates of the `pool` top ranked, and a rate counts as high only `margin`
   * above the pool, so one title doesn't flip a Label.
   */
  labels: { pool: number; margin: number }
}

/**
 * How a studio or Director treats the user: hits often or not, flops often or not. The one place a Label is paired
 * with its rates: the label map's corners in reading order, hit rate high on the top row, flop rate high on the right.
 */
export const LABEL_GRID = ['elite', 'bold', 'reliable', 'meh'] as const
export type Label = (typeof LABEL_GRID)[number]

/** Whether a Label's hit rate and flop rate read high (above the label lines): its place on the grid. */
export function labelRates(label: Label): { hitsHigh: boolean; flopsHigh: boolean } {
  const at = LABEL_GRID.indexOf(label)
  return { hitsHigh: at < 2, flopsHigh: at % 2 === 1 }
}

function labelOf(hitsHigh: boolean, flopsHigh: boolean): Label {
  return LABEL_GRID[(hitsHigh ? 0 : 2) + (flopsHigh ? 1 : 0)]
}

/** One counted title in one score. */
export type Vote<T extends ListTitle = ListTitle> = {
  title: T
  /** How much the user liked it, in SDs from their mean (status defaults and the fav bonus included). */
  z: number
  /**
   * Its vote weight W: √(runtime weight), rescaled so the mean W over every vote of every ranked one is 1 before the
   * Franchise factor n^−p, which then lightens the titles of long Franchises.
   */
  weight: number
  /** What it weighs in the hit and flop rates: W without the mid-band halving (a neutral title is still one watch). */
  rateWeight: number
  favourite: boolean
  /** Whether z comes from a score, not from a drop or rewatch default. */
  scored: boolean
}

/** A studio's or Director's score on this user's list. */
export type WhoScore<T extends ListTitle = ListTitle> = {
  id: number
  name: string
  /** Their own picture, when `countsFor` gave one (see Who). */
  image?: string | null
  /** The Studio Score or Director Score S. 0 is average for this user. */
  score: number
  /** The counted titles, in list order. Their count is what the Gate reads. */
  votes: Vote<T>[]
  /** Share of its votes at z ≥ 1.2, by rate weight. */
  hitRate: number
  /** Share of its votes at z ≤ −1, by rate weight. */
  flopRate: number
  /** From whether its hit and flop rates pass `labelLines` (see LABEL_GRID). */
  label: Label
}

export type Ranking<T extends ListTitle = ListTitle> = {
  /** Those with at least `gate` Votes, best first. */
  ranked: WhoScore<T>[]
  /** The best below the Gate, best first: promising, but too little seen to rank. */
  watchlist: WhoScore<T>[]
  /** Votes needed to be ranked: the params' `gate.start`, or lower for a short list. */
  gate: number
  /** The hit and flop rates one must pass to read high: the pooled rates of the top ranked + the margin. */
  labelLines: { hit: number; flop: number }
  /** Ū: the user's W-weighted mean vote utility e^(αZ) over every vote. A title above it lifts its score. */
  averageUtility: number
  scale: ScoreScale
  /** Scored titles among the titles the user watched (every status but Planning). */
  scoredCount: number
  watchedCount: number
  /** Titles that count (a score, or an unscored drop, rewatch or favourite), whoever they count for. */
  countedCount: number
  /** Scored titles among those: under half of `countedCount`, the labels may be off (#91's note). */
  countedScoredCount: number
}

export type Scoring<T extends ListTitle = ListTitle> =
  | { ok: true; ranking: Ranking<T> }
  | { ok: false; reason: 'too-few-scored'; scored: number }

const WATCHING: ReadonlySet<ListStatus> = new Set(['CURRENT', 'PAUSED'])

function scaleOf(scores: readonly number[]): ScoreScale {
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length
  const variance = scores.reduce((a, s) => a + (s - mean) ** 2, 0) / scores.length
  return { mean, sd: Math.max(Math.sqrt(variance), SD_FLOOR) }
}

/** A title's z and its runtime weight w (0 when it casts no Vote). */
function titleVote(
  e: ListTitle,
  scale: ScoreScale,
  favourite: boolean,
): { z: number; w: number; scored: boolean; mid: boolean } {
  const dropped = isDropped(e)
  const rewatches = rewatchesOf(e)
  const scored = e.score > 0
  let z: number
  if (scored) {
    z = (e.score - scale.mean) / scale.sd
    if (dropped) z = Math.min(z, DROP_Z_CAP)
  } else {
    z = dropped ? UNSCORED_DROP_Z : rewatches ? UNSCORED_REWATCH_Z : 0
  }
  if (favourite) z += FAV_BONUS

  let episodes = e.episodes || Math.max(e.progress || 1, 1)
  // A drop weighs what was actually watched (at least one episode), not the whole show.
  if (dropped) episodes = Math.min(Math.max(e.progress || 1, 1), episodes)
  let w = Math.log(1 + (episodes * (e.duration || 24)) / 24) * Math.min(1 + 0.5 * rewatches, 2)
  if (WATCHING.has(e.status)) w *= Math.min((e.progress || 0) / episodes, 1)
  const mid = Math.abs(z) < MID_BAND
  if (mid) w *= MID_WEIGHT
  if (!scored && !favourite) {
    if (dropped) w *= UNSCORED_DROP_WEIGHT
    else if (!rewatches) w = 0
  }
  return { z, w, scored, mid }
}

/**
 * Ranks whoever the user's titles count for by Studio Score v2.8: each title casts its Vote for everyone `countsFor`
 * returns for it, in full; a title it returns no one for counts for no one.
 */
export function scoreList<T extends ListTitle>(
  list: readonly T[],
  favouriteIds: Iterable<number>,
  countsFor: (title: T) => readonly Who[],
  params: ScoringParams,
): Scoring<T> {
  const watched = list.filter((e) => e.status !== 'PLANNING')
  const scores = watched.filter((e) => e.score > 0).map((e) => e.score)
  if (scores.length < MIN_SCORED) return { ok: false, reason: 'too-few-scored', scored: scores.length }
  const scale = scaleOf(scores)
  const favourites = new Set(favouriteIds)

  // Every title casts its own Vote for each one it counts for (sequels, films and recaps included).
  type GroupVote = { title: T; z: number; w: number; scored: boolean; favourite: boolean; mid: boolean }
  const byWho = new Map<number, { who: Who; votes: GroupVote[] }>()
  let countedCount = 0
  let countedScoredCount = 0
  for (const title of watched) {
    const favourite = favourites.has(title.mediaId)
    const vote = titleVote(title, scale, favourite)
    const { w, scored, mid } = vote
    if (w <= 0) continue
    // A Vote's Z is the entropic mean of its titles (one per Vote since v2.5), as the prototype computes it:
    // ln(w·e^z / w) is z up to rounding, and that rounding decides whether an unscored drop (z −1) is a flop,
    // so it is kept for parity with the prototype's labels (#90).
    const z = entropicMean([{ z: vote.z, weight: w }])
    countedCount++
    if (scored) countedScoredCount++
    for (const who of countsFor(title)) {
      let group = byWho.get(who.id)
      if (!group) byWho.set(who.id, (group = { who, votes: [] }))
      group.votes.push({ title, z, w, scored, favourite, mid })
    }
  }

  // W = √w, rescaled so the mean W over every vote is 1: k then reads as "k average Votes", before the Franchise factor.
  const rootWeights = [...byWho.values()].flatMap((g) => g.votes.map((v) => Math.sqrt(v.w)))
  const rescale = rootWeights.length / rootWeights.reduce((a, b) => a + b, 0)
  const everyone = [...byWho].map(([id, group]) => {
    const franchises = franchisesOf(group.votes)
    const size = new Map<number, number>()
    for (const f of franchises) size.set(f, (size.get(f) ?? 0) + 1)
    const { who } = group
    return {
      id,
      name: who.name,
      ...('image' in who ? { image: who.image } : {}),
      votes: group.votes.map(({ title, z, w, scored, favourite, mid }, i): Vote<T> => {
        const weight = Math.sqrt(w) * rescale * (size.get(franchises[i]) ?? 1) ** -FRANCHISE_P
        return { title, z, weight, rateWeight: mid ? weight / Math.sqrt(MID_WEIGHT) : weight, favourite, scored }
      }),
    }
  })

  const allVotes = everyone.flatMap((s) => s.votes)
  const averageUtility =
    allVotes.reduce((a, v) => a + v.weight * utility(v.z), 0) / allVotes.reduce((a, v) => a + v.weight, 0)
  const base = Math.log(averageUtility) / ALPHA

  const scored = everyone
    .map((s) => ({
      ...s,
      score: entropicMean(s.votes, params.k, averageUtility) - base + GAMMA * Math.log(1 + loveCount(s.votes)),
      hitRate: rateOf(s.votes, (v) => v.z >= HIT_Z),
      flopRate: rateOf(s.votes, (v) => v.z <= FLOP_Z),
    }))
    .sort((a, b) => b.score - a.score)

  const { start, target, floor } = params.gate
  let gate = start
  while (gate > floor && scored.filter((s) => s.votes.length >= gate).length < target) gate--
  const ranked = scored.filter((s) => s.votes.length >= gate)
  const watchlist = scored.filter((s) => s.votes.length < gate).slice(0, WATCHLIST_SIZE)

  // The label baseline: hit and flop rates pooled over the top ranked ones' votes (none ranked: 0).
  const pool = ranked.slice(0, params.labels.pool)
  const pooled = (rate: (s: (typeof pool)[number]) => number) => {
    const mass = pool.reduce((a, s) => a + rateMass(s.votes), 0)
    return mass ? pool.reduce((a, s) => a + rate(s) * rateMass(s.votes), 0) / mass : 0
  }
  const hitLine = pooled((s) => s.hitRate) + params.labels.margin
  const flopLine = pooled((s) => s.flopRate) + params.labels.margin
  const labelled = (s: (typeof scored)[number]): WhoScore<T> => ({ ...s, label: labelOf(s.hitRate > hitLine, s.flopRate > flopLine) })

  return {
    ok: true,
    ranking: {
      ranked: ranked.map(labelled),
      watchlist: watchlist.map(labelled),
      gate,
      labelLines: { hit: hitLine, flop: flopLine },
      averageUtility,
      scale,
      scoredCount: scores.length,
      watchedCount: watched.length,
      countedCount,
      countedScoredCount,
    },
  }
}

/** The votes' total rate weight. */
const rateMass = (votes: readonly Vote[]) => votes.reduce((a, v) => a + v.rateWeight, 0)

/** The rate-weighted share of the votes that pass `test`. */
function rateOf(votes: readonly Vote[], test: (v: Vote) => boolean): number {
  return votes.reduce((a, v) => a + (test(v) ? v.rateWeight : 0), 0) / rateMass(votes)
}

/** Each vote's Franchise, as the index of one of its titles: the titles counted together, joined by SEQUEL/PREQUEL. */
function franchisesOf(votes: ReadonlyArray<{ title: ListTitle }>): number[] {
  const index = new Map(votes.map((v, i) => [v.title.mediaId, i]))
  const parent = votes.map((_, i) => i)
  const root = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]]
    return i
  }
  votes.forEach((v, i) => {
    for (const relation of v.title.relations) {
      const j = index.get(relation.mediaId)
      if (j !== undefined) parent[root(i)] = root(j)
    }
  })
  return votes.map((_, i) => root(i))
}

/**
 * n_love: a soft count of loved works, not titles. Titles joined by SEQUEL/PREQUEL form one Franchise, worth at most 1
 * (its best vote). Fav split: in a Franchise with two or more favourites, each favourite counts on its own and the
 * rest stays one.
 */
function loveCount(votes: readonly Vote[]): number {
  const franchises = franchisesOf(votes)
  const root = (i: number) => franchises[i]
  const favouritesIn = new Map<number, number>()
  votes.forEach((v, i) => {
    if (v.favourite) favouritesIn.set(root(i), (favouritesIn.get(root(i)) ?? 0) + 1)
  })
  const best = new Map<string, number>()
  votes.forEach((v, i) => {
    const franchise = root(i)
    const key = v.favourite && (favouritesIn.get(franchise) ?? 0) >= 2 ? `fav ${i}` : `franchise ${franchise}`
    best.set(key, Math.max(best.get(key) ?? 0, sigmoid((v.z - LOVE_Z) / LOVE_SOFT)))
  })
  return [...best.values()].reduce((a, b) => a + b, 0)
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))

/** The user's mean and spread on the 10-point scale; a vote's z is how far a score sits from the mean. */
export type ScoreScale = { mean: number; sd: number }

/** A vote's utility e^(αz): what it is worth to its score. Ū is the user's W-weighted mean of these. */
export function utility(z: number): number {
  return Math.exp(ALPHA * z)
}

/** What one vote at this score is worth on the user's scale: e^(αz). Average ≈ the user's average of these. */
export function points(score: number, scale: ScoreScale): number {
  return utility((score - scale.mean) / scale.sd)
}

/** The score on the 10-point scale whose vote is worth `u` (the inverse of `points`): at Ū, the user's usual. */
export function scoreWorth(u: number, scale: ScoreScale): number {
  return scale.mean + (scale.sd * Math.log(u)) / ALPHA
}

/**
 * The first term of S: the entropic (log-sum-exp) mean of the votes' z, with `k` pseudo-votes of utility `prior`
 * (= e^(αZ) of the prior).
 */
export function entropicMean(votes: ReadonlyArray<{ z: number; weight: number }>, k = 0, prior = 1): number {
  let num = k * prior
  let den = k
  for (const v of votes) {
    num += v.weight * utility(v.z)
    den += v.weight
  }
  return Math.log(num / den) / ALPHA
}
