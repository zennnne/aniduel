// Studio Score v2.8 (research spec docs/research/top-studio-score.md, prototype scripts/top-studio-score/prototype.py).
// Pure: takes the titles on the user's list and their favourite anime, returns the ranked studios. No I/O.
import type { ListStatus } from '../anilist/types.ts'
import { isDropped, rewatchesOf, type StudioTitle } from './types.ts'

/** α: how far the entropic mean leans toward a studio's best titles. At α → 0 it is a plain mean. */
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
/** Titles closer than this to the user's mean (|z|) weigh half: neutral titles shouldn't drag a studio much. */
const MID_BAND = 0.5
const MID_WEIGHT = 0.5
/** An unscored drop weighs half: it says less than a real score. */
const UNSCORED_DROP_WEIGHT = 0.5
/** Pseudo-votes at the user's average every studio starts with: "a studio needs this much evidence". */
export const K = 13.1
/** γ: weight of the love count, ln(1 + n_love), which rewards the number of loved works. */
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
/** Votes a studio needs to be ranked. */
export const GATE = 6
/** A short list lowers the gate one Vote at a time until this many studios rank... */
export const GATE_TARGET = 10
/** ...but never below this. */
const GATE_FLOOR = 4
/** How many studios below the gate the watchlist shows. */
const WATCHLIST_SIZE = 5
/** A vote is a hit from this z, a flop up to this one. */
const HIT_Z = 1.2
const FLOP_Z = -1
/** Labels compare a studio's rates with the pooled rates of this many top ranked studios... */
const LABEL_POOL = 20
/** ...and a rate counts as high only this far above the pool, so one title doesn't flip a label. */
const LABEL_MARGIN = 0.06

/**
 * How a studio treats the user: hits often or not, flops often or not. The one place a Label is paired with its rates:
 * the label map's corners in reading order, hit rate high on the top row, flop rate high in the right column.
 */
export const LABEL_GRID = ['elite', 'bold', 'reliable', 'meh'] as const
export type StudioLabel = (typeof LABEL_GRID)[number]

/** Whether a Label's hit rate and flop rate read high (above the label lines): its place on the grid. */
export function labelRates(label: StudioLabel): { hitsHigh: boolean; flopsHigh: boolean } {
  const at = LABEL_GRID.indexOf(label)
  return { hitsHigh: at < 2, flopsHigh: at % 2 === 1 }
}

function labelOf(hitsHigh: boolean, flopsHigh: boolean): StudioLabel {
  return LABEL_GRID[(hitsHigh ? 0 : 2) + (flopsHigh ? 1 : 0)]
}

/** One counted title in one studio's score. */
export type StudioVote = {
  title: StudioTitle
  /** How much the user liked it, in SDs from their mean (status defaults and the fav bonus included). */
  z: number
  /**
   * Its vote weight W: √(runtime weight), rescaled so the mean W over every vote of every studio is 1 before the
   * Franchise factor n^−p, which then lightens the titles of long Franchises.
   */
  weight: number
  /** What it weighs in the hit and flop rates: W without the mid-band halving (a neutral title is still one watch). */
  rateWeight: number
  favourite: boolean
  /** Whether z comes from a score, not from a drop or rewatch default. */
  scored: boolean
}

export type StudioScore = {
  id: number
  name: string
  /** The Studio Score S. 0 is an average studio for this user. */
  score: number
  /** The counted titles, in list order. Their count is what the gate reads. */
  votes: StudioVote[]
  /** Share of its votes at z ≥ 1.2, by rate weight. */
  hitRate: number
  /** Share of its votes at z ≤ −1, by rate weight. */
  flopRate: number
  /** From whether its hit and flop rates pass `labelLines` (see LABEL_GRID). */
  label: StudioLabel
}

export type TopStudios = {
  /** Studios with at least `gate` Votes, best first. */
  studios: StudioScore[]
  /** The best studios below the gate, best first: promising, but too little seen to rank. */
  watchlist: StudioScore[]
  /** Votes a studio needed to be ranked: `GATE`, or lower for a short list. */
  gate: number
  /** The hit and flop rates a studio must pass to read high: the pooled rates of the top ranked studios + the margin. */
  labelLines: { hit: number; flop: number }
  /** Ū: the user's W-weighted mean vote utility e^(αZ) over every vote. A title above it lifts its studio. */
  averageUtility: number
  scale: ScoreScale
  /** Scored titles among the titles the user watched (every status but Planning). */
  scoredCount: number
  watchedCount: number
  /** Titles that count (a score, or an unscored drop, rewatch or favourite), with or without a main studio. */
  countedCount: number
  /** Scored titles among those: under half of `countedCount`, the labels may be off (#91's note). */
  countedScoredCount: number
}

export type StudioScoring = { ok: true; topStudios: TopStudios } | { ok: false; reason: 'too-few-scored'; scored: number }

const WATCHING: ReadonlySet<ListStatus> = new Set(['CURRENT', 'PAUSED'])

function scaleOf(scores: readonly number[]): ScoreScale {
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length
  const variance = scores.reduce((a, s) => a + (s - mean) ** 2, 0) / scores.length
  return { mean, sd: Math.max(Math.sqrt(variance), SD_FLOOR) }
}

/** A title's z and its runtime weight w (0 when it casts no Vote). */
function titleVote(
  e: StudioTitle,
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

/** Ranks the user's studios by Studio Score v2.8. */
export function scoreStudios(list: readonly StudioTitle[], favouriteIds: Iterable<number>): StudioScoring {
  const watched = list.filter((e) => e.status !== 'PLANNING')
  const scores = watched.filter((e) => e.score > 0).map((e) => e.score)
  if (scores.length < MIN_SCORED) return { ok: false, reason: 'too-few-scored', scored: scores.length }
  const scale = scaleOf(scores)
  const favourites = new Set(favouriteIds)

  // Every title casts its own Vote at each of its main studios (sequels, films and recaps included).
  type GroupVote = { title: StudioTitle; z: number; w: number; scored: boolean; favourite: boolean; mid: boolean }
  const byStudio = new Map<number, { name: string; votes: GroupVote[] }>()
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
    for (const studio of title.studios) {
      let group = byStudio.get(studio.id)
      if (!group) byStudio.set(studio.id, (group = { name: studio.name, votes: [] }))
      group.votes.push({ title, z, w, scored, favourite, mid })
    }
  }

  // W = √w, rescaled so the mean W over every vote is 1: k then reads as "k average Votes", before the Franchise factor.
  const rootWeights = [...byStudio.values()].flatMap((g) => g.votes.map((v) => Math.sqrt(v.w)))
  const rescale = rootWeights.length / rootWeights.reduce((a, b) => a + b, 0)
  const studios = [...byStudio].map(([id, group]) => {
    const franchises = franchisesOf(group.votes)
    const size = new Map<number, number>()
    for (const f of franchises) size.set(f, (size.get(f) ?? 0) + 1)
    return {
      id,
      name: group.name,
      votes: group.votes.map(({ title, z, w, scored, favourite, mid }, i): StudioVote => {
        const weight = Math.sqrt(w) * rescale * (size.get(franchises[i]) ?? 1) ** -FRANCHISE_P
        return { title, z, weight, rateWeight: mid ? weight / Math.sqrt(MID_WEIGHT) : weight, favourite, scored }
      }),
    }
  })

  const allVotes = studios.flatMap((s) => s.votes)
  const averageUtility =
    allVotes.reduce((a, v) => a + v.weight * utility(v.z), 0) / allVotes.reduce((a, v) => a + v.weight, 0)
  const base = Math.log(averageUtility) / ALPHA

  const scored = studios
    .map((s) => ({
      ...s,
      score: entropicMean(s.votes, K, averageUtility) - base + GAMMA * Math.log(1 + loveCount(s.votes)),
      hitRate: rateOf(s.votes, (v) => v.z >= HIT_Z),
      flopRate: rateOf(s.votes, (v) => v.z <= FLOP_Z),
    }))
    .sort((a, b) => b.score - a.score)

  let gate = GATE
  while (gate > GATE_FLOOR && scored.filter((s) => s.votes.length >= gate).length < GATE_TARGET) gate--
  const ranked = scored.filter((s) => s.votes.length >= gate)
  const watchlist = scored.filter((s) => s.votes.length < gate).slice(0, WATCHLIST_SIZE)

  // The label baseline: hit and flop rates pooled over the top ranked studios' votes (none ranked: 0).
  const pool = ranked.slice(0, LABEL_POOL)
  const pooled = (rate: (s: (typeof pool)[number]) => number) => {
    const mass = pool.reduce((a, s) => a + rateMass(s.votes), 0)
    return mass ? pool.reduce((a, s) => a + rate(s) * rateMass(s.votes), 0) / mass : 0
  }
  const hitLine = pooled((s) => s.hitRate) + LABEL_MARGIN
  const flopLine = pooled((s) => s.flopRate) + LABEL_MARGIN
  const labelled = (s: (typeof scored)[number]): StudioScore => ({ ...s, label: labelOf(s.hitRate > hitLine, s.flopRate > flopLine) })

  return {
    ok: true,
    topStudios: {
      studios: ranked.map(labelled),
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
const rateMass = (votes: readonly StudioVote[]) => votes.reduce((a, v) => a + v.rateWeight, 0)

/** The rate-weighted share of the votes that pass `test`. */
function rateOf(votes: readonly StudioVote[], test: (v: StudioVote) => boolean): number {
  return votes.reduce((a, v) => a + (test(v) ? v.rateWeight : 0), 0) / rateMass(votes)
}

/** Each vote's Franchise, as the index of one of its titles: the studio's titles joined by SEQUEL/PREQUEL. */
function franchisesOf(votes: ReadonlyArray<{ title: StudioTitle }>): number[] {
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
 * n_love: a soft count of the studio's loved works, not titles. Its titles joined by SEQUEL/PREQUEL form one
 * franchise, worth at most 1 (its best vote). Fav split: in a franchise with two or more favourites, each favourite
 * counts on its own and the rest stays one.
 */
function loveCount(votes: readonly StudioVote[]): number {
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

/** A vote's utility e^(αz): what it is worth to its studio. Ū is the user's W-weighted mean of these. */
export function utility(z: number): number {
  return Math.exp(ALPHA * z)
}

/** What one vote at this score is worth on the user's scale: e^(αz). Average studio ≈ the user's average of these. */
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
